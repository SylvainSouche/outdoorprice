// Scraper DeporVillage (FR, EUR)
// --------------------------------------------------------------------------
// Protocole :
//   GET https://www.deporvillage.fr/catalogsearch/result?q=<terme>
//   Site Next.js + Algolia InstantSearch (résultats SSR dans le HTML).
//   Aucune authentification, mais Cloudflare peut challenger.
//
// Champs utiles (HTML rendu côté serveur) :
//   [data-testid="product-card"]               → carte produit
//   a[title]                                    → libellé (attribut title)
//   a[href]                                     → URL produit
//   [data-testid="product-generic-price"] span → prix payé
//   [data-testid="product-generic-price"] del  → prix barré
//   img[src]                                    → image
//   data-insights-object-id                     → ID Algolia
//
// Pièges :
//   - Cloudflare peut challenger les IP data-center → fallback Playwright
//   - Le prix est au format français "74,95 €"
//   - L'image utilise CDN Cloudflare avec transformations (w=,h=,dpr=,q=)
// --------------------------------------------------------------------------
import * as cheerio from "cheerio";
import { SiteMeta, ProductResult, Scraper } from "../types";

import { fetchHtml, absUrl, parsePrice, cleanTitle } from "../http";

export const site: SiteMeta = {
  id: "deporvillage",
  name: "DeporVillage",
  baseUrl: "https://www.deporvillage.fr",
  country: "FR",
  currency: "EUR",
  accent: "bg-violet-100 text-violet-800 border-violet-200",
  groups: ["all", "cycling"],
};

export const scraper: Scraper = {
  site,
  capabilities: { engine: "html", usesPlaywright: true, relevance: "strict" },
  async search(query, signal) {
    const url = `${site.baseUrl}/catalogsearch/result?q=${encodeURIComponent(query)}`;
    const { html } = await fetchHtml(url, {
      signal,
      referer: site.baseUrl,
      timeoutMs: 25000,
      playwrightFallback: true,
      waitForSelector: '[data-testid="product-card"]',
    });

    const $ = cheerio.load(html);
    const products: ProductResult[] = [];
    const seen = new Set<string>();

    $('[data-testid="product-card"]').slice(0, 24).each((_, el) => {
      const $el = $(el);
      const $link = $el.find("a").first();
      const title = cleanTitle($link.attr("title") || $el.find("a").first().text());
      if (!title) return;
      const href = absUrl($link.attr("href"), site.baseUrl);
      if (!href || seen.has(href)) return;
      seen.add(href);

      const $price = $el.find('[data-testid="product-generic-price"]').first();
      const priceText = $price.find("span").first().text().trim();
      const originalText = $price.find("del").first().text().trim();
      const price = parsePrice(priceText);
      const originalPrice = parsePrice(originalText) || null;

      const img = $el.find("img").first().attr("src") ||
        $el.find("img").first().attr("data-src") ||
        $el.find("source").first().attr("srcSet")?.split(" ")[0] ||
        null;

      const discount =
        originalPrice && price && originalPrice > price
          ? Math.round((1 - price / originalPrice) * 100)
          : null;

      products.push({
        site: "deporvillage",
        siteName: site.name,
        title,
        url: href,
        price,
        originalPrice,
        currency: "EUR",
        image: absUrl(img, site.baseUrl),
        availability: "unknown",
        discount,
      });
    });

    return products;
  },
};
