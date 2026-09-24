// Scraper Au Vieux Campeur (FR, EUR)
// Recherche : https://www.au-vieux-campeur.com/recherche?text={q}
import * as cheerio from "cheerio";
import { fetchHtml, parsePrice, absUrl, cleanTitle } from "../http";
import { SITES, ProductResult, Scraper } from "../types";

export const vieuxcampeurScraper: Scraper = {
  site: SITES.vieuxcampeur,
  async search(query, signal) {
    const url = `${SITES.vieuxcampeur.baseUrl}/recherche?text=${encodeURIComponent(query)}`;
    const { html } = await fetchHtml(url, { signal, referer: SITES.vieuxcampeur.baseUrl });
    const $ = cheerio.load(html);
    const products: ProductResult[] = [];

    const cards = $(
      '.product, .product-item, .product-card, .list-item, [data-product], article.product, .product-list-item'
    ).toArray();

    cards.slice(0, 24).forEach((el) => {
      const $el = $(el);
      const title =
        cleanTitle($el.find('.product-name, .product-title, .name, h3 a, h4 a, a.title').first().text()) ||
        cleanTitle($el.find('a').first().attr('title') || "");
      const href = absUrl(
        $el.find('a.product-name, a.product-title, a.name, a[href*="/"]').first().attr('href'),
        SITES.vieuxcampeur.baseUrl
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
        site: "vieuxcampeur",
        siteName: SITES.vieuxcampeur.name,
        title,
        url: href,
        price,
        originalPrice: originalPrice || null,
        currency: "EUR",
        image: absUrl(img, SITES.vieuxcampeur.baseUrl),
        availability: "unknown",
        discount,
      });
    });

    return products;
  },
};
