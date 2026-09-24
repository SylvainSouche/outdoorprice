// Types partagés pour le moteur de recherche agrégatif

// SiteId est maintenant un string — l'enregistrement se fait en drop-in :
// 1. Drop un fichier `sites/<id>.ts` qui exporte `site` (SiteMeta) et `scraper` (Scraper)
// 2. Ajoute 1 ligne d'import dans `sites/index.ts`
// Plus besoin de modifier types.ts pour ajouter une boutique.
export type SiteId = string;

export interface SiteMeta {
  id: SiteId;
  name: string;
  baseUrl: string;
  country: string;
  currency: string;
  /** couleur tailwind utilisée pour le badge du site dans l'UI */
  accent: string;
  /** groupes builtin auxquels la boutique appartient (ex: ["outdoor"], ["cycling"], ["outdoor", "cycling"])
   *  "all" est implicite — ne pas l'inclure ici. */
  groups: string[];
}

export interface ProductResult {
  site: SiteId;
  siteName: string;
  title: string;
  url: string;
  price: number | null;
  /** prix d'origine barré si promotion */
  originalPrice?: number | null;
  currency: string;
  image?: string | null;
  /** en stock / disponibilité */
  availability?: "in_stock" | "out_of_stock" | "unknown";
  /** label de disponibilité lisible */
  availabilityLabel?: string;
  /** badge promo / -X% */
  discount?: number | null;
}

export interface SiteSearchResult {
  site: SiteMeta;
  products: ProductResult[];
  status: "ok" | "error" | "empty";
  /** message d'erreur (inclut la catégorie via ScraperError.toLogString()) */
  error?: string;
  /** temps de réponse en ms */
  durationMs?: number;
}

export interface AggregatedSearchResponse {
  query: string;
  totalProducts: number;
  results: SiteSearchResult[];
  durationMs: number;
  /** indique si au moins un site a répondu avec des produits */
  anySuccess: boolean;
}

/** Declared capabilities so the registry doesn't need hard-coded sets. */
export interface ScraperCapabilities {
  /** Uses Playwright (Chromium headless) for search or enrichment */
  usesPlaywright?: boolean;
  /** Site is behind a challenge (Cloudflare, Turnstile, etc.) — gets longer timeout */
  challenge?: boolean;
  /** Needs a headed (non-headless) browser — not supported in sandbox */
  needsHeaded?: boolean;
  /** Search engine type for documentation + future engine reuse */
  engine?: "algolia" | "doofinder" | "graphql" | "html" | "playwright" | "rest" | "custom";
  /** Query relevance filtering:
   *  - "strict" (default for cycling shops): after scraping, drop products whose
   *    title doesn't contain at least one token from the user's query. Prevents
   *    ProBikeShop returning cycling gear when searching for "Atomic Hawx" ski boots.
   *  - "loose": keep all products returned by the shop's search (trust the shop).
   *  If undefined, defaults to "loose" for backward compatibility.
   */
  relevance?: "strict" | "loose";
}

export interface Scraper {
  site: SiteMeta;
  /** Declared capabilities — registry reads these instead of hard-coded sets */
  capabilities?: ScraperCapabilities;
  search(query: string, signal?: AbortSignal): Promise<ProductResult[]>;
  /** Optional site-specific enrichment override (falls back to global enrich.ts) */
  enrich?(product: ProductResult, signal?: AbortSignal): Promise<ProductMetadata>;
}

// ---------------------------------------------------------------------------
// Workflow enrichi : matching cross-site + métadonnées
// ---------------------------------------------------------------------------

/** Métadonnées structurées extraites de la page produit */
export interface ProductMetadata {
  brand?: string;
  /** catégorie principale (ex: Ski de rando) */
  category?: string;
  /** sous-catégorie (ex: Skis) */
  subcategory?: string;
  /** sport/activité (ex: Randonnée à ski, Alpinisme, Trail) */
  sport?: string;
  /** gamme/usage (ex: Competition, Loisir, Performance) */
  range?: string;
  gender?: string;
  color?: string[];
  sizes?: string[];
  weight?: string;
  weightGrams?: number;
  material?: string;
  ean?: string;
  gtin?: string;
  sku?: string;
  mpn?: string; // manufacturer part number
  /** année/modèle (ex: 2024) */
  modelYear?: string;
  rating?: number;
  reviewCount?: number;
  /** specs génériques clé/valeur extraites du tableau technique */
  attributes?: Record<string, string>;
}

/** Une offre = un produit vendu par un site donné */
export interface ProductOffer {
  site: SiteId;
  siteName: string;
  url: string;
  title: string;
  price: number | null;
  originalPrice?: number | null;
  currency: string;
  image?: string | null;
  availability?: "in_stock" | "out_of_stock" | "unknown";
  availabilityLabel?: string;
  discount?: number | null;
  /** Couleurs spécifiques à cette offre (cosmetic variants) — ex: ["Rouge", "Bleu"] */
  color?: string[];
  /** Tailles spécifiques à cette offre */
  sizes?: string[];
  /** EAN de cette offre (utile pour afficher l'identifiant du coloris) */
  ean?: string;
}

/** Un produit logique = groupe d'offres cross-site matchées */
export interface MatchedProduct {
  /** id stable généré depuis la clé de matching */
  id: string;
  /** titre canonique (le plus descriptif du groupe) */
  title: string;
  brand?: string;
  category?: string;
  subcategory?: string;
  sport?: string;
  range?: string;
  image?: string | null;
  metadata: ProductMetadata;
  offers: ProductOffer[];
  // --- champs calculés pour l'UI ---
  minPrice: number | null;
  maxPrice: number | null;
  /** devise du prix min (les offres EUR/CHF ne sont pas comparables directement) */
  minCurrency: string;
  bestOffer?: ProductOffer;
  /** économie potentielle max - min dans le groupe (même devise seulement) */
  savings?: number | null;
  /** nombre de sites distincts proposant ce produit */
  siteCount: number;
  /** score de matching moyen (debug) */
  matchScore?: number;
  /** critères qui ont déclenché le match (debug) */
  matchReason?: string;
}

export interface AggregatedMatchResponse {
  query: string;
  totalProducts: number;
  products: MatchedProduct[];
  /** filtres dynamiques dérivés des métadonnées extraites */
  filters: DynamicFilters;
  durationMs: number;
  /** temps passé dans chaque étape du workflow (debug/perf) */
  phases: {
    searchMs: number;
    enrichMs: number;
    matchMs: number;
  };
  anySuccess: boolean;
  demo?: boolean;
}

export interface DynamicFilters {
  brands: { value: string; count: number }[];
  categories: { value: string; count: number }[];
  subcategories: { value: string; count: number }[];
  sports: { value: string; count: number }[];
  ranges: { value: string; count: number }[];
  genders: { value: string; count: number }[];
  colors: { value: string; count: number }[];
  sizes: { value: string; count: number }[];
  /** attributs techniques génériques (poids, matière, etc.) */
  attributes: { key: string; values: { value: string; count: number }[] }[];
  /** fourchette de prix observée (pour calibration UI) */
  priceRange?: { min: number; max: number; currency: string };
}


// ---------------------------------------------------------------------------
// SITES — client-safe metadata registry
// ---------------------------------------------------------------------------
// This record contains ONLY the metadata needed by the UI (id, name, country,
// currency, accent). It does NOT import any scraper code, so it's safe to
// import from client components (no Node-only deps like axios or playwright
// get pulled in).
//
// The full SiteMeta (with `groups` and the scraper function) lives in each
// `sites/<shop>.ts` file. To add a new shop:
//   1. Drop `sites/<shop>.ts` (exports `site: SiteMeta` + `scraper: Scraper`)
//   2. Add 1 import line to `sites/index.ts`
//   3. Add 1 entry to SITES below (7 lines: id, name, baseUrl, country, currency, accent, groups)
//
// The `groups` field here is the source of truth for group membership.
// `groups.ts` reads this to build the builtin groups.
export const SITES: Record<string, SiteMeta> = {
  bergzeit: {
    id: "bergzeit",
    name: "Bergzeit",
    baseUrl: "https://www.bergzeit.fr",
    country: "FR",
    currency: "EUR",
    accent: "bg-lime-100 text-lime-800 border-lime-200",
    groups: ["outdoor"],
  },
  ekosport: {
    id: "ekosport",
    name: "Ekosport",
    baseUrl: "https://www.ekosport.fr",
    country: "FR",
    currency: "EUR",
    accent: "bg-blue-100 text-blue-800 border-blue-200",
    groups: ["outdoor"],
  },
  glisshop: {
    id: "glisshop",
    name: "Glisshop",
    baseUrl: "https://www.glisshop.com",
    country: "FR",
    currency: "EUR",
    accent: "bg-cyan-100 text-cyan-800 border-cyan-200",
    groups: ["outdoor"],
  },
  montaz: {
    id: "montaz",
    name: "Montaz",
    baseUrl: "https://www.montaz.com",
    country: "FR",
    currency: "EUR",
    accent: "bg-orange-100 text-orange-800 border-orange-200",
    groups: ["outdoor"],
  },
  snowleader: {
    id: "snowleader",
    name: "Snowleader",
    baseUrl: "https://www.snowleader.com",
    country: "FR",
    currency: "EUR",
    accent: "bg-sky-100 text-sky-800 border-sky-200",
    groups: ["outdoor"],
  },
  sportbittl: {
    id: "sportbittl",
    name: "Sport Bittl",
    baseUrl: "https://www.sport-bittl.com",
    country: "DE",
    currency: "EUR",
    accent: "bg-red-100 text-red-800 border-red-200",
    groups: ["outdoor"],
  },
  sportconrad: {
    id: "sportconrad",
    name: "Sport Conrad",
    baseUrl: "https://www.sport-conrad.com",
    country: "DE",
    currency: "EUR",
    accent: "bg-purple-100 text-purple-800 border-purple-200",
    groups: ["outdoor"],
  },
  tradeinn: {
    id: "tradeinn",
    name: "Tradeinn",
    baseUrl: "https://www.tradeinn.com",
    country: "ES",
    currency: "EUR",
    accent: "bg-green-100 text-green-800 border-green-200",
    groups: ["outdoor"],
  },
  auvieuxcampeur: {
    id: "auvieuxcampeur",
    name: "Au Vieux Campeur",
    baseUrl: "https://www.auvieuxcampeur.com",
    country: "FR",
    currency: "EUR",
    accent: "bg-yellow-100 text-yellow-800 border-yellow-200",
    groups: ["outdoor"],
  },
  barrabes: {
    id: "barrabes",
    name: "Barrabes",
    baseUrl: "https://www.barrabes.com",
    country: "ES",
    currency: "EUR",
    accent: "bg-red-100 text-red-800 border-red-200",
    groups: ["outdoor"],
  },
  probikeshop: {
    id: "probikeshop",
    name: "ProBikeShop",
    baseUrl: "https://probikeshop.fr",
    country: "FR",
    currency: "EUR",
    accent: "bg-cyan-100 text-cyan-800 border-cyan-200",
    groups: ["cycling"],
  },
  alltricks: {
    id: "alltricks",
    name: "Alltricks",
    baseUrl: "https://www.alltricks.fr",
    country: "FR",
    currency: "EUR",
    accent: "bg-orange-100 text-orange-800 border-orange-200",
    groups: ["cycling"],
  },
  telemarkpyrenees: {
    id: "telemarkpyrenees",
    name: "Telemark Pyrenees",
    baseUrl: "https://www.telemark-pyrenees.com",
    country: "FR",
    currency: "EUR",
    accent: "bg-indigo-100 text-indigo-800 border-indigo-200",
    groups: ["outdoor"],
  },
  sportokay: {
    id: "sportokay",
    name: "Sportokay",
    baseUrl: "https://www.sportokay.com",
    country: "DE",
    currency: "EUR",
    accent: "bg-teal-100 text-teal-800 border-teal-200",
    groups: ["outdoor"],
  },
  bergfreunde: {
    id: "bergfreunde",
    name: "Bergfreunde",
    baseUrl: "https://www.bergfreunde.fr",
    country: "FR",
    currency: "EUR",
    accent: "bg-emerald-100 text-emerald-800 border-emerald-200",
    groups: ["outdoor"],
  },
  hardloop: {
    id: "hardloop",
    name: "Hardloop",
    baseUrl: "https://www.hardloop.fr",
    country: "FR",
    currency: "EUR",
    accent: "bg-stone-100 text-stone-800 border-stone-200",
    groups: ["outdoor"],
  },
  oliunid: {
    id: "oliunid",
    name: "Oliunid",
    baseUrl: "https://www.oliunid.com",
    country: "FR",
    currency: "EUR",
    accent: "bg-amber-100 text-amber-800 border-amber-200",
    groups: ["outdoor"],
  },
  varuste: {
    id: "varuste",
    name: "Varuste",
    baseUrl: "https://www.varuste.net",
    country: "FI",
    currency: "EUR",
    accent: "bg-slate-100 text-slate-800 border-slate-200",
    groups: ["outdoor"],
  },
  deporvillage: {
    id: "deporvillage",
    name: "DeporVillage",
    baseUrl: "https://www.deporvillage.fr",
    country: "FR",
    currency: "EUR",
    accent: "bg-violet-100 text-violet-800 border-violet-200",
    groups: ["outdoor", "cycling"],
  },
  all4cycling: {
    id: "all4cycling",
    name: "All4cycling",
    baseUrl: "https://www.all4cycling.com",
    country: "FR",
    currency: "EUR",
    accent: "bg-pink-100 text-pink-800 border-pink-200",
    groups: ["cycling"],
  },
  bike24: {
    id: "bike24",
    name: "Bike24",
    baseUrl: "https://www.bike24.com",
    country: "DE",
    currency: "EUR",
    accent: "bg-teal-100 text-teal-800 border-teal-200",
    groups: ["cycling"],
  },
  bikediscount: {
    id: "bikediscount",
    name: "Bike-Discount",
    baseUrl: "https://www.bike-discount.de",
    country: "DE",
    currency: "EUR",
    accent: "bg-orange-100 text-orange-800 border-orange-200",
    groups: ["cycling"],
  },
};

// ---------------------------------------------------------------------------
// Groupes de boutiques
// ---------------------------------------------------------------------------
// Un groupe est un ensemble de SiteId (avec chevauchement possible entre
// groupes). Les groupes par défaut sont fournis (outdoor=9 sites actuels,
// cycling et IT vides — l'utilisateur ajoutera les boutiques au fur et à
// mesure qu'il installe leurs plugins). Les groupes personnalisés sont
// persistés dans localStorage côté client.
// ---------------------------------------------------------------------------

export interface ShopGroup {
  id: string;
  name: string;
  description?: string;
  /** Emoji ou code tailwind pour l'icône (affiché dans l'UI) */
  icon?: string;
  /** Couleur tailwind pour le badge */
  accent?: string;
  /** Liste des SiteId appartenant à ce groupe */
  sites: SiteId[];
  /** true si c'est un groupe prédéfini (non éditable côté client) */
  builtin?: boolean;
}

/** IDs de groupes réservés (ne pas utiliser pour des groupes utilisateur). */
export const BUILTIN_GROUP_IDS = ["all", "outdoor", "cycling", "it"] as const;
export type BuiltinGroupId = (typeof BUILTIN_GROUP_IDS)[number];
