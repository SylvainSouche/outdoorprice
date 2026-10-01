import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseHtml } from "@/lib/scraper/sites/all4cycling";

const fixturePath = resolve(__dirname, "fixtures/all4cycling/search.html");
const html = readFileSync(fixturePath, "utf8");

describe("all4cycling.parseHtml", () => {
  const products = parseHtml(html);

  it("extracts all 3 cards from .card__info", () => {
    expect(products).toHaveLength(3);
  });

  it("skips empty .card__info containers (no title link)", () => {
    const titles = products.map(p => p.title);
    expect(titles.every(t => t.length > 0)).toBe(true);
  });

  it("appends vendor to title as 'Title — Vendor'", () => {
    expect(products[0].title).toBe("Castelli Giro 2024 Jersey — Castelli");
  });

  it("parses price from .price__current .js-value (French format)", () => {
    expect(products[0].price).toBe(100);
    expect(products[1].price).toBe(100);  // promo price
  });

  it("reads originalPrice from .price__was .js-value", () => {
    expect(products[0].originalPrice).toBeNull();  // no .price__was
    expect(products[1].originalPrice).toBe(150);    // 150,00 €
  });

  it("reads discount from .price__discount badge ('-33%')", () => {
    expect(products[1].discount).toBe(33);
  });

  it("marks sold-out products as out_of_stock", () => {
    expect(products[2].availability).toBe("out_of_stock");
  });

  it("marks available products as in_stock", () => {
    expect(products[0].availability).toBe("in_stock");
    expect(products[1].availability).toBe("in_stock");  // on-sale = in_stock
  });

  it("strips Shopify tracking params from product URLs (?_pos, _psq, _psid, _ss)", () => {
    expect(products[0].url).toBe("https://www.all4cycling.com/fr/products/castelli-giro-2024");
  });

  it("normalizes protocol-relative image URLs (//cdn → https://cdn)", () => {
    expect(products[0].image).toBe("https://cdn.shopify.com/giro.jpg");
  });

  it("preserves already-absolute image URLs", () => {
    expect(products[1].image).toBe("https://cdn.shopify.com/giro23.jpg");
  });

  it("tags every product with site='all4cycling' and currency='EUR'", () => {
    for (const p of products) {
      expect(p.site).toBe("all4cycling");
      expect(p.currency).toBe("EUR");
    }
  });
});
