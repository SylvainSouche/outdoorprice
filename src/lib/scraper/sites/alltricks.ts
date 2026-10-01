// Scraper Alltricks (FR, EUR)
// --------------------------------------------------------------------------
// Protocole (cf. PROTOCOLES.md) :
//   Formulaire de recherche POST https://www.alltricks.fr/search
//   Champ de requête : input[name="s"] (class="search tt-input", type="text")
//   Placeholder : "Rechercher un produit, une marque..."
//
//   Le site utilise Twitter Typeahead pour l'autocomplétion (classe tt-input).
//   La page de résultats est rendue côté serveur (HTML statique), pas une SPA.
//
//   Cloudflare protège la page /search (challenge JS). La page d'accueil et
//   /recherche (404 mais qui contient le formulaire) ne sont PAS protégées.
//   Le submit du form POST vers /search déclenche le challenge Cloudflare.
//
//   Depuis une IP résidentielle (pas data-center), Cloudflare ne challenge
//   pas — la page de résultats se charge normalement. Depuis le sandbox
//   data-center, le challenge ne peut pas être résolu (même via Playwright).
//
// Approche :
//   1. Chromium charge https://www.alltricks.fr/recherche (page 404 mais
//      contient le form de recherche, sans challenge Cloudflare).
//   2. Accepter les cookies (banner Didomi).
//   3. Cliquer sur input.search.tt-input, taper la requête, valider.
//   4. La soumission POST vers /search peut déclencher Cloudflare — attendre
//      jusqu'à 30s que le challenge se résolve (ça marche depuis une IP
//      résidentielle, rarement depuis le data-center).
//   5. Une fois la page de résultats chargée, extraire les cartes produit
//      via les liens /F-XXX/P-XXX.
//
// URL des produits : /F-<catId>-<catSlug>/P-<prodId>-<prodSlug>
//   ex : /F-32743-etriers-de-frein/P-412486-etrier_de_frein_avant_shimano_105_br_r7000_noir
//
// Champs utiles (HTML rendu côté serveur — sélecteurs à confirmer depuis
// une IP résidentielle, basés sur les conventions Alltricks) :
//   a[href*="/P-"]                    → lien produit (contient l'URL et le titre)
//   .product-card, .product-item     → conteneur carte (si présent)
//   img                               → image (à l'intérieur de la carte)
//   .price, [class*="price"]          → prix
//
// Pièges :
//   - Cloudflare bloque le POST /search depuis le data-center. Le scraper
//     gère ce cas en attendant 30s puis en retournant un résultat vide avec
//     un message d'erreur clair ("Cloudflare challenge non résolu").
//   - La classe "tt-input" indique Twitter Typeahead — pendant la frappe,
//     des suggestions peuvent apparaître dans une dropdown. Ne pas les
//     confondre avec les résultats de la page /search.
//   - Le formulaire accepte aussi un paramètre "Search" (uppercase S) dans
//     l'URL, mais c'est un 404 — seul le POST avec "s" fonctionne.
// --------------------------------------------------------------------------
import { SiteMeta, ProductResult, Scraper } from "../types";

import { absUrl, parsePrice, cleanTitle } from "../http";
import { ScraperError } from "../error";
import { logger } from "../../logger";

const log = logger.forSite("alltricks");

/** Attend que Cloudflare se résolve (la page title passe de "Un instant…" à
 *  un titre normal). Retourne true si cleared, false si timeout.
 *
 *  Stratégie :
 *   - On poll le titre + l'URL toutes les 500ms pendant 20s (configurable).
 *   - Si le titre contient "Un instant…" / "Just a moment..." → challenge
 *     Cloudflare, on attend encore.
 *   - Si l'URL n'est plus /recherche (la page initiale 404) ET le titre ne
 *     contient pas de mots-clés Cloudflare → page de résultats chargée.
 *   - Alltricks redirige /search vers /Acheter/<query> (URL rewriting SEO),
 *     donc on accepte n'importe quelle URL sauf /recherche.
 *
 *  Configurable via SCRAPE_CLOUDFLARE_TIMEOUT_MS (default 20000 = 20s).
 */
async function waitForCloudflare(page: any, timeoutMs?: number): Promise<boolean> {
  const earlyTimeoutMs = timeoutMs ?? parseInt(process.env.SCRAPE_CLOUDFLARE_TIMEOUT_MS || "20000", 10);
  const start = Date.now();
  let lastTitle = "";
  let lastUrl = "";
  while (Date.now() - start < earlyTimeoutMs) {
    const title = await page.title().catch(() => "");
    const url = page.url() || "";
    lastTitle = title;
    lastUrl = url;
    const t = title.toLowerCase();
    // Si on est sur "Un instant…" / "Just a moment..." → challenge Cloudflare
    if (t.includes("instant") || t.includes("moment") || t.includes("just a")) {
      await page.waitForTimeout(500);
      continue;
    }
    // Si on est encore sur /recherche (page 404 initiale), la navigation
    // n'a pas encore eu lieu → attendre
    if (url.includes("/recherche")) {
      await page.waitForTimeout(500);
      continue;
    }
    // On n'est plus sur /recherche ET le titre n'est pas Cloudflare →
    // page de résultats chargée (peut être /search, /Acheter/<query>, etc.)
    return true;
  }
  log.debug(`non résolu après ${earlyTimeoutMs / 1000}s (URL: ${lastUrl}, titre: "${lastTitle}")`);
  return false;
}

interface AlltricksCard {
  url: string | null;
  title: string | null;
  img: string | null;
  price: number | null;
  originalPrice: number | null;
}

async function loadAndSearch(query: string, signal?: AbortSignal): Promise<AlltricksCard[]> {
  const pw = await import("playwright" as any).catch(() => null);
  if (!pw) throw new ScraperError("alltricks", "Playwright non installé", { category: "unknown" });
  const chromium = pw.chromium;
  const t0 = Date.now();
  const log = (msg: string) => console.log(`[alltricks] +${Date.now() - t0}ms ${msg}`);

  const launchOpts: any = {
    // SCRAPE_HEADED=1 : Chrome visible — le challenge Cloudflare Turnstile
    // passe beaucoup mieux dans une vraie fenêtre que headless.
    headless: process.env.SCRAPE_HEADED !== "1",
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

  // Cloudflare détecte le Chromium bundlé de Playwright : on préfère le vrai
  // Chrome installé (channel "chrome") dont l'empreinte passe mieux le
  // challenge "Un instant…". Repli sur le Chromium bundlé si absent.
  // Désactivable via SCRAPE_USE_CHROME=0.
  let browser: any;
  const useChrome = process.env.SCRAPE_USE_CHROME !== "0";
  let usingChrome = false;
  if (useChrome) {
    try {
      browser = await chromium.launch({ ...launchOpts, channel: "chrome" });
      usingChrome = true;
      log("navigateur : vrai Chrome (channel chrome)");
    } catch {
      log("Chrome système introuvable — repli sur Chromium bundlé");
      browser = await chromium.launch(launchOpts);
    }
  } else {
    browser = await chromium.launch(launchOpts);
  }
  let ctx: any = null;
  try {
    ctx = await browser.newContext({
      // Avec le vrai Chrome, on garde son UA natif (cohérent avec l'empreinte)
      userAgent: usingChrome
        ? undefined
        : "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
      locale: "fr-FR",
      timezoneId: "Europe/Paris",
      viewport: { width: 1920, height: 1080 },
      extraHTTPHeaders: { "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8" },
    });
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "languages", { get: () => ["fr-FR", "fr", "en"] });
      Object.defineProperty(navigator, "vendor", { get: () => "Google Inc." });
    });

    const page = await ctx.newPage();
    log("page created");

    if (signal) {
      signal.addEventListener(
        "abort",
        () => { try { page?.close().catch(() => {}); } catch { /* ignore */ } },
        { once: true }
      );
    }

    // 1) Charger /recherche (page 404 mais contient le formulaire, sans Cloudflare)
    await page.goto(site.baseUrl + "/recherche", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    log("page.goto /recherche done");
    // Attendre que le form de recherche soit présent (5s max)
    let inputReady = false;
    try {
      await page.waitForSelector("input.search.tt-input, input[name='s']", { timeout: 5000 });
      inputReady = true;
      log("search input appeared");
    } catch {
      // Probable challenge Cloudflare sur /recherche lui-même : attendre
      // qu'il se dissipe avant d'abandonner.
      log("search input absent — vérification challenge Cloudflare");
      const cleared = await waitForCloudflare(page);
      if (cleared) {
        try {
          await page.waitForSelector("input.search.tt-input, input[name='s']", { timeout: 5000 });
          inputReady = true;
          log("search input appeared (après dissipation du challenge)");
        } catch { /* vraiment absent */ }
      }
      if (!inputReady) {
        throw new ScraperError(
          "alltricks",
          cleared
            ? "Champ de recherche introuvable sur /recherche (le site a probablement changé)"
            : "Cloudflare bloque même /recherche — le challenge ne se dissipe pas. Essayez SCRAPE_HEADED=1 (Chrome visible) ou une autre IP.",
          { category: cleared ? "parse" : "blocked" }
        );
      }
    }

    // 2) Accepter les cookies (banner Didomi) — quick check, don't wait long
    try {
      const cookieBtn = await page.$("#didomi-notice-agree-button, button:has-text('Accepter'), button:has-text('Tout accepter')");
      if (cookieBtn && await cookieBtn.isVisible().catch(() => false)) {
        await cookieBtn.click({ timeout: 2000 });
        await page.waitForTimeout(500);
        log("cookies accepted");
      } else {
        log("no cookie banner");
      }
    } catch { /* ignore */ }

    // 3) Trouver le champ de recherche (visible — un input masqué par le
    //    challenge Cloudflare ne doit pas passer)
    const searchInput = await page.$("input.search.tt-input, input[name='s'], input[placeholder*='echerch']");
    if (!searchInput || !(await searchInput.isVisible().catch(() => false))) {
      throw new ScraperError("alltricks", "champ de recherche introuvable/invisible sur /recherche (challenge Cloudflare ?)", { category: "blocked" });
    }

    // 3b) Le popup Didomi peut apparaître APRÈS la dissipation du challenge
    //     (il n'était pas là au step 2) — son backdrop intercepte les clics.
    try {
      const cookieBtn = await page.$("#didomi-notice-agree-button, button:has-text('Accepter'), button:has-text('Tout accepter')");
      if (cookieBtn && await cookieBtn.isVisible().catch(() => false)) {
        await cookieBtn.click({ timeout: 2000 });
        await page.waitForTimeout(500);
        log("cookies accepted (après challenge)");
      }
    } catch { /* ignore */ }

    // 4) Taper et soumettre le formulaire
    await searchInput.click({ timeout: 3000 });
    await searchInput.fill(query, { timeout: 5000 });
    await page.waitForTimeout(500);
    // Submit via form.submit() in JS — more reliable than clicking the
    // submit button (which may be visually hidden or intercepted by
    // Typeahead's Enter handler).
    let submitted = false;
    try {
      const result = await page.evaluate((q: string) => {
        const form = document.querySelector('form[action*="/search"]') as HTMLFormElement | null;
        if (!form) return "no form";
        // Set the search field value explicitly (Typeahead may have cleared it)
        const input = form.querySelector('input[name="s"]') as HTMLInputElement | null;
        if (input) input.value = q;
        form.submit();
        return "submitted";
      }, query);
      if (result === "submitted") {
        submitted = true;
        log("submitted via form.submit()");
      } else {
        log(`form.submit() failed: ${result}`);
      }
    } catch (e) {
      log(`form.submit() error: ${(e as Error).message.slice(0, 80)}`);
    }
    if (!submitted) {
      // Fallback: click submit button + wait for navigation
      try {
        const submitBtn = await page.$('form[action*="/search"] button[type="submit"], form[action*="/search"] button');
        if (submitBtn) {
          await Promise.all([
            page.waitForNavigation({ timeout: 5000, waitUntil: "domcontentloaded" }).catch(() => null),
            submitBtn.click({ timeout: 3000, force: true }),
          ]);
          log("submitted via button click (fallback)");
          submitted = true;
        }
      } catch (e) {
        log(`button click failed: ${(e as Error).message.slice(0, 80)}`);
      }
    }
    if (!submitted) {
      // Last resort: Enter key
      try {
        await Promise.all([
          page.waitForNavigation({ timeout: 5000, waitUntil: "domcontentloaded" }).catch(() => null),
          page.keyboard.press("Enter"),
        ]);
        log("submitted via Enter (last resort)");
      } catch {
        log("all submit methods failed");
      }
    }

    // 5) Attendre que Cloudflare se résolve (ou que la page de résultats se charge)
    //    waitForCloudflare poll le titre + cherche des produits. Bails out après le délai configuré
    //    (configurable) si Cloudflare ne se résout pas — depuis le data-center,
    //    le challenge ne se résout jamais, donc on ne ralentit pas toute la
    //    recherche pour rien.
    const cleared = await waitForCloudflare(page);
    log(`waitForCloudflare returned ${cleared}`);
    if (!cleared) {
      // Vérifier le titre pour un message plus précis
      const title = await page.title().catch(() => "");
      if (title.toLowerCase().includes("instant") || title.toLowerCase().includes("moment")) {
        throw new ScraperError(
          "alltricks",
          `Cloudflare challenge non résolu après ${parseInt(process.env.SCRAPE_CLOUDFLARE_TIMEOUT_MS || "20000", 10) / 1000}s — le site /search bloque les IP data-center. Fonctionne depuis une IP résidentielle. Augmentez SCRAPE_CLOUDFLARE_TIMEOUT_MS si vous êtes sur IP rési et le challenge est lent.`,
          { category: "blocked" }
        );
      }
      throw new ScraperError(
        "alltricks",
        `Page de résultats non chargée après ${parseInt(process.env.SCRAPE_CLOUDFLARE_TIMEOUT_MS || "20000", 10) / 1000}s — peut-être une navigation interrompue ou un changement de structure.`,
        { category: "timeout" }
      );
    }

    // À ce stade, soit on a des liens /P-, soit on est sur une page vide légitime
    const hasProducts = await page.$("a[href*='/P-']").catch(() => null);
    if (!hasProducts) {
      log("page loaded but no product links — empty results");
      return [];
    }
    log("product links appeared");
    await page.waitForTimeout(2000); // laisse les images charger

    // 6) Extraire les cartes produit
    const cards = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href*='/P-']"))
        .filter((a) => {
          // Filter out nav links / breadcrumbs — keep only product cards
          const href = a.getAttribute("href") || "";
          if (!href.includes("/P-")) return false;
          // Product links have the pattern /F-XXX-slug/P-XXX-slug
          return /\/F-\d+-[^/]+\/P-\d+-/.test(href);
        });
      // Dedup by href
      const seen = new Set<string>();
      const unique = items.filter((a) => {
        const href = a.getAttribute("href") || "";
        if (seen.has(href)) return false;
        seen.add(href);
        return true;
      });
      return unique.slice(0, 24).map((a) => {
        const href = a.getAttribute("href") || "";
        const title = (a.textContent || "").trim().slice(0, 200);
        // Find the parent card container
        let container: HTMLElement | null = a;
        for (let i = 0; i < 6; i++) {
          if (!container?.parentElement) break;
          container = container.parentElement;
          if (container?.querySelector("img") && container.textContent && container.textContent.includes("€")) {
            break;
          }
        }
        // Image produit : éviter les pictos du site (rating.svg, icônes) —
        // on privilégie les imgs du CDN produit, puis les non-SVG.
        const imgCandidates = container
          ? Array.from(container.querySelectorAll("img")).flatMap((im) => [
              im.getAttribute("src") || "",
              im.getAttribute("data-src") || "",
            ]).filter(Boolean)
          : [];
        const img =
          imgCandidates.find((s) => /product-cdn|cdn/i.test(s) && !/\.svg/i.test(s)) ||
          imgCandidates.find((s) => !/\.svg/i.test(s) && !/\/images\//i.test(s)) ||
          imgCandidates[0] ||
          null;
        // Find price — look for elements containing € within the container
        let priceText = "";
        let originalPriceText = "";
        if (container) {
          const priceEls = Array.from(container.querySelectorAll<HTMLElement>("[class*='price'], .price, .amount, [data-price]"));
          for (const el of priceEls) {
            let text = (el.textContent || "").trim();
            // Ne garder que le 1er prix bien formé du texte (l'élément peut
            // contenir plusieurs nombres — ex "29 00" → sinon 2900 au parse)
            const m = text.match(/\d{1,3}(?:[ .]\d{3})*[.,]\d{2}/);
            if (m) text = m[0];
            if (text.includes("€") || /\d+[.,]\d{2}/.test(text)) {
              if (!priceText) {
                priceText = text;
              } else if (!originalPriceText) {
                originalPriceText = text;
              }
            }
          }
          // Fallback: scan all text nodes in container for €
          if (!priceText) {
            const fullText = container.textContent || "";
            const priceMatch = fullText.match(/(\d+[.,]\d{2})\s*€/);
            if (priceMatch) priceText = priceMatch[0];
          }
        }
        return {
          url: href,
          title: title || null,
          img: img || null,
          priceText,
          originalPriceText,
        };
      });
    });

    // Parse prices
    return cards.map((c) => {
      const price = parsePrice(c.priceText);
      const originalPrice = parsePrice(c.originalPriceText);
      return {
        url: c.url,
        title: c.title,
        img: c.img,
        price: price && originalPrice && originalPrice > price ? price : (price ?? null),
        originalPrice: originalPrice && price && originalPrice > price ? originalPrice : null,
      };
    });
  } finally {
    try { if (ctx) await ctx.close(); } catch { /* ignore */ }
    try { await browser.close(); } catch { /* ignore */ }
  }
}

export const site: SiteMeta = {
  id: "alltricks",
  name: "Alltricks",
  baseUrl: "https://www.alltricks.fr",
  country: "FR",
  currency: "EUR",
  accent: "bg-orange-100 text-orange-800 border-orange-200",
  groups: ["cycling"],
};

export const scraper: Scraper = {
  site,
  capabilities: { engine: "html", usesPlaywright: true, challenge: true, relevance: "strict" },
  async search(query, signal) {
    const cards = await loadAndSearch(query, signal);
    const products: ProductResult[] = [];
    const seen = new Set<string>();

    cards.forEach((c) => {
      if (!c.title && !c.url) return;
      const href = absUrl(c.url, site.baseUrl);
      if (!href || seen.has(href)) return;
      seen.add(href);

      const title = cleanTitle(c.title || "");
      const discount =
        c.originalPrice && c.price && c.originalPrice > c.price
          ? Math.round((1 - c.price / c.originalPrice) * 100)
          : null;

      products.push({
        site: "alltricks",
        siteName: site.name,
        title,
        url: href,
        price: c.price,
        originalPrice: c.originalPrice || null,
        currency: "EUR",
        image: absUrl(c.img, site.baseUrl),
        availability: "unknown",
        discount,
      });
    });

    return products;
  },
};
