// Scraper ProBikeShop (FR, EUR)
// --------------------------------------------------------------------------
// Protocole (cf. PROTOCOLES.md) :
//   ProBikeShop est une boutique Shopify qui utilise Doofinder Layer Widget
//   en WebSocket Phoenix LiveView pour la recherche.
//   wss://eu1-layer.doofinder.com/layer/1/websocket?hashid=68b4fcaae52b03eb30d5be2176086740&origin=probikeshop.fr&...
//   Hashid : 68b4fcaae52b03eb30d5be2176086740 (constant).
//
//   Une API Shopify Storefront GraphQL existe (POST /api/2025-07/graphql.json)
//   mais elle ne sert qu'aux lookups par handle (recently viewed, bundles).
//   Elle n'est PAS utilisée pour la recherche utilisateur — tout passe par
//   Doofinder.
//
// Approche : on lance Chromium, charge la page d'accueil FR, clique sur l'icône
// de recherche (summary.header__icon--search) pour ouvrir le modal qui contient
// le layer DFD plein écran, tape la requête dans .dfd-searchbox-input, valide,
// attend l'affichage des cartes.
//
// Champs utiles (structure HTML rendue par le widget Doofinder — identique
// au widget Glisshop/Barrabes) :
//   .dfd-card-type-product            → carte produit (racine)
//   [dfd-value-link]                  → URL absolue du produit
//   .dfd-card-thumbnail img[src]      → image
//   .dfd-card-brand                   → marque (vrai champ marque)
//   .dfd-card-sku                     → SKU/référence (fallback pour marque si .dfd-card-brand absent)
//   .dfd-card-title                   → libellé
//   .dfd-card-price--sale[data-value] → prix payé (uniquement si promo)
//   .dfd-card-price[data-value]       → prix catalogue (toujours présent)
//   .dfd-card-flag[data-discount]     → pourcentage promo
//
// Pièges :
//   - Le champ qui ouvre le modal de recherche est un <summary> dans un
//     <details-modal>, pas un input. Il faut cliquer sur le summary, pas
//     sur un input直接.
//   - Le layer Doofinder est chargé en lazy : il faut attendre que
//     input.dfd-searchbox-input apparaisse après l'ouverture du modal.
// --------------------------------------------------------------------------
import { SiteMeta, ProductResult, Scraper } from "../types";

import { absUrl } from "../http";
import { ScraperError } from "../error";
import { logger } from "../../logger";

const log = logger.forSite("probikeshop");

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
// ProBikeShop utilise un <summary> dans un <details-modal> — cliquer sur
// n'importe quel input ne fonctionne pas, il faut le summary.
const SEARCH_TRIGGER_SELECTORS = [
  "summary.header__icon--search",        // ProBikeShop
  ".search_input",                       // ProBikeShop (classe générique)
  ".header__search summary",             // ProBikeShop (alternative)
  "#cSearch",                            // Barrabes
  "input.doofinder-trigger",             // Barrabes (classe générique)
  'input[name="searchText"]',             // Glisshop
  'input[name="q"]',
  'input[name="search"]',
  ".header-search__input",
  '[data-testid="search-input"]',
  '.search-form input[type="search"]',
  'input[type="search"]',
];

/** Tente de cliquer sur le trigger de recherche pour ouvrir le layer Doofinder.
 *  Essaye chaque sélecteur jusqu'à trouver un qui fonctionne. */
async function openDfdLayer(page: any): Promise<boolean> {
  for (const sel of SEARCH_TRIGGER_SELECTORS) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.click({ timeout: 3000, force: true });
        await page.waitForTimeout(1200);
        // Vérifie que le layer DFD est bien ouvert
        const dfdOpen = await page.$(".dfd-fullscreen, .dfd-layer, input.dfd-searchbox-input");
        if (dfdOpen) {
          log.info(`layer DFD ouvert via sélecteur "${sel}"`);
          return true;
        }
        // Si le modal est ouvert mais DFD pas encore chargé, attendre plus longtemps
        const modalOpen = await page.$("details[open] .header__search, .modal--open");
        if (modalOpen) {
          try {
            await page.waitForSelector("input.dfd-searchbox-input", { timeout: 5000 });
            log.info(`layer DFD ouvert via sélecteur "${sel}" (modal + lazy load)`);
            return true;
          } catch { /* next selector */ }
        }
      }
    } catch {
      // Sélecteur suivant
    }
  }
  return false;
}

async function loadAndQueryDfd(query: string, signal?: AbortSignal): Promise<DfdCard[]> {
  const pw = await import("playwright" as any).catch(() => null);
  if (!pw) throw new ScraperError("probikeshop", "Playwright non installé", { category: "unknown" });
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

    // 1) Charger la page d'accueil FR
    await page.goto(site.baseUrl + "/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(5000);

    // 1b) Accepter les cookies (banner CookieLab/CH2 — sinon le focus est volé)
    try {
      const acceptBtn = await page.$(
        "button:has-text('Tout autoriser'), button:has-text('Accepter'), button:has-text('Accept all')"
      );
      if (acceptBtn && await acceptBtn.isVisible().catch(() => false)) {
        await acceptBtn.click({ timeout: 2000 });
        await page.waitForTimeout(800);
      }
    } catch { /* ignore */ }

    // 1c) Fermer le modal de sélecteur de pays (probi détecte l'IP et ouvre
    //     un modal "We don't ship to <country>" qui bloque toute interaction).
    try {
      const closeBtn = await page.$(".md-modal-closeButton");
      if (closeBtn) {
        await closeBtn.click({ timeout: 2000, force: true });
        await page.waitForTimeout(1500);
      }
    } catch { /* ignore */ }

    // 2) Ouvrir le layer Doofinder (essaie plusieurs sélecteurs)
    const opened = await openDfdLayer(page);
    if (!opened) {
      throw new ScraperError("probikeshop", "Impossible d'ouvrir le layer Doofinder sur la page d'accueil", { category: "parse" });
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
  id: "probikeshop",
  name: "ProBikeShop",
  baseUrl: "https://probikeshop.fr",
  country: "FR",
  currency: "EUR",
  accent: "bg-cyan-100 text-cyan-800 border-cyan-200",
  groups: ["cycling"],
};

export const scraper: Scraper = {
  site,
    capabilities: { engine: "doofinder", usesPlaywright: true, challenge: true, relevance: "strict" },
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
        site: "probikeshop",
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
