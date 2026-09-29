// Scraper Sport Conrad (DE, EUR)
// --------------------------------------------------------------------------
// Protocole (cf. PROTOCOLES.md) :
//   POST https://sport-conrad.makaira.io/search/public
//   Aucune authentification. En-tête X-Makaira-Instance: live.
//
// Requête :
//   { searchPhrase, isSearch:true, enableAggregations:true, aggregations:{},
//     sorting:{}, count:"24", offset:"0", apiVersion:"2019.1.1",
//     constraints:{…}, customFilter:{…} }
//   count et offset sont des CHAÎNES. Le customFilter est obligatoire.
//
// Champs utiles :
//   product.items[].fields   → liste des produits
//     fields.price / fields.ean  → prix, EAN
//
// Pièges :
//   - Sans customFilter, Makaira répond HTTP 500
//   - count et offset en nombres provoquent un refus (doivent être des chaînes)
//   - Le customFilter n'accepte que les articles en stock et pourvus d'une image
//   - La boutique ne sert pas le français (titres en DE)
//   - Depuis un data-center, l'API peut retourner 500 ; depuis une IP résidentielle
//     le corps documenté fonctionne. On retente via Playwright sur la page HTML
//     si Makaira échoue.
// --------------------------------------------------------------------------
import axios from "axios";
import * as cheerio from "cheerio";
import { SiteMeta, ProductResult, Scraper } from "../types";

import { pickUserAgent, absUrl, fetchHtml, parsePrice, cleanTitle } from "../http";

interface MakairaProduct {
  fields?: {
    title?: string;
    price?: number | string;
    ean?: string;
    url?: string;
    link?: string;
    image?: string;
    images?: string[] | string;
    manufacturer?: string;
    brand?: string;
    instock?: number | boolean;
  };
  id?: string;
}

interface MakairaResponse {
  product?: {
    items?: MakairaProduct[];
    total?: number;
  };
}

async function tryMakaira(query: string, signal?: AbortSignal): Promise<ProductResult[]> {
  const url = "https://sport-conrad.makaira.io/search/public";
  // customFilter minimum documenté (cf. protocole : obligatoire).
  const body = {
    searchPhrase: query,
    isSearch: true,
    enableAggregations: true,
    aggregations: {},
    sorting: {},
    count: 24,          // NUMBER not string — string causes 500
    offset: "0",
    apiVersion: "2019.1.1",
    constraints: {
      "query.shop_id": 1,
      "query.use_stock": true,
      "oi.user.agent": "",
      "oi.user.ip": "",
      "oi.user.timezone": "+0200",
      "ab.experiments": null,
      "query.language": "en",
    },
    customFilter: {
      "makaira-productgroup": {
        or: [{ field: "visibleOnlyGroups", operator: "eq", value: ["none"] }],
        and: [{ attribute: "isOnStock", operator: "eq", value: ["yes"] }],
      },
      product: { not: [{ field: "picture_url_main", operator: "eq", value: false }] },
    },
  };

  const ua = pickUserAgent();
  const res = await axios.post<MakairaResponse>(url, body, {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Makaira-Instance": "live",
      "User-Agent": ua,
      "Origin": site.baseUrl,
      "Referer": `${site.baseUrl}/`,
    },
    timeout: 25000,
    signal,
    validateStatus: (s) => s < 500,
  });

  if (res.status >= 400) {
    throw new Error(`Sport Conrad: HTTP ${res.status}`);
  }

  const items = res.data?.product?.items ?? [];
  const products: ProductResult[] = [];
  const seen = new Set<string>();

  items.slice(0, 24).forEach((it) => {
    const f = it.fields ?? {};
    const title = (f.title || "").trim();
    if (!title) return;
    const linkRaw = f.url || f.link || "";
    const href = absUrl(linkRaw, site.baseUrl);
    if (!href || seen.has(href)) return;
    seen.add(href);

    const price =
      typeof f.price === "number"
        ? f.price
        : typeof f.price === "string"
        ? parseFloat(f.price.replace(",", "."))
        : null;
    const imgRaw =
      typeof f.images === "string"
        ? f.images
        : Array.isArray(f.images) && f.images.length
        ? f.images[0]
        : f.image || "";
    const brand = f.manufacturer || f.brand || undefined;

    products.push({
      site: "sportconrad",
      siteName: site.name,
      title: brand ? `${brand} ${title}` : title,
      url: href,
      price: price != null && Number.isFinite(price) ? price : null,
      originalPrice: null,
      currency: "EUR",
      image: absUrl(imgRaw, site.baseUrl),
      availability:
        f.instock === true || (typeof f.instock === "number" && f.instock > 0)
          ? "in_stock"
          : "unknown",
      discount: null,
    });
  });

  return products;
}

/** Fallback HTML via Playwright (si Makaira API indisponible). */
async function tryHtmlFallback(query: string, signal?: AbortSignal): Promise<ProductResult[]> {
  const url = `${site.baseUrl}/en/search?q=${encodeURIComponent(query)}`;
  const { html } = await fetchHtml(url, {
    signal,
    referer: site.baseUrl,
    timeoutMs: 30000,
    usePlaywright: true,
    waitForSelector: ".product-card, .product-item, [data-product], .list-item",
  });
  const $ = cheerio.load(html);
  const products: ProductResult[] = [];
  const seen = new Set<string>();

  $(".product-card, .product-item, [data-product], .list-item, .product-tile")
    .slice(0, 24)
    .each((_, el) => {
      const $el = $(el);
      const title = cleanTitle(
        $el.find(".product-title, .product-name, .title, h3, h4").first().text()
      );
      if (!title) return;
      const href = absUrl(
        $el.find('a[href*="::"], a[href*=".html"], a').first().attr("href"),
        site.baseUrl
      );
      if (!href || seen.has(href)) return;
      seen.add(href);
      const priceRaw = $el.find('.price, [itemprop="price"], .product-price').first().text();
      const originalRaw = $el.find('.old-price, .price--original, del').first().text();
      const img =
        $el.find("img").first().attr("src") ||
        $el.find("img").first().attr("data-src") ||
        null;
      const brand = cleanTitle($el.find(".product-brand, .brand, [data-brand]").first().text()) || undefined;
      const price = parsePrice(priceRaw);
      const originalPrice = parsePrice(originalRaw);
      const discount =
        originalPrice && price && originalPrice > price
          ? Math.round((1 - price / originalPrice) * 100)
          : null;
      products.push({
        site: "sportconrad",
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
}

export const site: SiteMeta = {
  id: "sportconrad",
  name: "Sport Conrad",
  baseUrl: "https://www.sport-conrad.com",
  country: "DE",
  currency: "EUR",
  accent: "bg-indigo-100 text-indigo-800 border-indigo-200",
  groups: ["all"],
};

export const scraper: Scraper = {
  site,
    capabilities: { engine: "rest" },
  async search(query, signal) {
    // 1) Tente l'API Makaira documentée (fonctionne depuis une IP résidentielle)
    try {
      const products = await tryMakaira(query, signal);
      if (products.length) return products;
    } catch (e: any) {
       
      console.warn(`[sportconrad] API Makaira échouée (${e.message}), tentative HTML…`);
    }
    // 2) Repli : rend la page HTML via Playwright
    return tryHtmlFallback(query, signal);
  },
};
