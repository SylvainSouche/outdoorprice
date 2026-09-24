// Scraper Conrad Sport (CH, CHF)
// Recherche : https://www.conrad-sport.ch/fr/recherche?q={q}
import * as cheerio from "cheerio";
import { fetchHtml, parsePrice, absUrl, cleanTitle } from "../http";
import { SITES, ProductResult, Scraper } from "../types";

export const conradsportScraper: Scraper = {
  site: SITES.conradsport,
  async search(query, signal) {
    const url = `${SITES.conradsport.baseUrl}/fr/recherche?q=${encodeURIComponent(query)}`;
    const { html } = await fetchHtml(url, { signal, referer: SITES.conradsport.baseUrl });
    const $ = cheerio.load(html);
    const products: ProductResult[] = [];

    const cards = $(
      '.product, .product-item, .product-card, .list-item, [data-product], article.product, .product-listing-item'
    ).toArray();

    cards.slice(0, 24).forEach((el) => {
      const $el = $(el);
      const title =
        cleanTitle($el.find('.product-name, .product-title, .name, h3 a, h4 a, a.title').first().text()) ||
        cleanTitle($el.find('a').first().attr('title') || "");
      const href = absUrl(
        $el.find('a.product-name, a.product-title, a.name, a[href*="/"]').first().attr('href'),
        SITES.conradsport.baseUrl
      );
      const priceRaw =
        $el.find('.price, .product-price, [itemprop="price"]').first().text() ||
        $el.find('[itemprop="price"][content]').attr('content') || "";
      const originalRaw =
        $el.find('.old-price, .regular-price, del, .price-old, .was-price, .strike').first().text() || "";
      const img =
        $el.find('img').first().attr('src') ||
        $el.find('img').first().attr('data-src') ||
        $el.find('img').first().attr('data-original') ||
        null;
      if (!title || !href) return;
      const price = parsePrice(priceRaw);
      const originalPrice = parsePrice(originalRaw);
      const discount =
        originalPrice && price && originalPrice > price
          ? Math.round((1 - price / originalPrice) * 100)
          : null;
      products.push({
        site: "conradsport",
        siteName: SITES.conradsport.name,
        title,
        url: href,
        price,
        originalPrice: originalPrice || null,
        currency: "CHF",
        image: absUrl(img, SITES.conradsport.baseUrl),
        availability: "unknown",
        discount,
      });
    });

    return products;
  },
};
