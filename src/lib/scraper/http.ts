// =============================================================================
// Client HTTP partagé pour le scraping — usage personnel, pas un service de crawl.
// -----------------------------------------------------------------------------
// IMPORTANT : ce client NE consulte PAS le robots.txt des sites ciblés.
// Ce projet est un outil de comparaison de prix à usage personnel / non commercial,
// pas un crawler indexeur à grande échelle. La consultation et le respect strict du
// robots.txt n'est donc pas appliquée ici. Si vous réutilisez ce code dans un
// cadre de service public ou commercial, vous DEVEZ réintroduire cette vérification
// (ex : `robots-parser` côté serveur) et respecter les règles d'indexation de
// chaque site.
// =============================================================================
import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";

// Proxy global (chargé une fois depuis l'env). Format :
//   http://user:pass@host:port        → proxy HTTP/HTTPS
//   https://user:pass@host:port        → proxy HTTPS
//   socks5://user:pass@host:port       → proxy SOCKS5 (recommandé pour scraping)
let CACHED_PROXY_AGENT: HttpsProxyAgent<string> | SocksProxyAgent | null | undefined;

function getProxyAgent(): HttpsProxyAgent<string> | SocksProxyAgent | null {
  if (CACHED_PROXY_AGENT !== undefined) return CACHED_PROXY_AGENT;
  const url = process.env.PROXY_URL?.trim();
  if (!url) {
    CACHED_PROXY_AGENT = null;
    return null;
  }
  try {
    if (url.startsWith("socks")) {
      CACHED_PROXY_AGENT = new SocksProxyAgent(url);
    } else {
      CACHED_PROXY_AGENT = new HttpsProxyAgent(url);
    }
     
    console.log(`[scraper] proxy activé : ${url.replace(/:\/\/[^@]*@/, "://***@")}`);
  } catch (e) {
     
    console.warn(`[scraper] proxy invalide (${url}) :`, e);
    CACHED_PROXY_AGENT = null;
  }
  return CACHED_PROXY_AGENT;
}

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
];

export function pickUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export function createHttpClient(opts: {
  timeoutMs?: number;
  referer?: string;
} = {}): AxiosInstance {
  const { timeoutMs = 12000, referer } = opts;
  const ua = pickUserAgent();
  // Jitter de délai (200-700ms) pour paraître non-robot si activé
  const jitterMs = process.env.SCRAPE_JITTER === "1" ? 200 + Math.floor(Math.random() * 500) : 0;
  const proxyAgent = getProxyAgent();
  const client = axios.create({
    timeout: timeoutMs + jitterMs,
    maxRedirects: 5,
    validateStatus: (s) => s < 500,
    // Désactive la compression "br" si axios n'a pas le décodeur brotli (Node récent l'ont)
    decompress: true,
    // TLS : autorise les suites modernes + garde http/1.1 (http/2 peut révéler le fingerprint)
    headers: {
      "User-Agent": ua,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8,de;q=0.7,es;q=0.6",
      "Accept-Encoding": "gzip, deflate, br",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      "Sec-Ch-Ua-Mobile": "?1",
      "Sec-Ch-Ua-Platform": ua.includes("Macintosh") ? '"macOS"' : ua.includes("Windows") ? '"Windows"' : '"Linux"',
      "Upgrade-Insecure-Requests": "1",
      ...(referer ? { Referer: referer } : {}),
    },
    ...(proxyAgent ? { httpsAgent: proxyAgent, httpAgent: proxyAgent, proxy: false } : {}),
  });
  return client;
}

export async function fetchHtml(
  url: string,
  opts: {
    timeoutMs?: number;
    referer?: string;
    signal?: AbortSignal;
    usePlaywright?: boolean;       // force Playwright si true
    playwrightFallback?: boolean;  // si axios échoue (status >= 400 ou exception), retry Playwright
    waitForSelector?: string;      // sélecteur à attendre en mode Playwright
  } = {}
): Promise<{ html: string; finalUrl: string; status: number }> {
  const mode = (process.env.SCRAPE_USE_PLAYWRIGHT === "1") || opts.usePlaywright
    ? "playwright"
    : "axios";

  // Mode 1 : Playwright direct
  if (mode === "playwright") {
    try {
      const { fetchHtmlWithPlaywright } = await import("./playwright");
      return await fetchHtmlWithPlaywright(url, {
        timeoutMs: opts.timeoutMs ?? 20000,
        referer: opts.referer,
        waitForSelector: opts.waitForSelector,
        signal: opts.signal,
      });
    } catch (e: any) {
      if (String(e?.message || "").includes("Playwright non installé")) {
         
        console.warn("[scraper] Playwright non installé, fallback axios");
      } else {
        throw e;
      }
    }
  }

  // Mode 2 : axios (par défaut)
  const client = createHttpClient(opts);
  const config: AxiosRequestConfig = {
    responseType: "text",
    signal: opts.signal,
  };
  try {
    const res = await client.get<string>(url, config);
    const html = typeof res.data === "string" ? res.data : String(res.data ?? "");
    const status = res.status;
    const finalUrl = res.request?.res?.responseUrl ?? res.config.url ?? url;

    // Fallback Playwright si la réponse est un challenge anti-bot
    const looksBlocked =
      status >= 400 ||
      /enable javascript|cloudflare|attention required|access denied|captcha|just a moment|cf-browser-verification|challenge-platform|akamai|loading-screen/i.test(html.slice(0, 5000));
    // Fallback Playwright activé par défaut si Playwright est dispo (peut être désactivé via SCRAPE_PLAYWRIGHT_FALLBACK=0)
    const fallbackEnabled = process.env.SCRAPE_PLAYWRIGHT_FALLBACK !== "0";
    if (looksBlocked && (opts.playwrightFallback || fallbackEnabled)) {
      try {
        const { fetchHtmlWithPlaywright, isPlaywrightAvailable } = await import("./playwright");
        if (await isPlaywrightAvailable()) {
           
          console.warn(`[scraper] axios bloqué (status=${status}) pour ${url}, retry Playwright`);
          return await fetchHtmlWithPlaywright(url, {
            timeoutMs: opts.timeoutMs ?? 20000,
            referer: opts.referer,
            waitForSelector: opts.waitForSelector,
            signal: opts.signal,
          });
        }
      } catch (e: any) {
         
        console.warn(`[scraper] Playwright fallback échoué pour ${url}: ${e?.message}`);
      }
    }
    return { html, finalUrl, status };
  } catch (e: any) {
    // Réseau/TLS ko → on tente Playwright si demandé
    const fallbackEnabled = process.env.SCRAPE_PLAYWRIGHT_FALLBACK !== "0";
    if (opts.playwrightFallback || fallbackEnabled) {
      try {
        const { fetchHtmlWithPlaywright, isPlaywrightAvailable } = await import("./playwright");
        if (await isPlaywrightAvailable()) {
           
          console.warn(`[scraper] axios échoué (${e?.message}) pour ${url}, retry Playwright`);
          return await fetchHtmlWithPlaywright(url, {
            timeoutMs: opts.timeoutMs ?? 20000,
            referer: opts.referer,
            waitForSelector: opts.waitForSelector,
            signal: opts.signal,
          });
        }
      } catch {
        // on propage l'erreur d'origine
      }
    }
    throw e;
  }
}

/**
 * Parse un prix européen : "1 234,56 €", "1234.56 EUR", "CHF 1'234.50", etc.
 * Retourne null si non parsable.
 */
export function parsePrice(raw: string | undefined | null): number | null {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;
  // Retire les symboles monétaires et codes (€, $, CHF, EUR, £)
  s = s.replace(/€|\$|£|CHF|EUR|chf|eur/gi, "").trim();
  // Retire tout sauf chiffres, séparateurs et signe
  s = s.replace(/[^\d.,'\s-]/g, "").trim();
  if (!s) return null;

  // Si on a une apostrophe (format suisse 1'234.50), on l'enlève
  s = s.replace(/'/g, "");

  // Cas : séparateur décimal virgule (FR/DE), séparateur de milliers espace ou point
  if (s.includes(",") && s.includes(".")) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (s.includes(",")) {
    const parts = s.split(",");
    if (parts.length === 2 && parts[1].length <= 2) {
      s = parts[0].replace(/\s/g, "") + "." + parts[1];
    } else {
      s = s.replace(/,/g, "");
    }
  } else {
    s = s.replace(/\s/g, "");
  }

  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fetch une URL JSON via Playwright (utile pour les endpoints API protégés
 * par Cloudflare que axios ne peut pas traverser directement).
 *
 * Playwright charge l'URL comme une page : le JSON est rendu dans un <pre>.
 * On l'extrait et on le parse.
 */
export async function fetchJsonViaPlaywright(
  url: string,
  opts: {
    timeoutMs?: number;
    referer?: string;
    signal?: AbortSignal;
  } = {}
): Promise<unknown> {
  const { fetchHtmlWithPlaywright } = await import("./playwright");
  const r = await fetchHtmlWithPlaywright(url, {
    timeoutMs: opts.timeoutMs ?? 30000,
    referer: opts.referer,
    signal: opts.signal,
  });
  // Cloudflare challenge ?
  if (r.html.includes("Just a moment") || r.html.includes("challenge-platform")) {
    throw new Error("Cloudflare challenge non résolu");
  }
  // Le JSON est rendu dans <pre>{...}</pre>
  const m = r.html.match(/<pre>([\s\S]+?)<\/pre>/);
  if (!m) {
    throw new Error("Réponse sans <pre> — pas du JSON ?");
  }
  try {
    return JSON.parse(m[1]);
  } catch (e) {
    throw new Error(`JSON invalide: ${(e as Error).message}`);
  }
}

/**
 * Effectue une requête POST/GET JSON via Playwright, en exécutant fetch()
 * depuis l'intérieur du navigateur. Utilisé pour les endpoints API protégés
 * par Cloudflare qui nécessitent des cookies / un défi résolu.
 *
 * Prérequis : on doit d'abord visiter une page du site pour résoudre le
 * challenge Cloudflare (cookies cf_clearance etc.), puis appeler cette
 * fonction avec la même origine.
 */
export async function fetchJsonPostViaPlaywright(
  apiUrl: string,
  opts: {
    method?: "GET" | "POST";
    body?: unknown;
    bodyForm?: Record<string, string>;
    bodyJson?: unknown;
    headers?: Record<string, string>;
    referer?: string;
    /** page à visiter d'abord pour résoudre Cloudflare (typiquement la racine du site) */
    bootstrapUrl?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {}
): Promise<unknown> {
  const { fetchHtmlWithPlaywright } = await import("./playwright");

  // 1) Visiter la page d'amorce pour résoudre Cloudflare et poser les cookies
  if (opts.bootstrapUrl) {
    try {
      await fetchHtmlWithPlaywright(opts.bootstrapUrl, {
        timeoutMs: opts.timeoutMs ?? 30000,
        referer: opts.referer,
        signal: opts.signal,
      });
    } catch {
      // ignore : on tente quand même le fetch
    }
  }

  // 2) Faire le fetch() dans le navigateur en gardant le contexte Cloudflare.
  //    On recharge la même page (ou l'API URL) puis on exécute fetch().
  const { fetchHtmlWithPlaywright: fetchPw2 } = await import("./playwright");
  // Re-visiter une page du site (pas l'API JSON, qui rendrait mal)
  // pour avoir un document valide, puis exécuter fetch().
  // Pour cela on doit passer par un wrapper custom.
  const html = await fetchPw2WithFetch(apiUrl, opts);
  // Le résultat sera soit du JSON brut rendu dans <pre>, soit un objet JSON.
  const m = html.match(/<pre>([\s\S]+?)<\/pre>/);
  if (m) {
    try { return JSON.parse(m[1]); } catch { /* see below */ }
  }
  // Si pas de <pre>, le contenu peut être le JSON brut directement
  try { return JSON.parse(html); } catch { /* see below */ }
  throw new Error("Réponse non-JSON");
}

/** Helper interne : visite l'API URL via Playwright en exécutant fetch() depuis le browser. */
async function fetchPw2WithFetch(
  apiUrl: string,
  opts: {
    method?: "GET" | "POST";
    body?: unknown;
    bodyForm?: Record<string, string>;
    bodyJson?: unknown;
    headers?: Record<string, string>;
    referer?: string;
    bootstrapUrl?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  }
): Promise<string> {
  // Implémentation : on ouvre une page sur l'origine, puis on exécute fetch()
  // depuis l'intérieur via page.evaluate. Cela hérite des cookies cf_clearance.
  const pw = await import("playwright" as any).catch(() => null);
  if (!pw) throw new Error("Playwright non installé");
  const chromium = pw.chromium;

  const launchOpts: any = {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--window-size=1920,1080",
    ],
  };

  const proxyUrl = process.env.PROXY_URL?.trim();
  if (proxyUrl) {
    try {
      const u = new URL(proxyUrl);
      launchOpts.proxy = {
        server: `${u.protocol}//${u.hostname}:${u.port}`,
        username: u.username || undefined,
        password: u.password || undefined,
      };
    } catch { /* ignore */ }
  }

  const browser = await chromium.launch(launchOpts);
  let ctx: any = null;
  try {
    ctx = await browser.newContext({
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
      locale: "fr-FR",
      timezoneId: "Europe/Paris",
      viewport: { width: 1920, height: 1080 },
      extraHTTPHeaders: {
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
        ...(opts.referer ? { Referer: opts.referer } : {}),
      },
    });
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "languages", { get: () => ["fr-FR", "fr", "en"] });
      Object.defineProperty(navigator, "vendor", { get: () => "Google Inc." });
    });

    const page = await ctx.newPage();

    // 1) Bootstrap : visiter la racine du site pour résoudre Cloudflare
    if (opts.bootstrapUrl) {
      try {
        await page.goto(opts.bootstrapUrl, { waitUntil: "domcontentloaded", timeout: opts.timeoutMs ?? 30000 });
        // Laisser le temps au challenge Cloudflare de se résoudre
        await page.waitForTimeout(2500);
      } catch { /* ignore */ }
    }

    // 2) Exécuter fetch() depuis le browser
    const method = opts.method || (opts.body || opts.bodyJson || opts.bodyForm ? "POST" : "GET");
    let bodyStr: string | undefined;
    const fetchHeaders: Record<string, string> = {
      "Accept": "application/json, text/plain, */*",
      ...(opts.headers || {}),
    };
    if (opts.bodyForm) {
      bodyStr = new URLSearchParams(opts.bodyForm).toString();
      fetchHeaders["Content-Type"] = "application/x-www-form-urlencoded";
    } else if (opts.bodyJson !== undefined) {
      bodyStr = JSON.stringify(opts.bodyJson);
      fetchHeaders["Content-Type"] = "application/json";
    } else if (opts.body !== undefined) {
      bodyStr = String(opts.body);
    }

    const result = await page.evaluate(
      async ({ url, method, bodyStr, fetchHeaders }) => {
        try {
          const res = await fetch(url, {
            method,
            headers: fetchHeaders,
            body: bodyStr,
            credentials: "include",
          });
          const text = await res.text();
          return { ok: true, status: res.status, text };
        } catch (e: any) {
          return { ok: false, error: String(e?.message || e) };
        }
      },
      { url: apiUrl, method, bodyStr, fetchHeaders }
    );

    if (!result.ok) throw new Error(`fetch() depuis le navigateur a échoué : ${result.error}`);
    if (result.status >= 400) {
      throw new Error(`API a répondu HTTP ${result.status}`);
    }
    return result.text;
  } finally {
    try { if (ctx) await ctx.close(); } catch { /* ignore */ }
    try { await browser.close(); } catch { /* ignore */ }
  }
}

/** Construit une URL absolue à partir d'une base et d'un href éventuellement relatif. */
export function absUrl(href: string | undefined | null, base: string): string | null {
  if (!href) return null;
  const h = String(href).trim();
  if (!h) return null;
  if (h.startsWith("mailto:") || h.startsWith("javascript:") || h === "#") return null;
  try {
    return new URL(h, base).toString();
  } catch {
    return null;
  }
}

/** Nettoie un titre de produit (espaces, sauts de ligne, etc.). */
export function cleanTitle(raw: string | undefined | null): string {
  if (!raw) return "";
  return String(raw)
    .replace(/\s+/g, " ")
    .replace(/\n+/g, " ")
    .trim();
}
