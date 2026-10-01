// Scraper Bergzeit (FR, EUR)
// --------------------------------------------------------------------------
// Protocole (cf. PROTOCOLES.md) :
//   GET https://www.bergzeit.fr/search/?q=<terme>&p=<page>
//   Aucune authentification.
//   Les données ne sont PAS dans le HTML rendu : elles sont dans un état
//   applicatif Vue sérialisé dans window.__initialAppState.
//   On extrait ce JSON via une regex sur la page servie.
//
// Champs utiles :
//   modules.productsListPage.elementsList[]  → liste des produits
//     .data.name             → libellé
//     .data.url              → lien produit (relatif)
//     .data.price.current    → prix payé
//     .data.price.old        → ancien prix (vaut « 0,00 € » hors promotion)
//     .data.price.previous   → prix conseillé fabricant (PAS un prix barré)
//     .data.images[0].src    → image (absolute)
//     .data.brand.name       → marque
//     .data.variations[import:manufacturer_size] → tailles
//
// Pièges :
//   - data.price.previous est le prix conseillé du fabricant, pas l'ancien prix
//   - Le JSON-LD liste les produits mais SANS aucun prix
//   - ms=true&filters ne renvoie que les facettes : pas de variante « produits »
//   - Les tailles doubles « 42.5|43 » doivent être séparées
// --------------------------------------------------------------------------
import * as cheerio from "cheerio";

import { SiteMeta, ProductResult, Scraper } from "../types";

import { fetchHtml, parsePrice, absUrl, cleanTitle } from "../http";

interface BzPrice {
  current?: string;
  old?: string;
  previous?: string;
}

interface BzElement {
  type?: string;
  data?: {
    name?: string;
    url?: string;
    sku?: string;
    brand?: { name?: string };
    images?: { alt?: string; src?: string; title?: string }[];
    sizedImages?: Record<string, string>;
    price?: BzPrice;
    variations?: Record<string, string[]>;
    manyAvailableSizes?: string[];
  };
}

interface BzAppState {
  modules?: {
    productsListPage?: {
      elementsList?: BzElement[];
    };
  };
}

/** Extrait window.__initialAppState du HTML servie. */
export function extractInitialState(html: string): BzAppState | null {
  // Le state est sérialisé sous la forme :
  //   <script>window.__initialAppState = { ... };</script>
  // Attention : c'est un objet littéral JavaScript (clés non quotées,
  // guillemets simples, JSON.parse() imbriqués), pas du JSON strict.
  // On extrait le contenu du <script> et on l'évalue via Function().
  const idx = html.indexOf("window.__initialAppState");
  if (idx < 0) return null;
  // Trouve la fin du <script> qui contient l'affectation.
  const scriptEnd = html.indexOf("</script>", idx);
  if (scriptEnd < 0) return null;
  const scriptStart = html.lastIndexOf("<script>", idx);
  const scriptContent = html.slice(scriptStart + "<script>".length, scriptEnd);
  // Strip "window.__initialAppState = " prefix et le ";" final éventuel.
  const eqIdx = scriptContent.indexOf("window.__initialAppState");
  if (eqIdx < 0) return null;
  let body = scriptContent.slice(eqIdx + "window.__initialAppState".length);
  // Supprime les "=" et les espaces
  body = body.replace(/^\s*=\s*/, "");
  // Supprime le ";" final et les espaces
  body = body.replace(/\s*;?\s*$/, "");
  try {
     
    const fn = new Function(`return (${body});`);
    return fn() as BzAppState;
  } catch {
    // Si l'évaluation échoue (corps trop gros / trop exotique), tente un
    // repli : ne garder que le tableau elementsList, qui lui est du JSON valide.
    const elIdx = body.indexOf("elementsList:");
    if (elIdx < 0) return null;
    // Trouve le crochet ouvrant après "elementsList:"
    const arrStart = body.indexOf("[", elIdx);
    if (arrStart < 0) return null;
    // Compte les brackets pour trouver la fin du tableau
    let depth = 0;
    let inStr = false;
    let esc = false;
    let arrEnd = -1;
    for (let i = arrStart; i < body.length; i++) {
      const c = body[i];
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === "[") depth++;
      else if (c === "]") {
        depth--;
        if (depth === 0) { arrEnd = i + 1; break; }
      }
    }
    if (arrEnd < 0) return null;
    const arrBody = body.slice(arrStart, arrEnd);
    try {
      const elements = JSON.parse(arrBody);
      return { modules: { productsListPage: { elementsList: elements } } } as BzAppState;
    } catch {
      return null;
    }
  }
}

/** Normalise une chaîne de prix Bergzeit ("12,95 €" → 12.95). */
function bzPrice(s: string | undefined): number | null {
  if (!s) return null;
  // "0,00 €" → 0, mais on garde null pour les prix nuls
  const n = parsePrice(s);
  if (n === null) return null;
  if (n === 0) return null; // 0 € = pas de prix valide
  return n;
}

export const site: SiteMeta = {
  id: "bergzeit",
  name: "Bergzeit",
  baseUrl: "https://www.bergzeit.fr",
  country: "FR",
  currency: "EUR",
  accent: "bg-lime-100 text-lime-800 border-lime-200",
  groups: ["all"],
};

export const scraper: Scraper = {
  site,
    capabilities: { engine: "html" },
  async search(query, signal) {
    const url = `${site.baseUrl}/search/?q=${encodeURIComponent(query)}&p=1`;
    const { html } = await fetchHtml(url, {
      signal,
      referer: site.baseUrl,
      timeoutMs: 25000,
      // Bergzeit rend côté serveur avec l'état Vue inline : axios suffit.
      // On garde le fallback Playwright au cas où l'IP est bloquée.
    });

    const products: ProductResult[] = [];
    const seen = new Set<string>();

    // 1) État applicatif inline (voie principale documentée)
    const state = extractInitialState(html);
    const elements = state?.modules?.productsListPage?.elementsList ?? [];
    if (elements.length) {
      for (const el of elements.slice(0, 24)) {
        const d = el.data || {};
        const title = cleanTitle(d.name || "");
        if (!title) continue;
        const href = absUrl(d.url, site.baseUrl);
        if (!href || seen.has(href)) continue;
        seen.add(href);
        const price = bzPrice(d.price?.current);
        const originalPrice = bzPrice(d.price?.old);
        // previous = prix conseillé fabricant, ne PAS l'utiliser comme prix barré
        const img = absUrl(
          d.images?.[0]?.src || d.sizedImages?.regular || null,
          site.baseUrl
        );
        const brand = d.brand?.name;
        const discount =
          originalPrice && price && originalPrice > price
            ? Math.round((1 - price / originalPrice) * 100)
            : null;
        products.push({
          site: "bergzeit",
          siteName: site.name,
          title: brand ? `${brand} ${title}` : title,
          url: href,
          price,
          originalPrice: originalPrice || null,
          currency: "EUR",
          image: img,
          availability: "unknown",
          discount,
        });
      }
      if (products.length) return products;
    }

    // 2) Fallback : JSON-LD de la page liste (cf. protocole : produits SANS prix)
    const $ = cheerio.load(html);
    $('script[type="application/ld+json"]').each((_, el) => {
      if (products.length >= 24) return;
      const txt = $(el).text().trim();
      if (!txt || !txt.includes("Product")) return;
      try {
        const data = JSON.parse(txt);
        const items = Array.isArray(data) ? data : [data];
        for (const it of items) {
          if (it["@type"] !== "Product" && !Array.isArray(it["@type"]?.match?.(/Product/))) continue;
          const title = cleanTitle(it.name || "");
          const href = absUrl(it.url, site.baseUrl);
          if (!title || !href || seen.has(href)) continue;
          seen.add(href);
          const img = absUrl(it.image, site.baseUrl);
          // Le protocole indique que le JSON-LD liste ne contient PAS les prix
          products.push({
            site: "bergzeit",
            siteName: site.name,
            title,
            url: href,
            price: null,
            originalPrice: null,
            currency: "EUR",
            image: img,
            availability: "unknown",
            discount: null,
          });
        }
      } catch {
        /* ignore */
      }
    });

    return products;
  },
};
