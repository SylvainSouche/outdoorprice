// Export CSV des produits matchés (une ligne par offre).
// --------------------------------------------------------------------------
import type { MatchedProduct } from "./scraper/types";

function esc(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  // échapper guillemets + séparateurs/retours ligne
  if (/[",;\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const HEADERS = [
  "produit_id", "titre", "marque", "categorie", "sous_categorie", "sport",
  "genre", "couleurs", "tailles", "score_match", "nb_offres",
  "offre_site", "offre_prix", "offre_prix_barre", "offre_remise_pct",
  "offre_devise", "offre_dispo", "offre_url",
];

/** Construit le CSV (une ligne par offre, champs produit répétés). */
export function exportMatchedCsv(products: MatchedProduct[]): string {
  const lines: string[] = [HEADERS.join(",")];
  for (const p of products) {
    const base = [
      p.id, p.title, p.brand ?? "", p.category ?? "", p.subcategory ?? "",
      p.sport ?? "", p.metadata.gender ?? "",
      (p.metadata.color ?? []).join(" / "),
      (p.metadata.sizes ?? []).join(" / "),
      p.matchScore ?? 1,
      p.offers.length,
    ];
    for (const o of p.offers) {
      lines.push([...base, o.siteName, o.price ?? "", o.originalPrice ?? "",
        o.discount ?? "", o.currency, o.availabilityLabel ?? o.availability, o.url]
        .map(esc).join(","));
    }
    // produit sans aucune offre (théorique) : ligne produit seule
    if (p.offers.length === 0) {
      lines.push([...base, "", "", "", "", "", "", "", ""].map(esc).join(","));
    }
  }
  return lines.join("\n");
}

/** Déclenche le téléchargement navigateur du CSV. */
export function downloadCsv(products: MatchedProduct[], filename = "outdoorprice-export.csv") {
  const csv = exportMatchedCsv(products);
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }); // BOM pour Excel
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ===========================================================================
// Export CSV « catégorisé » — pour debug de la classification
// --------------------------------------------------------------------------
// Une ligne PAR PRODUIT (pas par offre) avec TOUS les champs de classification :
//   - sport, categorie, sous_categorie, gamme (range)
//   - genre, couleurs, tailles
//   - ean, gtin, sku, mpn, modelYear, weight, rating, reviewCount
//   - matchScore, matchReason (pourquoi les offres ont été groupées)
//   - nb_offres, sites (joins), prix_min, prix_max
//
// Permet de comparer visuellement la classification automatique avec la
// réalité (par exemple en croisant avec le CSV complet exporté par `downloadCsv`).
// ===========================================================================

const CATEGORIZED_HEADERS = [
  "produit_id", "titre", "marque",
  "sport", "categorie", "sous_categorie", "gamme",
  "genre", "couleurs", "tailles",
  "ean", "gtin", "sku", "mpn", "model_year", "poids_g", "note", "nb_avis",
  "score_match", "raison_match",
  "nb_offres", "sites", "prix_min", "prix_max", "devise",
  "attributs",
];

/** Construit le CSV catégorisé (une ligne par produit, toutes les métadonnées). */
export function exportCategorizedCsv(products: MatchedProduct[]): string {
  const lines: string[] = [CATEGORIZED_HEADERS.join(",")];
  for (const p of products) {
    const md = (p.metadata ?? {}) as Record<string, unknown>;
    const attrs = toArray(md.attributes)
      .map((a: any) => {
        const key = a?.key ?? "";
        const vals = toArray(a?.values).map((v: any) => (typeof v === "object" ? v?.value ?? "" : String(v)));
        return `${key}=${vals.join("|")}`;
      })
      .join(" ; ");
    const row = [
      p.id,
      p.title,
      p.brand ?? "",
      p.sport ?? "",
      p.category ?? "",
      p.subcategory ?? "",
      p.range ?? "",
      (md as any).gender ?? "",
      toArray(md.color).join(" / "),
      toArray(md.sizes).join(" / "),
      (md as any).ean ?? "",
      (md as any).gtin ?? "",
      (md as any).sku ?? "",
      (md as any).mpn ?? "",
      (md as any).modelYear ?? "",
      (md as any).weight ?? "",
      (md as any).rating ?? "",
      (md as any).reviewCount ?? "",
      p.matchScore ?? "",
      p.matchReason ?? "",
      p.offers.length,
      p.offers.map((o) => o.siteName ?? o.site).join(" | "),
      p.minPrice ?? "",
      p.maxPrice ?? "",
      p.minCurrency ?? "",
      attrs,
    ];
    lines.push(row.map(esc).join(","));
  }
  return lines.join("\n");
}

/** Helper défensif : garantit qu'on a un tableau, peu importe ce qui est passé.
 *  Gère les cas où `attributes`, `color`, ou `sizes` arrivent en string / objet /
 *  null / undefined (le type `??` seul ne filtre que null/undefined). */
function toArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  // String → on ne la split pas (risque de casser une valeur legit)
  // On la wrapped dans un tableau à 1 élément.
  if (typeof v === "string") return [v];
  // Object (qui n'est pas un array) → on retourne ses valeurs
  if (typeof v === "object") return Object.values(v);
  return [v];
}

/** Déclenche le téléchargement navigateur du CSV catégorisé (debug). */
export function downloadCategorizedCsv(products: MatchedProduct[], filename = "outdoorprice-categorized.csv") {
  const csv = exportCategorizedCsv(products);
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }); // BOM pour Excel
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
