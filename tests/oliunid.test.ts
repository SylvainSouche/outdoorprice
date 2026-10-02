import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractProducts } from "@/lib/scraper/sites/oliunid";

const fixturePath = resolve(__dirname, "fixtures/oliunid/search.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

describe("oliunid.extractProducts", () => {
  const hits = fixture.results?.[0]?.hits ?? [];
  const products = extractProducts(hits);

  it("extracts 4 products (skips the one missing URL + dedupes the duplicate)", () => {
    expect(products).toHaveLength(4);
  });

  it("skips hits without a url field", () => {
    const titles = products.map(p => p.title);
    expect(titles).not.toContain("Missing URL — should be skipped");
  });

  it("dedupes by URL (Speed Radical appears twice, only first is kept)", () => {
    const speedRadical = products.filter(p => p.url.includes("speed-radical"));
    expect(speedRadical).toHaveLength(1);
  });

  it("prefixes title with manufacturer when not already in name", () => {
    // "Speed Radical" + "Dynafit" → "Dynafit Speed Radical"
    expect(products[0].title).toBe("Dynafit Speed Radical");
  });

  it("does NOT prefix title when name already starts with manufacturer", () => {
    // Simulate by adding a hit where name starts with manufacturer
    const customHits = [
      { name: "Dynafit Speed Radical 2", url: "/p/test", manufacturer: "Dynafit",
        price: { EUR: { default: 100.00 } } },
    ];
    const result = extractProducts(customHits);
    expect(result[0].title).toBe("Dynafit Speed Radical 2");
  });

  it("parses price from price.EUR.default", () => {
    expect(products[0].price).toBe(450.00);
    expect(products[1].price).toBe(320.00);
  });

  it("parses originalPrice from price.EUR.default_original", () => {
    expect(products[0].originalPrice).toBe(500.00);
  });

  it("computes discount = round((1 - price/original) * 100)", () => {
    // 1 - 450/500 = 0.10 → 10%
    expect(products[0].discount).toBe(10);
  });

  it("sets discount=null when there is no originalPrice", () => {
    expect(products[1].discount).toBeNull();
    expect(products[1].originalPrice).toBeNull();
  });

  it("absolutizes relative URLs (//cdn → https://cdn)", () => {
    expect(products[0].image).toBe("https://cdn.oliunid.com/img/speed-radical.jpg");
    expect(products[1].image).toBe("https://www.oliunid.com/img/melee.jpg");
    expect(products[2].image).toBe("https://cdn.oliunid.com/img/hawx.jpg");
  });

  it("tags every product with site='oliunid' and currency='EUR'", () => {
    for (const p of products) {
      expect(p.site).toBe("oliunid");
      expect(p.currency).toBe("EUR");
    }
  });
});
