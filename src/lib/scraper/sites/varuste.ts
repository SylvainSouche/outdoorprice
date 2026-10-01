// Scraper Varuste.net (FI, EUR — version FR)
// --------------------------------------------------------------------------
// Protocole (capturé le 2026-08-22, cf. PROTOCOLES.md) :
//   Site maison (Shuriken), SANS protection — POST direct en axios.
//
//   Recherche : POST https://varuste.net/fr/ajax/ennakoiva_tulokset.php
//     body : _hakuid=1&k_hakusana=<query>&referer=
//     (l'endpoint ennakoiva.php ne renvoie qu'un modal vide ; les résultats
//      viennent du 2e appel fait par le script du modal)
//   → HTML avec cartes :
//     <a class="ajaxlinkki item" href='/fr/p<id>/<slug>'>
//       <div class="alekulma_teksti">-13%</div>          → promo
//       <img src="/tiedostot/1/kuva/tuote/300/…jpg">
//       brand : div.product_listing_brand_name
//       variant : div.product_listing_variant_name
//       prix : « 144,19 € » après span.special_price
//       dispo : div.varastossa (« Disponible immédiatement »)
//
// Pièges :
//   - Cookies maaid=FI / valuutta=EUR posés par la 1re réponse — inutiles
//     en pratique (le POST passe sans).
//   - Prix FR virgule + &nbsp; avant €.
// --------------------------------------------------------------------------
import { SiteMeta, ProductResult, Scraper } from "../types";

import { absUrl, parsePrice } from "../http";
import { ScraperError } from "../error";

export const site: SiteMeta = {
  id: "varuste",
  name: "Varuste",
  baseUrl: "https://www.varuste.net",
  country: "FI",
  currency: "EUR",
  accent: "bg-slate-100 text-slate-800 border-slate-200",
  groups: ["all"],
};

export const scraper: Scraper = {
  site,
    capabilities: { engine: "html" },
  async search(query, signal) {
    const res = await fetch(`${site.baseUrl}/fr/ajax/ennakoiva_tulokset.php`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        Origin: site.baseUrl,
        Referer: `${site.baseUrl}/`,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
      },
      body: new URLSearchParams({ _hakuid: "1", k_hakusana: query, referer: "" }).toString(),
      signal,
    });
    if (!res.ok) throw new ScraperError("varuste", `ennakoiva_tulokset ${res.status}`, { statusCode: res.status, category: res.status === 403 ? "blocked" : "network" });
    const html = await res.text();

    const items = html.match(/<a class="ajaxlinkki item"[^>]*>[\s\S]*?<\/a>/g) ?? [];
    const products: ProductResult[] = [];
    const seen = new Set<string>();
    const NBSP = /\u00a0|&nbsp;/g;

    for (const item of items.slice(0, 24)) {
      const href = item.match(/href='([^']+)'/)?.[1];
      if (!href) continue;
      const url = absUrl(href, site.baseUrl);
      if (!url || seen.has(url)) continue;
      seen.add(url);

      const brand = item.match(/product_listing_brand_name[^>]*>([^<]+)</)?.[1]?.trim() || "";
      const variant = item.match(/product_listing_variant_name[^>]*>([^<]+)</)?.[1]?.trim() || "";
      const ariaLabel = item.match(/aria-label="([^"]+)"/)?.[1] || "";
      const title = `${brand} ${variant}`.trim() || ariaLabel;

      // Prix : la promo vient après span.special_price ; sinon 1er prix de la
      // carte. Les &nbsp; sont normalisés avant le match de repli.
      const price = parsePrice(item.match(/special_price[^<]*<\/span>\s*([\d.,]+)\s*(?:&nbsp;|\u00a0)?€/)?.[1]
        ?? item.replace(NBSP, " ").match(/([\d][\d.,]*)\s*€/)?.[1]);
      const discountRaw = item.match(/alekulma_teksti[^>]*>-(\d+)%/)?.[1];
      const discount = discountRaw ? parseInt(discountRaw, 10) : null;

      const img = item.match(/<img[^>]*src="([^"]+)"/)?.[1] || null;
      const inStock = /varastossa/.test(item);

      products.push({
        site: "varuste",
        siteName: site.name,
        title,
        url,
        price,
        originalPrice:
          price !== null && discount !== null
            ? Math.round((price / (1 - discount / 100)) * 100) / 100
            : null,
        currency: "EUR",
        image: absUrl(img, site.baseUrl),
        availability: inStock ? "in_stock" : "unknown",
        availabilityLabel: inStock ? "Disponible immédiatement" : undefined,
        discount,
      });
    }
    return products;
  },
};
