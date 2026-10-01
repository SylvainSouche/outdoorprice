// Matching cross-site multi-critères : regroupe les ProductResult enrichis
// en MatchedProduct (un produit logique = plusieurs offres cross-site).
//
// Stratégie en cascade (ne se base pas que sur le nom) :
//
//   1. Identifiant fort (EAN / GTIN / MPN) identique → match parfait (1.0)
//      raison: "ean" / "gtin" / "mpn"
//
//   2. Score multi-critères pondéré :
//        - marque identique        (poids 0.30)
//        - catégorie identique     (poids 0.20)
//        - sport identique         (poids 0.15)
//        - sous-catégorie identique(poids 0.10)
//        - gamme identique         (poids 0.10)
//        - similarité tokens titre (poids 0.15)
//      Si score ≥ 0.55 → match. raison: "multi-criteria"
//
//   3. Similarité tokens titre très haute (≥ 0.85) même sans métadonnées
//      → match prudent. raison: "title-similarity"
//
//   4. Même marque + tokens clé du modèle identiques
//      (tokens de ≥ 4 lettres, hors couleurs/tailles) → match. raison: "brand+model"
//
// L'algorithme utilise Union-Find pour regrouper transitivement.
import type {
  ProductResult,
  ProductMetadata,
  ProductOffer,
  MatchedProduct,
} from "./types";
import { guessBrandFromTitle } from "./enrich";

/** Tokens vides ou non discriminants à retirer pour la comparaison. */
const STOP_TOKENS = new Set([
  // FR
  "le", "la", "les", "un", "une", "des", "du", "de", "the", "of", "and", "or",
  "pour", "avec", "sans", "acheter", "nouveau", "neuf", "occasion",
  // Mots génériques de type produit (FR + EN + DE + ES) — ces mots ne
  // discriminent pas les produits entre eux et gonflent artificiellement
  // la similarité Jaccard entre titres courts et titres longs.
  "chaussures", "chaussure", "shoes", "schuhe", "laufschuhe", "trailrunningschuhe",
  "zapatillas", "scarpe", "boot", "boots", "stiefel",
  "sac", "sacs", "backpack", "rucksack", "ruck sack", "bag", "bags", "tasche",
  "veste", "vestes", "jacket", "jackets", "jacke", "chaqueta",
  "pantalon", "pantalons", "pants", "trouser", "hose", "pantaln",
  "gant", "gants", "glove", "gloves", "handschuhe",
  "bonnet", "beanie", "hat", "mütze", "gorro",
  "skis", "ski", "schnee", "snowboard", "splitboard",
  "binding", "bindung", "fixation", "fix",
  "pole", "stock", "stok", "stoecke",
  // Couleurs FR
  "noir", "blanc", "rouge", "bleu", "vert", "jaune", "orange", "violet",
  "gris", "rose", "marron", "beige", "kaki", "anthracite", "bordeaux",
  "turquoise", "creme", "ivoire", "sable", "corail", "argile",
  // Couleurs EN
  "black", "white", "red", "blue", "green", "yellow", "purple", "pink",
  "brown", "navy", "teal", "olive", "gold", "silver", "copper", "bronze",
  "grey", "gray",
  // Outdoor colorway names (Dynafit, Salomon, Arc'teryx, etc.) — ces mots
  // sont des noms de coloris, pas des discriminants de produit. Les retirer
  // permet à « Radical /noir out » et « Radical /overcast cinder » de matcher.
  "fluo", "fluorescent", "neon", "out", "balsam", "cinder", "alabama",
  "overcast", "cabana", "storm", "sunset", "sand", "ash", "fire",
  "crimson", "amber", "graphite", "slate", "moss", "lagoon", "aqua",
  "mint", "lime", "coralred", "rust",
  // Genre (FR + EN + DE) — géré séparément via metadata.gender hard veto.
  // On les strip des titres pour que « Speedgoat 7 M » et « Speedgoat 7 Trailrunningschuhe Herren »
  // aient une similarité basée sur le modèle, pas sur le mot « Herren ».
  "homme", "femme", "mixte", "enfant", "men", "women", "kid", "unisexe", "unisex",
  "damen", "herren", "junior", "kinder", "damen", "herren", "mannlich", "weiblich",
  // Divers
  "edition", "model", "modèle", "v2", "v3", "new", "promo", "sale",
]);

const TOKEN_SPLIT_RE = /[\s\-_,.;:|·/()'"’°]+/;

// Marqueurs de genre : dès qu'on en rencontre un dans un titre, on considère
// que tout ce qui suit est un suffixe « coloris » (cosmetic variant) qu'on
// peut stripper avant de comparer. Ça évite d'avoir à maintenir une liste
// exhaustive de noms de coloris (« berry jam », « starlight glow », etc.).
// On matche sur mots entiers (\b) pour ne pas attraper le « M » de « Mountain ».
const GENDER_MARKER_RE =
  /\b(W|M|Damen|Herren|femme|homme|Women|Men|Femme|Homme|Woman|Man|Women'?s|Men'?s|Junior|Enfant|Kids|Boys|Girls|Homme|Femme)\b/g;

/** Strip le suffixe coloris d'un titre.
 *  Stratégie : si le titre contient un marqueur de genre (W, M, Damen, Herren,
 *  femme, homme, etc.), on garde tout jusqu'à ce marqueur INCLUS, et on jette
 *  le reste. Sinon, on strippe à partir du premier "/" (séparateur de coloris
 *  chez Snowleader).
 *
 *  Exemples :
 *    "Speedgoat 6 W Oatmeal/Mountain Iris"  → "Speedgoat 6 W"
 *    "Speedgoat 7 Trailrunningschuhe Herren berry jam"  → "Speedgoat 7 Trailrunningschuhe Herren"
 *    "Hoka Chaussures Speedgoat 7 homme"  → "Hoka Chaussures Speedgoat 7 homme" (rien à stripper)
 *    "Dynafit Radical 24 Backpack /noir out"  → "Dynafit Radical 24 Backpack " (slash)
 */
function stripColorSuffix(title: string): string {
  // Trouve le DERNIER marqueur de genre (au cas où il y en aurait plusieurs)
  GENDER_MARKER_RE.lastIndex = 0;
  let lastMatch: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = GENDER_MARKER_RE.exec(title)) !== null) {
    lastMatch = m;
  }
  if (lastMatch && lastMatch.index !== undefined) {
    return title.slice(0, lastMatch.index + lastMatch[0].length);
  }
  // Pas de marqueur de genre — strip à partir du premier "/" (colorway separator)
  const slashIdx = title.indexOf("/");
  if (slashIdx >= 0) {
    return title.slice(0, slashIdx);
  }
  return title;
}

/** Normalise un titre en tokens comparables. */
function normalizeTokens(title: string): string[] {
  // D'abord strip le suffixe coloris (basé sur marqueur de genre ou "/")
  const stripped = stripColorSuffix(title);
  const t = stripped
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s\-']/g, " ");
  const tokens = t.split(TOKEN_SPLIT_RE).filter(Boolean);
  return tokens.filter((tok) => {
    if (STOP_TOKENS.has(tok)) return false;
    // Only strip tokens that look like EU shoe sizes (2-digit numbers in
    // 30-50 range, possibly with .5). Single digits and 2-digit numbers
    // outside that range are kept — they're often model versions like
    // "Speedgoat 6", "Speedgoat 7", "TLT Superlite 2", "Radical 24 Backpack"
    // (liters), etc., and are critical discriminants.
    const sizeMatch = tok.match(/^(\d{2})([.,]5)?$/);
    if (sizeMatch) {
      const n = parseInt(sizeMatch[1], 10);
      if (n >= 30 && n <= 50) return false; // likely EU shoe size
    }
    if (/^(xs|s|m|l|xl|xxl|xxxl|onesize)$/.test(tok)) return false;
    if (/^(19|20)\d{2}$/.test(tok)) return false; // année
    // Drop single-letter tokens (W, M, S, L) — they're ambiguous (could be
    // gender markers OR abbreviations). Gender is handled separately via
    // metadata.gender with a hard mismatch rule.
    // EXCEPTION: keep single-digit tokens (model versions like "6", "7").
    if (tok.length < 2) return /^\d$/.test(tok);
    return true;
  });
}

/** Tokens "modèle" = tokens de ≥ 4 lettres (plus discriminants). */
function modelTokens(title: string): string[] {
  return normalizeTokens(title).filter((t) => t.length >= 4);
}

// ---------------------------------------------------------------------------
// Marqueurs de ligne produit : GTX, Mid, Pro, LT, SL, Carbon, etc.
// Ces tokens distinguent des lignes produit distinctes (ex: « Speedgoat 6 »
// vs « Speedgoat 6 GTX » vs « Speedgoat 6 Mid GTX » sont 3 produits différents).
// Si deux items ont des ensembles différents de ces marqueurs, on refuse le
// match — quelle que soit la similarité du reste du titre.
// ---------------------------------------------------------------------------
const PRODUCT_LINE_MARKERS = new Set([
  // GORE-TEX variants
  "gtx", "gor", "gore",
  // Hauteur de tige
  "mid", "low",
  // Versions « Pro / Elite / Performance »
  "pro", "elite", "perf", "performance", "comp", "competition",
  // Versions légères
  "lt", "sl", "light", "ultralight", "superlight",
  // Matières (carbone, titane, etc.)
  "carbon", "titanium", "ti",
  // Misc
  "homing", "mips",
  // Ski boot fit/volume variants (Atomic Hawx Ultra vs Prime vs Magna, etc.)
  // These are DIFFERENT products — a Hawx Ultra 100 is NOT a Hawx Prime 120.
  "ultra", "prime", "magna", "sport",
  // Ski boot walk-mode / cross-terrain
  "xtd",
  // Ski touring binding variants
  "rotation", "radical", "superlite", "tlt", "alpine",
  // Shoe width variants
  "wide", "narrow", "regular",
]);

/** Extrait les marqueurs de ligne produit d'un ensemble de tokens. */
function productLineMarkers(tokens: string[]): Set<string> {
  const s = new Set<string>();
  for (const t of tokens) {
    if (PRODUCT_LINE_MARKERS.has(t)) s.add(t);
  }
  return s;
}

/** Vrai si les deux items ont exactement les mêmes marqueurs de ligne produit. */
function sameProductLine(a: EnrichedItem, b: EnrichedItem): boolean {
  const ma = productLineMarkers(a.tokens);
  const mb = productLineMarkers(b.tokens);
  if (ma.size !== mb.size) return false;
  for (const t of ma) if (!mb.has(t)) return false;
  return true;
}

/** Tokens de version du modèle : chiffres seuls qui apparaissent dans des noms
 *  comme « Speedgoat 6 », « Speedgoat 7 », « TLT 2 », ou des indices de flex
 *  ski-boot comme « 100 », « 110 », « 120 », « 130 », « 150 ».
 *  Critiques pour distinguer des générations ou spécifications différentes. */
function modelVersionTokens(tokens: string[]): Set<string> {
  const s = new Set<string>();
  for (const t of tokens) {
    // Single digits (Speedgoat 6 vs 7) AND 2-3 digit numbers (flex 100 vs 120).
    // EU shoe sizes (30-50) are already stripped by normalizeTokens, so we
    // only see flex indices (90-150) and model version numbers (1-9, 2-3).
    if (/^\d{1,3}$/.test(t)) s.add(t);
  }
  return s;
}

/** Vrai si les deux items ont la même version de modèle.
 *  Si l'un a un numéro de version et l'autre non, ou si les numéros diffèrent,
 *  ce sont des générations différentes du produit → false. */
function sameModelVersion(a: EnrichedItem, b: EnrichedItem): boolean {
  const va = modelVersionTokens(a.tokens);
  const vb = modelVersionTokens(b.tokens);
  // Si aucun des deux n'a de version, on ne peut pas dire → true (continuer)
  if (va.size === 0 && vb.size === 0) return true;
  // Si un seul a une version, on est permissif (l'autre titre est peut-être
  // moins détaillé). Sauf si l'autre a clairement une version différente.
  if (va.size === 0 || vb.size === 0) return true;
  // Si les deux ont des versions, elles doivent coïncider exactement
  if (va.size !== vb.size) return false;
  for (const v of va) if (!vb.has(v)) return false;
  return true;
}

/** Indice de Jaccard sur les ensembles de tokens. */
function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

interface EnrichedItem {
  product: ProductResult;
  metadata: ProductMetadata;
  tokens: string[];
  modelTokens: string[];
  brand?: string;
  strongId?: string;
}

function toOffer(p: ProductResult, m: ProductMetadata): ProductOffer {
  return {
    site: p.site,
    siteName: p.siteName,
    url: p.url,
    title: p.title,
    price: p.price,
    originalPrice: p.originalPrice ?? null,
    currency: p.currency,
    image: p.image ?? null,
    availability: p.availability,
    availabilityLabel: p.availabilityLabel,
    discount: p.discount ?? null,
    color: m.color && m.color.length > 0 ? m.color : undefined,
    sizes: m.sizes && m.sizes.length > 0 ? m.sizes : undefined,
    ean: m.ean,
  };
}

/** Clé de regroupement forte : EAN > GTIN > MPN (normalisée). */
function strongKey(m: ProductMetadata): string | undefined {
  const raw = m.ean || m.gtin || m.mpn;
  if (!raw) return undefined;
  const k = String(raw).replace(/[^\dA-Za-z]/g, "").toUpperCase();
  return k.length >= 6 ? k : undefined;
}

/** Marque canonique (première lettre majuscule) pour comparaison et UI. */
function canonBrand(m: ProductMetadata, fallbackTitle: string): string | undefined {
  const b = m.brand || guessBrandFromTitle(fallbackTitle);
  if (!b) return undefined;
  return b.trim().replace(/\s+/g, " ");
}

function sameStr(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  return a.toLowerCase().trim() === b.toLowerCase().trim();
}

/** Hash stable court pour générer un id de produit logique. */
function hashId(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

interface MatchResult {
  matched: boolean;
  score: number;
  reason: string;
}

/** Évalue le match entre deux items enrichis. */
function evaluateMatch(a: EnrichedItem, b: EnrichedItem): MatchResult {
  // 1. Identifiant fort (avant tout — même site, même EAN = variantes cosmetic)
  if (a.strongId && b.strongId && a.strongId === b.strongId) {
    return { matched: true, score: 1, reason: a.metadata.ean ? "ean" : a.metadata.gtin ? "gtin" : "mpn" };
  }

  // 2. RÈGLES DURES DE NON-MATCH (hard vetoes) -----------------------------
  //    Si l'une des conditions suivantes est vraie, on NE matche JAMAIS,
  //    quel que soit le reste. Ces règles distinguent des produits réellement
  //    différents qui partagent marque + sport + catégorie.

  // 2a. Genre différent (Femme vs Homme = produits différents)
  //     ex: « Speedgoat 7 W » vs « Speedgoat 7 M » sont 2 produits distincts
  //     (l'iconographie, la semelle, le last peuvent différer).
  if (a.metadata.gender && b.metadata.gender
      && !sameStr(a.metadata.gender, b.metadata.gender)) {
    return { matched: false, score: 0, reason: "gender-mismatch" };
  }

  // 2b. Ligne produit différente (GTX vs non-GTX, Mid vs non-Mid, etc.)
  //     ex: « Speedgoat 6 » vs « Speedgoat 6 GTX » vs « Speedgoat 6 Mid GTX »
  //     sont 3 produits différents — la membrane, la hauteur de tige, etc.
  //     ne sont pas des variantes cosmétiques.
  if (!sameProductLine(a, b)) {
    return { matched: false, score: 0, reason: "product-line-mismatch" };
  }

  // 2c. Version de modèle différente (6 vs 7, etc.)
  //     ex: « Speedgoat 6 » vs « Speedgoat 7 » sont des produits DIFFÉRENTS
  //     (semelle, tige, drop différent). On extrait les chiffres du titre
  //     et on exige qu'ils coïncident si les deux titres en ont.
  if (!sameModelVersion(a, b)) {
    return { matched: false, score: 0, reason: "model-version-mismatch" };
  }

  // 3. Variantes cosmetic du MÊME site -------------------------------------
  //    Même marque + titre quasi identique (après stripping couleurs) =
  //    variantes cosmétiques (coloris) du même produit. On les regroupe.
  if (a.product.site === b.product.site) {
    if (a.brand && b.brand && sameStr(a.brand, b.brand)) {
      const titleSim = jaccard(a.tokens, b.tokens);
      // Similarité très haute = le titre ne diffère que par le suffixe couleur
      if (titleSim >= 0.85) {
        return { matched: true, score: 0.9, reason: "cosmetic-variant" };
      }
      // Marque identique + tokens modèle (≥4 lettres) quasi identiques
      const modelSim = jaccard(a.modelTokens, b.modelTokens);
      if (modelSim >= 0.7 && a.modelTokens.length >= 2) {
        return { matched: true, score: 0.75, reason: "cosmetic-variant" };
      }
    }
    return { matched: false, score: 0, reason: "" };
  }

  // 4. Score multi-critères (cross-site) -----------------------------------
  let score = 0;
  let reasons: string[] = [];

  const brandMatch = a.brand && b.brand && sameStr(a.brand, b.brand);
  if (brandMatch) {
    score += 0.3;
    reasons.push("brand");
  }

  const catMatch = sameStr(a.metadata.category, b.metadata.category);
  if (catMatch && a.metadata.category) {
    score += 0.2;
    reasons.push("category");
  }

  const sportMatch = sameStr(a.metadata.sport, b.metadata.sport);
  if (sportMatch && a.metadata.sport) {
    score += 0.15;
    reasons.push("sport");
  }

  const subcatMatch = sameStr(a.metadata.subcategory, b.metadata.subcategory);
  if (subcatMatch && a.metadata.subcategory) {
    score += 0.1;
    reasons.push("subcategory");
  }

  const rangeMatch = sameStr(a.metadata.range, b.metadata.range);
  if (rangeMatch && a.metadata.range) {
    score += 0.1;
    reasons.push("range");
  }

  const titleSim = jaccard(a.tokens, b.tokens);
  score += titleSim * 0.15;
  if (titleSim > 0.4) reasons.push("title");

  // Multi-criteria match : on exige AUSSI une similarité de titre >= 0.4.
  // Sans ce plancher, deux produits différents d'une même marque partageant
  // juste catégorie + sport (ex: « Speedgoat 6 » vs « Speedgoat 7 » chez Hoka)
  // atteindraient 0.65 de score (brand 0.3 + cat 0.2 + sport 0.15) et
  // matcherait à tort. Le plancher de 0.4 évite cela tout en restant permissif
  // pour les vrais cross-site matchs où les titres diffèrent légèrement.
  if (score >= 0.55 && titleSim >= 0.4) {
    return { matched: true, score: Math.min(score, 0.99), reason: `multi:${reasons.join("+")}` };
  }

  // 5. Très haute similarité de titre même sans métadonnées
  if (titleSim >= 0.85) {
    return { matched: true, score: titleSim, reason: "title-similarity" };
  }

  // 6. Même marque + tokens modèle fortement chevauchants
  //    Cas typique : Snowleader « Speedgoat 7 M » (titre court sans marque)
  //    vs Sport Bittl « HOKA Speedgoat 7 Trailrunningschuhe Herren » (titre long).
  //    Les tokens modèle (≥ 4 lettres) sont juste « speedgoat » pour Snowleader
  //    et « hoka, speedgoat » pour Sport Bittl → Jaccard 1/2 = 0.5.
  //    On accepte 0.5 (au lieu de 0.6) et on exige seulement 1 token modèle
  //    par côté (au lieu de 2) pour gérer les titres courts.
  if (brandMatch) {
    const modelSim = jaccard(a.modelTokens, b.modelTokens);
    // Count shared model tokens (intersection size)
    const shared = a.modelTokens.filter((t) => b.modelTokens.includes(t)).length;
    // Tightened from 0.5 to 0.6, and require ≥ 2 shared model tokens
    // (was ≥ 1 per side). This prevents "Hawx Ultra" matching "Hawx Prime"
    // (shared = {atomic, hawx} = 2, but modelSim = 0.5 which is now below 0.6).
    // For short Snowleader titles with only 1 model token (e.g. "speedgoat"),
    // shared = 1 — we still accept if modelSim > 0.7 (near-perfect match).
    if (modelSim >= 0.6
        && a.modelTokens.length >= 1
        && b.modelTokens.length >= 1
        && (shared >= 2 || modelSim > 0.7)) {
      return { matched: true, score: 0.6 + modelSim * 0.2, reason: "brand+model" };
    }
  }

  return { matched: false, score, reason: "" };
}

/**
 * Regroupe une liste de ProductResult enrichis en MatchedProduct.
 * Algo Union-Find : on compare chaque paire, et si match, on fusionne.
 */
export function matchProducts(items: EnrichedItem[]): MatchedProduct[] {
  const n = items.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };

  // Score/reason maps are declared BEFORE union() so the closure can read them.
  // (Without this, the closure captures the bindings at call-time, which works
  // due to `var`-like hoisting for `const` in function scope, but it's clearer
  // to declare them explicitly first.)
  const matchScores = new Map<number, number[]>();
  const matchReasons = new Map<number, Set<string>>();

  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    parent[ra] = rb;
    // ── P1.3 fix: merge score/reason maps when roots merge ──────────────
    // Without this, scores stored at the old root `ra` become orphaned
    // when `ra` is demoted (no longer a root) by this union. The final
    // group's matchScore/matchReason would then reflect only the pairs
    // stored at the surviving root `rb`, losing earlier pair scores.
    const sa = matchScores.get(ra);
    const sb = matchScores.get(rb);
    if (sa && sb) {
      sb.push(...sa);
      matchScores.delete(ra);
    } else if (sa) {
      matchScores.set(rb, sa);
      matchScores.delete(ra);
    }
    const ra_reasons = matchReasons.get(ra);
    const rb_reasons = matchReasons.get(rb);
    if (ra_reasons && rb_reasons) {
      for (const r of ra_reasons) rb_reasons.add(r);
      matchReasons.delete(ra);
    } else if (ra_reasons) {
      matchReasons.set(rb, ra_reasons);
      matchReasons.delete(ra);
    }
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const result = evaluateMatch(items[i], items[j]);
      if (result.matched) {
        union(i, j);
        const root = find(i);
        const arr = matchScores.get(root) ?? [];
        arr.push(result.score);
        matchScores.set(root, arr);
        const reasons = matchReasons.get(root) ?? new Set<string>();
        reasons.add(result.reason);
        matchReasons.set(root, reasons);
      }
    }
  }

  // Construire les groupes
  const groups = new Map<number, EnrichedItem[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const arr = groups.get(r) ?? [];
    arr.push(items[i]);
    groups.set(r, arr);
  }

  const matched: MatchedProduct[] = [];
  for (const [root, members] of groups.entries()) {
    matched.push(buildMatchedProduct(members, matchScores.get(root), matchReasons.get(root)));
    void root;
  }

  // Tri : plus de sites d'abord, puis prix min croissant
  matched.sort((a, b) => {
    if (b.siteCount !== a.siteCount) return b.siteCount - a.siteCount;
    return (a.minPrice ?? Infinity) - (b.minPrice ?? Infinity);
  });

  return matched;
}

function buildMatchedProduct(
  members: EnrichedItem[],
  scores?: number[],
  reasons?: Set<string>
): MatchedProduct {
  const offers = members.map((m) => toOffer(m.product, m.metadata));
  offers.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));

  // Métadonnées : on prend la première non vide pour chaque champ
  // SAUF pour color/sizes où on AGGRÈGE toutes les valeurs distinctes
  // (les coloris cosmetic variants doivent apparaître ensemble).
  const md: ProductMetadata = {};
  const colorSet = new Set<string>();
  const sizeSet = new Set<string>();
  for (const m of members) {
    const x = m.metadata;
    md.brand ??= x.brand;
    md.category ??= x.category;
    md.subcategory ??= x.subcategory;
    md.sport ??= x.sport;
    md.range ??= x.range;
    md.gender ??= x.gender;
    md.weight ??= x.weight;
    md.weightGrams ??= x.weightGrams;
    md.material ??= x.material;
    md.ean ??= x.ean;
    md.gtin ??= x.gtin;
    md.sku ??= x.sku;
    md.mpn ??= x.mpn;
    md.modelYear ??= x.modelYear;
    md.rating ??= x.rating;
    md.reviewCount ??= x.reviewCount;
    if (!md.attributes && x.attributes) md.attributes = x.attributes;
    // Aggregate colors across all members (cosmetic variants grouped together)
    for (const c of x.color ?? []) {
      const norm = c.trim();
      if (norm) colorSet.add(norm);
    }
    // Same for sizes
    for (const s of x.sizes ?? []) {
      const norm = s.trim();
      if (norm) sizeSet.add(norm);
    }
  }
  if (colorSet.size > 0) md.color = [...colorSet].sort();
  if (sizeSet.size > 0) md.sizes = [...sizeSet].sort();

  // Titre canonique : le plus long des membres (généralement le plus informatif)
  const canonTitle =
    [...members]
      .map((m) => m.product.title)
      .sort((a, b) => b.length - a.length)[0] || members[0].product.title;

  const image = members.map((m) => m.product.image).find(Boolean) ?? null;
  const brand = canonBrand(md, canonTitle);

  const offersWithPrice = offers.filter((o) => o.price !== null);
  const minOffer = offersWithPrice[0];
  const minPrice = minOffer?.price ?? null;
  const minCurrency = minOffer?.currency ?? "EUR";

  const sameCurrency = offersWithPrice.filter((o) => o.currency === minCurrency);
  const maxPrice = sameCurrency.length > 1
    ? sameCurrency.reduce(
        (m, o) => ((o.price ?? -Infinity) > (m ?? -Infinity) ? o.price ?? null : m),
        null as number | null
      )
    : minPrice;
  const savings = maxPrice !== null && minPrice !== null && maxPrice > minPrice
    ? Math.round((maxPrice - minPrice) * 100) / 100
    : null;

  const siteCount = new Set(members.map((m) => m.product.site)).size;
  const matchScore = scores && scores.length
    ? Math.round((scores.reduce((s, x) => s + x, 0) / scores.length) * 100) / 100
    : 1;
  const matchReason = reasons && reasons.size ? [...reasons].sort().join(", ") : undefined;

  const idSource = md.ean || md.gtin || md.mpn || `${brand ?? ""}|${canonTitle}`.toLowerCase();
  const id = hashId(idSource);

  return {
    id,
    title: canonTitle,
    brand,
    category: md.category,
    subcategory: md.subcategory,
    sport: md.sport,
    range: md.range,
    image,
    metadata: md,
    offers,
    minPrice,
    maxPrice,
    minCurrency,
    bestOffer: minOffer,
    savings,
    siteCount,
    matchScore,
    matchReason,
  };
}

/** Prépare les items enrichis pour le matcher. */
export function prepareItems(
  products: ProductResult[],
  metadatas: ProductMetadata[]
): EnrichedItem[] {
  return products.map((product, i) => {
    const metadata = metadatas[i] || {};
    const tokens = normalizeTokens(product.title);
    const mtokens = modelTokens(product.title);
    const brand = canonBrand(metadata, product.title);
    const strongId = strongKey(metadata);
    return { product, metadata, tokens, modelTokens: mtokens, brand, strongId };
  });
}
