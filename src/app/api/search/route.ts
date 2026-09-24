// Route API : POST /api/search { query, onlySites?, group? } -> AggregatedMatchResponse
//
// Workflow complet : recherche → enrichissement (pages produits) → matching cross-site
// → filtres dynamiques. Retourne des MatchedProduct (un produit = plusieurs offres).
//
// Filtre par groupe : si `group` est fourni (id de groupe prédéfini ou custom),
// on restreint les sites à ceux du groupe. Compatible avec `onlySites` — si les
// deux sont fournis, l'intersection est utilisée.
import { NextRequest, NextResponse } from "next/server";
import { aggregateMatched } from "@/lib/scraper/registry";
import { SITES } from "@/lib/scraper/types";
import { type SiteId, type ShopGroup } from "@/lib/scraper/types";
import { DEFAULT_GROUPS, getSitesForGroup, sanitizeSiteIds } from "@/lib/scraper/groups";
import { getCached, setCached } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_SITES: SiteId[] = Object.keys(SITES) as SiteId[];

/** Lit les groupes custom depuis le header X-Custom-Groups (base64 JSON). */
function readCustomGroupsFromHeader(req: NextRequest): ShopGroup[] {
  const header = req.headers.get("X-Custom-Groups");
  if (!header) return [];
  try {
    const decoded = Buffer.from(header, "base64").toString("utf-8");
    const parsed = JSON.parse(decoded);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((g: unknown): g is ShopGroup => {
        if (!g || typeof g !== "object") return false;
        const obj = g as Record<string, unknown>;
        return typeof obj.id === "string" && typeof obj.name === "string"
          && Array.isArray(obj.sites);
      })
      .map((g) => ({
        ...g,
        builtin: false,
        sites: sanitizeSiteIds(g.sites),
      }));
  } catch {
    return [];
  }
}

/** Calcule la liste effective de sites à interroger, en tenant compte de :
 *  - onlySites (si fourni)
 *  - group (si fourni)
 *  - intersection des deux si les deux sont fournis
 *  - tous les sites si aucun des deux n'est fourni
 *
 *  IMPORTANT : si `group` est fourni mais que le groupe n'a aucun site
 *  (ex: groupe « cycling » vide), on renvoie un tableau vide pour ne PAS
 *  interroger tous les sites — l'utilisateur a explicitement choisi ce groupe. */
function computeTargetSites(
  onlySites: SiteId[] | undefined,
  groupSites: SiteId[] | undefined,
  hasGroup: boolean
): SiteId[] | undefined {
  if (hasGroup && groupSites && groupSites.length === 0) {
    // Groupe explicitement sélectionné mais vide → aucun site
    return [];
  }
  if (onlySites && onlySites.length && groupSites && groupSites.length) {
    // Intersection : on ne garde que les sites présents dans les deux
    const set = new Set(groupSites);
    const inter = onlySites.filter((s) => set.has(s));
    return inter; // peut être vide si l'intersection est vide
  }
  if (groupSites && groupSites.length) return groupSites;
  if (onlySites && onlySites.length) return onlySites;
  return undefined;
}

async function handleQuery(
  query: string,
  onlySites: SiteId[] | undefined,
  group: string | undefined,
  customGroups: ShopGroup[]
) {
  // Si un groupe est fourni, on récupère ses sites
  let groupSites: SiteId[] | undefined;
  const hasGroup = !!group && group !== "all";
  if (hasGroup) {
    const allGroups = [...DEFAULT_GROUPS, ...customGroups];
    groupSites = getSitesForGroup(allGroups, group!);
  }

  const targetSites = computeTargetSites(onlySites, groupSites, hasGroup);

  // Si targetSites est vide (mais pas undefined), c'est que le groupe est
  // vide ou que l'intersection est vide — on renvoie une réponse vide sans
  // interroger l'agrégateur (qui Otherwise lancerait tous les scrapers).
  if (targetSites && targetSites.length === 0) {
    return {
      query,
      totalProducts: 0,
      products: [],
      filters: {
        brands: [], categories: [], subcategories: [], sports: [], ranges: [],
        genders: [], colors: [], sizes: [], attributes: [],
      },
      durationMs: 0,
      phases: { searchMs: 0, enrichMs: 0, matchMs: 0 },
      anySuccess: false,
      demo: false,
      sites: [],
      appliedFilter: {
        group: group ?? null,
        onlySites: targetSites,
      },
    };
  }

  const start = Date.now();

  // Check cache first (2 min TTL)
  const cacheKeySites = targetSites?.map(String);
  const cached = getCached<ReturnType<typeof buildApiResponse>>(query, cacheKeySites, group);
  if (cached) {
    return { ...cached, cached: true, durationMs: Date.now() - start };
  }

  const { products, filters, rawResults, phases, anySuccess, demo } = await aggregateMatched(
    query,
    targetSites && targetSites.length ? { onlySites: targetSites } : {}
  );
  const durationMs = Date.now() - start;

  const response = buildApiResponse(
    query, products, filters, rawResults, phases, anySuccess, demo,
    durationMs, group, targetSites
  );

  // Cache the result
  setCached(query, response, cacheKeySites, group);

  return response;
}

function buildApiResponse(
  query: string,
  products: unknown[],
  filters: unknown,
  rawResults: unknown,
  phases: { searchMs: number; enrichMs: number; matchMs: number },
  anySuccess: boolean,
  demo: boolean,
  durationMs: number,
  group: string | undefined,
  targetSites: SiteId[] | undefined
) {
  return {
    query,
    totalProducts: (products as unknown[]).length,
    products,
    filters,
    durationMs,
    phases,
    anySuccess,
    demo,
    sites: (rawResults as Array<{ site: { id: string; name: string }; status: string; products: unknown[]; durationMs?: number; error?: string }>).map((r) => ({
      id: r.site.id,
      name: r.site.name,
      status: r.status,
      count: r.products.length,
      durationMs: r.durationMs,
      error: r.error,
    })),
    appliedFilter: {
      group: group ?? null,
      onlySites: targetSites ?? null,
    },
    cached: false as const,
  };
}

export async function POST(req: NextRequest) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  if (!query || query.length < 2) {
    return NextResponse.json(
      { error: "Requête trop courte (min 2 caractères)" },
      { status: 400 }
    );
  }
  const onlySitesRaw = Array.isArray(body?.onlySites) ? body.onlySites : null;
  const onlySites = onlySitesRaw
    ? onlySitesRaw.filter((s: any): s is SiteId =>
        typeof s === "string" && (VALID_SITES as string[]).includes(s))
    : undefined;
  const group = typeof body?.group === "string" ? body.group.trim() : undefined;
  const customGroups = readCustomGroupsFromHeader(req);

  const data = await handleQuery(query, onlySites, group, customGroups);
  return NextResponse.json(data);
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  if (!q || q.length < 2) {
    return NextResponse.json(
      { error: "Paramètre q trop court (min 2 caractères)" },
      { status: 400 }
    );
  }
  const only = req.nextUrl.searchParams.getAll("site") as SiteId[];
  const group = req.nextUrl.searchParams.get("group") ?? undefined;
  const customGroups = readCustomGroupsFromHeader(req);
  const data = await handleQuery(
    q,
    only.length ? only : undefined,
    group,
    customGroups
  );
  return NextResponse.json(data);
}
