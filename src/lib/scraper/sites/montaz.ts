// Scraper Montaz (FR, EUR)
// --------------------------------------------------------------------------
// Protocole (cf. PROTOCOLES.md) :
//   GET https://www.montaz.com/global-search.html?keyword=<terme>
//   Aucune authentification.
//   robots.txt déconseille la recherche : usage personnel seulement.
//
// Particularité : tout est dans des attributs data-*, RIEN dans le texte.
//
// Champs utiles :
//   .product-card-image[data-product][data-prix-final]  → carte produit
//   @data-name           → libellé
//   @data-prix-final     → prix payé
//   @data-prix-unitaire  → prix catalogue (renseigné même hors promotion)
//   @data-marque         → marque
//   @data-link           → lien produit
//   @data-img             → image
// --------------------------------------------------------------------------
import * as cheerio from "cheerio";

import { SiteMeta, ProductResult, Scraper } from "../types";

import { fetchHtml, parsePrice, absUrl } from "../http";

export const site: SiteMeta = {
  id: "montaz",
  name: "Montaz",
  baseUrl: "https://www.montaz.com",
  country: "FR",
  currency: "EUR",
  accent: "bg-emerald-100 text-emerald-800 border-emerald-200",
  groups: ["all"],
};

/**
 * Parse Montaz search results HTML into ProductResult[].
 *
 * Extracted as a pure function so it can be unit-tested with HTML fixtures
 * (tests/fixtures/montaz/search.html) without network access.
 */
export function parseHtml(html: string): ProductResult[] {
  const $ = cheerio.load(html);
  const products: ProductResult[] = [];
  const seen = new Set<string>();

  // Les cartes portent .product-card-image avec des data-attrs
  const cards = $(".product-card-image[data-prix-final], .product-card-image[data-product]").toArray();
  cards.slice(0, 24).forEach((el) => {
    const $el = $(el);
    const name = ($el.attr("data-name") || "").trim();
    const prixFinalRaw = ($el.attr("data-prix-final") || "").trim();
    const prixUnitaireRaw = ($el.attr("data-prix-unitaire") || "").trim();
    const marque = ($el.attr("data-marque") || "").trim();
    const linkRaw = ($el.attr("data-link") || "").trim();
    const imgRaw = ($el.attr("data-img") || "").trim();
    if (!name) return;

    const href = absUrl(linkRaw, site.baseUrl);
    if (!href || seen.has(href)) return;
    seen.add(href);

    const price = parsePrice(prixFinalRaw);
    // data-prix-unitaire est renseigné même hors promo :
    // ne le considérer comme « prix barré » que s'il est strictement supérieur au prix payé.
    const originalPrice = parsePrice(prixUnitaireRaw);
    const realOriginal =
      originalPrice && price && originalPrice > price ? originalPrice : null;
    const discount =
      realOriginal && price
        ? Math.round((1 - price / realOriginal) * 100)
        : null;

    products.push({
      site: "montaz",
      siteName: site.name,
      title: marque ? `${marque} ${name}` : name,
      url: href,
      price,
      originalPrice: realOriginal,
      currency: "EUR",
      image: absUrl(imgRaw, site.baseUrl),
      availability: "unknown",
      discount,
    });
  });

  return products;
}

export const scraper: Scraper = {
  site,
  capabilities: { engine: "html" },
  async search(query, signal) {
    const url = `${site.baseUrl}/global-search.html?keyword=${encodeURIComponent(query)}`;
    const { html } = await fetchHtml(url, {
      signal,
      referer: site.baseUrl,
      timeoutMs: 25000,
    });
    return parseHtml(html);
  },
};
