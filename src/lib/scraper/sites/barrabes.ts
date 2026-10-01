// Scraper Barrabes (ES/FR, EUR)
// --------------------------------------------------------------------------
// Protocole (cf. PROTOCOLES.md) :
//   Doofinder Layer Widget en WebSocket Phoenix LiveView.
//   wss://eu1-layer.doofinder.com/layer/1/websocket?hashid=<HASHID>&origin=www.barrabes.com&...
//   L'API REST Doofinder répond « request not authenticated » : voie close.
//   Le seul accès pratique : rendre la page avec un vrai navigateur, ouvrir
//   le layer Doofinder, taper la requête, et lire les cartes rendues.
//
// Hashid Barrabes : ab5ee4283e3582ee7ecdb6e65abbf338 (constante — un hashid par
// installation Doofinder, ne change pas).
//
// Approche : on lance Chromium, charge la page d'accueil FR, clique sur le champ
// de recherche (qui ouvre le layer DFD plein écran), tape la requête dans
// l'input `.dfd-searchbox-input`, valide, attend l'affichage des cartes.
//
// Champs utiles (structure HTML rendue par le widget Doofinder — identique
// au widget Glisshop, seul le hashid change) :
//   .dfd-card-type-product            → carte produit (racine)
//   [dfd-value-link]                  → URL absolue du produit
//   .dfd-card-thumbnail img[src]      → image
//   .dfd-card-brand                   → marque (vrai champ marque)
//   .dfd-card-sku                     → SKU/référence (fallback pour marque si .dfd-card-brand absent)
//   .dfd-card-title                   → libellé
//   .dfd-card-price--sale[data-value] → prix payé (uniquement si promo)
//   .dfd-card-price[data-value]       → prix catalogue (toujours présent)
//   .dfd-card-flag[data-discount]     → pourcentage promo (« 50% »)
//
// Pièges :
//   - Le sélecteur du champ de recherche qui ouvre le layer varie. On essaie
//     plusieurs sélecteurs : input[name="searchText"], input[name="q"],
//     .header-search__input, [data-testid="search-input"].
//   - Le layer Doofinder s'ouvre en plein écran avec un overlay ; il faut
//     attendre que l'overlay soit visible avant de taper.
//   - Les prix peuvent arriver en différé (chargement async des cartes).
// --------------------------------------------------------------------------
import { SiteMeta, ProductResult, Scraper } from "../types";

import { absUrl } from "../http";
import { ScraperError } from "../error";
import { logger } from "../../logger";

const log = logger.forSite("barrabes");

interface DfdCard {
  link: string | null;
  title: string | null;
  brand: string | null;
  img: string | null;
  salePrice: number | null;
  catalogPrice: number | null;
  discount: number | null;
}

// Sélecteurs à essayer pour ouvrir le layer Doofinder (par ordre de priorité).
// Le champ qui déclenche l'ouverture du layer varie selon l'intégration.
// Barrabes utilise `input#cSearch.doofinder-trigger` (readonly — le click
// déclenche l'ouverture du layer).
const SEARCH_INPUT_SELECTORS = [
  "#cSearch",                              // Barrabes
  "input.doofinder-trigger",               // Barrabes (classe générique)
  'input[name="searchText"]',              // Glisshop
  'input[name="q"]',
  'input[name="search"]',
  ".header-search__input",
  '[data-testid="search-input"]',
  '.search-form input[type="search"]',
  '.search-form input[type="text"]',
  'input[type="search"]',
];

/** Tente de cliquer sur le champ de recherche pour ouvrir le layer Doofinder.
 *  Essaye chaque sélecteur jusqu'à trouver un qui fonctionne.
 *  Si aucun sélecteur ne fonctionne au premier essai, on retente jusqu'à 3 fois
 *  avec un délai entre chaque (le widget Doofinder peut mettre du temps à
 *  s'initialiser sur certaines pages). */
async function openDfdLayer(page: any): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const sel of SEARCH_INPUT_SELECTORS) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.click({ timeout: 3000, force: true });
          await page.waitForTimeout(1000);
          const dfdOpen = await page.$(".dfd-fullscreen, .dfd-layer, input.dfd-searchbox-input");
          if (dfdOpen) {
            log.info(`layer DFD ouvert via sélecteur "${sel}" (tentative ${attempt + 1})`);
            return true;
          }
        }
      } catch {
        // Sélecteur suivant
      }
    }
    if (attempt < 2) {
      log.info(`tentative ${attempt + 1} échouée, retry dans 2s...`);
      await page.waitForTimeout(2000);
    }
  }
  return false;
}

async function loadAndQueryDfd(query: string, signal?: AbortSignal): Promise<DfdCard[]> {
  const pw = await import("playwright" as any).catch(() => null);
  if (!pw) throw new ScraperError("barrabes", "Playwright non installé", { category: "unknown" });
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
      extraHTTPHeaders: { "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8" },
    });
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "languages", { get: () => ["fr-FR", "fr", "en"] });
      Object.defineProperty(navigator, "vendor", { get: () => "Google Inc." });
    });

    const page = await ctx.newPage();

    if (signal) {
      signal.addEventListener(
        "abort",
        () => { try { page?.close().catch(() => {}); } catch { /* ignore */ } },
        { once: true }
      );
    }

    // 1) Charger la page d'accueil FR (le widget Doofinder s'y initialise)
    await page.goto(site.baseUrl + "/fr/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(2500);

    // 2) Ouvrir le layer Doofinder (essaie plusieurs sélecteurs)
    const opened = await openDfdLayer(page);
    if (!opened) {
      throw new ScraperError("barrabes", "Impossible d'ouvrir le layer Doofinder sur la page d'accueil", { category: "parse" });
    }
    await page.waitForTimeout(1200);

    // 3) Taper dans l'input DFD et valider
    await page.waitForSelector("input.dfd-searchbox-input", { timeout: 8000 });
    await page.fill("input.dfd-searchbox-input", query, { timeout: 8000 });
    await page.waitForTimeout(1500);
    await page.press("input.dfd-searchbox-input", "Enter");

    // 4) Attendre l'affichage des cartes produit
    await page.waitForSelector(".dfd-card-type-product", { timeout: 12000 });
    await page.waitForTimeout(2000); // laisse le temps aux prix d'arriver

    // 5) Extraire les cartes via page.evaluate (le DOM est vivant, pas statique)
    const cards = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll<HTMLElement>(".dfd-card-type-product"));
      return items.slice(0, 24).map((el) => {
        const link = el.getAttribute("dfd-value-link");
        const img = el.querySelector(".dfd-card-thumbnail img")?.getAttribute("src") || null;
        const brand = (el.querySelector(".dfd-card-brand")?.textContent || el.querySelector(".dfd-card-sku")?.textContent || "").trim();
        const title = (el.querySelector(".dfd-card-title")?.textContent || "").trim();
        const saleEl = el.querySelector(".dfd-card-price--sale");
        const salePrice = saleEl ? parseFloat(saleEl.getAttribute("data-value") || "") : null;
        const allPrices = Array.from(el.querySelectorAll<HTMLElement>(".dfd-card-price"));
        const catalogPrice = allPrices
          .filter((p) => !p.classList.contains("dfd-card-price--sale"))
          .map((p) => parseFloat(p.getAttribute("data-value") || ""))
          .find((v) => !isNaN(v)) ?? null;
        const discountRaw = el.querySelector(".dfd-card-flag[data-discount]")?.getAttribute("data-discount") || null;
        const discount = discountRaw ? parseInt(discountRaw.replace(/[^\d]/g, ""), 10) : null;
        return {
          link: link || null,
          title: title || null,
          brand: brand || null,
          img: img || null,
          salePrice: isNaN(salePrice as number) ? null : salePrice,
          catalogPrice: isNaN(catalogPrice as number) ? null : catalogPrice,
          discount: isNaN(discount as number) ? null : discount,
        };
      });
    });

    return cards;
  } finally {
    try { if (ctx) await ctx.close(); } catch { /* ignore */ }
    try { await browser.close(); } catch { /* ignore */ }
  }
}

export const site: SiteMeta = {
  id: "barrabes",
  name: "Barrabes",
  baseUrl: "https://www.barrabes.com",
  country: "ES",
  currency: "EUR",
  accent: "bg-red-100 text-red-800 border-red-200",
  groups: ["all"],
};

export const scraper: Scraper = {
  site,
    capabilities: { engine: "doofinder", usesPlaywright: true },
  async search(query, signal) {
    const cards = await loadAndQueryDfd(query, signal);
    const products: ProductResult[] = [];
    const seen = new Set<string>();

    cards.forEach((c) => {
      if (!c.title && !c.brand) return;
      const href = absUrl(c.link, site.baseUrl);
      if (!href || seen.has(href)) return;
      seen.add(href);

      const price = c.salePrice ?? c.catalogPrice ?? null;
      const originalPrice =
        c.catalogPrice && price && c.catalogPrice > price ? c.catalogPrice : null;
      const discount =
        c.discount ?? (originalPrice && price
          ? Math.round((1 - price / originalPrice) * 100)
          : null);
      const title = c.brand && c.title ? `${c.brand} ${c.title}` : (c.title || c.brand || "");

      products.push({
        site: "barrabes",
        siteName: site.name,
        title,
        url: href,
        price,
        originalPrice,
        currency: "EUR",
        image: absUrl(c.img, site.baseUrl),
        availability: "unknown",
        discount,
      });
    });

    return products;
  },
};
