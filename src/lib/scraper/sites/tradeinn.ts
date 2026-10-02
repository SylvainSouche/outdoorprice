// Scraper Tradeinn (ES, EUR)
// --------------------------------------------------------------------------
// Protocole (cf. PROTOCOLES.md) :
//   POST https://www.tradeinn.com/listado.php
//   Aucune authentification. visitorid généré, jamais recopié d'un relevé.
//
// Requête (formulaire) :
//   action=buscador_google
//   palabras=<terme>
//   id_tienda=0
//   nextToken=null
//   idioma=fre
//   visitorid=<généré>
//
// Champs utiles :
//   results[].product.title              → libellé
//   product.brands[0]                    → marque
//   product.availability                 → IN_STOCK ou non
//   product.audience.genders              → genre
//   attributes.price_all_<a>_to_<b>     → grilles "idPays:montant"
//                                          → 228 prix par produit, par pays
//
// Pièges :
//   - AUCUN champ prix direct : 23 grilles de prix par pays, en devise locale
//   - Le groupe France a été identifié en comparant un prix affiché sur le site
//   - L'URL /fr?query=… ne sert que de lien : paramètre ignoré côté serveur
//   - Pagination par curseur nextToken, jamais observée en pratique
//   - Tradeinn bloque les data-centers (Cloudflare) : on utilise Playwright
//     pour exécuter fetch() depuis un vrai navigateur après avoir résolu le
//     challenge Cloudflare.
// --------------------------------------------------------------------------
import { SiteMeta, ProductResult, Scraper } from "../types";

import { absUrl, fetchJsonPostViaPlaywright } from "../http";

// Identifiant du groupe de prix France. Trouvé en comparant un prix
// affiché sur le site avec l'attribut price_all_X_to_Y correspondant.
// Les attributs réels sont des BUCKETS (ex: price_all_61_to_70) contenant
// des entrées "idPays:montant" — on cherche l'entrée "70:…" partout.
const FR_COUNTRY_ID = "70";

interface TradeinnProduct {
  id?: string;
  title?: string;
  brands?: string[];
  availability?: string;
  image?: string;
  images?: { uri?: string; url?: string }[];
  url?: string;
  uri?: string;
  attributes?: Record<string, { text?: string[] } | string | string[]>;
  audience?: { genders?: string[] };
  childSku?: string;
  sku?: string;
}

interface TradeinnResponse {
  results?: { product: TradeinnProduct }[];
  nextPageToken?: string | null;
}

/** Génère un visitorid au format observé : "<unix_seconds>.<rand>". */
function genVisitorId(): string {
  return `${Math.floor(Date.now() / 1000)}.${Math.floor(Math.random() * 1e10)}`;
}

/** Extrait le prix France : scanne tous les buckets attributes.price_all_X_to_Y
 *  (format {text: ["61:…", …, "70:124.99"]}) et renvoie l'entrée "70:…". */
function extractFrPrice(attrs?: TradeinnProduct["attributes"]): number | null {
  if (!attrs) return null;
  for (const [key, value] of Object.entries(attrs)) {
    if (!key.startsWith("price_all_")) continue;
    // Normalise en liste de chaînes : {text: [...]} | "a" | ["a"]
    const entries: string[] = Array.isArray(value)
      ? value.map(String)
      : typeof value === "object" && value !== null && Array.isArray(value.text)
        ? value.text.map(String)
        : [String(value)];
    for (const e of entries) {
      const m = e.match(new RegExp(`^${FR_COUNTRY_ID}\\s*[:=]\\s*(\\d+(?:[.,]\\d+)?)$`));
      if (m) return parseFloat(m[1].replace(",", "."));
    }
  }
  return null;
}

export const site: SiteMeta = {
  id: "tradeinn",
  name: "Tradeinn",
  baseUrl: "https://www.tradeinn.com",
  country: "ES",
  currency: "EUR",
  accent: "bg-rose-100 text-rose-800 border-rose-200",
  groups: ["all"],
};

/**
 * Parse Tradeinn API response (JSON) into ProductResult[].
 *
 * Extracted as a pure function so it can be unit-tested with JSON fixtures
 * (tests/fixtures/tradeinn/search.json) without needing Playwright.
 *
 * Tradeinn's API returns products in `data.results[].product`. Each product
 * has 23 country-specific price buckets (attributes.price_all_X_to_Y) —
 * we extract the one for France (id=70).
 */
export function parseResults(data: TradeinnResponse): ProductResult[] {
  if (!data || !data.results) return [];
  const items = data.results;
  const products: ProductResult[] = [];
  const seen = new Set<string>();

  items.slice(0, 24).forEach((r) => {
    const p = r.product;
    if (!p) return;
    const title = (p.title || "").trim();
    if (!title) return;
    const brand = p.brands?.[0];
    const sku = p.childSku || p.sku || p.id || "";
    // La réponse réelle met l'URL dans product.uri (avec params de tracking)
    const linkRaw = p.uri || p.url || (sku ? `${site.baseUrl}/fr/${sku}` : "");
    const href = absUrl(linkRaw.split("?")[0], site.baseUrl);
    if (!href || seen.has(href)) return;
    seen.add(href);

    const imgRaw =
      p.image || (p.images?.[0]?.uri ?? p.images?.[0]?.url ?? "");
    const price = extractFrPrice(p.attributes);
    const inStock = (p.availability || "").toUpperCase() === "IN_STOCK";

    products.push({
      site: "tradeinn",
      siteName: site.name,
      title: brand ? `${brand} ${title}` : title,
      url: href,
      price,
      originalPrice: null,
      currency: "EUR",
      image: absUrl(imgRaw, site.baseUrl),
      availability: inStock ? "in_stock" : "out_of_stock",
      availabilityLabel: inStock ? "En stock" : "Rupture",
      discount: null,
    });
  });

  return products;
}

export const scraper: Scraper = {
  site,
  capabilities: { engine: "rest", usesPlaywright: true, challenge: true },
  async search(query, signal) {
    const apiUrl = `${site.baseUrl}/listado.php`;
    const bodyForm: Record<string, string> = {
      action: "buscador_google",
      palabras: query,
      // id_tienda = boutique : 3 = Trekkinn (outdoor), 10 = Runnerinn.
      // Le contexte de l'app est outdoor → Trekkinn.
      id_tienda: "3",
      nextToken: "null",
      idioma: "fra",
      visitorid: genVisitorId(),
    };

    const data = (await fetchJsonPostViaPlaywright(apiUrl, {
      method: "POST",
      bodyForm,
      headers: {
        Origin: site.baseUrl,
      },
      referer: `${site.baseUrl}/trekkinn/fr`,
      bootstrapUrl: `${site.baseUrl}/trekkinn/fr`,
      timeoutMs: 30000,
      signal,
    })) as TradeinnResponse;

    return parseResults(data);
  },
};
