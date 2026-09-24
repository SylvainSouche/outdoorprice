// protocol-generator.js
// --------------------------------------------------------------------------
// Analyse les requêtes capturées et génère un protocol.md au format attendu
// par le projet outdoorprice (cf. PROTOCOLES.md).
//
// Catégorisation des requêtes :
//   - "search"   : POST/GET avec un paramètre qui ressemble à une requête
//                  utilisateur (q=, query=, search=, keyword=, palabras=),
//                  ou GraphQL avec "search" dans la query
//   - "product"  : URL qui ressemble à une page produit (contient /p/, /product/,
//                  /produit/, /detail/, un SKU, etc.) OU un appel API avec un
//                  identifiant produit dans l'URL
//   - "websocket" : connexion wss://
//   - "other"    : tout le reste (JS, CSS, images, fonts, analytics)
//
// Pour chaque requête "search" ou "product", on extrait :
//   - méthode HTTP, URL, Host
//   - Content-Type, corps de requête (form-encoded, JSON, GraphQL)
//   - Status, Content-Type et corps de réponse (50KB max)
//   - En-têtes notables (Store, X-Makaira-Instance, Authorization, Origin, Referer)
//   - **Un produit exemple complet** extrait du premier tableau d'items détecté
//     dans la réponse (le plus utile pour écrire un scraper — on voit tous
//     les champs disponibles, sans tronquer)
//   - **Le nombre total d'items** dans chaque tableau détecté (pagination)
// --------------------------------------------------------------------------

/** Catégorie de requête. */
export const CATEGORY = {
  SEARCH: "search",
  PRODUCT: "product",
  WEBSOCKET: "websocket",
  OTHER: "other",
};

// Limites d'affichage — généreuses pour permettre l'analyse complète
const LIMIT_RESPONSE_BODY = 50000;   // 50 KB (10× plus qu'avant)
const LIMIT_REQUEST_BODY  = 10000;  // 10 KB
const LIMIT_WS_FRAME      = 10000;  // 10 KB par frame WS
const LIMIT_WS_FRAMES_SHOWN = 15;   // 15 frames WS affichées
const LIMIT_FIELDS        = 50;     // 50 chemins de champs utiles
const LIMIT_SEARCH_ENDPOINTS = 5;
const LIMIT_PRODUCT_ENDPOINTS = 5;

/** Heuristique : la requête ressemble-t-elle à une recherche utilisateur ? */
function isSearchRequest(req) {
  const url = (req.url || "").toLowerCase();
  const method = (req.method || "GET").toUpperCase();
  const body = req.body || "";
  const contentType = (req.headers?.["content-type"] || "").toLowerCase();

  // GET avec un paramètre qui ressemble à une recherche — la voie la plus fiable
  // pour les boutiques SSR (Shopify, Magento, Shopware, etc.).
  // On couvre les variants q= / query= / search= / keyword= / palabras= / suche= / recherche=
  // + les routes /search / /recherche / /suche / /buscar explicites.
  const searchParams = ["q=", "query=", "search=", "searchTerm=", "keyword=", "keywords=", "palabras=", "suche=", "recherche=", "term="];
  if (method === "GET") {
    if (searchParams.some((p) => url.includes("?" + p) || url.includes("&" + p))) {
      return true;
    }
    // Routes de recherche : /search, /search-result, /recherche, /resultat-recherche,
    // /suche, /suchergebnis, /buscar (Shopify, Bike24, Magento, etc.)
    if (/\/(search(-result)?|recherche|resultat-recherche|suche|suchergebnis|buscar)(\?|\/|$)/i.test(url)) {
      return true;
    }
    // Shopify predictive search : /search/suggest?...&section_id=predictive-search
    if (/\/search\/suggest/i.test(url)) {
      return true;
    }
  }

  // POST form-encoded avec un champ de recherche
  if (method === "POST" && contentType.includes("x-www-form-urlencoded")) {
    const bodyLower = body.toLowerCase();
    if (searchParams.some((p) => bodyLower.includes(p))) return true;
  }

  // POST JSON (GraphQL ou REST) — il faut regarder À L'INTÉRIEUR du corps
  // pour déterminer si c'est vraiment une recherche. La présence d'une clé
  // "query" au top-level n'est PAS suffisante : c'est l'enveloppe standard
  // de GraphQL, présent dans TOUTES les requêtes GraphQL (cart, consent,
  // wishlist, etc.). Il faut inspecter le contenu de la query.
  if (method === "POST" && contentType.includes("json")) {
    try {
      const parsed = JSON.parse(body);

      // Cas 1 : REST JSON avec un champ search-like au top-level (pas GraphQL)
      // On vérifie que ce n'est PAS une enveloppe GraphQL (pas de clé "query"
      // dont la valeur est une string commençant par "query " ou "mutation ").
      const isGraphQLEnvelope = typeof parsed.query === "string"
        && /^\s*(query|mutation|subscription|fragment)\s+/i.test(parsed.query);
      if (!isGraphQLEnvelope) {
        const keys = Object.keys(parsed);
        const searchKeys = ["search", "q", "keyword", "keywords", "searchPhrase", "searchString", "palabras", "suche", "term", "text"];
        // NOTE : on n'inclut pas "query" ici — c'est trop générique et cause
        // des faux positifs sur toutes les API GraphQL de Shopify.
        if (keys.some((k) => searchKeys.includes(k.toLowerCase()))) return true;
        // Variables GraphQL (variables.search, variables.query avec valeur string)
        if (parsed.variables && typeof parsed.variables === "object") {
          const varKeys = Object.keys(parsed.variables);
          if (varKeys.some((k) => searchKeys.includes(k.toLowerCase()))) return true;
        }
      }

      // Cas 2 : GraphQL — chercher des noms d'opérations de recherche dans la
      // string de query. On évite ainsi de classer "GetSlideCartOffers" ou
      // "bannerQuery" comme des recherches.
      if (isGraphQLEnvelope) {
        const queryStr = parsed.query.toLowerCase();
        // Noms d'opérations / champs typiques des recherches e-commerce.
        // On cherche "search" ou "products" comme nom d'opération ou nom de champ,
        // mais pas "research" ou "searchresult" noyés dans un mot plus long.
        const searchOps = [
          /\bsearch\b/i,            // query searchProducts(...)
          /\bsearchproducts\b/i,
          /\bpredictivesearch\b/i,
          /\bproductsearch\b/i,
          /\bproducts\s*\(/i,      // query products(first: 10, query: "...")
          /\bsearch\b\s*\(/i,      // search(query: ...)
          /\bquery:\s*["']/i,       // query: "user input" (Shopify products query arg)
        ];
        // Exclure les queries qui parlent explicitement de panier, consentement,
        // wishlist, etc. — ce sont des faux positifs fréquents.
        const nonSearchOps = [
          /\bslidecartoffers\b/i,
          /\bconsentmanagement\b/i,
          /\bcart\b/i,
          /\bwishlist\b/i,
          /\bmetafield\b/i,  // la plupart des metafield queries ne sont pas des recherches
        ];
        const hasSearchOp = searchOps.some((re) => re.test(queryStr));
        const hasNonSearchOp = nonSearchOps.some((re) => re.test(queryStr));
        // Si on a un search op ET pas de non-search op, c'est une recherche.
        // Si on a les deux, c'est probablement une mutation cart avec un search
        // dedans — on ne classe pas.
        if (hasSearchOp && !hasNonSearchOp) return true;
      }
    } catch {
      // Pas du JSON valide, on ignore
    }
  }

  // URL contains /graphql + body contains "search" — fallback (was the old
  // behavior). Mais on a déjà traité le JSON POST ci-dessus avec plus de
  // précision, donc ce fallback ne s'active que pour les requêtes non-JSON.
  if (url.includes("/graphql") && url.includes("search")) return true;

  return false;
}

/** Heuristique : la requête ressemble-t-elle à un détail produit (page ou API) ? */
function isProductRequest(req) {
  const url = req.url || "";
  const urlLower = url.toLowerCase();
  const method = (req.method || "GET").toUpperCase();

  // Page produit HTML : URLs typiques
  const productPatterns = [
    /\/p\/[\w-]+/i,              // /p/ski-radical-1234
    /\/product\//i,
    /\/products\//i,             // Shopify : /products/<handle>
    /\/produit\//i,
    /\/produkte\//i,
    /\/producto\//i,
    /\/detalle\//i,
    /\/detail\//i,
    /\/item\//i,
    /\/dp\/[\w]+/i,              // Amazon-style /dp/ASIN
    /\/sku\//i,
    /-[a-z0-9]{6,}\.html/i,     // suffixe -SKU.html (Snowleader)
    /\?p=\d+/i,                  // ?p=123456 (Ekosport)
  ];
  if (method === "GET" && productPatterns.some((p) => p.test(urlLower))) {
    if (!isSearchRequest(req)) return true;
  }

  // API produit : POST/GET vers un endpoint avec un identifiant produit dans l'URL
  if (/\/api\/.*\/(product|item|detail|p)\//i.test(urlLower)) return true;

  return false;
}

/** Catégorise une requête. */
export function categorize(req) {
  if ((req.url || "").startsWith("ws://") || (req.url || "").startsWith("wss://")) {
    return CATEGORY.WEBSOCKET;
  }
  if (isSearchRequest(req)) return CATEGORY.SEARCH;
  if (isProductRequest(req)) return CATEGORY.PRODUCT;
  return CATEGORY.OTHER;
}

/** Extrait les en-têtes notables (ceux qui aident à comprendre le protocole). */
function extractNotableHeaders(headers) {
  if (!headers) return {};
  const notable = {};
  const interesting = [
    "content-type", "store", "x-makaira-instance", "authorization",
    "origin", "referer", "x-requested-with", "x-api-key", "x-algolia-api-key",
    "x-algolia-application-id", "accept", "user-agent", "cookie",
    "x-csrf-token", "x-shopware-context-token", "sw-context-token",
  ];
  for (const [k, v] of Object.entries(headers)) {
    const kl = k.toLowerCase();
    if (interesting.includes(kl)) {
      // Tronquer les cookies à 200 chars (sinon le doc devient illisible)
      if (kl === "cookie") {
        notable[kl] = (v || "").slice(0, 200) + (v && v.length > 200 ? " …" : "");
      } else {
        notable[kl] = v;
      }
    }
  }
  return notable;
}

/** Coupe une chaîne à n caractères en ajoutant "…" si coupée. */
function truncate(s, n = LIMIT_RESPONSE_BODY) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + ` …[truncated at ${n} chars, total ${s.length}]` : s;
}

/** Tente de parser un corps et renvoie un aperçu lisible.
 *  - JSON : pretty-print, limité à `limit` caractères (default 50KB)
 *  - HTML : tronqué à `limit` caractères (default 50KB) — c'est volontairement
 *    la même limite que JSON, car les boutiques Shopify/SSR servent les résultats
 *    de recherche en HTML, et le HTML contient les cartes produits qu'on doit
 *    voir pour écrire le scraper.
 *  - Form-encoded et autres : tronqué à min(limit, 5000) — rarement utile au-delà.
 */
function previewBody(body, contentType, limit = LIMIT_RESPONSE_BODY) {
  if (!body) return "";
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("json")) {
    try {
      const parsed = JSON.parse(body);
      // Pretty-print en limitant à `limit` caractères
      return JSON.stringify(parsed, null, 2).slice(0, limit);
    } catch {
      return truncate(body, limit);
    }
  }
  if (ct.includes("html")) {
    // HTML — on garde la même limite que JSON. Le HTML est souvent énorme
    // (1MB+ pour les pages de résultats), mais c'est précisément dans ce HTML
    // que se trouvent les cartes produits. On laisse l'utilisateur voir assez
    // de HTML pour identifier la structure, et l'extraction JSON-LD séparée
    // (cf. extractJsonLdFromHtml) fournit la version structurée.
    return truncate(body, limit);
  }
  if (ct.includes("x-www-form-urlencoded")) {
    return truncate(body, Math.min(limit, 5000));
  }
  return truncate(body, Math.min(limit, 5000));
}

/** Détecte des "champs utiles" dans une réponse JSON — renvoie la liste des
 *  chemins (ex: "data.items[].title", "prices.sale") qui ressemblent à des
 *  données produit. */
function detectUsefulFields(obj, prefix = "", depth = 0, results = []) {
  if (depth > 4 || !obj || typeof obj !== "object") return results;
  if (Array.isArray(obj)) {
    if (obj.length > 0 && typeof obj[0] === "object") {
      detectUsefulFields(obj[0], prefix + "[].", depth + 1, results);
    }
    return results;
  }
  const interestingKeys = [
    "title", "name", "price", "prices", "sale_price", "list_price", "regular_price",
    "final_price", "image", "images", "url", "url_key", "brand", "marque",
    "ean", "gtin", "gtin13", "sku", "mpn", "color", "couleur", "sizes",
    "configurable_options", "rating", "review_count", "bazaarvoice_rating",
    "availability", "stock", "in_stock", "discount", "old_price",
    "id", "product_id", "df_id", "link", "description", "categories",
    "currency", "compare_at_price", "handle", "variant_id",
  ];
  for (const [k, v] of Object.entries(obj)) {
    const kl = k.toLowerCase();
    const path = prefix + k;
    if (interestingKeys.includes(kl)) {
      results.push(path);
    }
    if (v && typeof v === "object") {
      detectUsefulFields(v, path + ".", depth + 1, results);
    }
  }
  return results;
}

/** Compte le nombre d'items dans chaque tableau détecté dans un objet JSON.
 *  Retourne [{path, count}, ...] — utile pour comprendre la pagination. */
function detectArrayCounts(obj, prefix = "", depth = 0, results = []) {
  if (depth > 4 || !obj || typeof obj !== "object") return results;
  if (Array.isArray(obj)) {
    if (obj.length > 0) {
      results.push({ path: prefix.replace(/\.$/, ""), count: obj.length });
    }
    if (obj.length > 0 && typeof obj[0] === "object") {
      detectArrayCounts(obj[0], prefix + "[].", depth + 1, results);
    }
    return results;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === "object") {
      detectArrayCounts(v, prefix + k + ".", depth + 1, results);
    }
  }
  return results;
}

/** Détecte si un objet ressemble à un produit e-commerce. */
function looksLikeProduct(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  const keys = Object.keys(obj).map((k) => k.toLowerCase());
  const productIndicators = [
    "title", "name", "price", "ean", "sku", "brand", "marque",
    "image", "images", "url", "link", "df_id",
  ];
  let score = 0;
  for (const ind of productIndicators) {
    if (keys.includes(ind)) score++;
  }
  return score >= 2;
}

/** Trouve le PREMIER tableau d'items dans un objet JSON et retourne le
 *  premier élément (sample product). C'est la donnée la plus utile pour
 *  écrire un scraper : on voit tous les champs disponibles, sans tronquer.
 *  Retourne { sample: objet, arrayPath: chemin, totalCount: N, allItems: tableau } ou null. */
function findFirstProductArray(obj, prefix = "", depth = 0) {
  if (depth > 5 || !obj || typeof obj !== "object") return null;
  if (Array.isArray(obj)) {
    // Heuristique : tableau contenant au moins un objet qui ressemble à un produit
    const productLike = obj.filter((o) => o && typeof o === "object" && looksLikeProduct(o));
    if (productLike.length > 0) {
      return {
        arrayPath: prefix.replace(/\.$/, "") || "(root)",
        totalCount: obj.length,
        productCount: productLike.length,
        sample: productLike[0],
        allItems: obj,
      };
    }
    // Sinon, on descend dans le premier élément
    if (obj.length > 0 && typeof obj[0] === "object") {
      const sub = findFirstProductArray(obj[0], prefix + "[].", depth + 1);
      if (sub) return sub;
    }
    return null;
  }
  // Objet : descendre dans chaque valeur
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === "object") {
      const sub = findFirstProductArray(v, prefix + k + ".", depth + 1);
      if (sub) return sub;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// HTML helpers — pour les boutiques SSR (Shopify, Magento, Shopware, etc.)
// qui servent les résultats de recherche en HTML plutôt qu'en JSON.
// ---------------------------------------------------------------------------

/** Extrait TOUS les blocs JSON-LD d'une page HTML.
 *  Retourne [{ script, parsed }] — parsed peut être un objet ou un tableau
 *  (cas Shopify : un seul <script> contient un tableau de Product/ItemList). */
function extractJsonLdFromHtml(html, maxBlocks = 5) {
  if (!html) return [];
  const results = [];
  // Match <script type="application/ld+json">...</script> — non-greedy, et
  // on tolère les espaces/attributs supplémentaires dans la balise ouvrante.
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  let count = 0;
  while ((m = re.exec(html)) !== null && count < maxBlocks) {
    const raw = m[1].trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      results.push({ script: raw.slice(0, 200), parsed });
      count++;
    } catch {
      // JSON-LD mal formé — on l'ignore (souvent causé par du templating
      // côté serveur qui n'a pas échappé correctement).
    }
  }
  return results;
}

/** Cherche dans les blocs JSON-LD un ItemList contenant des produits.
 *  Retourne [{ sample, totalCount }] pour chaque ItemList trouvé. */
function findItemListProducts(jsonLdBlocks) {
  const results = [];
  for (const block of jsonLdBlocks) {
    if (!block.parsed) continue;
    // Le JSON-LD peut être : un objet Product, un tableau [Product, ...],
    // un objet ItemList avec itemListElement: [ListItem → item: Product], etc.
    const candidates = Array.isArray(block.parsed) ? block.parsed : [block.parsed];
    for (const cand of candidates) {
      if (!cand || typeof cand !== "object") continue;
      // ItemList schema.org
      if (cand["@type"] === "ItemList" && Array.isArray(cand.itemListElement)) {
        const items = cand.itemListElement
          .map((e) => e?.item || e)
          .filter((it) => it && typeof it === "object" && looksLikeProduct(it));
        if (items.length > 0) {
          results.push({
            sample: items[0],
            totalCount: cand.itemListElement.length,
            productCount: items.length,
            arrayPath: "itemListElement[].item",
          });
        }
      }
      // Parfois c'est directement un tableau de Product
      if (Array.isArray(cand) && cand.length > 0 && looksLikeProduct(cand[0])) {
        const items = cand.filter((it) => looksLikeProduct(it));
        if (items.length > 0) {
          results.push({
            sample: items[0],
            totalCount: cand.length,
            productCount: items.length,
            arrayPath: "(root array)",
          });
        }
      }
    }
  }
  return results;
}

/** Extrait le premier bloc carte produit d'une page HTML Shopify/Magento/etc.
 *  Cherche d'abord les conteneurs connus (.card__info, .product-card, etc.)
 *  puis fallback sur le 1er <a href="/products/..."> en remontant au parent.
 *  Retourne un extrait HTML de la carte (limité à 5KB pour rester lisible).
 *
 *  IMPORTANT : on ne veut pas juste le <a> image (qui est souvent la 1ère
 *  correspondance) mais le conteneur qui regroupe image + titre + prix. Sinon
 *  on rate la structure DOM que le scraper doit réellement parser.
 */
function extractFirstProductCardHtml(html, maxLen = 5000) {
  if (!html) return null;

  // 1. Chercher d'abord les conteneurs carte connus par sélecteur de classe.
  //    On utilise une liste de patterns de classe — pas un parseur DOM complet,
  //    car on n'a pas accès à cheerio dans l'extension.
  const cardContainerPatterns = [
    // Shopify themes (All4cycling, etc.) — thème "Prestige" / "Impulse" / "Streamline"
    /<div[^>]*class=["'][^"']*\bcard__info\b[^"']*["'][^>]*>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/i,
    // Magnto 2 Luma / Hyva
    /<div[^>]*class=["'][^"']*\bproduct-item-info\b[^"']*["'][^>]*>[\s\S]*?<\/li>/i,
    // WooCommerce default
    /<li[^>]*class=["'][^"']*\bproduct\b[^"']*["'][^>]*>[\s\S]*?<\/li>/i,
    // Generic .product-card / .product-card-info
    /<(?:div|article|li)[^>]*class=["'][^"']*\bproduct-card(?:-info)?\b[^"']*["'][^>]*>[\s\S]*?<\/(?:div|article|li)>/i,
    // Generic .item / .card with /products/ link inside
    /<(?:div|article|li)[^>]*class=["'][^"']*\b(?:item|card)\b[^"']*["'][^>]*>[\s\S]*?\/(?:products|p|produit|producto)\/[\w-]+[\s\S]*?<\/(?:div|article|li)>/i,
  ];
  for (const re of cardContainerPatterns) {
    const m = html.match(re);
    if (m) {
      const card = m[0];
      // Sanity check : la carte doit contenir un prix (€ ou $ ou £ ou CHF)
      // et un titre (<h[1-6]> ou class contenant "title")
      const hasPrice = /[€$£]/.test(card) || /\bprice\b/i.test(card);
      const hasTitle = /<h[1-6]/i.test(card) || /\b(?:title|name)\b/i.test(card);
      if (hasPrice && hasTitle) {
        return card.length > maxLen ? card.slice(0, maxLen) + ` …[truncated at ${maxLen} chars, total ${card.length}]` : card;
      }
    }
  }

  // 2. Fallback : chercher un <a href="/products/..."> puis étendre à son
  //    conteneur parent probable. On prend les 2000 chars avant et 3000 après
  //    le match pour capturer le conteneur carte complet.
  const patterns = [
    /<a[^>]*href=["'][^"']*\/products\/[\w-]+[^"']*["'][^>]*>[\s\S]*?<\/a>/i,
    /<a[^>]*href=["'][^"']*\/p\/[\w-]+[^"']*["'][^>]*>[\s\S]*?<\/a>/i,
    /<a[^>]*href=["'][^"']*\/produit\/[\w-]+[^"']*["'][^>]*>[\s\S]*?<\/a>/i,
    /<a[^>]*href=["'][^"']*\/producto\/[\w-]+[^"']*["'][^>]*>[\s\S]*?<\/a>/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) {
      // Étendre : prendre le contexte autour pour inclure titre + prix
      const idx = m.index ?? 0;
      const start = Math.max(0, idx - 2000);
      const end = Math.min(html.length, idx + m[0].length + 3000);
      const extended = html.slice(start, end);
      return extended.length > maxLen ? extended.slice(0, maxLen) + ` …[truncated at ${maxLen} chars, total ${extended.length}]` : extended;
    }
  }
  return null;
}

/** Compte le nombre de cartes produit dans une page HTML de recherche Shopify
 *  ou autre. Utile pour comprendre la pagination et vérifier qu'on récupère
 *  bien tous les produits. Retourne { count, source } ou null. */
function countProductCards(html) {
  if (!html) return null;

  // 1. Compter les conteneurs connus (card__info pour Shopify, etc.)
  const cardClassPatterns = [
    { re: /class=["'][^"']*\bcard__info\b[^"']*["']/gi, source: ".card__info (Shopify)" },
    { re: /class=["'][^"']*\bproduct-item-info\b[^"']*["']/gi, source: ".product-item-info (Magento)" },
    { re: /class=["'][^"']*\bproduct-card\b[^"']*["']/gi, source: ".product-card" },
    { re: /data-testid=["']product-card["']/gi, source: "[data-testid=product-card] (Next.js)" },
    { re: /class=["'][^"']*\bpredictive-result\b[^"']*["']/gi, source: ".predictive-result (Shopify suggest)" },
  ];

  let bestCount = 0;
  let bestSource = null;
  for (const { re, source } of cardClassPatterns) {
    const matches = html.match(re);
    if (matches && matches.length > bestCount) {
      bestCount = matches.length;
      bestSource = source;
    }
  }

  // 2. Fallback : compter les liens /products/<handle> uniques
  if (bestCount === 0) {
    const productLinks = new Set();
    const linkRe = /href=["'][^"']*\/(?:products|p|produit|producto)\/[\w-]+[^"']*["']/gi;
    let m;
    while ((m = linkRe.exec(html)) !== null) {
      // Strip query params for dedup
      const url = m[0].replace(/[?"].*$/, "");
      productLinks.add(url);
    }
    if (productLinks.size > 0) {
      return { count: productLinks.size, source: "unique /products/* links" };
    }
    return null;
  }

  return { count: bestCount, source: bestSource };
}

/** Détecte un compteur de résultats dans une page HTML de recherche.
 *  Patterns communs :
 *    <title>Recherche : 231 résultats trouvés pour « castelli giro »</title>
 *    <span class="results-count">231 products</span>
 *    "totalCount": 231 (JSON-LD)
 *  Retourne [{ count, source, raw }] ou [] si rien trouvé. */
function detectResultCount(html) {
  if (!html) return [];
  const results = [];

  // <title>...N résultats... / ...N products...</title>
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) {
    const title = titleMatch[1];
    // "231 résultats trouvés", "231 results", "231 productos", etc.
    const countMatch = title.match(/(\d+)\s*(?:résultats?|results?|resultados?|ergebnisse|prodotti)/i);
    if (countMatch) {
      results.push({ count: parseInt(countMatch[1], 10), source: "<title>", raw: title.trim() });
    }
  }

  // data-total-results="231" ou data-results-count="231" (attributs data-*)
  const dataAttrMatch = html.match(/data-(?:total-)?results?(?:-count)?=["'](\d+)["']/i);
  if (dataAttrMatch) {
    results.push({ count: parseInt(dataAttrMatch[1], 10), source: "data-* attribute", raw: dataAttrMatch[0] });
  }

  // <span class="results-count">231</span> ou textes équivalents
  const spanMatch = html.match(/<span[^>]*class=["'][^"']*(?:results?-count|total-count|product-count)[^"']*["'][^>]*>\s*(?:<[^>]+>\s*)*(\d+)\s*(?:<[^>]+>\s*)*<\/span>/i);
  if (spanMatch) {
    results.push({ count: parseInt(spanMatch[1], 10), source: "<span class=results-count>", raw: spanMatch[0].slice(0, 200) });
  }

  return results;
}

/** Affiche un objet JSON sans troncation (ou tronqué à une limite très haute).
 *  Utilisé pour le "Sample product" — l'idée est de voir TOUS les champs. */
function prettyJson(obj, limit = 30000) {
  try {
    const s = JSON.stringify(obj, null, 2);
    if (s.length > limit) {
      return s.slice(0, limit) + `\n…[truncated at ${limit} chars, total ${s.length}]`;
    }
    return s;
  } catch {
    return String(obj);
  }
}

/** Tente de parser une chaîne WS frame (Doofinder Phoenix, JSON, etc.). */
function parseWsFrame(data) {
  if (!data) return null;
  // 1. Phoenix LiveView frame : [join_ref, message_id, topic, event, payload]
  //    On doit tester ça AVANT le JSON direct, car un tableau Phoenix est
  //    aussi du JSON valide mais on veut extraire le payload.
  try {
    const arr = JSON.parse(data);
    if (Array.isArray(arr) && arr.length >= 5) {
      const payload = arr[4];
      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        return { _phoenixEvent: arr[3], _phoenixTopic: arr[2], payload };
      }
    }
  } catch {}
  // 2. JSON direct (Doofinder classique, payloads simples, etc.)
  try {
    return JSON.parse(data);
  } catch {}
  return null;
}

/** Génère le protocol.md à partir des requêtes capturées. */
export function generateProtocol({ shopName, requests }) {
  const name = shopName?.trim() || "UnknownShop";
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
  const date = new Date().toISOString().slice(0, 10);

  // Filtre et catégorise
  const searchReqs = requests.filter((r) => r.category === CATEGORY.SEARCH);
  const productReqs = requests.filter((r) => r.category === CATEGORY.PRODUCT);
  const wsReqs = requests.filter((r) => r.category === CATEGORY.WEBSOCKET);

  // Déduplication par URL (sans query string pour les GET)
  const dedup = (arr) => {
    const seen = new Set();
    return arr.filter((r) => {
      const key = r.method + " " + r.url.replace(/[?#].*$/, "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const uniqueSearch = dedup(searchReqs);
  const uniqueProduct = dedup(productReqs);

  let md = `# Protocol — ${name}\n\n`;
  md += `> Généré automatiquement par l'extension Chrome **Shop Protocol Recorder** le ${date}.\n`;
  md += `> Source : ${requests.length} requêtes capturées (${uniqueSearch.length} search, ${uniqueProduct.length} product, ${wsReqs.length} WebSocket).\n\n`;
  md += `## Résumé exécutif\n\n`;
  md += `| Type | Méthode | Endpoint | Host |\n`;
  md += `|------|--------|----------|------|\n`;
  for (const r of uniqueSearch) {
    let host = "—"; let path = r.url;
    try { const u = new URL(r.url); host = u.host; path = u.pathname + (u.search ? "?" + u.search.slice(0, 30) + "…" : ""); } catch {}
    md += `| SEARCH | ${r.method} | \`${path}\` | ${host} |\n`;
  }
  for (const r of uniqueProduct) {
    let host = "—"; let path = r.url;
    try { const u = new URL(r.url); host = u.host; path = u.pathname; } catch {}
    md += `| PRODUCT | ${r.method} | \`${path.slice(0, 80)}\` | ${host} |\n`;
  }
  for (const r of wsReqs) {
    let host = "—"; let path = r.url;
    try { const u = new URL(r.url); host = u.host; path = u.pathname; } catch {}
    md += `| WEBSOCKET | WS | \`${path}\` | ${host} |\n`;
  }
  md += `\n`;

  // Search endpoints
  if (uniqueSearch.length > 0) {
    md += `## Recherche (Search)\n\n`;
    uniqueSearch.slice(0, LIMIT_SEARCH_ENDPOINTS).forEach((r, i) => {
      md += `### Endpoint ${i + 1}\n\n`;
      md += `**Point d'entrée**\n\n\`\`\`\n${r.method} ${r.url}\n\`\`\`\n\n`;
      md += `**En-têtes notables**\n\n\`\`\`\n`;
      const headers = extractNotableHeaders(r.headers);
      for (const [k, v] of Object.entries(headers)) {
        md += `${k}: ${v}\n`;
      }
      md += `\`\`\`\n\n`;
      if (r.body) {
        md += `**Corps de requête** (${r.headers?.["content-type"] || "?"})\n\n\`\`\`\n`;
        md += previewBody(r.body, r.headers?.["content-type"], LIMIT_REQUEST_BODY);
        md += `\n\`\`\`\n\n`;
      }
      if (r.responseBody) {
        md += `**Réponse (aperçu ${r.responseStatus ?? "?"})** — ${r.responseBody.length.toLocaleString()} caractères capturés\n\n\`\`\`\n`;
        md += previewBody(r.responseBody, r.responseContentType, LIMIT_RESPONSE_BODY);
        md += `\n\`\`\`\n\n`;
        // Tente de détecter des champs utiles si JSON
        if ((r.responseContentType || "").includes("json")) {
          try {
            const parsed = JSON.parse(r.responseBody);
            const fields = detectUsefulFields(parsed);
            if (fields.length > 0) {
              md += `**Champs utiles détectés** (${fields.length} chemins)\n\n`;
              for (const f of fields.slice(0, LIMIT_FIELDS)) md += `- \`${f}\`\n`;
              if (fields.length > LIMIT_FIELDS) {
                md += `- …et ${fields.length - LIMIT_FIELDS} autres (voir capture JSON brute)\n`;
              }
              md += `\n`;
            }
            // Array counts (pagination)
            const arrays = detectArrayCounts(parsed);
            if (arrays.length > 0) {
              md += `**Tableaux détectés** (pagination)\n\n`;
              for (const a of arrays.slice(0, 10)) {
                md += `- \`${a.path}\` → ${a.count} items\n`;
              }
              md += `\n`;
            }
            // Sample product (le plus utile !)
            const sampleInfo = findFirstProductArray(parsed);
            if (sampleInfo) {
              md += `**Produit exemple complet** (extrait de \`${sampleInfo.arrayPath}\` — ${sampleInfo.productCount}/${sampleInfo.totalCount} items ressemblent à des produits)\n\n`;
              md += `> ⭐ C'est l'objet le plus utile pour écrire un scraper : il montre TOUS les champs disponibles pour UN produit, sans troncation.\n\n\`\`\`json\n`;
              md += prettyJson(sampleInfo.sample);
              md += `\n\`\`\`\n\n`;
            }
          } catch (e) {
            md += `> ⚠️ Réponse non-JSON valide : ${e.message}\n\n`;
          }
        }
        // ⚠️ Pour les boutiques SSR (Shopify, Magento, etc.) la réponse de
        // recherche est en HTML, pas en JSON. On extrait alors :
        //   1. Le compteur de résultats depuis le <title>
        //   2. Les blocs JSON-LD (souvent un ItemList de Product)
        //   3. La première carte produit HTML (pour comprendre la structure DOM)
        if ((r.responseContentType || "").includes("html")) {
          // 1. Compteur de résultats
          const counts = detectResultCount(r.responseBody);
          if (counts.length > 0) {
            md += `**Nombre de résultats détecté** (pagination)\n\n`;
            for (const c of counts) {
              md += `- ${c.count} produits — source: ${c.source}${c.raw ? ` (\`${c.raw.slice(0, 100)}\`)` : ""}\n`;
            }
            md += `\n`;
          }
          // 2. JSON-LD extraction (TOUS les blocs)
          const jsonLdBlocks = extractJsonLdFromHtml(r.responseBody);
          if (jsonLdBlocks.length > 0) {
            md += `**JSON-LD détecté dans le HTML** (${jsonLdBlocks.length} blocs)\n\n`;
            // Cherche d'abord un ItemList de produits
            const itemLists = findItemListProducts(jsonLdBlocks);
            if (itemLists.length > 0) {
              for (const list of itemLists.slice(0, 2)) {
                md += `**ItemList schema.org** — ${list.productCount}/${list.totalCount} items ressemblent à des produits (chemin: \`${list.arrayPath}\`)\n\n`;
                md += `> ⭐ Sample product extrait du JSON-LD — tous les champs sont structurés, c'est la source la plus fiable pour le scraper.\n\n\`\`\`json\n`;
                md += prettyJson(list.sample);
                md += `\n\`\`\`\n\n`;
              }
            }
            // Affiche aussi le premier bloc JSON-LD brut (souvent un breadcrumb ou Organization)
            if (itemLists.length === 0) {
              md += `Aucun ItemList de produits détecté dans le JSON-LD. Premier bloc brut :\n\n\`\`\`json\n`;
              md += prettyJson(jsonLdBlocks[0].parsed, 5000);
              md += `\n\`\`\`\n\n`;
            }
          }
          // 3. Première carte produit HTML — montre la structure DOM à parser
          // 3a. Compter les cartes trouvées dans la page
          const cardCount = countProductCards(r.responseBody);
          if (cardCount) {
            md += `**Cartes produit détectées** : ${cardCount.count} (sélecteur: \`${cardCount.source}\`)\n\n`;
          }
          // 3b. Extraire la première carte HTML
          const cardHtml = extractFirstProductCardHtml(r.responseBody, 5000);
          if (cardHtml) {
            md += `**Première carte produit (HTML brut à parser)**\n\n`;
            md += `> Le scraper doit extraire les cartes produits de ce HTML. Voici la première carte trouvée :\n\n\`\`\`html\n`;
            md += cardHtml;
            md += `\n\`\`\`\n\n`;
          }
        }
      } else {
        md += `> ⚠️ Corps de réponse non capturé (peut arriver si l'onglet a été fermé avant l'arrêt du recording).\n\n`;
      }
    });
  }

  // Product endpoints
  if (uniqueProduct.length > 0) {
    md += `## Page produit (Product detail)\n\n`;
    uniqueProduct.slice(0, LIMIT_PRODUCT_ENDPOINTS).forEach((r, i) => {
      md += `### Endpoint ${i + 1}\n\n`;
      md += `**Point d'entrée**\n\n\`\`\`\n${r.method} ${r.url}\n\`\`\`\n\n`;
      const headers = extractNotableHeaders(r.headers);
      if (Object.keys(headers).length > 0) {
        md += `**En-têtes notables**\n\n\`\`\`\n`;
        for (const [k, v] of Object.entries(headers)) {
          md += `${k}: ${v}\n`;
        }
        md += `\`\`\`\n\n`;
      }
      if (r.body) {
        md += `**Corps de requête**\n\n\`\`\`\n${previewBody(r.body, r.headers?.["content-type"], LIMIT_REQUEST_BODY)}\n\`\`\`\n\n`;
      }
      if (r.responseBody) {
        md += `**Réponse (aperçu ${r.responseStatus ?? "?"})** — ${r.responseBody.length.toLocaleString()} caractères capturés\n\n\`\`\`\n`;
        md += previewBody(r.responseBody, r.responseContentType, LIMIT_RESPONSE_BODY);
        md += `\n\`\`\`\n\n`;
        // Pour les pages produit HTML, chercher les blocs JSON-LD Product
        if ((r.responseContentType || "").includes("html")) {
          const jsonLdBlocks = extractJsonLdFromHtml(r.responseBody);
          // Filtrer pour ne garder que les blocs Product (ou objets avec @type Product)
          const productBlocks = jsonLdBlocks.filter((b) => {
            if (!b.parsed) return false;
            const candidates = Array.isArray(b.parsed) ? b.parsed : [b.parsed];
            return candidates.some((c) => c && typeof c === "object" && (
              c["@type"] === "Product" ||
              (Array.isArray(c["@type"]) && c["@type"].includes("Product"))
            ));
          });
          if (productBlocks.length > 0) {
            md += `**JSON-LD \`Product\` détecté dans le HTML** (${productBlocks.length} bloc(s))\n\n\`\`\`json\n`;
            md += prettyJson(productBlocks[0].parsed, 15000);
            md += `\n\`\`\`\n\n`;
          } else if (jsonLdBlocks.length > 0) {
            // Pas de Product, mais on a d'autres blocs JSON-LD (Breadcrumb, Organization, etc.)
            md += `**JSON-LD détecté dans le HTML** (${jsonLdBlocks.length} blocs, mais aucun \`Product\`)\n\n\`\`\`json\n`;
            md += prettyJson(jsonLdBlocks[0].parsed, 5000);
            md += `\n\`\`\`\n\n`;
          }
        }
        // Pour les API JSON produit
        if ((r.responseContentType || "").includes("json")) {
          try {
            const parsed = JSON.parse(r.responseBody);
            const fields = detectUsefulFields(parsed);
            if (fields.length > 0) {
              md += `**Champs utiles détectés** (${fields.length} chemins)\n\n`;
              for (const f of fields.slice(0, LIMIT_FIELDS)) md += `- \`${f}\`\n`;
              md += `\n`;
            }
          } catch {}
        }
      }
    });
  }

  // WebSockets — la section la plus importante pour Doofinder (Glisshop, Barrabes, ProBikeShop)
  if (wsReqs.length > 0) {
    md += `## WebSocket\n\n`;
    md += `> ⚠️ Pour les sites basés sur Doofinder (Glisshop, Barrabes, ProBikeShop...), la réponse de recherche arrive via les frames WebSocket ( Phoenix LiveView ). C'est dans ces frames qu'on trouve les produits.\n\n`;
    wsReqs.forEach((r, i) => {
      md += `### WS ${i + 1}: \`${r.url}\`\n\n`;
      // Afficher les paramètres de l'URL (hashid surtout)
      try {
        const u = new URL(r.url);
        if (u.searchParams.has("hashid")) {
          md += `**Hashid Doofinder** : \`${u.searchParams.get("hashid")}\`\n\n`;
        }
      } catch {}
      if (r.wsFrames && r.wsFrames.length > 0) {
        md += `**Frames capturées** : ${r.wsFrames.length} total, ${LIMIT_WS_FRAMES_SHOWN} affichées ci-dessous (chacune jusqu'à ${LIMIT_WS_FRAME.toLocaleString()} caractères)\n\n`;
        // Chercher la frame qui contient probablement la réponse de recherche
        // (la plus grosse frame reçue ←, qui contient du JSON ou du Phoenix payload)
        const sortedFrames = [...r.wsFrames].map((f, idx) => {
          const parsed = parseWsFrame(f.data);
          let isSearchResponse = false;
          if (parsed) {
            const flat = JSON.stringify(parsed).toLowerCase();
            if (flat.includes("title") && (flat.includes("price") || flat.includes("link") || flat.includes("image"))) {
              isSearchResponse = true;
            }
          }
          return { ...f, idx, parsed, isSearchResponse, dataSize: (f.data || "").length };
        }).sort((a, b) => {
          // Search responses first, then by size descending
          if (a.isSearchResponse !== b.isSearchResponse) return a.isSearchResponse ? -1 : 1;
          return b.dataSize - a.dataSize;
        });

        // Afficher d'abord les frames qui ressemblent à une réponse de recherche
        const searchLikeFrames = sortedFrames.filter((f) => f.isSearchResponse).slice(0, 3);
        if (searchLikeFrames.length > 0) {
          md += `#### Frames contenant des produits (réponse de recherche)\n\n`;
          searchLikeFrames.forEach((f) => {
            md += `**Frame ${f.idx + 1}** [${f.direction}] ${f.dataSize.toLocaleString()} chars\n\n\`\`\`json\n`;
            if (f.parsed) {
              md += prettyJson(f.parsed, LIMIT_WS_FRAME);
            } else {
              md += truncate(f.data, LIMIT_WS_FRAME);
            }
            md += `\n\`\`\`\n\n`;
            // Tenter d'extraire un sample product
            if (f.parsed) {
              const sampleInfo = findFirstProductArray(f.parsed);
              if (sampleInfo) {
                md += `**Sample product extrait de cette frame** (chemin: \`${sampleInfo.arrayPath}\` — ${sampleInfo.productCount}/${sampleInfo.totalCount} items)\n\n\`\`\`json\n`;
                md += prettyJson(sampleInfo.sample);
                md += `\n\`\`\`\n\n`;
              }
            }
          });
        }

        // Puis afficher les autres frames (jusqu'à la limite)
        md += `#### Autres frames échantillonnées\n\n`;
        const otherFrames = sortedFrames.filter((f) => !f.isSearchResponse).slice(0, LIMIT_WS_FRAMES_SHOWN - searchLikeFrames.length);
        for (const f of otherFrames) {
          md += `**Frame ${f.idx + 1}** [${f.direction}] ${f.dataSize.toLocaleString()} chars\n\n\`\`\`\n`;
          if (f.parsed) {
            md += prettyJson(f.parsed, LIMIT_WS_FRAME);
          } else {
            md += truncate(f.data, LIMIT_WS_FRAME);
          }
          md += `\n\`\`\`\n\n`;
        }
      } else {
        md += `> ⚠️ Aucune frame capturée pour cette WebSocket. Voir limitations dans le README (Chrome 99+ requis).\n\n`;
      }
    });
  }

  md += `## Recommandations pour le scraper\n\n`;
  md += `1. **Identifier le moteur de recherche** :\n`;
  md += `   - **API REST JSON** (Bergzeit, Sport Conrad) → reproduire le POST/GET et parser le JSON.\n`;
  md += `   - **GraphQL** (Snowleader, Ekosport, Shopify Storefront API) → reproduire la query, notamment \`search\` ou \`products(query: "...")\`.\n`;
  md += `   - **Page HTML SSR** (Shopify, Magento, Shopware) → la réponse est une page HTML. Parser le DOM avec cheerio et extraire les cartes produits. **Chercher d'abord les blocs JSON-LD \`<script type="application/ld+json">\`** — c'est la source la plus fiable et structurée.\n`;
  md += `   - **WebSocket Doofinder** (Glisshop, Barrabes, ProBikeShop) → utiliser Playwright et laisser le navigateur faire le handshake Phoenix LiveView, puis extraire les cartes du DOM.\n`;
  md += `2. **Vérifier les en-têtes obligatoires** : certains sites exigent \`Origin\`, \`Referer\`, \`X-Requested-With\` ou un token d'API à durée limitée. Reproduire EXACTEMENT les en-têtes notables ci-dessus.\n`;
  md += `3. **Pour les pages produit HTML**, vérifier si un JSON-LD \`<script type="application/ld+json">\` est servi dans le HTML — c'est la source la plus fiable pour les métadonnées (EAN, brand, price, sku, image).\n`;
  md += `4. **Pour les pages de recherche HTML (Shopify)**, le JSON-LD contient souvent un \`ItemList\` schema.org avec la liste des produits — c'est la source la plus simple à parser. Sinon, parser directement les cartes produit HTML (cf. l'extrait "Première carte produit" ci-dessus).\n`;
  md += `5. **Pour les API JSON** (GraphQL, REST), reproduire exactement le corps de requête capturé. Vérifier les champs obligatoires (ex: \`customFilter\` chez Sport Conrad, \`visitorid\` chez Tradeinn). Pour Shopify GraphQL, ne pas reproduire les queries \`slide_cart_offers\` ou \`bannerQuery\` — ce sont des queries d'app, pas de recherche.\n`;
  md += `6. **Pour les WebSockets Doofinder (Phoenix LiveView)** : ne pas essayer de reproduire le handshake à la main. Utiliser Playwright pour charger la page, ouvrir le layer, et extraire les cartes produits du DOM (cf. \`src/lib/scraper/sites/barrabes.ts\` pour exemple).\n`;
  md += `7. **Le "Produit exemple complet" ci-dessus** (ou le "Sample product extrait du JSON-LD" pour les pages HTML) est le point de départ pour écrire le mapping \`ProductResult\`. Listez tous les champs que vous voyez dans l'exemple et mappez-les vers les propriétés de \`ProductResult\` dans \`src/lib/scraper/types.ts\`.\n`;
  md += `8. **Tester avec** \`make check-site SITE=<new-site> Q="test"\` après implémentation.\n\n`;
  md += `## Données brutes\n\n`;
  md += `Les ${requests.length} requêtes capturées sont disponibles :\n`;
  md += `- Dans la console DevTools (variable \`__capturedRequests\`)\n`;
  md += `- Via le bouton **"Download raw JSON"** qui exporte toutes les requêtes avec leur corps complet (sans troncation)\n`;

  return md;
}

// Exporte aussi les helpers pour les tests éventuels
export {
  truncate, previewBody, detectUsefulFields, detectArrayCounts,
  findFirstProductArray, looksLikeProduct, parseWsFrame, prettyJson,
  extractNotableHeaders, extractJsonLdFromHtml, findItemListProducts,
  extractFirstProductCardHtml, detectResultCount, countProductCards,
  isSearchRequest, isProductRequest,
};
