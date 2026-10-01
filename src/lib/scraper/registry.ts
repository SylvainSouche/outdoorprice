// Registry : orchestre les scrapers en parallèle avec timeout global,
// gestion d'erreurs par site. Aucune donnée de démo — si tout échoue,
// la réponse est vide et l'UI affiche clairement l'échec.
import { SCRAPERS, PLAYWRIGHT_SITES, CHALLENGE_SITES, SCRAPER_BY_SITE } from "./sites";
import { SITES } from "./types";
import { SiteId, SiteSearchResult, ProductResult, MatchedProduct, ProductMetadata, DynamicFilters } from "./types";
import { enrichProduct, ENRICH_TOP_N_PER_SITE } from "./enrich";
import { matchProducts, prepareItems } from "./matcher";
import { buildDynamicFilters } from "./filters";
import { ScraperError } from "./error";
import {
  isDebugDump,
  isDebugVerbose,
  createDebugSession,
  dumpSearchResults,
  dumpMatchedResults,
  debugLog,
} from "../debug";
import { logger } from "../logger";

// Re-export for backwards compatibility
export { SCRAPERS, SCRAPER_BY_SITE };


/** Timeout par scraper en ms */
const PER_SITE_TIMEOUT = parseInt(process.env.SCRAPE_SITE_TIMEOUT_MS || "30000", 10);
const CHALLENGE_SITE_TIMEOUT = parseInt(process.env.SCRAPE_SITE_TIMEOUT_MS || "60000", 10);

/** Timeout effectif pour un site donné — challenge sites get longer. */
function siteTimeoutMs(siteId: string): number {
  return CHALLENGE_SITES.has(siteId as SiteId) ? CHALLENGE_SITE_TIMEOUT : PER_SITE_TIMEOUT;
}

/** Délai max de stagger entre scrapers (ms). */
const STAGGER_MAX_MS = 800;

/** Délai avant retry sur résultat empty (ms). */
const RETRY_DELAY_MS = 1500;

/** Délai aléatoire entre 0 et maxMs. */
function randomDelay(maxMs: number): number {
  return Math.floor(Math.random() * maxMs);
}
/** Attend ms millisecondes. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Lance UN scraper avec timeout + retry sur empty. */
async function runScraperWithRetry(
  scraper: { site: typeof SCRAPERS[number]["site"]; search: typeof SCRAPERS[number]["search"] },
  query: string,
  signal?: AbortSignal
): Promise<SiteSearchResult> {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PER_SITE_TIMEOUT);

  // Link external signal to our internal controller (with cleanup)
  const onExternalAbort = () => controller.abort();
  if (signal) {
    signal.addEventListener("abort", onExternalAbort, { once: true });
  }

  try {
    let products = await scraper.search(query, controller.signal);
    let durationMs = Date.now() - start;

    // Retry once on empty (rate-limit recovery)
    if ((!products || products.length === 0) && !controller.signal.aborted) {
      logger.forSite(scraper.site.id).info(`retourné vide, retry dans ${RETRY_DELAY_MS}ms...`);
      await sleep(RETRY_DELAY_MS);
      // New controller for retry
      const retryController = new AbortController();
      const retryTimeout = setTimeout(() => retryController.abort(), PER_SITE_TIMEOUT);
      const onExternalAbortRetry = () => retryController.abort();
      if (signal) {
        signal.addEventListener("abort", onExternalAbortRetry, { once: true });
      }
      try {
        products = await scraper.search(query, retryController.signal);
      } catch (e) {
        // Retry failed — return original empty result
        return {
          site: scraper.site,
          products: [],
          status: "empty",
          durationMs: Date.now() - start,
        };
      } finally {
        clearTimeout(retryTimeout);
        if (signal) signal.removeEventListener("abort", onExternalAbortRetry);
      }
      durationMs = Date.now() - start;
    }

    if (!products || products.length === 0) {
      return {
        site: scraper.site,
        products: [],
        status: "empty",
        durationMs,
      };
    }
    return {
      site: scraper.site,
      products,
      status: "ok",
      durationMs,
    };
  } catch (e) {
    const durationMs = Date.now() - start;
    const scraperError = e instanceof ScraperError
      ? e
      : new ScraperError(scraper.site.id, e instanceof Error ? e.message : String(e), { cause: e });
    return {
      site: scraper.site,
      products: [],
      status: "error",
      error: scraperError.toLogString(),
      durationMs,
    };
  } finally {
    clearTimeout(timeout);
    if (signal) signal.removeEventListener("abort", onExternalAbort);
  }
}

/** Sites qui utilisent Playwright (Chromium headless). Ces sites sont gourmands
 *  en mémoire (~80 Mo par instance Chromium), donc on limite leur concurrence
 *  pour éviter de crasher le serveur. */

/** Nombre maximum de scrapers Playwright lancés en parallèle. Au-delà, on
 *  sérialise. Default 3 (≈240 Mo RAM pour 3 Chromium). */
const MAX_PARALLEL_PLAYWRIGHT = parseInt(process.env.SCRAPE_MAX_PARALLEL_PLAYWRIGHT || "3", 10);

/**
 * Lance tous les scrapers en parallèle (avec un petit stagger aléatoire pour
 * éviter le rate-limiting) et retourne un résultat par site, qu'il ait réussi
 * ou échoué. Aucune erreur ne fait planter l'ensemble.
 *
 * Si un scraper retourne empty, on retente une fois après un court délai
 * (utile pour les sites qui rate-limit temporairement).
 *
 * Les scrapers Playwright (Chromium) sont limités à MAX_PARALLEL_PLAYWRIGHT
 * en parallèle pour éviter de saturer la RAM (chaque Chromium ≈80 Mo).
 * Les scrapers HTTP (bergzeit, montaz, sportbittl) tournent tous en parallèle.
 */
export async function aggregateSearch(
  query: string,
  opts: { onlySites?: SiteId[] } = {}
): Promise<SiteSearchResult[]> {
  const selected = opts.onlySites && opts.onlySites.length
    ? SCRAPERS.filter((s) => opts.onlySites!.includes(s.site.id))
    : SCRAPERS;

  // Sépare les scrapers Playwright des scrapers HTTP (axios direct).
  const httpScrapers = selected.filter((s) => !PLAYWRIGHT_SITES.has(s.site.id as SiteId));
  const pwScrapers = selected.filter((s) => PLAYWRIGHT_SITES.has(s.site.id as SiteId));

  // Lance les scrapers HTTP en parallèle (avec stagger)
  const httpPromises = httpScrapers.map(async (scraper, idx) => {
    if (idx > 0) {
      await sleep(randomDelay(Math.min(STAGGER_MAX_MS, idx * 50)));
    }
    return runScraperWithRetry(scraper, query);
  });

  // Lance les scrapers Playwright avec concurrence limitée
  const pwResults: SiteSearchResult[] = [];
  let pwCursor = 0;
  const pwWorkers = Array.from(
    { length: Math.min(MAX_PARALLEL_PLAYWRIGHT, pwScrapers.length) },
    async () => {
      while (pwCursor < pwScrapers.length) {
        const i = pwCursor++;
        const scraper = pwScrapers[i];
        if (i > 0) await sleep(randomDelay(500));
        const result = await runScraperWithRetry(scraper, query);
        pwResults.push(result);
      }
    }
  );

  // Attend tout
  const [httpSettled] = await Promise.all([
    Promise.allSettled(httpPromises),
    Promise.all(pwWorkers),
  ]);

  // Combine les résultats
  const results: SiteSearchResult[] = [];
  for (const r of httpSettled) {
    if (r.status === "fulfilled") results.push(r.value);
  }
  results.push(...pwResults);

  // Query relevance filter: for shops with `relevance: "strict"`, drop products
  // whose title doesn't contain at least one token from the user's query.
  // This prevents cycling shops (ProBikeShop, All4cycling, etc.) from returning
  // irrelevant results when searching for outdoor products (e.g. "Atomic Hawx"
  // ski boots → ProBikeShop returns cycling jerseys).
  const queryTokens = query.toLowerCase().split(/[\s,;]+/).filter((t) => t.length >= 2);
  if (queryTokens.length > 0) {
    for (const r of results) {
      const scraper = SCRAPER_BY_SITE[r.site.id];
      if (scraper?.capabilities?.relevance === "strict" && r.products.length > 0) {
        const before = r.products.length;
        r.products = r.products.filter((p) => {
          const title = (p.title || "").toLowerCase();
          // Product must contain at least one query token
          return queryTokens.some((tok) => title.includes(tok));
        });
        const dropped = before - r.products.length;
        if (dropped > 0) {
          debugLog(`[${r.site.id}] relevance filter: dropped ${dropped} irrelevant products (query="${query}")`);
          if (r.products.length === 0) {
            r.status = "empty";
          }
        }
      }
    }
  }

  // Tri par ordre original (pour que l'UI affiche les sites dans un ordre stable)
  const orderMap = new Map(selected.map((s, i) => [s.site.id, i]));
  results.sort((a, b) => (orderMap.get(a.site.id) ?? 0) - (orderMap.get(b.site.id) ?? 0));

  return results;
}

/** true si au moins un site a renvoyé au moins un produit */
export function anySuccess(results: SiteSearchResult[]): boolean {
  return results.some((r) => r.status === "ok" && r.products.length > 0);
}

// ---------------------------------------------------------------------------
// Workflow enrichi : search → enrich → match
// ---------------------------------------------------------------------------

/** Pool de concurrence simple pour limiter le nombre de fetchs parallèles. */
async function runPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        results[i] = await fn(items[i], i);
      } catch (e) {
        results[i] = undefined as unknown as R;
      }
    }
  });
  await Promise.all(workers);
  return results;
}


/**
 * Workflow complet :
 *   1. Recherche parallèle sur tous les sites
 *   2. Top-N résultats par site → fetch page produit → extraction métadonnées
 *   3. Matching cross-site → MatchedProduct[]
 *   4. Construction des filtres dynamiques
 *
 * PAS DE FALLBACK DÉMO. Si tous les sites échouent, renvoie un tableau vide
 * et l'UI affiche l'échec réel (sites en erreur + messages).
 */
export async function aggregateMatched(
  query: string,
  opts: { onlySites?: SiteId[] } = {}
): Promise<{
  products: MatchedProduct[];
  filters: DynamicFilters;
  rawResults: SiteSearchResult[];
  phases: { searchMs: number; enrichMs: number; matchMs: number };
  anySuccess: boolean;
  demo: boolean;
}> {
  // ----- Phase 1 : recherche -----
  const t0 = Date.now();
  const debugDir = isDebugDump() ? createDebugSession(query) : "";
  if (isDebugDump()) debugLog(`Debug session: ${debugDir}`);

  const results = await aggregateSearch(query, opts);
  const searchMs = Date.now() - t0;

  if (isDebugDump()) dumpSearchResults(debugDir, query, results);

  const success = anySuccess(results);
  if (!success) {
    return {
      products: [],
      filters: buildDynamicFilters([]),
      rawResults: results,
      phases: { searchMs, enrichMs: 0, matchMs: 0 },
      anySuccess: false,
      demo: false,
    };
  }

  if (isDebugVerbose()) {
    const okSites = results.filter((r) => r.status === "ok");
    debugLog(`Search: ${okSites.length} sites returned products`);
    for (const r of okSites) debugLog(`  ${r.site.id}: ${r.products.length} products (${r.durationMs}ms)`);
  }

  // ----- Phase 2 : enrichissement (top-N par site) -----
  // ALL products are kept for matching — enrichment just adds metadata
  // (EAN, brand, category) to the top N to improve match quality.
  const t1 = Date.now();
  const allProducts: ProductResult[] = [];
  const enrichMap = new Map<number, ProductMetadata>();

  for (const r of results) {
    if (r.status !== "ok") continue;
    r.products.forEach((product) => {
      const idx = allProducts.length;
      allProducts.push(product);
      const siteCount = allProducts.filter((p) => p.site === product.site).length;
      if (siteCount <= ENRICH_TOP_N_PER_SITE) {
        enrichMap.set(idx, {});
      }
    });
  }

  const toEnrich: { product: ProductResult; index: number }[] = [];
  for (const [idx] of enrichMap) {
    toEnrich.push({ product: allProducts[idx], index: idx });
  }

  await runPool(toEnrich, 8, async (item) => {
    const md = await enrichProduct(item.product);
    enrichMap.set(item.index, md);
    if (isDebugVerbose()) {
      debugLog(`Enriched: ${item.product.url.slice(0, 60)} -> brand=${(md as any).brand ?? "—"}, ean=${(md as any).ean ?? "—"}`);
    }
  });

  const enrichMs = Date.now() - t1;

  // ----- Phase 3 : matching -----
  // ALL products participate — enriched ones have full metadata,
  // unenriched ones use title similarity only.
  const t2 = Date.now();
  const metadatas: ProductMetadata[] = allProducts.map((_, i) => enrichMap.get(i) ?? {});
  const items = prepareItems(allProducts, metadatas);
  const matched = matchProducts(items);
  const matchMs = Date.now() - t2;

  if (isDebugVerbose()) {
    debugLog(`Matched: ${allProducts.length} products -> ${matched.length} groups`);
    for (const p of matched) debugLog(`  [${p.id}] ${p.title.slice(0, 50)} (${p.offers.length} offers, ${p.siteCount} sites)`);
  }

  if (isDebugDump()) dumpMatchedResults(debugDir, matched, { searchMs, enrichMs, matchMs });

  const filters = buildDynamicFilters(matched);

  return {
    products: matched,
    filters,
    rawResults: results,
    phases: { searchMs, enrichMs, matchMs },
    anySuccess: true,
    demo: false,
  };
}
