// Construit les filtres dynamiques à partir des MatchedProduct.
import type { DynamicFilters, MatchedProduct } from "./types";

function bump(map: Map<string, number>, key: string) {
  const k = key.trim();
  if (!k) return;
  map.set(k, (map.get(k) ?? 0) + 1);
}

function toList(map: Map<string, number>) {
  return [...map.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
}

export function buildDynamicFilters(products: MatchedProduct[]): DynamicFilters {
  const brands = new Map<string, number>();
  const categories = new Map<string, number>();
  const subcategories = new Map<string, number>();
  const sports = new Map<string, number>();
  const ranges = new Map<string, number>();
  const genders = new Map<string, number>();
  const colors = new Map<string, number>();
  const sizes = new Map<string, number>();
  const attrMap = new Map<string, Map<string, number>>();

  let minPrice = Infinity;
  let maxPrice = -Infinity;
  let priceCurrency = "EUR";

  for (const p of products) {
    if (p.brand) bump(brands, p.brand);
    if (p.category) bump(categories, p.category);
    if (p.subcategory) bump(subcategories, p.subcategory);
    if (p.sport) bump(sports, p.sport);
    if (p.range) bump(ranges, p.range);
    if (p.metadata.gender) bump(genders, p.metadata.gender);
    for (const c of p.metadata.color ?? []) bump(colors, c);
    for (const s of p.metadata.sizes ?? []) bump(sizes, s);
    if (p.minPrice !== null) {
      minPrice = Math.min(minPrice, p.minPrice);
      maxPrice = Math.max(maxPrice, p.minPrice);
      priceCurrency = p.minCurrency;
    }
    if (p.metadata.attributes) {
      for (const [k, v] of Object.entries(p.metadata.attributes)) {
        if (!v) continue;
        const kl = k.toLowerCase().trim();
        if (!kl) continue;
        const inner = attrMap.get(kl) ?? new Map<string, number>();
        bump(inner, v);
        attrMap.set(kl, inner);
      }
    }
  }

  const attributes = [...attrMap.entries()]
    .filter(([, m]) => m.size >= 1)
    .map(([key, m]) => ({ key, values: toList(m).slice(0, 8) }))
    .sort((a, b) => b.values.length - a.values.length)
    .slice(0, 8);

  const priceRange = minPrice !== Infinity && maxPrice !== -Infinity
    ? { min: Math.floor(minPrice), max: Math.ceil(maxPrice), currency: priceCurrency }
    : undefined;

  return {
    brands: toList(brands).slice(0, 30),
    categories: toList(categories).slice(0, 15),
    subcategories: toList(subcategories).slice(0, 15),
    sports: toList(sports).slice(0, 12),
    ranges: toList(ranges).slice(0, 8),
    genders: toList(genders).slice(0, 6),
    colors: toList(colors).slice(0, 15),
    sizes: toList(sizes).slice(0, 25),
    attributes,
    priceRange,
  };
}


/** Normalize size values (EU 42 → eu:42, US 9 → us:9, etc.) */
export function normalizeSizeValue(raw: string): string {
  const t = raw.trim().toLowerCase().replace(/\s+/g, " ");
  const unitMatch = t.match(/\b(eu|us|uk|cm|mp)\b/);
  const numMatch = t.match(/(\d{1,2}(?:[.,]\d)?)/);
  if (numMatch) {
    const unit = unitMatch ? unitMatch[1] : "eu";
    return `${unit}:${numMatch[1].replace(",", ".")}`;
  }
  return t;
}
