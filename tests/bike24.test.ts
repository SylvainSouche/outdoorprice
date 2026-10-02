import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseBike24Html } from "@/lib/scraper/sites/bike24";

const fixturePath = resolve(__dirname, "fixtures/bike24/search.html");
const html = readFileSync(fixturePath, "utf8");

describe("bike24.parseBike24Html", () => {
  const products = parseBike24Html(html);

  it("extracts all 4 valid product links (skips the no-title noise + dedupes the duplicate)", () => {
    expect(products).toHaveLength(4);
  });

  it("skips <a> elements without a title attribute", () => {
    const titles = products.map(p => p.title);
    expect(titles.every(t => t.length > 0)).toBe(true);
  });

  it("dedupes by URL (product 1's URL appears twice, only first is kept)", () => {
    const ultegra = products.filter(p => p.url.includes("ultegra"));
    expect(ultegra).toHaveLength(1);
  });

  it("prefixes title with brand when brand div is present", () => {
    expect(products[0].title).toBe("Shimano Ultegra FD-R8150 Di2 Front Derailleur — Shimano");
  });

  it("parses regular price from .font-semibold", () => {
    expect(products[0].price).toBe(149.99);
    expect(products[0].originalPrice).toBeNull();
    expect(products[0].discount).toBeNull();
  });

  it("parses sale price from .text-red-d500 + original from .before:bg-grey + discount from .bg-red-d500", () => {
    expect(products[1].price).toBe(899.99);
    expect(products[1].originalPrice).toBe(1099.99);
    expect(products[1].discount).toBe(18);
  });

  it("marks products with .text-green-d500 as in_stock", () => {
    expect(products[0].availability).toBe("in_stock");
    expect(products[1].availability).toBe("in_stock");
    expect(products[3].availability).toBe("in_stock");  // French "Disponible"
  });

  it("marks products with 'unavailable' text but no green as out_of_stock", () => {
    expect(products[2].availability).toBe("out_of_stock");
  });

  it("absolutizes relative image URLs (//cdn → https://cdn)", () => {
    expect(products[1].image).toBe("https://cdn.bike24.com/img/105-groupset.jpg");
  });

  it("absolutizes relative product URLs", () => {
    expect(products[0].url).toBe("https://www.bike24.com/products/shimano-ultegra-fd-r8150-di2");
    expect(products[3].url).toBe("https://www.bike24.com/produits/shimano-sora-fd-r3030");
  });

  it("tags every product with site='bike24' and currency='EUR'", () => {
    for (const p of products) {
      expect(p.site).toBe("bike24");
      expect(p.currency).toBe("EUR");
    }
  });
});
