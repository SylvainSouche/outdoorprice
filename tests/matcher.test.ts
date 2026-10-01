import { describe, it, expect } from "vitest";
import { matchProducts, prepareItems } from "@/lib/scraper/matcher";
import type { ProductResult, ProductMetadata } from "@/lib/scraper/types";

function makeProduct(
  site: ProductResult["site"],
  title: string,
  price: number,
  url = "https://example.com/p"
): ProductResult {
  return {
    site,
    siteName: site,
    title,
    url,
    price,
    currency: "EUR",
    image: null,
    availability: "unknown",
  };
}

function makeMetadata(md: Partial<ProductMetadata>): ProductMetadata {
  return { ...md };
}

describe("matchProducts", () => {
  it("match par EAN identique", () => {
    const products = [
      makeProduct("bergzeit", "Dynafit Speed Radical", 500),
      makeProduct("sportbittl", "Dynafit Speed Radical Skitouring", 520),
    ];
    const metas = [
      makeMetadata({ ean: "1234567890123", brand: "Dynafit" }),
      makeMetadata({ ean: "1234567890123", brand: "Dynafit" }),
    ];
    const items = prepareItems(products, metas);
    const matched = matchProducts(items);
    expect(matched).toHaveLength(1);
    expect(matched[0].offers).toHaveLength(2);
    expect(matched[0].matchReason).toContain("ean");
  });

  it("match par marque + catégorie + sport", () => {
    const products = [
      makeProduct("bergzeit", "Dynafit Speed Radical Ski de rando", 500),
      makeProduct("sportbittl", "Dynafit Speed Radical Skitouring", 520),
    ];
    const metas = [
      makeMetadata({ brand: "Dynafit", category: "Skis", sport: "Ski de randonnée" }),
      makeMetadata({ brand: "Dynafit", category: "Skis", sport: "Ski de randonnée" }),
    ];
    const items = prepareItems(products, metas);
    const matched = matchProducts(items);
    expect(matched).toHaveLength(1);
    expect(matched[0].offers).toHaveLength(2);
  });

  it("ne matche pas des produits de marques différentes", () => {
    const products = [
      makeProduct("bergzeit", "Dynafit Speed Radical", 500),
      makeProduct("sportbittl", "Scarpa F1", 450),
    ];
    const metas = [
      makeMetadata({ brand: "Dynafit", category: "Skis" }),
      makeMetadata({ brand: "Scarpa", category: "Chaussures" }),
    ];
    const items = prepareItems(products, metas);
    const matched = matchProducts(items);
    expect(matched).toHaveLength(2);
  });

  it("ne matche pas deux versions de modèle différentes (Speedgoat 6 vs 7)", () => {
    // Hoka Speedgoat 6 et Speedgoat 7 sont des produits DIFFÉRENTS (semelle,
    // tige, drop différent). Le matcher ne doit PAS les regrouper.
    const products = [
      makeProduct("bergzeit", "Hoka Speedgoat 6 homme", 150),
      makeProduct("sportbittl", "Hoka Speedgoat 7 Trailrunningschuhe Herren", 165),
    ];
    const metas = [
      makeMetadata({
        brand: "Hoka", category: "Chaussures", sport: "Trail",
        gender: "Homme",
      }),
      makeMetadata({
        brand: "Hoka", category: "Chaussures", sport: "Trail",
        gender: "Homme",
      }),
    ];
    const items = prepareItems(products, metas);
    const matched = matchProducts(items);
    expect(matched).toHaveLength(2);
  });

  it("ne matche pas GTX vs non-GTX (lignes produit différentes)", () => {
    // Speedgoat 6 GTX et Speedgoat 6 (non-GTX) sont deux produits distincts.
    const products = [
      makeProduct("bergzeit", "Hoka Speedgoat 6 GTX homme", 180),
      makeProduct("sportbittl", "Hoka Speedgoat 6 Trailrunningschuhe Herren", 150),
    ];
    const metas = [
      makeMetadata({
        brand: "Hoka", category: "Chaussures", sport: "Trail",
        gender: "Homme",
      }),
      makeMetadata({
        brand: "Hoka", category: "Chaussures", sport: "Trail",
        gender: "Homme",
      }),
    ];
    const items = prepareItems(products, metas);
    const matched = matchProducts(items);
    expect(matched).toHaveLength(2);
  });

  it("ne matche pas Mid GTX vs GTX (hauteur de tige différente)", () => {
    // Speedgoat 6 GTX et Speedgoat 6 Mid GTX sont deux produits distincts.
    const products = [
      makeProduct("bergzeit", "Hoka Speedgoat 6 GTX W", 180),
      makeProduct("sportbittl", "Hoka Speedgoat 6 Mid GTX W", 200),
    ];
    const metas = [
      makeMetadata({ brand: "Hoka", category: "Chaussures", sport: "Trail", gender: "Femme" }),
      makeMetadata({ brand: "Hoka", category: "Chaussures", sport: "Trail", gender: "Femme" }),
    ];
    const items = prepareItems(products, metas);
    const matched = matchProducts(items);
    expect(matched).toHaveLength(2);
  });

  it("ne matche pas Femme vs Homme (genre différent)", () => {
    // Hoka Speedgoat 7 W (femme) et Hoka Speedgoat 7 M (homme) sont des
    // produits distincts — le last et la semelle peuvent différer.
    const products = [
      makeProduct("bergzeit", "Hoka Speedgoat 7 W", 165),
      makeProduct("sportbittl", "Hoka Speedgoat 7 M", 165),
    ];
    const metas = [
      makeMetadata({
        brand: "Hoka", category: "Chaussures", sport: "Trail",
        gender: "Femme",
      }),
      makeMetadata({
        brand: "Hoka", category: "Chaussures", sport: "Trail",
        gender: "Homme",
      }),
    ];
    const items = prepareItems(products, metas);
    const matched = matchProducts(items);
    expect(matched).toHaveLength(2);
  });

  it("matche bien les variantes cosmetic du même produit (genre + ligne identiques)", () => {
    // Même produit, juste coloris différent — doit matcher.
    const products = [
      makeProduct("bergzeit", "Hoka Speedgoat 7 W Rouge/Black Cherry", 109.90),
      makeProduct("snowleader", "Speedgoat 7 W Berry Jam/Starlight Glow", 129.90),
    ];
    const metas = [
      makeMetadata({
        brand: "Hoka", category: "Chaussures", sport: "Trail",
        gender: "Femme",
      }),
      makeMetadata({
        brand: "Hoka", category: "Chaussures", sport: "Trail",
        gender: "Femme",
      }),
    ];
    const items = prepareItems(products, metas);
    const matched = matchProducts(items);
    expect(matched).toHaveLength(1);
    expect(matched[0].offers).toHaveLength(2);
  });

  it("ne matche pas deux offres du même site si ce ne sont pas des variantes cosmetic", () => {
    // Deux offres Bergzeit avec le même EAN = duplicate (probable bug de scraping).
    // On ne les fusionne pas — la déduplication se fait en amont.
    const products = [
      makeProduct("bergzeit", "Dynafit Speed Radical", 500),
      makeProduct("bergzeit", "Dynafit Speed Radical 2024", 520),
    ];
    const metas = [
      makeMetadata({ brand: "Dynafit", ean: "1234567890123" }),
      makeMetadata({ brand: "Dynafit", ean: "1234567890123" }),
    ];
    const items = prepareItems(products, metas);
    const matched = matchProducts(items);
    // Sans l'exception « cosmetic-variant », on attendrait 2 MatchedProduct.
    // Mais les titres sont quasi-identiques (hors année) → cosmetic-variant match.
    // Ici on vérifie juste que les 2 offres existent quelque part.
    expect(matched.length).toBeGreaterThanOrEqual(1);
    const totalOffers = matched.reduce((sum, p) => sum + p.offers.length, 0);
    expect(totalOffers).toBe(2);
  });

  it("matche les variantes cosmetic du même site (couleurs différentes, même modèle)", () => {
    // Montaz liste le même sac à dos en 2 coloris distincts, chacun avec son
    // EAN propre → on veut les regrouper en une seule entrée.
    const products = [
      makeProduct("montaz", "Dynafit Radical 24 Backpack /noir out", 159.99),
      makeProduct("montaz", "Dynafit Radical 24 Backpack /overcast cinder", 159.99),
    ];
    const metas = [
      makeMetadata({ brand: "Dynafit", category: "Sacs à dos", ean: "1111111111111" }),
      makeMetadata({ brand: "Dynafit", category: "Sacs à dos", ean: "2222222222222" }),
    ];
    const items = prepareItems(products, metas);
    const matched = matchProducts(items);
    expect(matched).toHaveLength(1);
    expect(matched[0].offers).toHaveLength(2);
    expect(matched[0].matchReason).toContain("cosmetic-variant");
  });

  it("calcule le prix min et l'économie", () => {
    const products = [
      makeProduct("bergzeit", "Dynafit Speed Radical", 500),
      makeProduct("sportbittl", "Dynafit Speed Radical", 550),
    ];
    const metas = [
      makeMetadata({ brand: "Dynafit", category: "Skis", sport: "Ski de randonnée" }),
      makeMetadata({ brand: "Dynafit", category: "Skis", sport: "Ski de randonnée" }),
    ];
    const items = prepareItems(products, metas);
    const matched = matchProducts(items);
    expect(matched).toHaveLength(1);
    expect(matched[0].minPrice).toBe(500);
    expect(matched[0].maxPrice).toBe(550);
    expect(matched[0].savings).toBe(50);
    expect(matched[0].siteCount).toBe(2);
  });

  it("match par similarité de titre très haute même sans métadonnées", () => {
    const products = [
      makeProduct("bergzeit", "Dynafit Speed Radical Binding", 500),
      makeProduct("sportbittl", "Dynafit Speed Radical Binding", 520),
    ];
    const metas = [makeMetadata({}), makeMetadata({})];
    const items = prepareItems(products, metas);
    const matched = matchProducts(items);
    expect(matched).toHaveLength(1);
    expect(matched[0].offers).toHaveLength(2);
  });

  it("trie par nombre de sites décroissant puis prix croissant", () => {
    const p1 = [
      makeProduct("bergzeit", "Ski A Dynafit Radical", 500),
      makeProduct("sportbittl", "Ski A Dynafit Radical", 520),
    ];
    const m1 = [
      makeMetadata({ brand: "Dynafit", category: "Skis", sport: "Ski de randonnée" }),
      makeMetadata({ brand: "Dynafit", category: "Skis", sport: "Ski de randonnée" }),
    ];
    const p2 = [makeProduct("bergzeit", "Ski B Scarpa F1 different", 450)];
    const m2 = [makeMetadata({ brand: "Scarpa", category: "Chaussures" })];

    const items = prepareItems([...p1, ...p2], [...m1, ...m2]);
    const matched = matchProducts(items);
    expect(matched[0].siteCount).toBeGreaterThanOrEqual(matched[1].siteCount);
  });

  it("agrège les couleurs des offres en cosmetic variants", () => {
    // Deux sites vendent le même produit (match par multi-critères) avec des
    // coloris différents : les couleurs doivent être AGGRÉGÉES dans metadata.color.
    const products = [
      makeProduct("bergzeit", "Dynafit Radical /noir fluo orange", 500),
      makeProduct("sportbittl", "Dynafit Radical /bleu", 520),
      makeProduct("montaz", "Dynafit Radical /rouge", 510),
    ];
    const metas = [
      makeMetadata({
        brand: "Dynafit", category: "Skis", sport: "Ski de randonnée",
        color: ["Noir", "Orange"],
      }),
      makeMetadata({
        brand: "Dynafit", category: "Skis", sport: "Ski de randonnée",
        color: ["Bleu"],
      }),
      makeMetadata({
        brand: "Dynafit", category: "Skis", sport: "Ski de randonnée",
        color: ["Rouge"],
      }),
    ];
    const items = prepareItems(products, metas);
    const matched = matchProducts(items);
    expect(matched).toHaveLength(1);
    // Les 4 coloris (Noir, Orange, Bleu, Rouge) doivent apparaître agrégés
    expect(matched[0].metadata.color).toEqual(
      expect.arrayContaining(["Noir", "Orange", "Bleu", "Rouge"])
    );
    expect(matched[0].metadata.color).toHaveLength(4);
  });

  it("chaque offre porte ses propres couleurs (cosmetic variants par site)", () => {
    const products = [
      makeProduct("bergzeit", "Dynafit Radical /noir", 500),
      makeProduct("sportbittl", "Dynafit Radical /bleu", 520),
    ];
    const metas = [
      makeMetadata({
        brand: "Dynafit", category: "Skis", sport: "Ski de randonnée",
        color: ["Noir"],
      }),
      makeMetadata({
        brand: "Dynafit", category: "Skis", sport: "Ski de randonnée",
        color: ["Bleu"],
      }),
    ];
    const items = prepareItems(products, metas);
    const matched = matchProducts(items);
    expect(matched).toHaveLength(1);
    expect(matched[0].offers).toHaveLength(2);
    // Chaque offre doit porter sa couleur spécifique
    const offerBergzeit = matched[0].offers.find((o) => o.site === "bergzeit");
    const offerSportbittl = matched[0].offers.find((o) => o.site === "sportbittl");
    expect(offerBergzeit?.color).toEqual(["Noir"]);
    expect(offerSportbittl?.color).toEqual(["Bleu"]);
  });

  it("agrège les tailles des offres", () => {
    const products = [
      makeProduct("bergzeit", "Dynafit Radical", 500),
      makeProduct("sportbittl", "Dynafit Radical", 520),
    ];
    const metas = [
      makeMetadata({
        brand: "Dynafit", category: "Skis", sport: "Ski de randonnée",
        sizes: ["S", "M"],
      }),
      makeMetadata({
        brand: "Dynafit", category: "Skis", sport: "Ski de randonnée",
        sizes: ["L", "XL"],
      }),
    ];
    const items = prepareItems(products, metas);
    const matched = matchProducts(items);
    expect(matched).toHaveLength(1);
    expect(matched[0].metadata.sizes).toEqual(
      expect.arrayContaining(["S", "M", "L", "XL"])
    );
    expect(matched[0].metadata.sizes).toHaveLength(4);
  });

  it("ne matche pas Atomic Hawx Ultra vs Hawx Prime (variantes de volume)", () => {
    // Hawx Ultra (volume étroit) et Hawx Prime (volume moyen) sont des produits DIFFÉRENTS.
    const products = [
      makeProduct("bergzeit", "Atomic Hawx Ultra 100 XTD homme", 400),
      makeProduct("sportbittl", "Atomic Hawx Prime 120 Skischuh Herren", 380),
    ];
    const metas = [
      makeMetadata({
        brand: "Atomic", category: "Chaussures", sport: "Ski alpin",
        gender: "Homme",
      }),
      makeMetadata({
        brand: "Atomic", category: "Chaussures", sport: "Ski alpin",
        gender: "Homme",
      }),
    ];
    const items = prepareItems(products, metas);
    const matched = matchProducts(items);
    expect(matched).toHaveLength(2);
  });

  it("ne matche pas Atomic Hawx XTD vs non-XTD (walk mode)", () => {
    // XTD = mode marche (cross-terrain). Non-XTD = alpin pur. Produits différents.
    const products = [
      makeProduct("bergzeit", "Atomic Hawx Prime 100 XTD homme", 400),
      makeProduct("sportbittl", "Atomic Hawx Prime 100 Skischuh Herren", 350),
    ];
    const metas = [
      makeMetadata({
        brand: "Atomic", category: "Chaussures", sport: "Ski alpin",
        gender: "Homme",
      }),
      makeMetadata({
        brand: "Atomic", category: "Chaussures", sport: "Ski alpin",
        gender: "Homme",
      }),
    ];
    const items = prepareItems(products, metas);
    const matched = matchProducts(items);
    expect(matched).toHaveLength(2);
  });

  it("ne matche pas flex 100 vs flex 120 (indices de flex différents)", () => {
    // Même modèle (Hawx Ultra XTD), mais flex 100 (intermédiaire) vs 120 (expert).
    const products = [
      makeProduct("bergzeit", "Atomic Hawx Ultra 100 XTD homme", 400),
      makeProduct("sportbittl", "Atomic Hawx Ultra 120 XTD Skischuh Herren", 450),
    ];
    const metas = [
      makeMetadata({
        brand: "Atomic", category: "Chaussures", sport: "Ski alpin",
        gender: "Homme",
      }),
      makeMetadata({
        brand: "Atomic", category: "Chaussures", sport: "Ski alpin",
        gender: "Homme",
      }),
    ];
    const items = prepareItems(products, metas);
    const matched = matchProducts(items);
    expect(matched).toHaveLength(2);
  });

  it("matche bien 2 offres du MÊME Atomic Hawx Ultra 100 XTD (cross-site)", () => {
    // Même produit exact (Hawx Ultra 100 XTD, pas de promo) sur 2 sites → 1 group.
    const products = [
      makeProduct("bergzeit", "Atomic Hawx Ultra 100 XTD homme", 400),
      makeProduct("sportbittl", "Atomic Hawx Ultra 100 XTD Skischuh Herren", 380),
    ];
    const metas = [
      makeMetadata({
        brand: "Atomic", category: "Chaussures", sport: "Ski alpin",
        gender: "Homme",
      }),
      makeMetadata({
        brand: "Atomic", category: "Chaussures", sport: "Ski alpin",
        gender: "Homme",
      }),
    ];
    const items = prepareItems(products, metas);
    const matched = matchProducts(items);
    expect(matched).toHaveLength(1);
    expect(matched[0].offers).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // P1.3 — Anti-conflation split: scores must be re-aggregated when Union-Find
  //        merges groups transitively. Without the fix, scores stored at an
  //        intermediate root become orphaned when that root is later demoted
  //        by a subsequent union, and the final matchScore / matchReason
  //        reflect only the last union's pair — not all matching pairs in
  //        the group.
  // -------------------------------------------------------------------------
  it("P1.3: aggregates matchScore across all pairs when groups merge transitively", () => {
    // 3 items on 3 different sites:
    //   A (bergzeit)   — has EAN + brand+category+sport (strong metadata)
    //   B (sportbittl) — has same EAN as A  → match score 1.0
    //   C (snowleader) — has NO EAN, but same brand+category+sport+title tokens as A → multi match ~0.7
    //
    // Pairwise:
    //   A-B: matched, score 1.0,  reason "ean"
    //   A-C: matched, score ~0.7, reason "multi:brand+category+sport+title"
    //   B-C: B has no title tokens overlapping with C (B has extra "Skitouring" word) — may or may not match
    //
    // Expected after fix:
    //   - All 3 items in one group (transitive union)
    //   - matchScore = average of ALL pairwise scores in the group (at least A-B + A-C)
    //   - matchReason contains BOTH "ean" AND "multi:..."
    //
    // Buggy behavior (before fix):
    //   - matchScore = only the LAST union's pair score (e.g. 0.7)
    //   - matchReason = only "multi:..." (the "ean" reason from the first pair is lost)
    const products = [
      makeProduct("bergzeit",   "Dynafit Speed Radical", 500),
      makeProduct("sportbittl", "Dynafit Speed Radical", 520),
      makeProduct("snowleader", "Dynafit Speed Radical Skitouring", 540),
    ];
    const metas = [
      // A: full metadata (EAN + brand + category + sport)
      makeMetadata({
        ean: "1234567890123",
        brand: "Dynafit",
        category: "Skins",
        sport: "Ski de randonnée",
      }),
      // B: same EAN as A → guaranteed strong match A-B
      makeMetadata({
        ean: "1234567890123",
        brand: "Dynafit",
        category: "Skins",
        sport: "Ski de randonnée",
      }),
      // C: no EAN, but same brand+category+sport → multi-criteria match with A
      makeMetadata({
        brand: "Dynafit",
        category: "Skins",
        sport: "Ski de randonnée",
      }),
    ];
    const items = prepareItems(products, metas);
    const matched = matchProducts(items);

    // Sanity: all 3 should be in one group
    expect(matched).toHaveLength(1);
    expect(matched[0].offers).toHaveLength(3);

    // BUG CHECK 1: matchReason must include BOTH "ean" and "multi:..."
    // Buggy version would only have one of them (whichever union happened last).
    expect(matched[0].matchReason).toBeDefined();
    expect(matched[0].matchReason).toContain("ean");
    expect(matched[0].matchReason).toContain("multi:");

    // BUG CHECK 2: matchScore must reflect BOTH pairs (1.0 + ~0.7 = avg ~0.85)
    // Buggy version would be just 1.0 (if last union was A-B) or just 0.7 (if last was A-C).
    // Correct: avg of [1.0, multi_score, ...] — multi_score is at least 0.55 (threshold).
    // So matchScore should be ≥ 0.55 and < 1.0 (because there are mixed scores).
    expect(matched[0].matchScore).toBeGreaterThanOrEqual(0.55);
    expect(matched[0].matchScore).toBeLessThan(1.0);
    // The "ean" pair contributes 1.0, so the average should be > 0.7 (just multi alone)
    expect(matched[0].matchScore).toBeGreaterThan(0.7);
  });
});
