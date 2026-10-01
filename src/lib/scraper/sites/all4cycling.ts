// Scraper All4cycling (FR / IT, EUR — Shopify-based)
// --------------------------------------------------------------------------
// Protocole (cf. PROTOCOLES.md) :
//   GET https://www.all4cycling.com/fr/search?q=<terme>&options[prefix]=last&page=N
//   Réponse : page HTML rendue côté serveur (Shopify Liquid theme "All4cycling v110").
//   Aucune authentification. Cloudflare peut challenger les IP data-center.
//
//   Aussi disponible (plus léger, mais limité à 6 suggestions) :
//   GET /fr/search/suggest?q=<terme>&resources[limit]=6&section_id=predictive-search
//
// Champs utiles (sélecteurs du thème Shopify) :
//   <div class="card__info">                          → carte produit (conteneur info)
//     <p class="card__vendor">Castelli</p>             → marque
//     <p class="card__title"><a href="/fr/products/X">  → titre + URL
//     <div class="price [price--sold-out|price--on-sale|price--available]">
//       <span class="price__current"><span class="js-value">€100,00</span></span>
//       <span class="price__was"><span class="js-value">€150,00</span></span>  ← prix barré
//       <span class="price__discount">-33%</span>      ← discount
//     </div>
//   <a href="/fr/products/X" class="js-prod-link">     → carte média (image)
//     <img class="card__main-image" src="...">
//
// Pagination : ?page=N (Shopify standard). 24 produits par page.
//
// Pièges :
//   - Pas de JSON-LD ItemList de produits (seulement Organization, WebPage, BikeStore).
//     Il faut parser le HTML directement.
//   - Le prix est au format français "€100,00" (avec virgule décimale).
//   - La classe `price--sold-out` indique rupture, `price--on-sale` indique promo.
//   - L'image principale a alt="" (vide) — pour le titre il faut regarder
//     card__hover-image alt OU aria-label du lien parent.
//   - L'URL produit peut contenir des paramètres de tracking (_pos, _psq, _psid, _ss)
//     qu'on doit nettoyer.
// --------------------------------------------------------------------------
import * as cheerio from "cheerio";
import { SiteMeta, ProductResult, Scraper } from "../types";

import { fetchHtml, absUrl, parsePrice, cleanTitle } from "../http";

// Nettoie les paramètres de tracking Shopify (?_pos=1&_psq=...&_psid=...&_ss=e)
function stripTrackingParams(url: string): string {
  try {
    const u = new URL(url);
    u.search = "";
    return u.toString();
  } catch {
    return url.split("?")[0];
  }
}

export const site: SiteMeta = {
  id: "all4cycling",
  name: "All4cycling",
  baseUrl: "https://www.all4cycling.com",
  country: "FR",
  currency: "EUR",
  accent: "bg-pink-100 text-pink-800 border-pink-200",
  groups: ["cycling"],
};

/**
 * Parse All4cycling search results HTML into ProductResult[].
 *
 * Extracted as a pure function so it can be unit-tested with HTML fixtures
 * (tests/fixtures/all4cycling/search.html) without network access.
 */
export function parseHtml(html: string): ProductResult[] {
  const $ = cheerio.load(html);
  const products: ProductResult[] = [];
  const seen = new Set<string>();

  // 1. Page de recherche principale — cartes dans <div class="card__info">
  $(".card__info").slice(0, 24).each((_, el) => {
    const $el = $(el);
    const $titleLink = $el.find(".card__title a").first();
    const title = cleanTitle($titleLink.text() || $titleLink.attr("aria-label"));
    if (!title) return;
    const href = absUrl($titleLink.attr("href"), site.baseUrl);
    if (!href || seen.has(href)) return;
    seen.add(href);

    const vendor = $el.find(".card__vendor").first().text().trim();
    const $price = $el.find(".price").first();
    const priceText = $price.find(".price__current .js-value").first().text().trim();
    const wasText = $price.find(".price__was .js-value").first().text().trim();
    const price = parsePrice(priceText);
    const originalPrice = parsePrice(wasText) || null;

    // Discount : soit depuis le badge price__discount, soit calculé depuis was vs price
    let discount: number | null = null;
    const discountText = $price.find(".price__discount").first().text().trim();
    const discountMatch = discountText.match(/-?\s*(\d+)\s*%/);
    if (discountMatch) {
      discount = parseInt(discountMatch[1], 10);
    } else if (originalPrice && price && originalPrice > price) {
      discount = Math.round((1 - price / originalPrice) * 100);
    }

    // Disponibilité : la classe .price indique le statut
    const priceClass = $price.attr("class") || "";
    let availability: ProductResult["availability"] = "unknown";
    if (priceClass.includes("price--sold-out")) {
      availability = "out_of_stock";
    } else if (priceClass.includes("price--on-sale") || priceClass.includes("price--available")) {
      availability = "in_stock";
    } else if (price) {
      // Si on a un prix mais pas de classe explicite, c'est probablement dispo
      availability = "in_stock";
    }

    // Image : la carte média est dans un frère .card__media du .card__info-container.
    // Structure Shopify : <div class="card__media">...<img class="card__main-image">...</div>
    //                       <div class="card__info-container"><div class="card__info">...
    // On remonte au .card__info-container, puis on cherche .card__media dans le parent commun.
    const $cardWrapper = $el.parent().parent();  // div qui contient .card__media + .card__info-container
    let img =
      $cardWrapper.find("img.card__main-image").attr("src") ||
      $cardWrapper.find("img[class*='card__main-image']").attr("src") ||
      $cardWrapper.find("img").first().attr("src") ||
      null;
    // Fallback : si pas trouvé, chercher par href dans tout le document
    if (!img) {
      const $matchingMediaLink = $(`a[href^="${href.replace(/\/$/, "")}"]`).first();
      img = $matchingMediaLink.find("img.card__main-image").attr("src") ||
            $matchingMediaLink.find("img").first().attr("src") ||
            null;
    }
    // Normaliser les URLs CDN Shopify (//www → https://www)
    if (img && img.startsWith("//")) {
      img = "https:" + img;
    }

    products.push({
      site: "all4cycling",
      siteName: site.name,
      title: vendor ? `${title} — ${vendor}` : title,
      brand: vendor || undefined,
      url: stripTrackingParams(href),
      price,
      originalPrice,
      currency: "EUR",
      image: absUrl(img, site.baseUrl),
      availability,
      discount,
    });
  });

  // 2. Fallback : si la page principale n'a pas de .card__info (parfois le thème
  //    rend en mode "predictive" uniquement), utiliser les .predictive-result
  if (products.length === 0) {
    $(".predictive-result").slice(0, 24).each((_, el) => {
      const $el = $(el);
      const href = absUrl($el.attr("href"), site.baseUrl);
      if (!href || seen.has(href)) return;
      seen.add(href);
      const title = cleanTitle($el.find(".predictive-result__title").text() || $el.attr("aria-label"));
      if (!title) return;
      const vendor = $el.find(".predictive-result__sub-title").text().trim();
      const $price = $el.find(".price").first();
      const price = parsePrice($price.find(".price__current .js-value").text());
      const originalPrice = parsePrice($price.find(".price__was .js-value").text()) || null;
      const img = $el.find(".predictive-result__media").attr("src") || $el.find("img").first().attr("src") || null;
      const priceClass = $price.attr("class") || "";
      let availability: ProductResult["availability"] = "unknown";
      if (priceClass.includes("price--sold-out")) availability = "out_of_stock";
      else if (price) availability = "in_stock";
      products.push({
        site: "all4cycling",
        siteName: site.name,
        title: vendor ? `${title} — ${vendor}` : title,
        brand: vendor || undefined,
        url: stripTrackingParams(href),
        price,
        originalPrice,
        currency: "EUR",
        image: absUrl(img, site.baseUrl),
        availability,
        discount: originalPrice && price && originalPrice > price
          ? Math.round((1 - price / originalPrice) * 100)
          : null,
      });
    });
  }

  return products;
}

export const scraper: Scraper = {
  site,
  capabilities: { engine: "html", usesPlaywright: true, relevance: "strict" },
  async search(query, signal) {
    const url = `${site.baseUrl}/fr/search?options%5Bprefix%5D=last&q=${encodeURIComponent(query)}`;
    const { html } = await fetchHtml(url, {
      signal,
      referer: site.baseUrl,
      timeoutMs: 25000,
      playwrightFallback: true,
      waitForSelector: ".card__info, .predictive-result",
    });
    return parseHtml(html);
  },
};
