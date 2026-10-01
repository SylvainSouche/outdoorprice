import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseHtml } from "@/lib/scraper/sites/montaz";

const fixturePath = resolve(__dirname, "fixtures/montaz/search.html");
const html = readFileSync(fixturePath, "utf8");

describe("montaz.parseHtml", () => {
  const products = parseHtml(html);

  it("extracts all 3 product cards", () => {
    expect(products).toHaveLength(3);
  });

  it("ignores non-product-card elements (no data-prix-final, no data-product)", () => {
    const titles = products.map(p => p.title);
    expect(titles).not.toContain("ignored");
  });

  it("prefixes title with marque", () => {
    expect(products[0].title).toBe("Dynafit Speed Radical");
    expect(products[1].title).toBe("Dynafit Melee");
  });

  it("parses price with French decimal comma + € suffix", () => {
    expect(products[0].price).toBe(450);
    expect(products[1].price).toBe(320);
  });

  it("sets originalPrice=null when prix-unitaire === prix-final (no promo)", () => {
    expect(products[0].originalPrice).toBeNull();
  });

  it("sets originalPrice when prix-unitaire > prix-final (promo)", () => {
    expect(products[1].originalPrice).toBe(400);
  });

  it("computes discount = round((1 - price/original) * 100)", () => {
    expect(products[1].discount).toBe(20);  // (1 - 320/400) * 100 = 20
  });

  it("sets discount=null when no promo", () => {
    expect(products[0].discount).toBeNull();
  });

  it("absolutizes relative URLs (data-link → https://www.montaz.com/...)", () => {
    expect(products[0].url).toBe("https://www.montaz.com/produit/dynafit-speed-radical.html");
  });

  it("absolutizes image URLs (data-img → https://...)", () => {
    expect(products[0].image).toBe("https://cdn.montaz.com/img/speed-radical.jpg");
    // Product 2 has a relative img — should be prefixed with baseUrl
    expect(products[1].image).toBe("https://www.montaz.com/img/melee.jpg");
  });

  it("finds products with only data-product (no data-prix-final)", () => {
    const pkgRt = products.find(p => p.title === "Dynafit PKG RT");
    expect(pkgRt).toBeDefined();
    expect(pkgRt!.price).toBeNull();  // prix-final missing → null
  });

  it("tags every product with site='montaz' and currency='EUR'", () => {
    for (const p of products) {
      expect(p.site).toBe("montaz");
      expect(p.currency).toBe("EUR");
    }
  });
});
