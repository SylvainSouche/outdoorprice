import { describe, it, expect } from "vitest";
import { exportCategorizedCsv, exportMatchedCsv } from "@/lib/csv";
import type { MatchedProduct } from "@/lib/scraper/types";

// Helpers to build a minimal matched product with overrides
function mockProduct(overrides: Partial<MatchedProduct> = {}): MatchedProduct {
  return {
    id: "abc123",
    title: "Test Product",
    brand: "TestBrand",
    offers: [{ siteName: "TestSite", price: 100, currency: "EUR", availability: "in_stock", url: "https://example.com" } as any],
    minPrice: 100,
    maxPrice: 100,
    minCurrency: "EUR",
    siteCount: 1,
    matchScore: 0.9,
    matchReason: "brand+model",
    metadata: { color: ["Black"], sizes: ["42"], gender: "Homme" } as any,
    ...overrides,
  };
}

describe("exportCategorizedCsv — defensive against bad metadata.shapes", () => {
  it("génère un CSV sans planter quand metadata.attributes est undefined", () => {
    const p = mockProduct({ metadata: { attributes: undefined } as any });
    const csv = exportCategorizedCsv([p]);
    expect(csv).toContain("Test Product");
    expect(csv).toContain("TestBrand");
    // Pas d'erreur .map is not a function
    expect(csv.split("\n").length).toBe(2); // 1 header + 1 product
  });

  it("gère attributes = null", () => {
    const p = mockProduct({ metadata: { attributes: null } as any });
    expect(() => exportCategorizedCsv([p])).not.toThrow();
  });

  it("gère attributes = string (cas qui faisait planter avant le fix)", () => {
    const p = mockProduct({ metadata: { attributes: "some-string" as any } as any });
    expect(() => exportCategorizedCsv([p])).not.toThrow();
  });

  it("gère attributes = objet (au lieu de tableau)", () => {
    const p = mockProduct({
      metadata: { attributes: { weight: "580g", color: "Black" } as any } as any,
    });
    expect(() => exportCategorizedCsv([p])).not.toThrow();
  });

  it("gère metadata = null", () => {
    const p = mockProduct({ metadata: null as any });
    expect(() => exportCategorizedCsv([p])).not.toThrow();
  });

  it("gère color / sizes en string (au lieu de tableau)", () => {
    const p = mockProduct({
      metadata: { color: "Red" as any, sizes: "42" as any } as any,
    });
    const csv = exportCategorizedCsv([p]);
    expect(csv).toContain("Red");
    expect(csv).toContain("42");
  });

  it("gère les entrées d'attributes manquantes ou brisées", () => {
    const p = mockProduct({
      metadata: {
        attributes: [
          { key: "weight", values: [{ value: "580g" }] },
          null,  // entrée cassée
          { key: "color" },  // values manquant
          { values: [{ value: "X" }] },  // key manquant
        ] as any,
      } as any,
    });
    expect(() => exportCategorizedCsv([p])).not.toThrow();
    const csv = exportCategorizedCsv([p]);
    expect(csv).toContain("weight=580g");
  });

  it("génère l'en-tête avec toutes les colonnes attendues", () => {
    const csv = exportCategorizedCsv([]);
    const headers = csv.split(",")[0] ? csv.split("\n")[0].split(",") : [];
    expect(headers).toContain("produit_id");
    expect(headers).toContain("titre");
    expect(headers).toContain("marque");
    expect(headers).toContain("sport");
    expect(headers).toContain("categorie");
    expect(headers).toContain("sous_categorie");
    expect(headers).toContain("gamme");
    expect(headers).toContain("ean");
    expect(headers).toContain("score_match");
    expect(headers).toContain("raison_match");
    expect(headers).toContain("attributs");
  });
});

describe("exportMatchedCsv (rétrocompatibilité)", () => {
  it("génère une ligne par offre", () => {
    const p = mockProduct({
      offers: [
        { siteName: "Site1", price: 100, currency: "EUR" } as any,
        { siteName: "Site2", price: 90, currency: "EUR" } as any,
      ],
    });
    const csv = exportMatchedCsv([p]);
    const lines = csv.split("\n");
    expect(lines.length).toBe(3); // 1 header + 2 offers
    expect(lines[1]).toContain("Site1");
    expect(lines[2]).toContain("Site2");
  });
});
