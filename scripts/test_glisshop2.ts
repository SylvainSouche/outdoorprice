import { chromium } from "playwright";
import * as fs from "fs";

const log = (m: string) => { fs.appendFileSync("/tmp/gli2.log", m + "\n"); console.log(m); };
fs.writeFileSync("/tmp/gli2.log", "");

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const ctx = await browser.newContext({
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
  locale: "fr-FR",
  viewport: { width: 1920, height: 1080 },
});
const page = await ctx.newPage();

try {
  log("Loading homepage...");
  await page.goto("https://www.glisshop.com/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  // Click on search input
  log("Clicking search input...");
  await page.click('input[name="searchText"]', { timeout: 5000 });
  await page.waitForTimeout(1500);

  // Check what's now visible
  const dfdVisible = await page.evaluate(() => {
    const els = document.querySelectorAll(".dfd-fullscreen, .dfd-layer, .dfd-root, [class*='dfd']");
    return Array.from(els).slice(0, 5).map((el) => ({
      tag: el.tagName,
      class: el.className,
      visible: (el as HTMLElement).offsetParent !== null,
    }));
  });
  log("DFD visible elements: " + JSON.stringify(dfdVisible, null, 2));

  // Find the dfd search input
  const dfdInput = await page.evaluate(() => {
    const inputs = document.querySelectorAll('input');
    return Array.from(inputs).map((i) => ({
      name: i.name, placeholder: i.placeholder, class: i.className,
      type: i.type, visible: i.offsetParent !== null,
    }));
  });
  log("Inputs:\n" + JSON.stringify(dfdInput, null, 2));

  // Type in the visible dfd search input
  log("Typing 'Dynafit'...");
  // Find a visible input in the dfd layer
  const dfdInputSelector = await page.evaluate(() => {
    const inputs = document.querySelectorAll('input');
    for (const i of inputs) {
      if (i.offsetParent !== null && (i.className.includes('dfd') || i.placeholder?.toLowerCase().includes('recherche'))) {
        // Add a unique id
        i.id = i.id || 'dfd-search-input';
        return '#' + i.id;
      }
    }
    return null;
  });
  log("DFD input selector: " + dfdInputSelector);

  if (dfdInputSelector) {
    await page.fill(dfdInputSelector, "Dynafit");
    await page.waitForTimeout(4000);

    // Get rendered HTML
    const dfdHtml = await page.evaluate(() => {
      const layer = document.querySelector('.dfd-fullscreen, .dfd-layer, .dfd-root');
      return layer ? layer.outerHTML.slice(0, 3000) : "no layer found";
    });
    log("DFD layer HTML (first 3000): " + dfdHtml);

    // Get product count
    const productCount = await page.evaluate(() => {
      const items = document.querySelectorAll("[data-product-id], .dfd-card, .dfd-result-item, .dfd-product");
      return { count: items.length, first: items[0]?.outerHTML?.slice(0, 500) };
    });
    log("Products: " + JSON.stringify(productCount, null, 2));
  }
} catch (e: any) {
  log("Error: " + e.message);
}
await browser.close();
log("Done");
