// Scraper Bike24 (EN/FR, EUR — custom Next.js platform, Akamai Bot Manager)
// --------------------------------------------------------------------------
// Protocole (cf. PROTOCOLES.md) :
//   Search page: GET https://www.bike24.com/search-result?searchTerm=<terme>
//
// Anti-bot : Akamai Bot Manager — détecte Chromium headless via TLS fingerprint.
// Stratégie : utiliser le VRAI Chrome installé sur la machine (channel: "chrome")
// en mode headful (visible). Le TLS fingerprint de Chrome ≠ celui de Chromium.
//
// Si Chrome n'est pas installé, fallback sur Chromium headful.
// Si Akamai bloque quand même, le site est marqué comme bloqué (status: error).
// --------------------------------------------------------------------------
import * as cheerio from "cheerio";
import { SiteMeta, ProductResult, Scraper } from "../types";
import { parsePrice, absUrl, cleanTitle } from "../http";

export const site: SiteMeta = {
  id: "bike24",
  name: "Bike24",
  baseUrl: "https://www.bike24.com",
  country: "DE",
  currency: "EUR",
  accent: "bg-teal-100 text-teal-800 border-teal-200",
  groups: ["cycling"],
};

function parseBike24Html(html: string): ProductResult[] {
  const $ = cheerio.load(html);
  const products: ProductResult[] = [];
  const seen = new Set<string>();

  $('a[href*="/products/"], a[href*="/produits/"]').slice(0, 24).each((_, el) => {
    const $el = $(el);
    const href = absUrl($el.attr("href"), site.baseUrl);
    if (!href || seen.has(href)) return;

    const fullTitle = cleanTitle($el.attr("title"));
    if (!fullTitle) return;
    seen.add(href);

    const brand = $el.find("div.uppercase").first().text().trim() || undefined;

    let price: number | null = null;
    let originalPrice: number | null = null;
    let discount: number | null = null;

    const salePriceText = $el.find(".text-red-d500").first().text().trim();
    if (salePriceText) {
      price = parsePrice(salePriceText);
      const origText = $el.find('[class*="before:bg-grey"]').first().text().trim();
      originalPrice = parsePrice(origText) || null;
      const discText = $el.find(".bg-red-d500").first().text().trim();
      const discMatch = discText.match(/(\d+)/);
      discount = discMatch ? parseInt(discMatch[1], 10) : null;
    }

    if (price === null) {
      const regPriceText = $el.find(".font-semibold").first().text().trim();
      price = parsePrice(regPriceText);
    }

    const img = $el.find("img").first().attr("src") || null;
    const hasGreen = $el.find(".text-green-d500").length > 0;
    let availability: ProductResult["availability"] = "unknown";
    if (hasGreen) {
      availability = "in_stock";
    } else {
      const cardText = $el.text().toLowerCase();
      if (cardText.includes("indisponible") || cardText.includes("unavailable") || cardText.includes("épuisé")) {
        availability = "out_of_stock";
      }
    }

    products.push({
      site: "bike24",
      siteName: site.name,
      title: brand ? `${fullTitle} — ${brand}` : fullTitle,
      brand,
      url: href,
      price,
      originalPrice,
      currency: "EUR",
      image: absUrl(img, site.baseUrl),
      availability,
      discount,
    });
  });

  return products;
}

async function searchWithRealChrome(query: string): Promise<ProductResult[]> {
  // Use playwright directly (not playwright-extra — simpler, no missing peer dep issues)
  const { chromium } = await import("playwright");

  // Launch options — use bundled Chromium (Electron ships it)
  const launchOpts: any = {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
      "--headless=new",
      "--disable-gpu",
      "--window-size=1920,1080",
    ],
  };

  let browser;
  browser = await chromium.launch(launchOpts);

  try {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      locale: "fr-FR",
      timezone: "Europe/Paris",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    });

    const page = await context.newPage();

    // 1. Load homepage — Akamai challenge resolves in real Chrome
    await page.goto(site.baseUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(5000);

    const title = await page.title();
    if (title.includes("Access Denied") || title.includes("Denied")) {
      throw new Error("Akamai challenge non résolu — bike24 bloque les navigateurs automatisés.");
    }

    // 2. Navigate to search results
    const searchUrl = `${site.baseUrl}/search-result?searchTerm=${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    // 3. Wait for product cards
    await page.waitForSelector('a[href*="/products/"], a[href*="/produits/"]', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // 4. Get HTML and parse
    const html = await page.content();
    await context.close();

    return parseBike24Html(html);
  } finally {
    await browser.close();
  }
}

export const scraper: Scraper = {
  site,
  capabilities: {
    engine: "html",
    usesPlaywright: true,
    challenge: true,
    relevance: "strict",
  },
  async search(query, signal) {
    return await searchWithRealChrome(query);
  },
};
