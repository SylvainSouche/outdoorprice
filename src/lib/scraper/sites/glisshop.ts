// Scraper Glisshop (FR, EUR)
// --------------------------------------------------------------------------
// Protocole (cf. PROTOCOLES.md) :
//   Doofinder Layer Widget en WebSocket Phoenix LiveView.
//   L'API REST répond « request not authenticated » : voie close.
//   Le seul accès pratique : rendre la page avec un vrai navigateur, ouvrir
//   le layer Doofinder, taper la requête, et lire les cartes rendues.
//
// Approche : on lance Chromium, charge la page d'accueil, clique sur le champ
// de recherche (qui ouvre le layer DFD plein écran), tape la requête dans
// l'input `.dfd-searchbox-input`, valide, attend l'affichage des cartes.
//
// Champs utiles (structure HTML rendue par le widget Doofinder) :
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
//   - Une extraction par expressions régulières ne marche pas : 20 liens
//     pour 18 prix et 10 libellés, sans appariement par position.
//   - vars[dfGroup]=TVA20 sélectionne la grille de prix (chaque carte
//     porte .dfd-card-pricing.TVA20).
// --------------------------------------------------------------------------
import { SiteMeta, ProductResult, Scraper } from "../types";

import { absUrl } from "../http";

interface DfdCard {
  link: string | null;
  title: string | null;
  brand: string | null;
  img: string | null;
  salePrice: number | null;
  catalogPrice: number | null;
  discount: number | null;
}

async function loadAndQueryDfd(query: string, signal?: AbortSignal): Promise<DfdCard[]> {
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

    // 1) Charger la page d'accueil (le widget Doofinder s'y initialise)
    await page.goto(site.baseUrl + "/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(2500);

    // 1b) Dismiss Didomi cookie banner if present (it intercepts clicks)
    try {
      const didomiBtn = await page.$("#didomi-notice-agree-button, button:has-text('Accepter'), button:has-text('Tout accepter')");
      if (didomiBtn && await didomiBtn.isVisible().catch(() => false)) {
        await didomiBtn.click({ timeout: 3000 });
        await page.waitForTimeout(800);
      }
    } catch { /* ignore */ }

    // 2) Cliquer sur le champ de recherche pour ouvrir le layer DFD plein écran
    await page.click('input[name="searchText"]', { timeout: 8000 });
    await page.waitForTimeout(1500);

    // 3) Taper dans l'input DFD et valider
    await page.fill('input.dfd-searchbox-input', query, { timeout: 8000 });
    await page.waitForTimeout(1500);
    await page.press('input.dfd-searchbox-input', "Enter");

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
  id: "glisshop",
  name: "Glisshop",
  baseUrl: "https://www.glisshop.com",
  country: "FR",
  currency: "EUR",
  accent: "bg-sky-100 text-sky-800 border-sky-200",
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
        site: "glisshop",
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
