// src/config.ts — Hardcoded configuration and constants
// --------------------------------------------------------------------------
// All site-specific, UI-specific, and scraping-specific constants that were
// previously scattered across page.tsx are centralized here.
// --------------------------------------------------------------------------

import type { SiteId } from "./lib/scraper/types";

// --- Search suggestions (shown as quick-click chips) ---
export const SUGGESTIONS = [
  "Dynafit Speed Radical",
  "Hoka Speedgoat 7",
  "Scarpa F1 LT",
  "Black Diamond Helio",
  "Arc'teryx Beta AR",
  "Patagonia Nano Puff",
  "Petzl GriGri",
  "Dynafit TLT Superlite",
];

// --- Sort options ---
export const SORT_OPTIONS = [
  { value: "siteCount_desc", key: "sidebar.sortSiteCount" },
  { value: "price_asc", key: "sidebar.sortPriceAsc" },
  { value: "price_desc", key: "sidebar.sortPriceDesc" },
  { value: "savings_desc", key: "sidebar.sortSavings" },
  { value: "rating_desc", key: "sidebar.sortRating" },
] as const;

export type SortKey = (typeof SORT_OPTIONS)[number]["value"];

// --- Color → hex mapping for ColorSwatches component ---
export const COLOR_HEX: Record<string, string> = {
  // FR colors
  noir: "#1a1a1a", black: "#1a1a1a", blanc: "#ffffff", white: "#ffffff",
  rouge: "#dc2626", red: "#dc2626", bleu: "#2563eb", blue: "#2563eb",
  vert: "#16a34a", green: "#16a34a", jaune: "#eab308", yellow: "#eab308",
  orange: "#ea580c", rose: "#ec4899", pink: "#ec4899",
  gris: "#6b7280", grey: "#6b7280", gray: "#6b7280",
  marron: "#92400e", brown: "#92400e", beige: "#d4b896",
  bordeaux: "#7c2d12", marine: "#1e3a5f", turquoise: "#06b6d4",
  violet: "#7c3aed", purple: "#7c3aed", corail: "#ff7f50",
  ivoire: "#fffff0", ivory: "#fffff0", sable: "#e6d8b8",
  argile: "#a0522d", teal: "#0d9488", olive: "#556b2f",
  or: "#d4af37", gold: "#d4af37", silver: "#c0c0c0", argent: "#c0c0c0",
  copper: "#b87333", bronze: "#cd7f32",
  // Outdoor colorway names
  cinder: "#58453a", overcast: "#8b8b8b", balsam: "#3d5a3d",
  storm: "#4a5568", sunset: "#ff6b35", sand: "#c2a878",
  ash: "#b0b0b0", fire: "#dc2626", crimson: "#dc143c",
  amber: "#f59e0b", graphite: "#414a4c", slate: "#64748b",
  moss: "#8a9a5b", lagoon: "#0891b2", aqua: "#00ffff",
  mint: "#98ff98", lime: "#84cc16", "coral red": "#ff4040",
  rust: "#b7410e", fluo: "#ccff00", fluorescent: "#ccff00",
  neon: "#ccff00", cabana: "#7ec8e3", alabama: "#f5e6c8",
  // DE colors
  schwarz: "#1a1a1a", weiss: "#ffffff", rot: "#dc2626",
  blau: "#2563eb", grün: "#16a34a", gelb: "#eab308",
  grau: "#6b7280", braun: "#92400e",
  // ES colors
  negro: "#1a1a1a", blanco: "#ffffff", rojo: "#dc2626",
  azul: "#2563eb", verde: "#16a34a", amarillo: "#eab308",
  gris_claro: "#d1d5db", oscuro: "#1a1a1a",
};

// --- EU shoe size regex (used by normalizeTokens in matcher) ---
// Not used directly here, but documented for reference

// --- Default sort key ---
export const DEFAULT_SORT_KEY: SortKey = "siteCount_desc";

// --- Min sites slider config ---
export const MIN_SITES_DEFAULT = 1;
export const MIN_SITES_MAX = 9;

// --- Log panel: max entries ---
export const MAX_LOGS = 500;

// --- Live filter: fields searched ---
export const LIVE_FILTER_FIELDS = [
  "title", "brand", "category", "subcategory", "sport", "range",
  "gender", "color", "sizes", "attributes", "siteName",
] as const;
