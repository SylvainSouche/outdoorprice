// Scraper Sportokay (AT, EUR)
// --------------------------------------------------------------------------
// Protocole (capturé le 2026-08-22, cf. PROTOCOLES.md) :
//   Magento 1, store FR sous /fr_fr, SANS Cloudflare — HTML pur via axios.
//
//   Recherche : GET https://www.sportokay.com/fr_fr/catalogsearch/result?q=<query>
//   → page servie-côté (1,4 Mo), cartes produit :
//     <article class="b_catalog-product-list-item ...">
//       <a href="https://…/fr_fr/<slug>-<id>.html" title="…">
//       <img src="https://cdn-www.sportokay.com/__imgproxy/…">
//       prix : blocs "special-price" / "price" avec « 118,99 € »
//
//   Autocomplete : GET /autocomplete.php?store=fr&currency=EUR&delivery=fr&cg=0
//     &fallback_url=…&q=<query> (Wyomind) — utile en complément, mais la page
//     de résultats suffit (prix complets).
//
// Pièges :
//   - Le 1er title="" des couleurs (« Noir ») n'est PAS le titre produit —
//     prendre le title du lien produit (dernier).
//   - Prix FR avec virgule décimale ; special-price = prix payé, sinon "price".
//   - La marque est en tête du titre (« Atomic Hawx Kids 3 … »).
// --------------------------------------------------------------------------
import { SiteMeta, ProductResult, Scraper } from "../types";

import { fetchHtml, absUrl, parsePrice } from "../http";

export const site: SiteMeta = {
  id: "sportokay",
  name: "Sportokay",
  baseUrl: "https://www.sportokay.com",
  country: "SK",
  currency: "EUR",
  accent: "bg-blue-100 text-blue-800 border-blue-200",
  groups: ["all"],
};

export const scraper: Scraper = {
  site,
    capabilities: { engine: "html" },
  async search(query, signal) {
    const url = `${site.baseUrl}/fr_fr/catalogsearch/result?q=${encodeURIComponent(query)}`;
    const { html } = await fetchHtml(url, { signal, referer: `${site.baseUrl}/fr_fr` });

    // Cartes produit — découpées par <article …>…</article>
    const items =
      html.match(/<article class="b_catalog-product-list-item[^"]*"[^>]*>[\s\S]*?<\/article>/g) ?? [];

    const products: ProductResult[] = [];
    const seen = new Set<string>();
    for (const item of items.slice(0, 24)) {
      // Lien + titre produit : l'attribut title du <a> produit (ordre des
      // attributs href/title variable selon les cartes → deux motifs).
      const hrefByTitleAfter =
        item.match(/<a\s[^>]*href="([^"]+\.html)"[^>]*title="([^"]+)"/);
      const hrefByTitleBefore =
        item.match(/<a\s[^>]*title="([^"]+)"[^>]*href="([^"]+\.html)"/);
      let href: string | null;
      let title: string;
      if (hrefByTitleAfter) {
        href = hrefByTitleAfter[1];
        title = hrefByTitleAfter[2];
      } else if (hrefByTitleBefore) {
        title = hrefByTitleBefore[1];
        href = hrefByTitleBefore[2];
      } else {
        // Repli : lien seul, titre = premier title de la carte (peut être une
        // couleur — cf. Pièges) — mieux que rien.
        href = item.match(/href="([^"]+\.html)"/)?.[1] || null;
        title = item.match(/title="([^"]+)"/)?.[1] || "";
      }
      if (!href) continue;
      const abs = absUrl(href, site.baseUrl);
      if (!abs || seen.has(abs)) continue;
      seen.add(abs);

      // Image : première img de la carte (imgproxy CDN)
      const img = item.match(/<img\s[^>]*src="([^"]+)"/)?.[1] || null;

      // Prix : special-price d'abord (promo), sinon price normal
      const specialBlock = item.match(/special-price[\s\S]{0,400}?([\d.,]+)\s*(?:€|&euro;)/);
      const anyPrice = item.match(/([\d][\d.,]*)\s*(?:€|&euro;)/);
      const price = specialBlock ? parsePrice(specialBlock[1]) : anyPrice ? parsePrice(anyPrice[1]) : null;
      // Prix barré : le prix le plus élevé de la carte
      const allPrices = [...item.matchAll(/([\d][\d.,]*)\s*(?:€|&euro;)/g)]
        .map((m) => parsePrice(m[1]))
        .filter((p): p is number => p !== null);
      const originalPrice = price !== null ? allPrices.find((p) => p > price) ?? null : null;
      const discount =
        price !== null && originalPrice !== null
          ? Math.round((1 - price / originalPrice) * 100)
          : null;

      products.push({
        site: "sportokay",
        siteName: site.name,
        title: title.trim(),
        url: abs,
        price,
        originalPrice,
        currency: "EUR",
        image: absUrl(img, site.baseUrl),
        availability: "unknown",
        discount,
      });
    }
    return products;
  },
};
