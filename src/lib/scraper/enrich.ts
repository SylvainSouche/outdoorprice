// Enrichissement : récupère la page produit et extrait les métadonnées structurées.
//
// Sources d'extraction (par ordre de fiabilité) :
//  1. JSON-LD <script type="application/ld+json"> avec @type Product
//  2. Microdata HTML5 : [itemtype*="schema.org/Product"] + itemprop
//  3. Open Graph / meta tags : og:brand, product:brand, etc.
//  4. Sélecteurs génériques communs : tableau specs, déclinaisons couleur/taille
//
// Toute extraction est tolérante : si une source échoue, on tente la suivante.
import * as cheerio from "cheerio";
import { fetchHtml, absUrl } from "./http";
import type { ProductMetadata, ProductResult, SiteId } from "./types";
import { SITES } from "./types";
import { classifyTaxonomy } from "./taxonomy";

/** Limite de produit à enrichir par site (perf : éviter 200+ fetchs). */
export const ENRICH_TOP_N_PER_SITE = 6;

interface JsonLdProduct {
  "@type"?: string | string[];
  name?: string;
  brand?: { name?: string } | string;
  category?: string;
  color?: string;
  size?: string;
  sku?: string;
  gtin?: string;
  gtin13?: string;
  gtin12?: string;
  ean?: string;
  mpn?: string;
  weight?: string | { value?: string; unitCode?: string };
  material?: string;
  aggregateRating?: { ratingValue?: string | number; reviewCount?: string | number };
  offers?: any;
  [k: string]: any;
}

function asString(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "string") return v.trim() || undefined;
  if (typeof v === "number") return String(v);
  if (typeof v === "object" && v !== null && "name" in v) {
    return asString((v as any).name);
  }
  return String(v).trim() || undefined;
}

function extractJsonLdProducts($: cheerio.CheerioAPI): JsonLdProduct[] {
  const out: JsonLdProduct[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text().trim();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      const candidates: any[] = Array.isArray(parsed) ? parsed : [parsed];
      for (const c of candidates) {
        // graph de @graph
        if (c && typeof c === "object" && Array.isArray(c["@graph"])) {
          candidates.push(...c["@graph"]);
        }
        const t = c && c["@type"];
        const types = Array.isArray(t) ? t : [t];
        if (types.some((x) => String(x).toLowerCase().includes("product"))) {
          out.push(c as JsonLdProduct);
        }
      }
    } catch {
      // JSON-LD cassé : on ignore
    }
  });
  return out;
}

function extractMicrodata($: cheerio.CheerioAPI): Record<string, string> {
  const out: Record<string, string> = {};
  const scope = $('[itemtype*="schema.org/Product"], [itemtype*="schema.org/Offer"]').first();
  if (!scope.length) return out;
  scope.find("[itemprop]").each((_, el) => {
    const $el = $(el);
    const prop = $el.attr("itemprop");
    if (!prop) return;
    if (out[prop]) return;
    const val =
      $el.attr("content") ||
      $el.attr("href") ||
      $el.find('[itemprop="name"], .value').first().text() ||
      $el.text();
    const cleaned = (val || "").trim();
    if (cleaned) out[prop] = cleaned;
  });
  return out;
}

function extractMetaTags($: cheerio.CheerioAPI): Record<string, string> {
  const out: Record<string, string> = {};
  const picks: Record<string, string> = {
    brand: 'meta[property="og:brand"], meta[property="product:brand"], meta[name="brand"], meta[name="twitter:brand"]',
    category: 'meta[property="product:category"], meta[name="category"]',
    gtin: 'meta[property="product:gtin"], meta[name="gtin"]',
    ean: 'meta[name="ean"]',
    sku: 'meta[property="product:sku"], meta[name="sku"]',
    mpn: 'meta[property="product:mpn"], meta[name="mpn"]',
    color: 'meta[property="product:color"], meta[name="color"]',
    material: 'meta[property="product:material"], meta[name="material"]',
    rating: 'meta[property="product:rating:value"], meta[name="rating"]',
    reviewCount: 'meta[property="product:rating:count"], meta[name="review_count"]',
  };
  for (const [k, sel] of Object.entries(picks)) {
    const v = $(sel).first().attr("content");
    if (v && v.trim()) out[k] = v.trim();
  }
  return out;
}

/** Tableau technique générique : paires clé/valeur dans les listes dl/dt/dd, table tr td, etc. */
function extractSpecsTable($: cheerio.CheerioAPI): Record<string, string> {
  const out: Record<string, string> = {};
  // <dl><dt>K</dt><dd>V</dd></dl>
  $("dl dt").each((_, dt) => {
    const $dt = $(dt);
    const k = $dt.text().trim().replace(/:$/, "");
    const v = $dt.next("dd").text().trim();
    if (k && v && !out[k]) out[k] = v;
  });
  // table tr > td*2
  $("table tr, .specs tr, .product-features tr, .technical-data tr").each((_, tr) => {
    const $tr = $(tr);
    const tds = $tr.find("td, th");
    if (tds.length >= 2) {
      const k = $(tds[0]).text().trim().replace(/:$/, "");
      const v = $(tds[1]).text().trim();
      if (k && v && !out[k]) out[k] = v;
    }
  });
  // listes .feature / .spec génériques
  $(".product-features li, .specs li, .features li, .product-attributes li").each((_, li) => {
    const txt = $(li).text().trim();
    const m = txt.match(/^([A-Za-zÀ-ÿ][\w\s/+-]{1,40})\s*[:：]\s*(.+)$/);
    if (m) {
      const k = m[1].trim();
      const v = m[2].trim();
      if (k && v && !out[k]) out[k] = v;
    }
  });
  return out;
}

/** Breadcrumb / fil d'ariane : source riche de catégorie/sous-catégorie/sport. */
function extractBreadcrumb($: cheerio.CheerioAPI): string[] {
  const crumbs: string[] = [];
  // Microdata breadcrumb
  $('[itemtype*="schema.org/BreadcrumbList"] [itemprop="itemListElement"]').each((_, el) => {
    const name = $(el).find('[itemprop="name"]').first().text().trim();
    if (name) crumbs.push(name);
  });
  if (crumbs.length === 0) {
    // Breadcrumb générique
    $(
      '.breadcrumb li, .breadcrumbs li, nav[aria-label*="breadcrumb" i] li, .breadcrumb a, .breadcrumbs a'
    ).each((_, el) => {
      const name = $(el).text().trim();
      if (name && name.length < 60 && !crumbs.includes(name)) crumbs.push(name);
    });
  }
  return crumbs;
}

/** Extrait une année-modèle depuis le titre ou les specs (ex: 2024, Édition 2023). */
function extractModelYear(title: string, specs: Record<string, string>): string | undefined {
  const m = title.match(/\b(20\d{2})\b/);
  if (m) return m[1];
  for (const [k, v] of Object.entries(specs)) {
    const kl = k.toLowerCase();
    if (kl.includes("annee") || kl.includes("year") || kl.includes("modèle") || kl.includes("model")) {
      const m2 = String(v).match(/\b(20\d{2})\b/);
      if (m2) return m2[1];
    }
  }
  return undefined;
}

/** Parse un poids en grammes depuis une chaîne ("850 g", "1.2 kg", "850g", etc.). */
export function parseWeightGrams(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const s = raw.toLowerCase().replace(/\s+/g, "").replace(",", ".");
  let m = s.match(/(\d+(?:\.\d+)?)kg/);
  if (m) return Math.round(parseFloat(m[1]) * 1000);
  m = s.match(/(\d+(?:\.\d+)?)g\b/);
  if (m) return Math.round(parseFloat(m[1]));
  m = s.match(/(\d+(?:\.\d+)?)gr\b/);
  if (m) return Math.round(parseFloat(m[1]));
  return undefined;
}

// Mots connus comme désignant une couleur (FR + EN + outdoor colorways).
// On garde la première lettre majuscule pour l'affichage, et on compare
// insensible à la casse / accents / pluriels.
const COLOR_WORDS = new Set([
  // FR
  "noir", "blanc", "rouge", "bleu", "vert", "jaune", "orange", "violet",
  "gris", "rose", "marron", "beige", "kaki", "anthracite", "bordeaux",
  "turquoise", "creme", "ivoire", "sable", "corail", "argile",
  // EN
  "black", "white", "red", "blue", "green", "yellow", "purple", "pink",
  "brown", "navy", "teal", "olive", "gold", "silver", "copper", "bronze",
  "grey", "gray",
  // Outdoor / Dynafit / Salomon colorway names
  "fluo", "fluorescent", "neon", "out", "balsam", "cinder", "alabama",
  "overcast", "cabana", "storm", "sunset", "sand", "ash", "fire",
  "crimson", "amber", "graphite", "slate", "moss", "lagoon", "aqua",
  "mint", "lime", "coralred", "rust",
]);

/** Normalise pour comparaison (casse, accents, pluriels simples). */
function canon(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/s$/, "");
}

/** Capitalise proprement ("noir" → "Noir", "bleu" → "Bleu"). */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** Extrait les couleurs depuis un titre produit.
 *  Patterns reconnus :
 *    - « /<coloris> » ou « /<color1> <color2> » suffixe (Montaz)
 *    - « <color1> <color2> » après le dernier token « / »
 *    - « couleur : <...> » explicite
 *
 *  On retourne chaque mot de couleur distinct, capitalisé, dédupliqué.
 *  On n'ajoute PAS les mots non reconnus (ex: « backpack », « dynafit »). */
export function extractColorsFromTitle(title: string | undefined): string[] {
  if (!title) return [];
  const found: string[] = [];
  const seen = new Set<string>();

  // 1) Pattern « /<suffix> » (souvent un coloris composé)
  //    ex: « Dynafit Radical 24 Backpack /noir out » → "noir", "out"
  const slashMatch = title.match(/\/([^/]+)$/);
  if (slashMatch) {
    const suffix = slashMatch[1].trim();
    // Prend chaque mot du suffixe et garde ceux qui sont des couleurs connues
    for (const word of suffix.split(/[\s\-_,.;:|·()'"’°]+/)) {
      const w = word.trim();
      if (!w) continue;
      const c = canon(w);
      if (COLOR_WORDS.has(c) && !seen.has(c)) {
        seen.add(c);
        found.push(capitalize(w));
      }
    }
  }

  // 2) Pattern « couleur : <...> » ou « color : <...> »
  const colorColon = title.match(/(?:couleur|color)\s*[:=]\s*([^,;|]+)/i);
  if (colorColon) {
    for (const word of colorColon[1].trim().split(/[\s\-_,.;:|·()'"’°]+/)) {
      const w = word.trim();
      if (!w) continue;
      const c = canon(w);
      if (COLOR_WORDS.has(c) && !seen.has(c)) {
        seen.add(c);
        found.push(capitalize(w));
      }
    }
  }

  // 3) Scan global : tous les mots qui sont des couleurs connues
  //    (utile quand il n'y a pas de « / » — ex: « Dynafit Radical Bleu »)
  if (found.length === 0) {
    const words = title.split(/[\s\-_,.;:|·()'"’°/]+/);
    for (const word of words) {
      const w = word.trim();
      if (!w || w.length < 3) continue;
      const c = canon(w);
      if (COLOR_WORDS.has(c) && !seen.has(c)) {
        seen.add(c);
        found.push(capitalize(w));
      }
    }
  }

  return found.slice(0, 6);
}

/** Déclinaisons couleur / taille visibles dans la page (selectors de variation). */
function extractVariations($: cheerio.CheerioAPI): { colors: string[]; sizes: string[] } {
  const colors = new Set<string>();
  const sizes = new Set<string>();

  const colorSelectors = [
    '[data-color]', '[data-attribute="color"]',
    '.color-swatch, .swatch-color, .color-option, .product-color .option',
    'select[name*="color" i] option', 'select[name*="couleur" i] option',
    '[aria-label*="couleur" i]', '[aria-label*="color" i]',
  ];
  const sizeSelectors = [
    '[data-size]', '[data-attribute="size"]', '[data-attribute="taille"]',
    '.size-option, .product-size .option, .size-swatch',
    'select[name*="size" i] option', 'select[name*="taille" i] option',
    '[aria-label*="taille" i]', '[aria-label*="size" i]',
  ];

  $(colorSelectors.join(", ")).each((_, el) => {
    const $el = $(el);
    const v = ($el.attr("data-color") || $el.attr("title") || $el.attr("aria-label") || $el.text() || "")
      .trim()
      .split(/[\s,|·-]+/)[0];
    if (v && v.length >= 2 && v.length <= 30) colors.add(v);
  });
  $(sizeSelectors.join(", ")).each((_, el) => {
    const $el = $(el);
    const v = ($el.attr("data-size") || $el.attr("title") || $el.attr("value") || $el.text() || "")
      .trim();
    if (v && v.length >= 1 && v.length <= 12) sizes.add(v);
  });

  return { colors: [...colors].slice(0, 12), sizes: [...sizes].slice(0, 20) };
}

/** Détection du genre à partir du titre/catégorie.
 *  Reconnaît FR, EN, DE. Les marqueurs standalone « W » et « M » (utilisés
 *  par Snowleader et d'autres) sont aussi reconnus via word boundary \b —
 *  ils ne matchent PAS à l'intérieur d'un mot comme « Mountain » ou « Pro ». */
function detectGender(text: string): string | undefined {
  const t = text.toLowerCase();
  // Order matters: check "unisexe/mixte" first to avoid being overridden by
  // "homme/femme" substring matches inside "unisex homme/femme" labels.
  if (/\b(unisexe|unisex|mixed|herren.?damen|damen.?herren|h\/f|f\/h)\b/.test(t)) return "Mixte";
  // Femme : FR + EN + DE + standalone W (utilisé par Snowleader, etc.)
  // Note: \bW\b matche seulement un W standalone (pas le W de "Mountain" ou "Wide").
  if (
    /\b(femme|women|woman|girl|dame|damen|w|weiblich)\b/.test(t) ||
    /women'?s/.test(t) ||
    /dames?/.test(t)
  ) return "Femme";
  // Homme : FR + EN + DE + standalone M
  if (
    /\b(homme|men|man|boy|monsieur|herren|m|mannlich)\b/.test(t) ||
    /men'?s/.test(t)
  ) return "Homme";
  if (/\b(enfant|kid|child|junior|boys|girls|kinder)\b/.test(t)) return "Enfant";
  return undefined;
}

function weightFromSpecs(specs: Record<string, string>): string | undefined {
  for (const [k, v] of Object.entries(specs)) {
    const kl = k.toLowerCase();
    if (kl.includes("poids") || kl.includes("weight") || kl.includes("gewicht")) {
      return v;
    }
  }
  return undefined;
}

function materialFromSpecs(specs: Record<string, string>): string | undefined {
  for (const [k, v] of Object.entries(specs)) {
    const kl = k.toLowerCase();
    if (kl.includes("mati") || kl.includes("material") || kl.includes("materialien")) {
      return v;
    }
  }
  return undefined;
}

function ratingNum(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function reviewNum(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === "number" ? v : parseInt(String(v).replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Enrichit un ProductResult en récupérant sa page produit.
 * En cas d'échec réseau/parsing, retourne quand même un objet partiel
 * (titre/URL connus), sans faire planter le workflow.
 */
export async function enrichProduct(p: ProductResult, signal?: AbortSignal): Promise<ProductMetadata> {
  const siteMeta = SITES[p.site as SiteId];
  const referer = siteMeta?.baseUrl;

  // Timeout for product page fetch. ProBikeShop and other Playwright-fallback
  // sites need more time (country modal dismissal + Cloudflare). Default 10s,
  // but 20s for known slow sites.
  const isSlowSite = p.site === "probikeshop" || p.site === "barrabes" || p.site === "alltricks";
  const fetchTimeoutMs = isSlowSite ? 20000 : 10000;

  let html = "";
  try {
    const res = await fetchHtml(p.url, { signal, referer, timeoutMs: fetchTimeoutMs });
    html = res.html;
  } catch {
    // On retourne des métadonnées minimales dérivées du titre de recherche
    return {
      brand: guessBrandFromTitle(p.title),
      gender: detectGender(p.title),
    };
  }

  const $ = cheerio.load(html);
  const jsonLd = extractJsonLdProducts($);
  const microdata = extractMicrodata($);
  const meta = extractMetaTags($);
  const specs = extractSpecsTable($);
  const breadcrumbs = extractBreadcrumb($);
  const { colors, sizes } = extractVariations($);

  // Couleur dérivée du titre : les sites comme Montaz suffixent le titre avec
  // « /<coloris> » (ex: « Dynafit Radical 24 Backpack /noir out »).
  // On extrait les mots connus comme couleurs, pour ne pas récupérer « backpack ».
  const titleColors = extractColorsFromTitle(p.title);
  for (const c of titleColors) colors.push(c);

  // Fusion par priorité : JSON-LD > microdata > meta > specs
  const ld = jsonLd[0] || {};
  const brand =
    asString(ld.brand) ||
    microdata.brand ||
    meta.brand ||
    guessBrandFromTitle(p.title);
  const rawCategory =
    asString(ld.category) ||
    microdata.category ||
    meta.category ||
    undefined;
  const ean = ld.ean || ld.gtin13 || ld.gtin12 || microdata.ean || meta.ean || undefined;
  const gtin = ld.gtin || microdata.gtin || meta.gtin || undefined;
  const sku = ld.sku || microdata.sku || meta.sku || undefined;
  const mpn = ld.mpn || microdata.mpn || meta.mpn || undefined;
  const color = ld.color || microdata.color || meta.color || undefined;
  if (color && colors.length === 0) colors.push(String(color));
  const ldWeight = ld.weight
    ? typeof ld.weight === "string"
      ? ld.weight
      : `${ld.weight.value ?? ""} ${ld.weight.unitCode ?? ""}`.trim()
    : undefined;
  const weight = ldWeight || weightFromSpecs(specs);
  const weightGrams = parseWeightGrams(weight);
  const material = materialFromSpecs(specs) || asString(ld.material) || meta.material;
  const rating = ratingNum(ld.aggregateRating?.ratingValue || microdata.rating || meta.rating);
  const reviewCount = reviewNum(ld.aggregateRating?.reviewCount || microdata.reviewCount || meta.reviewCount);
  const modelYear = extractModelYear(p.title, specs);

  // Taxonomie normalisée depuis catégorie brute + breadcrumb + titre
  const taxonomy = classifyTaxonomy(rawCategory, breadcrumbs.join(" / "), p.title);
  const category = taxonomy.category || rawCategory;
  const subcategory = taxonomy.subcategory;
  const sport = taxonomy.sport;
  const range = taxonomy.range;

  // Attributs techniques : tout sauf les clés déjà mappées
  const reservedKeys = new Set(
    ["brand", "category", "subcategory", "sport", "range", "color", "ean", "gtin", "sku", "mpn",
     "weight", "material", "rating", "reviewcount", "gender", "modelyear", "annee", "year"]
      .map((k) => k.toLowerCase())
  );
  const attributes: Record<string, string> = {};
  for (const [k, v] of Object.entries(specs)) {
    const kl = k.toLowerCase();
    if (reservedKeys.has(kl)) continue;
    if (kl.length > 40) continue;
    attributes[k] = v;
  }

  return {
    brand,
    category,
    subcategory,
    sport,
    range,
    gender: detectGender(`${p.title} ${rawCategory ?? ""}`),
    color: colors.length ? colors : color ? [String(color)] : undefined,
    sizes: sizes.length ? sizes : undefined,
    weight,
    weightGrams,
    material,
    ean: ean ? String(ean) : undefined,
    gtin: gtin ? String(gtin) : undefined,
    sku: sku ? String(sku) : undefined,
    mpn: mpn ? String(mpn) : undefined,
    modelYear,
    rating,
    reviewCount,
    attributes: Object.keys(attributes).length ? attributes : undefined,
  };
}

/** Devine la marque depuis le titre : 1er token en majuscule qui ressemble à une marque outdoor connue. */
const KNOWN_BRANDS = [
  "Dynafit", "Scarpa", "Salomon", "Black Diamond", "Arc'teryx", "Patagonia", "Petzl",
  "La Sportiva", "Mammut", "Salewa", "Atomic", "Fischer", "Rossignol", "Head",
  "Dynastar", "Movement", "Voile", "G3", "Hagan", "Skitrab", " ATK", "Plum",
  "Marker", "Tyrolia", "Look", "Pomoca", "Contour", "Colltex", "Simond",
  "Decathlon", "Forclaz", "Quechua", "Wedze", "Btwin", "Kalenji",
  "Ortovox", "Deuter", "Osprey", "Gregory", "Vaude", "Lowe Alpine",
  "Mountain Equipment", "Rab", "The North Face", "Millet", "Eider",
  "Picture", "Burton", "Capita", "Jones", "Lib Tech", "Ride", "Nitro",
  "Oakley", "Smith", "POC", "Anon", "Bollé", "Cébé",
  "Garmin", "Suunto", "Polar", "Coros", "Wahoo",
  // Trail running / sneakers
  "Hoka", "HOKA", "Brooks", "Saucony", "On", "Altra", "Topo Athletic", "Inov-8",
  "Vibram", "Merrell", "Asics", "Nike", "Adidas", "New Balance", "Reebok",
  // Casual / lifestyle outdoor
  "Fjällräven", "Fjallraven", "Prana", "PrAna", "Cotopaxi", "Stanley",
  // Mountaineering hardware
  // "Black" alone is NOT a brand (false positives in "Black/Outer Orbit" etc.)
  // — only "Black Diamond" is.
  "Grivel", "Camp", "CAMP", "Cassin", "BlueWater", "Mammut",
  "Beal", "Edelrid", "Sterling", "Metolius", "DMM", "Wild Country",
  // Ski / snowboard apparel
  "686", "Volcom", "DC", "ThirtyTwo", "Northwave", "Drake", "Flow",
  // Other outdoor
  "Lowa", "Hanwag", "Meindl", "Lowa", "AKU", "Salewa", "Garmont", "Crispi",
  "Rossignol", "Blizzard", "K2", "Nordica", "Tecnica", "Dalbello", "Elan",
  "Kastle", "Stockli", "Völkl", "Volkl", "Line", "Armada", "Faction",
  // Cycling apparel & accessories (try FIRST — Castelli/Sportful/Rapha are
  // more common than the "Giro" helmet brand in cycling jerseys)
  "Castelli", "CASTELLI", "Sportful", "SPORTFUL", "Rapha", "RAPHA", "Assos", "ASSOS",
  "Maap", "MAAP", "Bianchi", "BIANCHI", "Pinarello", "PINARELLO", "Cervélo", "Cervelo",
  "Specialized", "SPECIALIZED", "Trek", "TREK", "Giant", "GIANT", "Merida", "MERIDA",
  "Cannondale", "CANNONDALE", "Scott", "SCOTT", "BMC", "Orbea", "ORBEA",
  "Shimano", "SHIMANO", "SRAM", "Campagnolo", "CAMPAGNOLO", "Rotor", "ROTOR",
  "FSA", "Vision", "Zipp", "ZIPP", "Enve", "ENVE", "Campy", "Epic", "EPIC",
  "Selle Italia", "Selle Royal", "Brooks England", "Pro", "PRO", "Syncros", "SYNCROS",
  "Continental", "CONTINENTAL", "Michelin", "MICHELIN", "Pirelli", "PIRELLI",
  "Vittoria", "VITTORIA", "Tufo", "TUFO", "Challenge", "CHALLENGE",
  "Garmin", "Wahoo", "Stages", "STAGES", "4iiii", "Pioneer", "PIONEER",
  // Cycling shoes & helmets (Giro helmets is HERE, after the apparel brands)
  "Sidi", "SIDI", "Gaerne", "GAERNE", "Northwave", "NORTHWAVE", "Fizik", "FIZIK",
  "Bontrager", "BONTRAGER", "Giro", "GIRO", "Lazer", "LAZER", "Kask", "KASK",
  "Mavic", "MAVIC", " DT Swiss ", "Campagnolo", "Fulcrum", "FULCRUM",
  // Bike components
  "Fox", "FOX", "RockShox", "ROCKSHOX", "Ohlins", "Öhlins", "DVO", "Manitou", "MANITOU",
  "Magura", "MAGURA", "Hope", "HOPE", "Avid", "AVID", "TRP", "Shimano", "SRAM",
];

// Modèles outdoor connus et leur marque associée.
// Utilisé quand le titre ne contient pas la marque (ex: Snowleader omet « Hoka »
// du titre « Speedgoat 7 M Bay Leaf/Sea Glass »).
const MODEL_TO_BRAND: Record<string, string> = {
  // Hoka models
  "speedgoat": "Hoka",
  "clifton": "Hoka",
  "rincon": "Hoka",
  "bondi": "Hoka",
  "mach": "Hoka",
  "stinson": "Hoka",
  "arahi": "Hoka",
  "challenger": "Hoka",
  "rocket": "Hoka",
  "mafate": "Hoka",
  "tarantelle": "Hoka",
  "evo": "Hoka",
  "cascadia": "Brooks",
  // Salomon models
  "s/lab": "Salomon",
  "speedcross": "Salomon",
  "sense": "Salomon",
  "xon": "Salomon",
  // Dynafit models
  "radical": "Dynafit",
  "rotation": "Dynafit",
  "st": "Dynafit",
  "superlite": "Dynafit",
  "tlt": "Dynafit",
  "alpine": "Dynafit",
  // Scarpa models
  "f1": "Scarpa",
  "skimo": "Scarpa",
  "alien": "Scarpa",
  "maestrale": "Scarpa",
  "gea": "Scarpa",
  // Black Diamond models
  "helio": "Black Diamond",
  "vector": "Black Diamond",
  "megawatt": "Black Diamond",
};

export function guessBrandFromTitle(title: string): string | undefined {
  const t = title.toLowerCase();
  // 1. Cherche une marque connue directement dans le titre
  //    IMPORTANT : on utilise \b (word boundary) au lieu de .includes()
  //    pour éviter les faux positifs : « On » dans « connue », « DC » dans « dcore »,
  //    « K2 » dans « K200 » etc. ne doivent PAS matcher.
  for (const b of KNOWN_BRANDS) {
    const bl = b.toLowerCase().trim();
    if (!bl) continue;
    // Echappe les caractères spéciaux regex
    const escaped = bl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // \b nécessite qu'on soit entre un \w et un \W
    const re = new RegExp(`\\b${escaped}\\b`, "i");
    if (re.test(t)) return b.trim();
  }
  // 2. Si pas de marque trouvée, cherche un modèle connu et infère la marque
  const tokens = t.split(/[\s\-_,.;:|·/()'"’°]+/).filter(Boolean);
  for (const tok of tokens) {
    if (MODEL_TO_BRAND[tok]) return MODEL_TO_BRAND[tok];
  }
  // 3. Fallback : 1er mot capitalisé de 3+ lettres, en ignorant les mots qui
  //    sont en fait des catégories de produits en français (pas des marques).
  //    Sans ça, "Manchettes CASTELLI ESPRESSO Bordeaux" → "Manchettes" (faux).
  const NON_BRAND_WORDS = new Set([
    "Le", "La", "Les", "Des", "The", "Pour", "Avec", "De", "Du", "Et", "Or",
    // Catégories de produits FR qui apparaissent en début de titre
    "Manchettes", "Jambières", "Jambi", "Couvre", "Couvre-Chaussures",
    "Gants", "Maillot", "Cuissard", "Salopette", "Veste", "Pantalon",
    "Casque", "Casquette", "Chaussures", "Chaussettes", "Gourde",
    "Bidon", "Selle", "Guidon", "Cintre", "Pédale", "Pedale", "Pédales",
    "Roue", "Roues", "Pneu", "Pneus", "Chambre", "Dérailleur", "Derailleur",
    "Frein", "Freins", "Disque", "Disques", "Cassette", "Plateau", "Plateaux",
    "Chaîne", "Chaine", "Crank", "Jeu", "Direction", "Tige", "Tiges",
    "Sacoche", "Sacoches", "Sac", "Sacs", "Sac à dos", "Antivol", "Antivols",
    "Lampe", "Lampes", "Phare", "Phares", "Éclairage", "Eclairage",
    "Protège", "Protege", "Protège-Cadre", "Porte", "Porte-Bidon",
    "Support", "Supports", "Fixation", "Fixations", "Pompe", "Pompes",
    "Outillage", "Outil", "Outils", "Réparation", "Reparation",
    "Nutrition", "Boisson", "Boissons", "Gel", "Barre", "Barres",
    // Catégories outdoor
    "Skis", "Skins", "Peaux", "Chaussures", "Bâtons", "Batons", "Crampons",
    "Piolets", "Casques", "Harness", "Harnais", "Mousqueton", "Mousquetons",
    "Corde", "Cordes", "Baudrier", "Baudriers", "Descendeur", "Assureur",
    "Sac", "Sacs", "Saccoche", "Tente", "Tentes", "Matelas", "Duvet",
    "Réchaud", "Rechaud", "Popote", "Boussole", "Altitude",
    // Couleurs communes en FR
    "Noir", "Blanc", "Rouge", "Bleu", "Vert", "Jaune", "Orange", "Rose",
    "Gris", "Marron", "Beige", "Bordeaux", "Marine", "Turquoise", "Violet",
    // Adjectifs descriptifs
    "Homme", "Femme", "Mixte", "Junior", "Enfant", "Unisexe",
    "Court", "Courts", "Long", "Longs", "Court", "Court",
    "Imperméable", "Impermeable", "Respirant", "Respirants", "Léger", "Légers",
    // Contexte/usage
    "Route", "VTT", "Vélo", "Velo", "Gravel", "Cyclocross", "BMX", "Enduro",
    "Trail", "Running", "Fitness", "Urbain", "Ville", "Trekking", "Touring",
    "Compétition", "Competition", "Performance", "Loisir", "Pro", "Premium",
    // Années / collections
    "Giro", "Tour", "Vuelta", "World", "Cup", "Edition", "Collection",
  ]);
  const matches = title.match(/\b([A-Z][a-zA-Z'’-]{2,})\b/g) || [];
  for (const m of matches) {
    if (!NON_BRAND_WORDS.has(m)) return m;
  }
  return undefined;
}
