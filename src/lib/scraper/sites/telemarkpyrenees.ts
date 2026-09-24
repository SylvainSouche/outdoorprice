// Scraper Telemark-Pyrenees (FR, EUR)
// --------------------------------------------------------------------------
// Protocole (capturé le 2026-08-22, cf. PROTOCOLES.md) :
//   100% API directe, SANS navigateur ni Cloudflare :
//
//   1) Recherche : POST https://elsearch.telemark-pyrenees.com/_msearch
//      (Elasticsearch, auth Basic statique "telemark:telemark" — base64
//      dGVsZW1hcms6dGVsZW1hcms=). Index "search_telemark". Le host elsearch
//      n'est PAS derrière le Cloudflare du site www.
//      → hits[]._source.search_card = HTML rendu serveur contenant :
//        titre, image, <a href> produit, et un placeholder prix avec
//        data-entity-id (variation purchasable_entity).
//   2) Prix : POST https://www.telemark-pyrenees.com/fr/ajax/load-prices
//      (vado pricing) avec items[i][entity_id]=… — SANS cookies.
//      → {"<entity_id>": {"final_price":"339,90 €","original_price":"529,00 €","discount":"35%"}}
//
// Pièges :
//   - search_card est une LISTE de chaînes (une par carte) chez Elasticsearch.
//   - Le prix n'est PAS dans l'index : il faut le 2e appel load-prices.
//   - Le site www est protégé Turnstile sur /fr/search, mais les endpoints
//     ci-dessus passent sans clearance.
// --------------------------------------------------------------------------
import { SiteMeta, ProductResult, Scraper } from "../types";

import { ScraperError } from "../error";

import { absUrl, parsePrice } from "../http";

const ES_URL = "https://elsearch.telemark-pyrenees.com/_msearch";
const PRICES_URL = "https://www.telemark-pyrenees.com/fr/ajax/load-prices";
// Basic telemark:telemark — credentials publics embarqués dans le JS du site.
const ES_AUTH = "Basic dGVsZW1hcms6dGVsZW1hcms=";

interface EsHit {
  _source?: {
    title?: string[] | string;
    search_card?: string[] | string;
  };
}

interface CardInfo {
  title: string;
  url: string;
  img: string | null;
  entityId: string | null;
}

/** Extrait les infos produit du HTML search_card (rendu serveur). */
function parseSearchCard(cardHtml: string, fallbackTitle: string): CardInfo | null {
  const linkMatch = cardHtml.match(/<a\s[^>]*href="([^"]+)"/);
  const imgMatch = cardHtml.match(/<img\s[^>]*src="([^"]+)"/);
  const entityMatch = cardHtml.match(/data-entity-id="(\d+)"/);
  const titleMatch = cardHtml.match(/field-name-title[^>]*>([^<]+)</);
  const title = (titleMatch?.[1] || fallbackTitle || "").trim();
  const href = linkMatch?.[1] || null;
  if (!title || !href) return null;
  return {
    title,
    url: href,
    img: imgMatch?.[1] || null,
    entityId: entityMatch?.[1] || null,
  };
}

export const site: SiteMeta = {
  id: "telemarkpyrenees",
  name: "Telemark Pyrenees",
  baseUrl: "https://www.telemark-pyrenees.com",
  country: "FR",
  currency: "EUR",
  accent: "bg-purple-100 text-purple-800 border-purple-200",
  groups: ["all"],
};

export const scraper: Scraper = {
  site,
    capabilities: { engine: "html" },
  async search(query, signal) {
    // ----- 1) Recherche Elasticsearch (_msearch) -----
    const esQuery = {
      query: {
        bool: {
          filter: [
            {
              query_string: {
                query:
                  "(search_api_language:fr) AND (display_status:true OR product_type:giftcard) AND (NOT blocked_countries:FR)",
              },
            },
          ],
          must: {
            bool: {
              minimum_should_match: 1,
              should: [
                { constant_score: { filter: { multi_match: { query, type: "phrase", fields: ["title", "title_unfiltered", "keywords"] } }, boost: 400 } },
                { constant_score: { filter: { match_phrase: { category_keywords: query } }, boost: 200 } },
                { constant_score: { filter: { match_phrase: { category_name: query } }, boost: 100 } },
                {
                  multi_match: {
                    query,
                    fields: ["title^100", "keywords^100", "category_keywords^80", "category_name^40", "title_unfiltered^100"],
                    operator: "or",
                    fuzziness: "AUTO",
                    boost: 0.01,
                  },
                },
              ],
            },
          },
        },
      },
      size: 24,
      from: 0,
      _source: { includes: ["search_card", "title"] },
    };
    const ndjson = JSON.stringify({ index: "search_telemark" }) + "\n" + JSON.stringify(esQuery) + "\n";

    const esRes = await fetch(ES_URL, {
      method: "POST",
      headers: {
        Authorization: ES_AUTH,
        "Content-Type": "application/x-ndjson",
        Origin: site.baseUrl,
        Referer: `${site.baseUrl}/`,
      },
      body: ndjson,
      signal,
    });
    if (!esRes.ok) throw new ScraperError("telemarkpyrenees", `Elasticsearch _msearch ${esRes.status}`, { statusCode: esRes.status, category: esRes.status === 401 || esRes.status === 403 ? "auth" : "network" });
    const esData = (await esRes.json()) as { responses?: { hits?: { hits?: EsHit[] } }[] };
    const hits = esData.responses?.[0]?.hits?.hits ?? [];

    // ----- 2) Parser les cartes -----
    const cards: (CardInfo & { priceInfo?: { final: string; original: string; discount: string } })[] = [];
    const seen = new Set<string>();
    for (const h of hits) {
      const rawTitle = Array.isArray(h._source?.title) ? h._source?.title[0] : h._source?.title || "";
      const rawCard = Array.isArray(h._source?.search_card) ? h._source?.search_card.join("") : h._source?.search_card || "";
      const card = parseSearchCard(rawCard, rawTitle);
      if (!card) continue;
      const url = absUrl(card.url, site.baseUrl);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      cards.push({ ...card, url });
    }

    // ----- 3) Prix via load-prices (batch, sans cookies) -----
    if (cards.length > 0) {
      const entityIds = cards.map((c) => c.entityId).filter((id): id is string => !!id).slice(0, 30);
      if (entityIds.length > 0) {
        const params = new URLSearchParams();
        entityIds.forEach((id, i) => {
          params.append(`items[${i}][entity_id]`, id);
          params.append(`items[${i}][entity_type]`, "purchasable_entity");
          params.append(`items[${i}][adjustment_types]`, "vado_discount|sales_price|fee|promotion|tax");
        });
        try {
          const priceRes = await fetch(PRICES_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
              "X-Requested-With": "XMLHttpRequest",
              Origin: site.baseUrl,
              Referer: `${site.baseUrl}/fr`,
            },
            body: params.toString(),
            signal,
          });
          if (priceRes.ok) {
            const prices = (await priceRes.json()) as Record<
              string,
              { final_price?: string; original_price?: string; discount?: string }
            >;
            for (const c of cards) {
              const p = c.entityId ? prices[c.entityId] : undefined;
              if (p) c.priceInfo = { final: p.final_price || "", original: p.original_price || "", discount: p.discount || "" };
            }
          }
        } catch { /* prix indisponibles → produits sans prix */ }
      }
    }

    // ----- 4) Produits -----
    return cards.map((c) => {
      const price = c.priceInfo ? parsePrice(c.priceInfo.final) : null;
      const originalPrice = c.priceInfo ? parsePrice(c.priceInfo.original) : null;
      const discount = c.priceInfo?.discount ? parseInt(c.priceInfo.discount.replace(/[^\d]/g, ""), 10) : null;
      return {
        site: "telemarkpyrenees" as const,
        siteName: site.name,
        title: c.title,
        url: c.url,
        price,
        originalPrice: originalPrice && price && originalPrice > price ? originalPrice : null,
        currency: "EUR",
        image: absUrl(c.img, site.baseUrl),
        availability: "unknown",
        discount: Number.isFinite(discount as number) ? discount : null,
      } satisfies ProductResult;
    });
  },
};
