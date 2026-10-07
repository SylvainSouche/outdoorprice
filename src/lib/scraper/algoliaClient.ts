// =============================================================================
// Shared Algolia multi-query client for scrapers that target Algolia-backed
// shops (ekosport, oliunid, ...).
//
// Both scrapers follow the same pattern:
//   1. Extract appId + apiKey + indexName from the shop's HTML or config
//      endpoint (each scraper does this its own way — keys are scoped per
//      shop and expire, so we can't share them).
//   2. POST https://<APPID>-dsn.algolia.net/1/indexes/*/queries
//      with headers:
//        X-Algolia-Application-Id: <appId>
//        X-Algolia-API-Key: <apiKey>
//      body: { "requests": [{ "indexName": "...", "params": "query=...&hitsPerPage=24" }] }
//
// This module provides the second step as a typed helper so future Algolia
// scrapers don't have to copy-paste the axios boilerplate + error handling.
//
// Extracted in P2.1 from ekosport.ts + oliunid.ts to remove duplication.
// =============================================================================

import axios from "axios";
import { ScraperError } from "./error";
import { logger } from "../logger";

export interface AlgoliaQueryParams {
  query: string;
  hitsPerPage?: number;
  page?: number;
  attributesToRetrieve?: string;
  numericFilters?: string;
  /** Any extra params to append to the Algolia `params` field. */
  extra?: Record<string, string>;
}

export interface AlgoliaQueryRequest {
  indexName: string;
  params: AlgoliaQueryParams;
}

export interface AlgoliaHit {
  // Common fields — every scraper uses different keys. We allow any extra
  // field via the index signature so callers don't have to cast.
  objectID?: string;
  name?: string;
  url?: string;
  [key: string]: unknown;
}

export interface AlgoliaQueryResponse<T = AlgoliaHit> {
  results?: { hits?: T[]; nbHits?: number }[];
}

export interface AlgoliaClientOpts {
  siteId: string;
  appId: string;
  apiKey: string;
  /** Optional Origin/Referer — required by some scoped keys (e.g. oliunid). */
  origin?: string;
  referer?: string;
  /** User-Agent override. Defaults to a Chrome UA. */
  userAgent?: string;
  /** Per-request timeout in ms. Default: 25000. */
  timeoutMs?: number;
  /** Abort signal. */
  signal?: AbortSignal;
}

/**
 * Run a multi-query (search across one or more indexes in a single request).
 *
 * Sends the standard Algolia multi-query POST request (the multi-index
 * queries endpoint) and returns the response. Throws ScraperError on
 * HTTP ≥ 400 with the proper category (blocked / auth / network / parse)
 * inferred from the status code.
 *
 * @example
 *   const res = await queryAlgolia(
 *     { siteId: "ekosport", appId, apiKey, referer },
 *     [{ indexName, params: { query, hitsPerPage: 24 } }],
 *   );
 *   const hits = res.results?.[0]?.hits ?? [];
 */
export async function queryAlgolia<T = AlgoliaHit>(
  opts: AlgoliaClientOpts,
  requests: AlgoliaQueryRequest[]
): Promise<AlgoliaQueryResponse<T>> {
  const log = logger.forSite(opts.siteId, "algolia");
  const url = `https://${opts.appId.toLowerCase()}-dsn.algolia.net/1/indexes/*/queries`;
  const ua = opts.userAgent ?? "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

  // Build the body — Algolia wants `params` as a URL-encoded query string,
  // not as a nested object.
  const body = {
    requests: requests.map((r) => ({
      indexName: r.indexName,
      params: buildParamsString(r.params),
    })),
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-Algolia-Application-Id": opts.appId,
    "X-Algolia-API-Key": opts.apiKey,
    "User-Agent": ua,
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
  };
  if (opts.origin) headers["Origin"] = opts.origin;
  if (opts.referer) headers["Referer"] = opts.referer;

  log.debug(`POST ${url} (${requests.length} request(s))`);

  try {
    const res = await axios.post<AlgoliaQueryResponse<T>>(url, body, {
      headers,
      timeout: opts.timeoutMs ?? 25000,
      signal: opts.signal,
      validateStatus: (s) => s < 500,  // let us inspect 4xx responses
    });

    if (res.status >= 400) {
      const category =
        res.status === 401 || res.status === 403 ? "auth"
        : res.status === 403 ? "blocked"
        : "network";
      throw new ScraperError(
        opts.siteId,
        `Algolia HTTP ${res.status}`,
        { statusCode: res.status, category }
      );
    }

    return res.data;
  } catch (e) {
    // Re-throw ScraperError as-is
    if (e instanceof ScraperError) throw e;

    // Network/DNS/timeout errors
    const msg = e instanceof Error ? e.message : String(e);
    log.error("Algolia request failed", e);
    throw new ScraperError(opts.siteId, `Algolia network error: ${msg}`, {
      category: msg.includes("timeout") ? "timeout" : "network",
      cause: e,
    });
  }
}

/** Build the URL-encoded `params` string for a single Algolia query request. */
function buildParamsString(p: AlgoliaQueryParams): string {
  const parts: Record<string, string> = {
    query: p.query,
    hitsPerPage: String(p.hitsPerPage ?? 24),
    page: String(p.page ?? 0),
  };
  if (p.attributesToRetrieve) parts.attributesToRetrieve = p.attributesToRetrieve;
  if (p.numericFilters) parts.numericFilters = p.numericFilters;
  if (p.extra) Object.assign(parts, p.extra);
  return new URLSearchParams(parts).toString();
}
