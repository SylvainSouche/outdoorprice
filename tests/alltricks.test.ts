import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseAlltricksHtml } from "@/lib/scraper/sites/alltricks";

const fixturePath = resolve(__dirname, "fixtures/alltricks/search.html");
const html = readFileSync(fixturePath, "utf8");

describe("alltricks.parseAlltricksHtml", () => {
  const products = parseAlltricksHtml(html);

  it("extracts all 5 valid product cards (skips noise + dedupes duplicate)", () => {
    expect(products).toHaveLength(5);
  });

  it("skips links that match /P- but not /F-XXX/P-XXX pattern", () => {
    const titles = products.map(p => p.title);
    expect(titles).not.toContain("Invalid product link");
  });

  it("dedupes by URL (Ultegra appears twice, only first is kept)", () => {
    const ultegra = products.filter(p => p.url.includes("ultegra"));
    expect(ultegra).toHaveLength(1);
  });

  it("extracts title from <a> text content", () => {
    expect(products[0].title).toBe("Shimano Ultegra FD-R8150");
  });

  it("extracts regular price from .price element", () => {
    expect(products[0].price).toBe(149.99);
    expect(products[0].originalPrice).toBeNull();
    expect(products[0].discount).toBeNull();
  });

  it("extracts both price + originalPrice from multiple .price elements", () => {
    expect(products[1].price).toBe(899.99);
    expect(products[1].originalPrice).toBe(1099.99);
    // (1 - 899.99/1099.99) * 100 ≈ 18.18 → rounded to 18
    expect(products[1].discount).toBe(18);
  });

  it("prefers cdn images over non-cdn", () => {
    expect(products[0].image).toBe("https://product-cdn.alltricks.fr/img/ultegra.jpg");
    // Product 4 (Sora) has no cdn image — falls back to first non-svg non-/images/
    expect(products[3].image).toBe("https://www.alltricks.fr/static/sora.jpg");
  });

  it("skips SVG icons and uses the cdn product image instead", () => {
    // Product 5 (Castelli Giro) has 2 SVG icons + 1 cdn image — should pick the cdn
    expect(products[4].image).toBe("https://product-cdn.alltricks.fr/img/giro.jpg");
  });

  it("absolutizes relative URLs", () => {
    expect(products[0].url).toBe("https://www.alltricks.fr/F-100-shimano-ultegra/P-1000-shimano-ultegra-fd-r8150.html");
  });

  it("handles data-src lazy-loaded images", () => {
    // Product 3 (Dura-Ace) has src="" and data-src=cdn URL
    expect(products[2].image).toBe("https://product-cdn.alltricks.fr/img/dura-ace.jpg");
  });

  it("tags every product with site='alltricks' and currency='EUR'", () => {
    for (const p of products) {
      expect(p.site).toBe("alltricks");
      expect(p.currency).toBe("EUR");
    }
  });
});
