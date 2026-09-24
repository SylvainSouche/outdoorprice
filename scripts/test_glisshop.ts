import { chromium } from "playwright";
import * as fs from "fs";

const log = (m: string) => { fs.appendFileSync("/tmp/gli.log", m + "\n"); console.log(m); };
fs.writeFileSync("/tmp/gli.log", "");

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const ctx = await browser.newContext({
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
  locale: "fr-FR",
  viewport: { width: 1920, height: 1080 },
});
const page = await ctx.newPage();

let dfRequests: string[] = [];
let dfResponses: string[] = [];
page.on("request", (req) => {
  const url = req.url();
  if (url.includes("doofinder") || url.includes("dfd") || url.includes("glisshop")) {
    if (req.method() === "POST" || url.includes("layer") || url.includes("search")) {
      dfRequests.push(`${req.method()} ${url}`);
      const pd = req.postData();
      if (pd) log(`REQ ${req.method()} ${url}\n  body: ${pd.slice(0, 500)}`);
    }
  }
});
page.on("response", async (res) => {
  const url = res.url();
  if (url.includes("doofinder") || (url.includes("glisshop") && (url.includes("search") || url.includes("recherche")))) {
    dfResponses.push(`${res.status()} ${url}`);
    try {
      const body = await res.text();
      log(`RES ${res.status()} ${url}\n  body: ${body.slice(0, 500)}`);
    } catch (e: any) {
      log(`RES ${res.status()} ${url} (err: ${e.message})`);
    }
  }
});

try {
  log("Navigating to homepage...");
  await page.goto("https://www.glisshop.com/", { waitUntil: "domcontentloaded", timeout: 30000 });
  log("Page loaded");
  await page.waitForTimeout(3000);

  // Type in the search box
  log("Typing in search box...");
  await page.fill('input[name="searchText"]', "Dynafit");
  await page.waitForTimeout(2000);

  // Press Enter
  await page.press('input[name="searchText"]', "Enter");
  log("Enter pressed, waiting 5s...");
  await page.waitForTimeout(5000);

  log("Current URL: " + page.url());

  // Check for product items
  const products = await page.evaluate(() => {
    const items = document.querySelectorAll("[data-product-id], .dfd-card, .product-item, .product-card, [class*='product']");
    return {
      count: items.length,
      first: items[0]?.outerHTML?.slice(0, 500) || null,
    };
  });
  log("Products found: " + products.count);
  if (products.first) log("First product: " + products.first);
} catch (e: any) {
  log("Error: " + e.message);
}
await browser.close();
log("Done. Captured " + dfRequests.length + " requests, " + dfResponses.length + " responses");
