// Scraper Bergfreunde (DE, EUR)
// --------------------------------------------------------------------------
// Protocole (capturé le 2026-08-22, cf. PROTOCOLES.md) :
//   OXID eShop (Fact-Finder), SANS Cloudflare — HTML pur via axios.
//
//   Recherche : GET https://www.bergfreunde.eu/s/<slug>/?searchparam=<q>
//     slug = query minuscule, espaces → "--" (ex: "salewa--wildfire")
//   → page servie-côté, cartes :
//     <li class="product-item …">
//       marque : 1er <div class="product-title"> (texte nu)
//       titre :  2e <div class="product-title"> (spans)
//       prix :   span[data-codecept="currentPrice"] « € 118,97 » (« from » possible)
//       barré :  span.uvp « € 169,95 »
//       image :  img.product-image (bfgcdn.com)
//       lien :   1er href https://…/ produit
//
//   Compléments : /suggest.php?searchparam=<q>&format=json (Fact-Finder,
//   type productName avec deeplink + articleNr) ; popup produit
//   /index.php?cl=details&fnc=getProductPopupInfo&anid=<id>.
//
// Pièges :
//   - « from € 118,97 » : prix à partir de (variantes) — on garde le montant.
//   - Prix format allemand « € 118,97 » (symbole AVANT, virgule décimale).
// --------------------------------------------------------------------------
import { SiteMeta, ProductResult, Scraper } from "../types";

import { fetchHtml, absUrl, parsePrice, cleanTitle } from "../http";

export const site: SiteMeta = {
  id: "bergfreunde",
  name: "Bergfreunde",
  baseUrl: "https://www.bergfreunde.fr",
  country: "DE",
  currency: "EUR",
  accent: "bg-green-100 text-green-800 border-green-200",
  groups: ["all"],
};

export const scraper: Scraper = {
  site,
    capabilities: { engine: "html" },
  async search(query, signal) {
    const slug = query.toLowerCase().trim().replace(/\s+/g, "--");
    const enc = encodeURIComponent(query);
    const url = `${site.baseUrl}/s/${slug}/?searchparam=${enc}&iBfResetSorting=1&userInput=${enc}`;
    const { html } = await fetchHtml(url, { signal, referer: `${site.baseUrl}/` });

    // Cartes produit — découpées par <li class="product-item
    const parts = html.split(/<li [^>]*class="product-item/).slice(1);
    const products: ProductResult[] = [];
    const seen = new Set<string>();

    for (const part of parts.slice(0, 24)) {
      // Marque + titre : les divs product-title (1er = marque, suivants = titre).
      // Certains blocs répètent le même div — on dédoublonne.
      const decode = (t: string) =>
        cleanTitle(t
          .replace(/&#0?39;|&apos;/g, "'")
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, "&"));
      const rawDivs = [...part.matchAll(/<div class="product-title"[^>]*>([\s\S]*?)<\/div>/g)]
        .map((m) => decode(m[1].replace(/<[^>]+>/g, " ")))
        .filter(Boolean);
      const titleDivs = rawDivs.filter((t, i) => t !== rawDivs[i - 1]);
      if (titleDivs.length < 1) continue;
      const brand = titleDivs[0];
      const rest = titleDivs.slice(1).join(" ");
      // Si le titre répète déjà la marque, ne pas la préfixer
      const title =
        !rest || rest.toLowerCase() === brand.toLowerCase()
          ? brand
          : rest.toLowerCase().includes(brand.toLowerCase())
            ? rest
            : `${brand} ${rest}`;

      // Lien produit : premier href https absolu (hors data-encoded-href base64)
      const href = part.match(/href="(https:\/\/[^"]+bergfreunde\.eu\/[^"]+\/)"/)?.[1] || null;
      if (!href || /bergfreunde\.eu\/(index|FACT|out)\b/.test(href)) continue;
      const abs = absUrl(href, site.baseUrl);
      if (!abs || seen.has(abs)) continue;
      seen.add(abs);

      // Prix courant + prix barré (uvp)
      const currentPrice = parsePrice(part.match(/data-codecept="currentPrice"[^>]*>([\s\S]*?)<\/span>/)?.[1]?.match(/[\d.,]+/)?.[0]);
      const uvp = parsePrice(part.match(/class="uvp"[^>]*>([^<]*)</)?.[1]?.match(/[\d.,]+/)?.[0]);
      const discount =
        currentPrice !== null && uvp !== null && uvp > currentPrice
          ? Math.round((1 - currentPrice / uvp) * 100)
          : null;

      // Image
      const img = part.match(/<img[^>]*class="product-image[^"]*"[^>]*src="([^"]+)"/)?.[1]
        ?? part.match(/<img[^>]*src="([^"]*bfgcdn[^"]+)"/)?.[1]
        ?? null;

      products.push({
        site: "bergfreunde",
        siteName: site.name,
        title,
        url: abs,
        price: currentPrice,
        originalPrice: uvp && currentPrice !== null && uvp > currentPrice ? uvp : null,
        currency: "EUR",
        image: absUrl(img, site.baseUrl),
        availability: "unknown",
        discount,
      });
    }
    return products;
  },
};
