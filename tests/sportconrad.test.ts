import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseSportconradHtml } from "@/lib/scraper/sites/sportconrad";

const fixturePath = resolve(__dirname, "fixtures/sportconrad/search.html");
const html = readFileSync(fixturePath, "utf8");

describe("sportconrad.parseSportconradHtml", () => {
  const products = parseSportconradHtml(html);

  it("extracts all 5 valid product cards (skips empty + dedupes duplicate)", () => {
    expect(products).toHaveLength(5);
  });

  it("skips cards without a title", () => {
    const titles = products.map(p => p.title);
    expect(titles.every(t => t.length > 0)).toBe(true);
  });

  it("dedupes by URL (Speed Radical appears twice, only first is kept)", () => {
    const speedRadical = products.filter(p => p.url.includes("speed-radical"));
    expect(speedRadical).toHaveLength(1);
  });

  it("prefixes title with brand when present", () => {
    expect(products[0].title).toBe("Dynafit Speed Radical");
  });

  it("leaves title alone when no brand", () => {
    expect(products[3].title).toBe("Some Binding");
  });

  it("parses price (French format with comma)", () => {
    expect(products[0].price).toBe(450);
    expect(products[1].price).toBe(320);
  });

  it("parses originalPrice from .old-price / del", () => {
    expect(products[0].originalPrice).toBeNull();
    expect(products[1].originalPrice).toBe(400);
  });

  it("computes discount when originalPrice > price", () => {
    // (1 - 320/400) * 100 = 20
    expect(products[1].discount).toBe(20);
  });

  it("sets discount=null when no promo", () => {
    expect(products[0].discount).toBeNull();
  });

  it("uses data-src attribute when src is absent (lazy-loaded images)", () => {
    expect(products[2].image).toBe("https://www.sport-conrad.com/img/hawx.jpg");
  });

  it("absolutizes relative image URLs", () => {
    expect(products[0].image).toBe("https://www.sport-conrad.com/img/speed-radical.jpg");
  });

  it("absolutizes relative product URLs (with .html suffix and ::product-id)", () => {
    expect(products[0].url).toBe("https://www.sport-conrad.com/product/dynafit-speed-radical::12345.html");
  });

  it("tags every product with site='sportconrad' and currency='EUR'", () => {
    for (const p of products) {
      expect(p.site).toBe("sportconrad");
      expect(p.currency).toBe("EUR");
    }
  });
});
