// Scraper Oliunid (FR, EUR)
// --------------------------------------------------------------------------
import { ScraperError } from "../error";
// Protocole (capturé le 2026-08-22, cf. PROTOCOLES.md) :
//   Magento 2 + Algolia (module officiel). 100% API, sans navigateur.
//
//   1) Clé : la homepage embarque la config Algolia (JSON échappé \u00XX) :
//      "applicationId":"NHLOO6WTIO","indexName":"magento2_fr","apiKey":"<clé>"
//      La clé est SCOPÉE : referer www.oliunid.fr obligatoire + validUntil
//      ~7 jours → ré-extractée à chaque recherche (1 fetch home, cheap).
//   2) Recherche : POST https://<APPID>-dsn.algolia.net/1/indexes/*/queries
//      avec x-algolia-application-id / x-algolia-api-key + Origin/Referer
//      (sinon 403 « Method not allowed with this referer »).
//      Index "magento2_fr_products" → hits : name, url, manufacturer,
//      image_url, price.EUR.{default, default_original}.
//
// Pièges :
//   - La clé expire (validUntil) — JAMAIS la coder en dur.
//   - Headers Origin/Referer obligatoires (restriction referer de la clé).
//   - La home peut 403 avec un UA non-navigateur.
// --------------------------------------------------------------------------
import { SiteMeta, ProductResult, Scraper } from "../types";

import { fetchHtml, absUrl } from "../http";
import { queryAlgolia } from "../algoliaClient";
import { logger } from "../../logger";

const ALGOLIA_APP_ID = "NHLOO6WTIO";

interface AlgoliaHit {
  name?: string;
  url?: string;
  manufacturer?: string;
  image_url?: string;
  price?: { EUR?: { default?: number; default_original?: number } };
}

/** Extrait la clé Algolia courante depuis la config embarquée dans la home.
 *  Le résultat est MÉMOÏSÉ 24 h : la clé est valide ~7 jours et son
 *  extraction coûte un Chromium complet (la home 403 en axios → fallback
 *  Playwright) — inutile de le payer à chaque recherche. */
const KEY_TTL_MS = 24 * 3600 * 1000;
let cachedKey: { value: string; expiresAt: number } | null = null;

async function fetchAlgoliaKey(signal?: AbortSignal, forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedKey && cachedKey.expiresAt > Date.now()) return cachedKey.value;
  const { html } = await fetchHtml(`${site.baseUrl}/`, {
    signal,
    referer: site.baseUrl,
  });
  // la config est échappée (\u003A pour « : », \u003D pour « = ») — décoder d'abord
  const decoded = html
    .replace(/\\u003A/g, ":")
    .replace(/\\u003D/g, "=")
    .replace(/\\u0022/g, '"');
  const key = decoded.match(/"apiKey":"([A-Za-z0-9+/=]{60,})"/)?.[1];
  if (!key) throw new ScraperError("oliunid", "clé Algolia introuvable dans la homepage (module modifié ?", { category: "parse" });
  cachedKey = { value: key, expiresAt: Date.now() + KEY_TTL_MS };
  return key;
}

/** Extrait la liste de ProductResult depuis les hits Algolia.
 *  Pure function, extracted so it can be unit-tested. */
export function extractProducts(hits: AlgoliaHit[]): ProductResult[] {
  const products: ProductResult[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    if (!h.name || !h.url) continue;
    const url = absUrl(h.url, site.baseUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const price = h.price?.EUR?.default ?? null;
    const original = h.price?.EUR?.default_original ?? null;
    const discount = price !== null && original !== null && original > price
      ? Math.round((1 - price / original) * 100)
      : null;
    products.push({
      site: "oliunid",
      siteName: site.name,
      title: h.manufacturer && !h.name.toLowerCase().startsWith(h.manufacturer.toLowerCase())
        ? `${h.manufacturer} ${h.name}`
        : h.name,
      url,
      price,
      originalPrice: discount !== null ? original : null,
      currency: "EUR",
      image: absUrl(h.image_url ?? null, site.baseUrl),
      availability: "unknown",
      discount,
    });
  }
  return products;
}

export const site: SiteMeta = {
  id: "oliunid",
  name: "Oliunid",
  baseUrl: "https://www.oliunid.com",
  country: "IT",
  currency: "EUR",
  accent: "bg-pink-100 text-pink-800 border-pink-200",
  groups: ["all"],
};

export const scraper: Scraper = {
  site,
    capabilities: { engine: "algolia" },
  async search(query, signal) {
    const apiKey = await fetchAlgoliaKey(signal);
    try {
      const data = await queryAlgolia(
        {
          siteId: "oliunid",
          appId: ALGOLIA_APP_ID,
          apiKey,
          origin: site.baseUrl,
          referer: `${site.baseUrl}/`,
          signal,
        },
        [
          {
            indexName: "magento2_fr_products",
            params: {
              query,
              hitsPerPage: 24,
              numericFilters: "visibility_search=1",
            },
          },
        ]
      );
      const hits = data.results?.[0]?.hits ?? [];
      return extractProducts(hits);
    } catch (e: any) {
      // If we get an auth error (403), the cached key may have expired before
      // its TTL — force-refresh and retry once.
      if (e instanceof ScraperError && e.category === "auth" && e.statusCode === 403) {
        logger.forSite("oliunid", "algolia").warn("403 — clé expirée, ré-extraction forcée");
        const freshKey = await fetchAlgoliaKey(signal, true);
        const data = await queryAlgolia(
          {
            siteId: "oliunid",
            appId: ALGOLIA_APP_ID,
            apiKey: freshKey,
            origin: site.baseUrl,
            referer: `${site.baseUrl}/`,
            signal,
          },
          [
            {
              indexName: "magento2_fr_products",
              params: {
                query,
                hitsPerPage: 24,
                numericFilters: "visibility_search=1",
              },
            },
          ]
        );
        return extractProducts(data.results?.[0]?.hits ?? []);
      }
      throw e;
    }
  },
};
