// =============================================================================
// Wrapper Playwright (headless browser) — fallback pour sites JS-rendered ou
// qui bloquent les requêtes axios simples (anti-bot Cloudflare avancé).
// -----------------------------------------------------------------------------
// Uses the shared BrowserPool (browserPool.ts) — a single Chromium instance
// is kept alive and contexts are created per-call (faster + less memory).
// =============================================================================

import { acquireContext, releaseContext } from "./browserPool";

export { isPlaywrightAvailable } from "./browserPool";

export function isPlaywrightEnabled(): boolean {
  return process.env.SCRAPE_USE_PLAYWRIGHT !== "0"; // enabled by default
}

// Sélecteurs communs pour détecter qu'une page e-commerce est prête.
// On attend l'un d'entre eux (race-first) avant de relire le HTML.
const PRODUCT_SELECTORS = [
  // Patterns e-commerce classiques
  ".product-grid-item",
  ".product-card",
  ".product-item",
  ".product-tile",
  ".product-list-item",
  ".item-product",
  "[data-product]",
  "[data-product-id]",
  "article.product",
  ".products-list-page-preloader__links a",
  // Doofinder Layer Widget (Glisshop, etc.)
  ".dfd-layer",
  ".dfd-results",
  ".dfd-card",
  "[dfd-value-link]",
  // WooCommerce
  ".type-product",
  ".wc-block-grid__product",
  // Liens produits génériques
  'a[href*="/produit/"]',
  'a[href*="/product/"]',
  'a[href*="/p/"]',
];

const BLOCKED_INDICATORS = [
  "just a moment",
  "checking your browser",
  "cloudflare",
  "cf-browser-verification",
  "cf-challenge",
  "challenge-platform",
  "enable javascript",
  "attention required",
  "access denied",
];

function looksBlocked(html: string): boolean {
  const head = html.slice(0, 8000).toLowerCase();
  return BLOCKED_INDICATORS.some((p) => head.includes(p));
}

/**
 * Fetch une URL avec Chromium headless.
 *
 * Stratégie anti-Cloudflare :
 *  1. waitUntil="domcontentloaded" (jamais networkidle, car Cloudflare maintient
 *     des connexions long-polling qui empêchent networkidle de se déclencher)
 *  2. Si page bloquée (challenge Cloudflare détecté dans le HTML), attend jusqu'à
 *     12s que le challenge se résolve tout seul (le navigateur réel le fait).
 *  3. Ensuite, attend qu'un sélecteur produit apparaisse (race-first).
 *
 * Retry : si timeout ou page closed, on retente une fois avec un délai initial.
 */
export async function fetchHtmlWithPlaywright(
  url: string,
  opts: {
    timeoutMs?: number;
    referer?: string;
    waitForSelector?: string;
    signal?: AbortSignal;
  } = {}
): Promise<{ html: string; finalUrl: string; status: number }> {
  const timeoutMs = opts.timeoutMs ?? 30000;
  const referer = opts.referer;
  const customSelector = opts.waitForSelector;

  // Deux tentatives : la 1ère sans délai, la 2e avec un délai initial aléatoire.
  let lastError: any = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await _attempt(url, {
        timeoutMs,
        referer,
        waitForSelector: customSelector,
        signal: opts.signal,
        initialDelayMs: attempt === 0 ? 0 : 1500 + Math.floor(Math.random() * 2500),
      });
      return result;
    } catch (e: any) {
      lastError = e;
      const msg = String(e?.message || "").toLowerCase();
      const isRetryable =
        msg.includes("target page, context or browser has been closed") ||
        msg.includes("timeout") ||
        msg.includes("navigation") ||
        msg.includes("closed");
      if (!isRetryable) break;
       
      console.warn(`[scraper/playwright] tentative ${attempt + 1} échouée (${e?.message}), retry...`);
    }
  }
  throw lastError;
}

async function _attempt(
  url: string,
  opts: {
    timeoutMs: number;
    referer?: string;
    waitForSelector?: string;
    signal?: AbortSignal;
    initialDelayMs: number;
  }
): Promise<{ html: string; finalUrl: string; status: number }> {
  const { timeoutMs, referer, waitForSelector, signal, initialDelayMs } = opts;

  // Use shared browser pool instead of launching per call
  const { context } = await acquireContext(referer);
  let page: any = null;
  try {
    page = await context.newPage();

    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          try {
            page?.close().catch(() => {});
          } catch {
            /* ignore */
          }
        },
        { once: true }
      );
    }

    // Délai initial optionnel (pour paraître humain sur la 2e tentative)
    if (initialDelayMs > 0) {
      await new Promise((r) => setTimeout(r, initialDelayMs));
    }

    // Phase 1 : charger la page
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    let status = response ? response.status() : 200;

    // Phase 2 : si challenge Cloudflare détecté, attendre qu'il se résolve
    let html = await page.content();
    let blocked = looksBlocked(html);

    if (blocked) {
      const challengeDeadline = Date.now() + 12000;
      while (blocked && Date.now() < challengeDeadline) {
        await new Promise((r) => setTimeout(r, 1500));
        html = await page.content();
        blocked = looksBlocked(html);
      }
      if (!blocked) {
        status = 200;
      }
    }

    // Phase 3 : attendre qu'un sélecteur produit apparaisse
    const selectors = waitForSelector ? [waitForSelector, ...PRODUCT_SELECTORS] : PRODUCT_SELECTORS;
    const waitDeadline = Date.now() + 6000;
    let foundSelector: string | null = null;
    while (Date.now() < waitDeadline && !foundSelector) {
      for (const sel of selectors) {
        const count = await page.evaluate((s: string) => {
          try {
            return document.querySelectorAll(s).length;
          } catch {
            return 0;
          }
        }, sel);
        if (count > 0) {
          foundSelector = sel;
          break;
        }
      }
      if (!foundSelector) {
        await new Promise((r) => setTimeout(r, 800));
      }
    }

    html = await page.content();
    const finalUrl = page.url();

    return { html, finalUrl, status };
  } finally {
    // Close page and release context back to pool
    try {
      if (page) await page.close();
    } catch {
      /* ignore */
    }
    await releaseContext(context);
  }
}
