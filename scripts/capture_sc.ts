import { chromium } from "playwright";
import * as fs from "fs";

const log = (msg: string) => {
  fs.appendFileSync("/tmp/sc_capture3.log", msg + "\n");
  console.log(msg);
};

fs.writeFileSync("/tmp/sc_capture3.log", "");
log("Starting...");

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const ctx = await browser.newContext({
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
  locale: "en-US",
  viewport: { width: 1920, height: 1080 },
});
const page = await ctx.newPage();

// Capture ALL XHR requests
page.on("request", (req) => {
  const t = req.resourceType();
  if (t === "xhr" || t === "fetch") {
    log(`[REQ ${req.method()}] ${req.url()}`);
    const postData = req.postData();
    if (postData) log(`  body: ${postData.slice(0, 500)}`);
  }
});

page.on("response", async (res) => {
  const t = res.request().resourceType();
  if (t === "xhr" || t === "fetch") {
    log(`[RES ${res.status()}] ${res.url()}`);
  }
});

try {
  log("Navigating...");
  const resp = await page.goto("https://www.sport-conrad.com/en/search?q=Dynafit", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  log(`Page status: ${resp?.status()}`);
  log(`Final URL: ${page.url()}`);
  log(`Title: ${await page.title()}`);

  log("Waiting 8s for XHR...");
  await page.waitForTimeout(8000);

  // Inspect product DOM
  const products = await page.evaluate(() => {
    const items = document.querySelectorAll("[data-product], [data-product-id], .product-item, .product-card");
    return Array.from(items).slice(0, 3).map((el) => ({
      tag: el.tagName,
      classes: el.className,
      attrs: Object.fromEntries(Array.from(el.attributes).map((a) => [a.name, a.value.slice(0, 100)])),
    }));
  });
  log("Products found: " + products.length);
  if (products.length) log("First product: " + JSON.stringify(products[0], null, 2));
} catch (e) {
  log("Error: " + e.message);
}
await browser.close();
log("Done");
