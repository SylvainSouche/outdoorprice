// Scraper Hardloop (FR, EUR)
// --------------------------------------------------------------------------
// Protocole (capturé le 2026-08-22, cf. PROTOCOLES.md) :
//   Next.js + Typesense (instantsearch dropdown, PAS de page de résultats).
//
//   1) Découverte : POST https://search.hardloop.fr/multi_search
//      (Typesense, header X-Typesense-Api-Key — clé search-only publique,
//      embarquée dans le JS du site, extractible au runtime si elle tourne).
//      Collection "products_light_fr-FR" → name, manufacturer, image, slug,
//      id_product. PAS de prix dans cette collection.
//   2) Prix : la page produit SSR https://www.hardloop.fr/produit/<id>-<slug>
//      embarque le JSON des combinaisons avec
//      "prices":{"reduction":"0","old_price":"139.90","price":"139.90"}.
//      (Ni l'API v2 api-shop ni le _next/data ne contiennent les prix.)
//
// Pièges :
//   - Pas de page de résultats de recherche : le site vit en dropdown.
//   - Le JSON SSR contient les prix de toutes les combinaisons — on prend la
//     1re occurrence (combinaison principale).
//   - La clé Typesense est scopée (search-only) et peut être rotationnée :
//     en cas de 401, erreur explicite.
// --------------------------------------------------------------------------
import { SiteMeta, ProductResult, Scraper } from "../types";

import { ScraperError } from "../error";

import { absUrl, parsePrice } from "../http";

const TYPESENSE_URL = "https://search.hardloop.fr/multi_search";
// Clé search-only de départ (inlinée NEXT_PUBLIC_* dans les chunks JS du
// site — rotation à chaque déploiement frontend). Si elle est refusée, on
// la ré-extrait à chaud des chunks (cf. resolveTypeenseKey).
let TYPESENSE_KEY = "6vpvkmpa4O98E0QoOlMKsqUQT2CUFvhg";

/** Extrait la clé Typesense courante depuis les chunks JS du site.
 *  Pattern d'inlining : `let e="<clé>",a="search.hardloop.fr"`.
 *  Mémoïsée pour la durée du process. */
async function resolveTypeenseKey(): Promise<string> {
  try {
    const res = await fetch(`${site.baseUrl}/`, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36" },
    });
    const html = await res.text();
    const srcs = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((m) => m[1]);
    // Le chunk de recherche est lazy-loadé : il n'est pas dans les <script>
    // de la home. Le _buildManifest liste TOUS les chunks du build.
    const buildId = html.match(/"buildId":"([^"]+)"/)?.[1];
    if (buildId) {
      const manifest = await fetch(`${site.baseUrl}/_next/static/${buildId}/_buildManifest.js`)
        .then((r) => (r.ok ? r.text() : ""))
        .catch(() => "");
      for (const m of manifest.matchAll(/"([^"]+\.js)"/g)) {
        // les chemins du manifest sont relatifs à /_next/ (ex: static/chunks/…)
        const p = m[1].startsWith("/") ? m[1] : m[1].startsWith("_next") ? `/${m[1]}` : `/_next/${m[1]}`;
        srcs.push(p);
      }
    }
    const uniq = [...new Set(srcs)].slice(0, 200);
    // Par paquets de 20 pour rester poli vis-à-vis du CDN
    const fetchChunk = (s: string) =>
      fetch(s.startsWith("http") ? s : `${site.baseUrl}${s}`)
        .then((r) => (r.ok ? r.text() : ""))
        .catch(() => "");
    for (let i = 0; i < uniq.length; i += 20) {
      const batch = await Promise.all(uniq.slice(i, i + 20).map(fetchChunk));
      for (const c of batch) {
        // `="<clé>",<var>="search.hardloop.fr"` (ordre des inlining esbuild)
        const m = c.match(/="([A-Za-z0-9]{20,40})",\w+="search\.hardloop\.fr"/);
        if (m) return m[1];
        // variante inversée
        const m2 = c.match(/"search\.hardloop\.fr",\w+="[a-z]+",\w+="([A-Za-z0-9]{20,40})"/);
        if (m2) return m2[1];
      }
    }
  } catch { /* réseau — on garde la clé courante */ }
  return TYPESENSE_KEY;
}

interface TypesenseDoc {
  name?: string;
  manufacturer?: string;
  image?: string;
  slug?: string;
  id_product?: number;
}

/** Cherche les produits via Typesense. Réessaie une fois avec une clé
 *  ré-extraite des chunks si la clé courante est refusée (rotation). */
async function typesenseSearch(query: string, signal?: AbortSignal): Promise<TypesenseDoc[]> {
  const body = {
    searches: [
      {
        query_by: "name,manufacturer,slug,categories,meta_description,category_brand",
        sort_by: "_text_match(buckets: 3):desc,popularity_score:desc",
        query_by_weights: "10,7,4,4,3,2",
        text_match_type: "max_weight",
        num_typos: 1,
        prioritize_exact_match: true,
        drop_tokens_threshold: 1,
        per_page: 24,
        collection: "products_light_fr-FR",
        q: query,
        page: 1,
      },
    ],
  };
  const doSearch = async (key: string) =>
    fetch(TYPESENSE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "X-Typesense-Api-Key": key,
        Origin: site.baseUrl,
        Referer: `${site.baseUrl}/`,
      },
      body: JSON.stringify(body),
      signal,
    });

  let res = await doSearch(TYPESENSE_KEY);
  if (res.status === 401 || res.status === 403) {
    // rotation probable de la clé → ré-extraction depuis les chunks JS
    TYPESENSE_KEY = await resolveTypeenseKey();
    res = await doSearch(TYPESENSE_KEY);
  }
  if (res.status === 401 || res.status === 403) {
    throw new ScraperError("hardloop", "clé Typesense refusée même après ré-extraction des chunks JS", { category: "auth" });
  }
  if (!res.ok) throw new ScraperError("hardloop", `Typesense multi_search ${res.status}`, { statusCode: res.status, category: res.status === 403 ? "blocked" : "network" });
  const data = (await res.json()) as { results?: { hits?: { document: TypesenseDoc }[] }[] };
  return (data.results?.[0]?.hits ?? []).map((h) => h.document);
}

/** Extrait le prix de la page produit SSR (JSON des combinaisons embarqué). */
async function fetchPrice(url: string, signal?: AbortSignal): Promise<{ price: number | null; originalPrice: number | null; reduction: number | null }> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36", Referer: `${site.baseUrl}/` },
      signal,
    });
    if (!res.ok) return { price: null, originalPrice: null, reduction: null };
    const html = await res.text();
    // 1re occurrence = combinaison principale
    const m = html.match(/"prices":\{"reduction":"([\d.]+)","price_without_taxes":"[\d.]+","old_price":"([\d.]+)","price":"([\d.]+)"/);
    if (!m) return { price: null, originalPrice: null, reduction: null };
    const price = parsePrice(m[3]);
    const oldPrice = parsePrice(m[2]);
    const reduction = parsePrice(m[1]) ?? null;
    return {
      price,
      originalPrice: oldPrice && price && oldPrice > price ? oldPrice : null,
      reduction,
    };
  } catch {
    return { price: null, originalPrice: null, reduction: null };
  }
}

export const site: SiteMeta = {
  id: "hardloop",
  name: "Hardloop",
  baseUrl: "https://www.hardloop.fr",
  country: "FR",
  currency: "EUR",
  accent: "bg-teal-100 text-teal-800 border-teal-200",
  groups: ["all"],
};

export const scraper: Scraper = {
  site,
    capabilities: { engine: "html" },
  async search(query, signal) {
    const docs = await typesenseSearch(query, signal);
    const seen = new Set<number>();
    const products = await Promise.all(
      docs
        .filter((d) => {
          if (!d.id_product || !d.name || !d.slug) return false;
          if (seen.has(d.id_product)) return false;
          seen.add(d.id_product);
          return true;
        })
        .slice(0, 24)
        .map(async (d) => {
          const url = `${site.baseUrl}/produit/${d.id_product}-${d.slug}`;
          const { price, originalPrice, reduction } = await fetchPrice(url, signal);
          return {
            site: "hardloop" as const,
            siteName: site.name,
            title: d.manufacturer ? `${d.manufacturer} ${d.name}` : d.name!,
            url,
            price,
            originalPrice,
            currency: "EUR",
            image: absUrl(d.image ?? null, site.baseUrl),
            availability: "unknown",
            discount: reduction && reduction > 0 ? Math.round(reduction) : null,
          } satisfies ProductResult;
        })
    );
    return products;
  },
};
