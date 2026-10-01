// Scraper Au Vieux Campeur (FR, EUR)
// --------------------------------------------------------------------------
// Protocole (cf. PROTOCOLES.md + capture Chrome extension 2026-08-21) :
//   POST https://api.sensefuel.live/search/<compte>
//   Compte : 0b09f99d-2b68-4403-8de4-c35fe7bc7d49 ; environmentId : 532
//   En-tête obligatoire : x-api-key (valeur masquée par Chrome dans les HAR,
//   on l'intercepte via Playwright en écoutant les requêtes du site lui-même).
//   En-têtes additionnels : Origin, Referer, X-Requested-With.
//
// Requête (corps réel capturé) :
//   { key:"<horodatage>-0-KeyHit",
//     terms:{ userExpression, expression, inputSource:"keyboard" },
//     userIds:{ id:<généré> },
//     trackFingerPrint:{ tracks:[…], environmentId:532 },
//     sellerId:"", acp:{}, needShortcuts:true,
//     items:{ from:0, size:20, bypassSpellcheck:false },
//     spotlights:[], scopes:[], filters:{}, showcases:{} }
//
// Champs utiles :
//   data.items.p[]   → liste des produits
//   ttl, brn, lnk, img, avl  → titre, marque, lien, image, disponibilité
//   prcn             → prix RÉELLEMENT PAYÉ
//   prc              → prix catalogue (malgré son nom)
//   pprcn            → prix précédent, en promotion seulement
//
// Approche :
//   1. Chromium charge la homepage auvieuxcampeur.fr
//   2. On intercepte TOUTES les requêtes vers api.sensefuel.live pour capturer
//      le x-api-key que le site envoie lui-même
//   3. Une fois la clé capturée, on fait nos propres requêtes de recherche
//      via axios (plus rapide que Playwright pour les requêtes suivantes)
//   4. Si la clé n'est pas capturée (page ne fait pas de recherche), on
//      utilise Playwright pour taper dans le champ de recherche et capturer
//      la réponse directement.
// --------------------------------------------------------------------------
import axios from "axios";
import { SiteMeta, ProductResult, Scraper } from "../types";

import { pickUserAgent, absUrl } from "../http";
import { ScraperError } from "../error";
import { logger } from "../../logger";

const log = logger.forSite("auvieuxcampeur");

const ACCOUNT = "0b09f99d-2b68-4403-8de4-c35fe7bc7d49";
const ENVIRONMENT_ID = 532;
const SEARCH_URL = `https://api.sensefuel.live/search/${ACCOUNT}`;
const TAG_URL = `https://tag.search.sensefuel.live/tag/${ACCOUNT}/tagp.js`;

/** Fetch le fichier tagp.js depuis SenseFuel et extrait l'API key.
 *  Le fichier JS contient la clé de recherche dans une config :
 *    search:{key:"67346a3c-..."}
 *  Cette clé est envoyée comme header "X-API-KEY" dans les requêtes.
 *
 *  IMPORTANT : on ne cache PAS la clé — elle peut changer ou avoir une durée
 *  de validité. On la récupère à chaque appel de search().
 */
async function fetchApiKey(): Promise<string | null> {
  try {
    const res = await axios.get(TAG_URL, {
      timeout: 15000,
      headers: { "User-Agent": pickUserAgent() },
      validateStatus: (s) => s < 400,
    });
    const js = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    // Le pattern exact dans tagp.js est :
    //   search:{key:"<uuid>"}
    const searchKeyMatch = js.match(/search\s*:\s*\{[^}]*key\s*:\s*"([a-f0-9-]{36})"/i);
    if (searchKeyMatch) {
      const key = searchKeyMatch[1];
      log.debug(`x-api-key extrait de tagp.js : ${key.slice(0, 8)}...`);
      return key;
    }
    log.warn(`tagp.js fetched (${js.length} chars) mais pas de clé trouvée`);
  } catch (e: any) {
    log.warn(`fetch tagp.js échoué : ${e.message}`);
  }
  return null;
}

interface SfItem {
  ttl?: string;
  brn?: string;
  lnk?: string;
  img?: string;
  avl?: string;
  prcn?: number;
  prc?: number;
  pprcn?: number;
}
interface SfResponse {
  data?: {
    items?: {
      p?: SfItem[];
      total?: number;
    };
  };
}

/** Génère un userId pseudo-aléatoire (24 chars hex). */
function genUserId(): string {
  const chars = "abcdef0123456789";
  let s = "";
  for (let i = 0; i < 24; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function buildBody(query: string) {
  const key = `${Date.now()}-0-KeyHit`;
  return {
    key,
    parentKey: key,
    terms: {
      userExpression: query,
      expression: query,
      inputSource: "keyboard",
    },
    userIds: { id: genUserId(), idSourceType: "cookie", trackId: genUserId() },
    trackFingerPrint: {
      tracks: [genUserId()],  // array of session IDs (strings)
      environmentId: "532",   // STRING, pas number !
    },
    sellerId: "",
    acp: {},
    needShortcuts: true,
    items: { from: 0, size: 24, bypassSpellcheck: false },
    spotlights: [],
    scopes: [],
    filters: {},
    showcases: {},
  };
}

function mapItems(items: SfItem[]): ProductResult[] {
  const products: ProductResult[] = [];
  const seen = new Set<string>();
  items.slice(0, 24).forEach((it) => {
    const title = (it.ttl || "").trim();
    if (!title) return;
    const href = absUrl(it.lnk, site.baseUrl);
    if (!href || seen.has(href)) return;
    seen.add(href);

    const price = it.prcn ?? null;
    const catalog = it.prc ?? null;
    const previous = it.pprcn ?? null;
    const realOriginal = previous || (catalog && price && catalog > price ? catalog : null);
    const discount =
      realOriginal && price
        ? Math.round((1 - price / realOriginal) * 100)
        : null;
    const inStock = (it.avl || "").toLowerCase().includes("stock");
    const brand = it.brn || undefined;

    products.push({
      site: "auvieuxcampeur",
      siteName: site.name,
      title: brand ? `${brand} ${title}` : title,
      url: href,
      price,
      originalPrice: realOriginal ?? null,
      currency: "EUR",
      image: absUrl(it.img, site.baseUrl),
      availability: inStock ? "in_stock" : "unknown",
      availabilityLabel: it.avl,
      discount,
    });
  });
  return products;
}

/** Intercepte le x-api-key et les produits via Playwright.
 *  Utilise deux méthodes en parallèle :
 *   1. page.route() — intercepte TOUTES les requêtes réseau au niveau Playwright
 *      (avant même Chrome), ce qui capture les headers que Chrome masque.
 *   2. page.evaluate() — monkey-patch window.fetch pour capturer les headers
 *      directement depuis le contexte JavaScript de la page.
 *   3. Lecture de la config SenseFuel depuis le DOM (data-attributes, scripts).
 */
async function captureApiKeyViaPlaywright(query: string, signal?: AbortSignal): Promise<{ apiKey: string | null; products: ProductResult[] }> {
  const pw = await import("playwright" as any).catch(() => null);
  if (!pw) throw new ScraperError("auvieuxcampeur", "Playwright non installé", { category: "unknown" });
  const chromium = pw.chromium;

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
  });
  let ctx: any = null;
  try {
    ctx = await browser.newContext({
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
      locale: "fr-FR",
      viewport: { width: 1920, height: 1080 },
      extraHTTPHeaders: { "Accept-Language": "fr-FR,fr;q=0.9" },
    });
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    const page = await ctx.newPage();

    if (signal) {
      signal.addEventListener("abort", () => { try { page?.close().catch(() => {}); } catch {} }, { once: true });
    }

    let capturedApiKey: string | null = null;
    let capturedResponse: SfResponse | null = null;

    // MÉTHODE 1: page.route() — intercepte au niveau Playwright (capturer TOUT,
    // y compris les headers que Chrome masque dans le HAR).
    await page.route("**/api.sensefuel.live/**", async (route: any) => {
      const request = route.request();
      const headers = await request.allHeaders();
      const apiKey = headers["x-api-key"] || headers["X-Api-Key"];
      if (apiKey) {
        capturedApiKey = apiKey;
        log.debug(`x-api-key capturé via page.route() : ${apiKey.slice(0, 8)}...`);
      }
      // Laisser la requête passer et capturer la réponse
      const response = await route.fetch();
      try {
        const body = await response.json();
        if (body?.data?.items?.p?.length > 0) {
          capturedResponse = body;
          log.debug(`réponse capturée via page.route() : ${body.data.items.p.length} produits`);
        }
      } catch {}
      // Transmettre la réponse au navigateur
      try { await route.fulfill({ response }); } catch {}
    });

    // MÉTHODE 2: Monkey-patch fetch() dans le contexte de la page pour capturer
    // les headers avant l'envoi (double sécurité).
    await page.addInitScript(() => {
      const origFetch = window.fetch;
      (window as any).__capturedHeaders = {};
      (window as any).fetch = function(...args: any[]) {
        try {
          const input = args[0];
          const init = args[1];
          if (typeof input === "string" && input.includes("sensefuel")) {
            const headers = init?.headers || {};
            if (headers instanceof Headers) {
              const ak = headers.get("x-api-key");
              if (ak) (window as any).__capturedHeaders.xApiKey = ak;
            } else {
              if (headers["x-api-key"]) (window as any).__capturedHeaders.xApiKey = headers["x-api-key"];
              if (headers["X-Api-Key"]) (window as any).__capturedHeaders.xApiKey = headers["X-Api-Key"];
            }
          }
        } catch {}
        return (origFetch as any).apply(this, args);
      };

      // Aussi monkey-patch XMLHttpRequest
      const origSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
      XMLHttpRequest.prototype.setRequestHeader = function(name: string, value: string) {
        if (name.toLowerCase() === "x-api-key") {
          (window as any).__capturedHeaders.xApiKey = value;
        }
        return origSetRequestHeader.call(this, name, value);
      };
    });

    // Charger la homepage
    await page.goto(site.baseUrl + "/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(5000);

    // Accepter les cookies
    try {
      const cookieBtn = await page.$("#didomi-notice-agree-button, button:has-text('Accepter'), button:has-text('Tout accepter')");
      if (cookieBtn && await cookieBtn.isVisible().catch(() => false)) {
        await cookieBtn.click({ timeout: 2000 });
        await page.waitForTimeout(500);
      }
    } catch {}

    // MÉTHODE 3: Lire la config SenseFuel depuis le DOM
    const sensefuelConfig = await page.evaluate(() => {
      // Cherche les data-attributes
      const el = document.querySelector("[data-sensefuel], [data-sf-api-key], [data-api-key]");
      if (el) {
        return {
          source: "data-attribute",
          apiKey: el.getAttribute("data-sf-api-key") || el.getAttribute("data-api-key") || el.getAttribute("data-sensefuel-api-key"),
        };
      }
      // Cherche dans les balises <script> une variable contenant apiKey
      const scripts = Array.from(document.querySelectorAll("script"));
      for (const s of scripts) {
        const text = s.textContent || "";
        // Pattern: apiKey: "xxxx" ou apiKey:"xxxx" ou "x-api-key":"xxxx"
        const match = text.match(/(?:apiKey|api_key|x-api-key)["\s:]+"([^"]{20,})"/i);
        if (match) return { source: "script-tag", apiKey: match[1] };
      }
      // Cherche dans les meta tags
      const meta = document.querySelector('meta[name="api-key"], meta[name="sensefuel-key"], meta[property="api-key"]');
      if (meta) return { source: "meta-tag", apiKey: meta.getAttribute("content") };
      // Cherche dans window
      const win: any = window;
      if (win.sensefuel?.apiKey) return { source: "window.sensefuel", apiKey: win.sensefuel.apiKey };
      if (win.SF?.apiKey) return { source: "window.SF", apiKey: win.SF.apiKey };
      if (win.sensefuelConfig?.apiKey) return { source: "window.sensefuelConfig", apiKey: win.sensefuelConfig.apiKey };
      return null;
    });
    if (sensefuelConfig?.apiKey) {
      capturedApiKey = sensefuelConfig.apiKey;
      log.debug(`x-api-key trouvé via ${sensefuelConfig.source} : ${sensefuelConfig.apiKey.slice(0, 8)}...`);
    }

    // Chercher le champ de recherche et taper la requête
    const searchInput = await page.$('input[name="q"], input[name="search"], input[type="search"], #search, .search input, input[placeholder*="echerch" i], input.sf-input, input.sensefuel-input');
    if (searchInput) {
      await searchInput.click({ timeout: 3000 });
      await searchInput.fill(query, { timeout: 5000 });
      await page.waitForTimeout(5000); // laisse SenseFuel répondre

      // Vérifier si on a capturé la clé via le monkey-patch
      if (!capturedApiKey) {
        const captured = await page.evaluate(() => (window as any).__capturedHeaders || {});
        if (captured.xApiKey) {
          capturedApiKey = captured.xApiKey;
          log.debug(`x-api-key capturé via fetch monkey-patch : ${captured.xApiKey.slice(0, 8)}...`);
        }
      }

      // Tenter Enter
      try {
        await page.keyboard.press("Enter");
        await page.waitForTimeout(3000);
      } catch {}
    }

    // Si on a capturé une réponse avec des produits
    if ((capturedResponse as any)?.data?.items?.p?.length > 0) {
      const products = mapItems((capturedResponse as any).data.items.p);
      return { apiKey: capturedApiKey, products };
    }

    return { apiKey: capturedApiKey, products: [] };
  } finally {
    try { if (ctx) await ctx.close(); } catch {}
    try { await browser.close(); } catch {}
  }
}

export const site: SiteMeta = {
  id: "auvieuxcampeur",
  name: "Au Vieux Campeur",
  baseUrl: "https://www.auvieuxcampeur.fr",
  country: "FR",
  currency: "EUR",
  accent: "bg-stone-100 text-stone-800 border-stone-200",
  groups: ["all"],
};

export const scraper: Scraper = {
  site,
  capabilities: { engine: "rest", challenge: true },
  async search(query, signal) {
    const ua = pickUserAgent();
    const searchPageUrl = `${site.baseUrl}/search?q=${encodeURIComponent(query)}`;
    const body = buildBody(query);

    // 0) Récupère la clé API depuis tagp.js (le fichier JS public de SenseFuel
    //    qui contient la clé en clair). Beaucoup plus rapide que Playwright.
    const apiKey = await fetchApiKey();

    // 1) Tente axios direct AVEC la clé (si trouvée)
    if (apiKey) {
      try {
        const res = await axios.post<SfResponse>(SEARCH_URL, body, {
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "User-Agent": ua,
            Origin: site.baseUrl,
            Referer: searchPageUrl,
            "X-Requested-With": "XMLHttpRequest",
            "X-API-KEY": apiKey,
            "Accept-Language": "fr-FR,fr;q=0.9",
          },
          timeout: 25000,
          signal,
          validateStatus: (s) => s < 500,
        });
        if (res.status < 400) {
          const items = res.data?.data?.items?.p ?? [];
          const products = mapItems(items);
          if (products.length) {
            log.info(`${products.length} produits récupérés via axios + clé tagp.js`);
            return products;
          }
        }
        log.warn(`axios avec clé : HTTP ${res.status}`);
      } catch (e: any) {
        log.warn(`axios avec clé échoué (${e.message})`);
      }
    }

    // 2) Tente axios SANS clé (au cas où l'API ne l'exigerait plus)
    try {
      const res = await axios.post<SfResponse>(SEARCH_URL, body, {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": ua,
          Origin: site.baseUrl,
          Referer: searchPageUrl,
          "X-Requested-With": "XMLHttpRequest",
          "Accept-Language": "fr-FR,fr;q=0.9",
        },
        timeout: 25000,
        signal,
        validateStatus: (s) => s < 500,
      });
      if (res.status < 400) {
        const items = res.data?.data?.items?.p ?? [];
        const products = mapItems(items);
        if (products.length) return products;
      }
    } catch {}

    // 3) Dernier recours : Playwright (interception + recherche directe)
    log.warn(`axios échoué, tentative Playwright…`);
    const { products } = await captureApiKeyViaPlaywright(query, signal);
    if (products.length > 0) return products;

    throw new ScraperError(
      "auvieuxcampeur",
      `Impossible de récupérer des produits. Clé API ${apiKey ? "trouvée mais" : "non trouvée et"} requête rejetée (401). L'API SenseFuel peut nécessiter une IP résidentielle.`,
      { statusCode: 401, category: "auth" }
    );
  },
};
