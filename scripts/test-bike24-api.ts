import { acquireContext, releaseContext } from "../src/lib/scraper/browserPool";

async function main() {
  const { context, browser } = await acquireContext("https://www.bike24.com");
  try {
    const page = await context.newPage();
    // Load homepage first to get Akamai cookies
    console.log("Loading bike24.com homepage...");
    await page.goto("https://www.bike24.com", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(5000);
    const title = await page.title();
    console.log("Homepage title:", title);
    
    if (title.includes("Access Denied")) {
      console.log("❌ Akamai blocked the homepage — can't proceed");
      return;
    }
    
    // Now fetch the search API
    console.log("\nFetching search-bar-results API...");
    const apiUrl = "https://www.bike24.com/search-page-api/search-bar-results?searchTerm=castelli";
    const response = await page.evaluate(async (url) => {
      const res = await fetch(url, {
        headers: { "Accept": "application/json" },
      });
      const text = await res.text();
      return { status: res.status, body: text };
    }, apiUrl);
    
    console.log("API status:", response.status);
    console.log("API body length:", response.body.length);
    console.log("API body (first 2000 chars):");
    console.log(response.body.slice(0, 2000));
  } finally {
    try { await page?.close(); } catch {}
    releaseContext({ context, browser });
  }
}
main().catch(console.error);
