// Scraper Bike-Discount (DE/FR, EUR — Shopware 6, Cloudflare)
// --------------------------------------------------------------------------
// Protocole (cf. PROTOCOLES.md) :
//   GET https://www.bike-discount.de/fr/search?search=<terme>
//   Réponse : HTML rendu côté serveur (Shopware 6, thème nelebiketheme).
//   Redirige vers la page de marque si la recherche correspond à une marque.
//   Pas d'anti-bot agressif — Cloudflare mais pas de challenge JS.
//   axios fonctionne directement (pas besoin de Playwright).
//
// Champs utiles (structure HTML du thème Shopware nelebiketheme) :
//   <div class="card product-box" data-product-information='{"id":"...","name":"...","brand":"...","price":9.99}'>
//     <a href="https://www.bike-discount.de/fr/<slug>" title="<title>" class="product-image-link">
//       <img data-src="<url>" .../>
//     </a>
//     <div class="product-price-wrapper">
//       <span class="list-price-price">19,00 €</span>  ← prix barré (PVC)
//       <span class="product-price">9,99 €</span>       ← prix actuel
//     </div>
//     <div class="product-badges">                       ← badges (promo, nouveau, etc.)
//
// Pagination : ?p=N (Shopware standard). 24-48 produits par page.
//
// Pièges :
//   - Le site redirige /fr/search?search=castelli vers /fr/castelli (page marque).
//     Il faut suivre les redirections (axios le fait avec maxRedirects: 5).
//   - Les images utilisent data-src (lazy loading) — prendre data-src, pas src.
//   - Les prix sont au format français "9,99 €" (virgule décimale).
//   - data-product-information contient déjà le nom, la marque et le prix en JSON.
// --------------------------------------------------------------------------
import * as cheerio from "cheerio";
import { SiteMeta, ProductResult, Scraper } from "../types";
import { fetchHtml, parsePrice, absUrl, cleanTitle } from "../http";

export const site: SiteMeta = {
  id: "bikediscount",
  name: "Bike-Discount",
  baseUrl: "https://www.bike-discount.de",
  country: "DE",
  currency: "EUR",
  accent: "bg-orange-100 text-orange-800 border-orange-200",
  groups: ["cycling"],
};

export const scraper: Scraper = {
  site,
  capabilities: {
    engine: "html",
    relevance: "strict",
  },
  async search(query, signal) {
    const url = `${site.baseUrl}/fr/search?search=${encodeURIComponent(query)}`;
    const { html } = await fetchHtml(url, {
      signal,
      referer: `${site.baseUrl}/fr`,
      timeoutMs: 25000,
      playwrightFallback: true,
    });

    const $ = cheerio.load(html);
    const products: ProductResult[] = [];
    const seen = new Set<string>();

    // Bike-Discount uses Shopware 6 with data-product-information JSON on each .product-box
    $(".product-box").slice(0, 24).each((_, el) => {
      const $el = $(el);

      // Try to parse the embedded JSON data
      let productData: any = {};
      const dataAttr = $el.attr("data-product-information");
      if (dataAttr) {
        try {
          productData = JSON.parse(dataAttr);
        } catch {
          // If parsing fails, continue without it
        }
      }

      // URL — from the product image link
      const $link = $el.find(".product-image-link, a[title]").first();
      const href = absUrl($link.attr("href"), site.baseUrl);
      if (!href || seen.has(href)) return;

      // Title — from JSON data, link title, or link text
      const title = cleanTitle(productData.name || $link.attr("title") || $link.text());
      if (!title) return;
      seen.add(href);

      // Brand — from JSON data
      const brand = productData.brand || undefined;

      // Price — prefer JSON data (it's the correct current price)
      let price: number | null = null;
      let originalPrice: number | null = null;
      let discount: number | null = null;

      if (productData.price) {
        price = productData.price;
      }

      // Original price (PVC) — from .list-price-price element
      const listPriceText = $el.find(".list-price-price").first().text().trim();
      if (listPriceText) {
        // Remove "PVC*" prefix if present
        const cleanPrice = listPriceText.replace(/^PVC\*?\s*/i, "").trim();
        originalPrice = parsePrice(cleanPrice);
      }

      // If no JSON price, extract current price from the product-price span
      // (it contains both PVC and current price — take the last number)
      if (price === null) {
        const priceText = $el.find(".product-price").last().text().trim();
        // The span contains "PVC*\n180,00 €\n\n117,00 €" — parse the last price
        const priceMatches = priceText.match(/[\d\s,.]+\s*€/g);
        if (priceMatches && priceMatches.length > 0) {
          price = parsePrice(priceMatches[priceMatches.length - 1]);
        }
      }

      if (originalPrice && price && originalPrice > price) {
        discount = Math.round((1 - price / originalPrice) * 100);
      }

      // Image — use data-src (lazy loading), fallback to src
      const img =
        $el.find("img").first().attr("data-src") ||
        $el.find("img").first().attr("src") ||
        null;

      // Availability
      const cardText = $el.text().toLowerCase();
      let availability: ProductResult["availability"] = "unknown";
      if (cardText.includes("épuisé") || cardText.includes("indisponible") || cardText.includes("out of stock")) {
        availability = "out_of_stock";
      } else if (price !== null) {
        availability = "in_stock";
      }

      products.push({
        site: "bikediscount",
        siteName: site.name,
        title: brand ? `${title} — ${brand}` : title,
        brand,
        url: href,
        price,
        originalPrice,
        currency: "EUR",
        image: absUrl(img, site.baseUrl),
        availability,
        discount,
      });
    });

    return products;
  },
};
