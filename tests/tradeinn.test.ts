import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseResults } from "@/lib/scraper/sites/tradeinn";

const fixturePath = resolve(__dirname, "fixtures/tradeinn/search.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

describe("tradeinn.parseResults", () => {
  const products = parseResults(fixture);

  it("extracts 4 products (skips empty title + dedupes duplicate URL)", () => {
    expect(products).toHaveLength(4);
  });

  it("skips products without a title", () => {
    const titles = products.map(p => p.title);
    expect(titles.every(t => t.length > 0)).toBe(true);
  });

  it("dedupes by URL (Speed Radical URL appears twice with different query strings)", () => {
    // The query string is stripped before dedup, so both URLs resolve to
    // /fr/speed-radical/dynafit/12345
    const speedRadical = products.filter(p => p.url.includes("speed-radical"));
    expect(speedRadical).toHaveLength(1);
  });

  it("prefixes title with brand", () => {
    expect(products[0].title).toBe("Dynafit Speed Radical");
    expect(products[1].title).toBe("Dynafit Melee");
    expect(products[2].title).toBe("Atomic Hawx Ultra 130");
  });

  it("extracts France price (id=70) from price_all_X_to_Y buckets", () => {
    // Two buckets both contain "70:…"; the first one wins (70:449.99)
    expect(products[0].price).toBe(449.99);
  });

  it("extracts price from images[0].uri when no image field", () => {
    // Product 2 (Melee) uses images[0].uri instead of image
    expect(products[1].price).toBe(320.00);
    expect(products[1].image).toBe("https://www.tradeinn.com/img/melee.jpg");
  });

  it("returns null price when France bucket is missing", () => {
    // Product 4 (No price for France) has prices only for countries 61 and 12
    expect(products[3].price).toBeNull();
  });

  it("strips query string from URL (utm params removed)", () => {
    // Product 1 has utm_source=internal — should be stripped
    expect(products[0].url).toBe("https://www.tradeinn.com/fr/speed-radical/dynafit/12345");
    // Product 3 (Hawx) has tracking=1 — should be stripped
    expect(products[2].url).toBe("https://www.tradeinn.com/fr/hawx-ultra-130/atomic/12347");
  });

  it("marks IN_STOCK as in_stock with 'En stock' label", () => {
    expect(products[0].availability).toBe("in_stock");
    expect(products[0].availabilityLabel).toBe("En stock");
  });

  it("marks OUT_OF_STOCK as out_of_stock with 'Rupture' label", () => {
    expect(products[2].availability).toBe("out_of_stock");
    expect(products[2].availabilityLabel).toBe("Rupture");
  });

  it("absolutizes protocol-relative image URLs (//cdn → https://cdn)", () => {
    // Product 3 (Hawx) uses //cdn.tradeinn.com/img/hawx.jpg
    expect(products[2].image).toBe("https://cdn.tradeinn.com/img/hawx.jpg");
  });

  it("always sets discount=null (Tradeinn never returns originalPrice)", () => {
    for (const p of products) {
      expect(p.discount).toBeNull();
      expect(p.originalPrice).toBeNull();
    }
  });

  it("tags every product with site='tradeinn' and currency='EUR'", () => {
    for (const p of products) {
      expect(p.site).toBe("tradeinn");
      expect(p.currency).toBe("EUR");
    }
  });
});
