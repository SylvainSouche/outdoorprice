import { describe, it, expect } from "vitest";
import { parsePrice, absUrl, cleanTitle } from "@/lib/scraper/http";

describe("parsePrice", () => {
  it("parse les prix FR avec virgule décimale et espace milliers", () => {
    expect(parsePrice("1 234,56 €")).toBeCloseTo(1234.56, 2);
    expect(parsePrice("999,00 €")).toBeCloseTo(999.0, 2);
    expect(parsePrice("42,99")).toBeCloseTo(42.99, 2);
  });

  it("parse les prix DE avec point milliers et virgule décimale", () => {
    expect(parsePrice("1.234,56 EUR")).toBeCloseTo(1234.56, 2);
    expect(parsePrice("12,99 €")).toBeCloseTo(12.99, 2);
  });

  it("parse les prix EN avec point décimal", () => {
    expect(parsePrice("1,234.56")).toBeCloseTo(1234.56, 2);
    expect(parsePrice("42.99")).toBeCloseTo(42.99, 2);
  });

  it("parse les prix suisses avec apostrophe milliers", () => {
    expect(parsePrice("CHF 1'234.50")).toBeCloseTo(1234.5, 2);
    expect(parsePrice("CHF 999.-")).toBeCloseTo(999, 2);
  });

  it("retourne null pour les entrées invalides", () => {
    expect(parsePrice("")).toBeNull();
    expect(parsePrice(null)).toBeNull();
    expect(parsePrice(undefined)).toBeNull();
    expect(parsePrice("—")).toBeNull();
    expect(parsePrice("N/A")).toBeNull();
  });

  it("gère les prix avec symbole € avant", () => {
    expect(parsePrice("€ 1 234,56")).toBeCloseTo(1234.56, 2);
  });
});

describe("absUrl", () => {
  it("résout les URLs relatives", () => {
    expect(absUrl("/produit/123", "https://www.ekosport.fr")).toBe(
      "https://www.ekosport.fr/produit/123"
    );
    expect(absUrl("produit/123", "https://www.ekosport.fr/")).toBe(
      "https://www.ekosport.fr/produit/123"
    );
  });

  it("garde les URLs absolues inchangées", () => {
    expect(absUrl("https://www.example.com/p/1", "https://other.com")).toBe(
      "https://www.example.com/p/1"
    );
  });

  it("retourne null pour les URLs invalides", () => {
    expect(absUrl("", "https://example.com")).toBeNull();
    expect(absUrl(null, "https://example.com")).toBeNull();
    expect(absUrl("javascript:void(0)", "https://example.com")).toBeNull();
    expect(absUrl("mailto:a@b.com", "https://example.com")).toBeNull();
    expect(absUrl("#", "https://example.com")).toBeNull();
  });
});

describe("cleanTitle", () => {
  it("nettoie les espaces et sauts de ligne", () => {
    expect(cleanTitle("  Ski\nDynafit\n  Speed  ")).toBe("Ski Dynafit Speed");
  });

  it("retourne une chaîne vide pour null/undefined", () => {
    expect(cleanTitle(null)).toBe("");
    expect(cleanTitle(undefined)).toBe("");
  });
});
