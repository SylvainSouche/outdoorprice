import { chromium } from "playwright";
import * as fs from "fs";

const log = (m: string) => { fs.appendFileSync("/tmp/gli3.log", m + "\n"); console.log(m); };
fs.writeFileSync("/tmp/gli3.log", "");

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

  // Click on homepage search input to open Doofinder layer
  log("Opening DFD layer...");
  await page.click('input[name="searchText"]', { timeout: 5000 });
  await page.waitForTimeout(1500);

  // Type in the DFD search input
  log("Typing 'Dynafit' in DFD search input...");
  await page.fill('input.dfd-searchbox-input', "Dynafit");
  await page.waitForTimeout(2000);

  // Submit (Enter)
  await page.press('input.dfd-searchbox-input', "Enter");
  log("Enter pressed, waiting 6s for results...");
  await page.waitForTimeout(6000);

  // Capture the rendered DFD layer
  const dfdHtml = await page.evaluate(() => {
    const layer = document.querySelector(".dfd-layer");
    return layer ? layer.outerHTML : "no layer found";
  });
  log("DFD layer HTML length: " + dfdHtml.length);
  // Save to file for inspection
  fs.writeFileSync("/tmp/gli_dfd_layer.html", dfdHtml);
  log("Saved to /tmp/gli_dfd_layer.html");

  // Look for product items
  const productInfo = await page.evaluate(() => {
    const items = document.querySelectorAll("[data-product-id], .dfd-card, .dfd-result-item, .dfd-product, [class*='dfd-product']");
    return {
      count: items.length,
      firstThree: Array.from(items).slice(0, 3).map((el) => ({
        tag: el.tagName,
        class: el.className,
        attrs: Object.fromEntries(Array.from(el.attributes).map((a) => [a.name, a.value.slice(0, 200)])),
        text: (el.textContent || "").slice(0, 200),
      })),
    };
  });
  log("Products found: " + productInfo.count);
  for (const p of productInfo.firstThree) {
    log("  - " + JSON.stringify(p));
  }
} catch (e: any) {
  log("Error: " + e.message);
}
await browser.close();
log("Done");
