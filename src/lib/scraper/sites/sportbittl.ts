// Scraper Sport Bittl (DE, EUR)
// --------------------------------------------------------------------------
// Protocole (cf. PROTOCOLES.md) :
//   GET https://www.sport-bittl.com/search.php?query=<terme>
//   Aucune authentification.
//   Page HTML rendue côté serveur, sélection par CSS.
//
// Champs utiles :
//   div.product-thumb-info               → carte produit
//   span.product-name                    → libellé
//   span.product-price.is-reduced        → prix payé (uniquement si promo)
//   span.product-price.is-original       → prix conseillé (suffixé "RRP")
//   span.product-brand                   → marque
//   a.product-title                      → lien produit
//
// Pièges :
//   - is-reduced n'existe que sur les articles en promotion : s'y limiter
//     perd les produits plein tarif. On lit donc product-price générique.
//   - Chaque carte porte DEUX spans de prix (un régulier, un barré si promo)
//   - is-price-type-1 n'a pas été élucidé (ignoré)
// --------------------------------------------------------------------------
import * as cheerio from "cheerio";

import { SiteMeta, ProductResult, Scraper } from "../types";

import { fetchHtml, parsePrice, absUrl, cleanTitle } from "../http";

export const site: SiteMeta = {
  id: "sportbittl",
  name: "Sport Bittl",
  baseUrl: "https://www.sport-bittl.com",
  country: "DE",
  currency: "EUR",
  accent: "bg-amber-100 text-amber-800 border-amber-200",
  groups: ["all"],
};

export const scraper: Scraper = {
  site,
    capabilities: { engine: "html" },
  async search(query, signal) {
    const url = `${site.baseUrl}/search.php?query=${encodeURIComponent(query)}`;
    const { html } = await fetchHtml(url, {
      signal,
      referer: site.baseUrl,
      timeoutMs: 25000,
    });
    const $ = cheerio.load(html);
    const products: ProductResult[] = [];
    const seen = new Set<string>();

    const cards = $("div.product-thumb-info").toArray();
    cards.slice(0, 24).forEach((el) => {
      const $el = $(el);
      const title = cleanTitle($el.find("span.product-name").first().text());
      if (!title) return;
      // Lien produit
      const href = absUrl(
        $el.find("a.product-title").first().attr("href") ||
          $el.find("a[href]").first().attr("href"),
        site.baseUrl
      );
      if (!href || seen.has(href)) return;
      seen.add(href);

      // Prix payé : is-reduced si promo, sinon le .product-price par défaut
      let priceRaw = $el.find("span.product-price.is-reduced").first().text().trim();
      let originalRaw = $el.find("span.product-price.is-original").first().text().trim();
      if (!priceRaw) {
        // Pas en promo : lire le span de prix générique
        priceRaw = $el.find("span.product-price").first().text().trim();
        originalRaw = "";
      }
      // is-original est suffixé "RRP" (Recommended Retail Price) → on retire
      originalRaw = originalRaw.replace(/\bRRP\b/gi, "").trim();

      const brand = cleanTitle($el.find("span.product-brand").first().text()) || undefined;
      const img =
        $el.find("img").first().attr("src") ||
        $el.find("img").first().attr("data-src") ||
        null;

      const price = parsePrice(priceRaw);
      const originalPrice = parsePrice(originalRaw);
      const discount =
        originalPrice && price && originalPrice > price
          ? Math.round((1 - price / originalPrice) * 100)
          : null;

      products.push({
        site: "sportbittl",
        siteName: site.name,
        title: brand ? `${brand} ${title}` : title,
        url: href,
        price,
        originalPrice: originalPrice || null,
        currency: "EUR",
        image: absUrl(img, site.baseUrl),
        availability: "unknown",
        discount,
      });
    });

    return products;
  },
};
