'use client';

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  ExternalLink,
  Loader2,
  Download,
  ShoppingCart,
  Filter,
  X,
  TrendingDown,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Globe,
  Mountain,
  ChevronDown,
  ChevronUp,
  Star,
  Tag,
  Layers,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  SITES,
  type SiteId,
  type MatchedProduct,
  type ProductOffer,
  type DynamicFilters,
  type ShopGroup,
} from "@/lib/scraper/types";
import { downloadCsv, downloadCategorizedCsv } from "@/lib/csv";
import { VERSION } from "@/lib/version";
import { useLang, LANG_LABELS, type Lang } from "@/lib/i18n";
import { normalizeSizeValue } from "@/lib/scraper/filters";
import {
  DEFAULT_GROUPS,
  ALL_SITE_IDS,
  loadCustomGroups,
  saveCustomGroups,
  getSitesForGroup,
} from "@/lib/scraper/groups";
import { MatchedProductCard } from "@/components/MatchedProductCard";
import { OfferRow } from "@/components/OfferRow";
import { ColorSwatches } from "@/components/ColorSwatches";
import { FilterSection } from "@/components/FilterSection";
import { FilterBalloon } from "@/components/FilterBalloon";
import { LogsPanel } from "@/components/LogsPanel";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { GroupMatrixModal } from "@/components/GroupMatrixModal";
import {
  logInfo,
  logWarn,
  logError,
  clearLogs,
  logSearchResults,
  subscribeLogs,
  type LogEntry,
  type LogLevel,
} from "@/lib/logs";
import { SUGGESTIONS, SORT_OPTIONS } from "@/config";

type SortKey = "price_asc" | "price_desc" | "savings_desc" | "siteCount_desc" | "rating_desc";

interface SiteStat {
  id: SiteId;
  name: string;
  status: "ok" | "error" | "empty";
  count: number;
  durationMs?: number;
  error?: string;
}

interface ApiResponse {
  query: string;
  totalProducts: number;
  products: MatchedProduct[];
  filters: DynamicFilters;
  durationMs: number;
  phases: { searchMs: number; enrichMs: number; matchMs: number };
  anySuccess: boolean;
  demo?: boolean;
  sites: SiteStat[];
}

const ALL_SITE_IDS_LOCAL = ALL_SITE_IDS;


/** Helper défensif : garantit qu'on a un tableau, peu importe ce qui est passé.
 *  Gère les cas où `attributes`, `color`, ou `sizes` arrivent en string / objet /
 *  null / undefined (le `??` seul ne filtre que null/undefined). */
function toArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  if (typeof v === "string") return [v];
  if (typeof v === "object") return Object.values(v);
  return [v];
}

function formatPrice(p: number | null, currency: string): string {
  if (p === null || p === undefined || Number.isNaN(p)) return "—";
  if (currency === "EUR") {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(p);
  }
  return `${currency} ${p.toFixed(2)}`;
}

// Mapping nom de couleur → hex (pour swatches visuels)
// Insensible casse/accents/préfixe souligné (« _Bleu » chez Ekosport).
const COLOR_HEX: Record<string, string> = {
  // FR
  noir: "#1a1a1a", blanc: "#f8f8f8", rouge: "#dc2626", bleu: "#2563eb",
  vert: "#16a34a", jaune: "#eab308", orange: "#ea580c", violet: "#7c3aed",
  gris: "#6b7280", rose: "#ec4899", marron: "#7c4a1e", beige: "#d6c4a0",
  kaki: "#4d5e2c", anthracite: "#2d2d2d", bordeaux: "#5b1a1a", turquoise: "#06b6d4",
  crème: "#f5ecd9", ivoire: "#fffff0", sable: "#c2a878", corail: "#ff7f50",
  // EN
  black: "#1a1a1a", white: "#f8f8f8", red: "#dc2626", blue: "#2563eb",
  green: "#16a34a", yellow: "#eab308", purple: "#7c3aed", gray: "#6b7280",
  grey: "#6b7280", pink: "#ec4899", brown: "#7c4a1e", navy: "#1e3a8a",
  teal: "#0d9488", olive: "#808000", gold: "#d4af37", silver: "#c0c0c0",
  copper: "#b87333", bronze: "#cd7f32",
  // Spécifiques outdoor
  "fluo": "#ccff00", "fluorescent": "#ccff00", "neon": "#ccff00",
  "out": "#1a1a1a", "balsam": "#3a5a40", "cinder": "#586065", "alabama": "#b91c1c",
  "overcast": "#7c8a94", "cabana": "#2b4c7e", "storm": "#374151",
  "sunset": "#f97316", "sand": "#dcb573", "ash": "#708090",
};

/** Normalise une couleur (supprime accents, souligné initial, pluriels simples). */

function getHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  // Groupes : par défaut "all" ; custom groups chargés depuis localStorage
  // (lazy initial state — pas de useEffect, sinon lint react-hooks/set-state-in-effect)
  const [groups, setGroups] = useState<ShopGroup[]>(() => {
    // Côté client seulement : useState initializer ne tourne qu'au mount
    if (typeof window === "undefined") return DEFAULT_GROUPS;
    const custom = loadCustomGroups();
    return custom.length > 0 ? [...DEFAULT_GROUPS, ...custom] : DEFAULT_GROUPS;
  });
  const [activeGroupId, setActiveGroupId] = useState<string>("all");
  const [showGroupEditor, setShowGroupEditor] = useState(false);

  // --- Groupes & sites sélectionnés (déclarés AVANT useQuery) ---
  const [userOff, setUserOff] = useState<Set<SiteId>>(new Set());
  const computedGroupSites: SiteId[] = (() => {
    if (activeGroupId === "all") return ALL_SITE_IDS;
    const group = groups.find((g) => g.id === activeGroupId);
    if (!group) return ALL_SITE_IDS;
    return group.sites.filter((s) => ALL_SITE_IDS.includes(s));
  })();
  const selectedSites: SiteId[] = computedGroupSites.filter((id) => !userOff.has(id));

  // Filtres
  const [sortKey, setSortKey] = useState<SortKey>("siteCount_desc");
  const [onlyPromos, setOnlyPromos] = useState(false);
  const [onlyInStock, setOnlyInStock] = useState(false);
  const [minPrice, setMinPrice] = useState<number | null>(null);
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  const [minSites, setMinSites] = useState<number>(1);
  // Treeview repliable (true = expanded by default)
  const [showShopTree, setShowShopTree] = useState(true);
  const [liveFilter, setLiveFilter] = useState("");
  const isDebugMode = process.env.NEXT_PUBLIC_DEBUG_DUMP === "1";
  const { t, lang, setLang } = useLang();
  // Filtres dynamiques dérivés des métadonnées
  const [activeBrands, setActiveBrands] = useState<Set<string>>(new Set());
  const [activeCategories, setActiveCategories] = useState<Set<string>>(new Set());
  const [activeSubcategories, setActiveSubcategories] = useState<Set<string>>(new Set());
  const [activeSports, setActiveSports] = useState<Set<string>>(new Set());
  const [activeRanges, setActiveRanges] = useState<Set<string>>(new Set());
  const [activeGenders, setActiveGenders] = useState<Set<string>>(new Set());
  const [activeColors, setActiveColors] = useState<Set<string>>(new Set());
  const [activeSizes, setActiveSizes] = useState<Set<string>>(new Set());
  const [showDebug, setShowDebug] = useState(false);

  function persistGroups(next: ShopGroup[]) {
    setGroups(next);
    saveCustomGroups(next);
  }

  const { data, isLoading, isFetching, refetch } = useQuery<ApiResponse>({
    // queryKey includes selectedSites so that selecting a subset of sites
    // triggers a re-search with only those sites. The API receives onlySites
    // and only scrapes the selected shops.
    queryKey: ["search", submittedQuery, selectedSites, activeGroupId],
    queryFn: async () => {
      const customGroups = groups.filter((g) => !g.builtin);
      const headerValue = customGroups.length > 0
        ? btoa(unescape(encodeURIComponent(JSON.stringify(customGroups))))
        : "";
      const res = await fetch("/api/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(headerValue ? { "X-Custom-Groups": headerValue } : {}),
        },
        body: JSON.stringify({
          query: submittedQuery,
          onlySites: selectedSites,
          group: activeGroupId !== "all" ? activeGroupId : undefined,
        }),
      });
      if (!res.ok) {
        logError(undefined, `API HTTP ${res.status} pour la requête "${submittedQuery}"`);
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      // Log les statuts par site
      if (data?.sites) {
        logSearchResults(data.sites);
      }
      return data;
    },
    enabled: submittedQuery.length >= 2,
    staleTime: 60_000,
  });

  // Subscribe au log buffer
  const [logs, setLogs] = useState<LogEntry[]>([]);
  useEffect(() => {
    const unsub = subscribeLogs((next) => setLogs(next));
    return unsub;
  }, []);

  const onSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      const q = query.trim();
      if (q.length < 2) return;
      setSubmittedQuery(q);
      // Réinitialise les filtres dynamiques à chaque nouvelle recherche
      setActiveBrands(new Set());
      setActiveCategories(new Set());
      setActiveSubcategories(new Set());
      setActiveSports(new Set());
      setActiveRanges(new Set());
      setActiveGenders(new Set());
      setActiveColors(new Set());
      setActiveSizes(new Set());
      refetch();
    },
    [query, refetch]
  );

  const toggleSet = (setter: React.Dispatch<React.SetStateAction<Set<string>>>) => (v: string) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  };

  const filtered = useMemo<MatchedProduct[]>(() => {
    if (!data) return [];
    let list = data.products;
    // Site filtering is done server-side via onlySites — no client-side filter needed.
    if (onlyPromos) list = list.filter((p) => p.offers.some((o) => (o.discount ?? 0) > 0));
    if (onlyInStock) list = list.filter((p) => p.offers.some((o) => o.availability !== "out_of_stock"));
    if (minPrice !== null)
      list = list.filter((p) => p.minPrice !== null && p.minPrice >= minPrice);
    if (maxPrice !== null)
      list = list.filter((p) => p.minPrice !== null && p.minPrice <= maxPrice);
    if (minSites > 1) list = list.filter((p) => p.siteCount >= minSites);
    if (activeBrands.size > 0) list = list.filter((p) => p.brand && activeBrands.has(p.brand));
    if (activeCategories.size > 0)
      list = list.filter((p) => p.category && activeCategories.has(p.category));
    if (activeSubcategories.size > 0)
      list = list.filter((p) => p.subcategory && activeSubcategories.has(p.subcategory));
    if (activeSports.size > 0)
      list = list.filter((p) => p.sport && activeSports.has(p.sport));
    if (activeRanges.size > 0)
      list = list.filter((p) => p.range && activeRanges.has(p.range));
    if (activeGenders.size > 0)
      list = list.filter((p) => p.metadata.gender && activeGenders.has(p.metadata.gender));
    if (activeColors.size > 0) {
      list = list.filter((p) =>
        (p.metadata.color ?? []).some((c) => activeColors.has(c.toLowerCase()))
      );
    }
    if (activeSizes.size > 0) {
      list = list.filter((p) =>
        (p.metadata.sizes ?? []).some((s) => activeSizes.has(s))
      );
    }

    // Live filter : filtre les produits par texte libre (substring exacte, pas mots-clés).
    // Cherche dans tous les champs textuels pertinents : titre, marque, classification,
    // genre, couleurs, tailles, et noms de sites des offres.
    // Vide = pas de filtrage.
    if (liveFilter.trim()) {
      const needle = liveFilter.trim().toLowerCase();
      list = list.filter((p) => {
        const md = p.metadata ?? ({} as any);
        // Defensive: attributes / color / sizes may arrive as non-array types
        // (undefined, null, string, object). toArray() handles all cases.
        const attrs = toArray(md.attributes).flatMap((a: any) =>
          toArray(a?.values).map((v: any) => (typeof v === "object" ? v?.value ?? "" : String(v)))
        );
        const haystack = [
          p.title,
          p.brand ?? "",
          p.category ?? "",
          p.subcategory ?? "",
          p.sport ?? "",
          p.range ?? "",
          md.gender ?? "",
          ...toArray(md.color),
          ...toArray(md.sizes),
          ...attrs,
          // Names of all offer sites (so you can filter by "bergzeit" or "all4cycling")
          ...p.offers.map((o) => o.siteName ?? ""),
        ].join(" \u0001 ").toLowerCase(); // \u0001 = separator to avoid matching across fields
        return haystack.includes(needle);
      });
    }

    const sorted = [...list];
    switch (sortKey) {
      case "price_asc":
        sorted.sort((a, b) => (a.minPrice ?? Infinity) - (b.minPrice ?? Infinity));
        break;
      case "price_desc":
        sorted.sort((a, b) => (b.minPrice ?? -Infinity) - (a.minPrice ?? -Infinity));
        break;
      case "savings_desc":
        sorted.sort((a, b) => (b.savings ?? 0) - (a.savings ?? 0));
        break;
      case "siteCount_desc":
        sorted.sort((a, b) => b.siteCount - a.siteCount);
        break;
      case "rating_desc":
        sorted.sort((a, b) => (b.metadata.rating ?? 0) - (a.metadata.rating ?? 0));
        break;
    }
    return sorted;
  }, [data, onlyPromos, onlyInStock, minPrice, maxPrice, minSites, activeBrands, activeCategories, activeSubcategories, activeSports, activeRanges, activeGenders, activeColors, activeSizes, sortKey, liveFilter]);

  const statsBySite = useMemo(() => {
    const map = new Map<SiteId, SiteStat>();
    ALL_SITE_IDS.forEach((id) =>
      map.set(id, { id, name: SITES[id].name, status: "empty", count: 0 })
    );
    if (data?.sites) {
      for (const s of data.sites) map.set(s.id, s);
    }
    return map;
  }, [data]);

  const cheapestOverall = useMemo(() => {
    const withPrice = filtered.filter((p) => p.minPrice !== null);
    if (withPrice.length === 0) return null;
    return withPrice.reduce((min, p) =>
      (p.minPrice ?? Infinity) < (min.minPrice ?? Infinity) ? p : min
    );
  }, [filtered]);

  const handleSuggestion = (s: string) => {
    setQuery(s);
    setSubmittedQuery(s);
    setActiveBrands(new Set());
    setActiveCategories(new Set());
    setActiveSubcategories(new Set());
    setActiveSports(new Set());
    setActiveRanges(new Set());
    setActiveGenders(new Set());
    setActiveColors(new Set());
    setActiveSizes(new Set());
    refetch();
  };

  const activeFilterCount =
    activeBrands.size +
    activeCategories.size +
    activeSubcategories.size +
    activeSports.size +
    activeRanges.size +
    activeGenders.size +
    activeColors.size +
    activeSizes.size +
    (onlyPromos ? 1 : 0) +
    (onlyInStock ? 1 : 0) +
    (minPrice !== null ? 1 : 0) +
    (maxPrice !== null ? 1 : 0) +
    (minSites > 1 ? 1 : 0);

  const resetFilters = () => {
    setActiveBrands(new Set());
    setActiveCategories(new Set());
    setActiveSubcategories(new Set());
    setActiveSports(new Set());
    setActiveRanges(new Set());
    setActiveGenders(new Set());
    setActiveColors(new Set());
    setActiveSizes(new Set());
    setOnlyPromos(false);
    setOnlyInStock(false);
    setMinPrice(null);
    setMaxPrice(null);
    setMinSites(1);
  };

  return (
    <div className="min-h-screen flex flex-col bg-stone-50 text-stone-900 pb-10">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-stone-200 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/70">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="grid place-items-center h-9 w-9 rounded-lg bg-stone-900 text-white">
              <Mountain className="h-5 w-5" />
            </div>
            <div className="leading-tight">
              <div className="font-semibold tracking-tight">
                OutdoorPrice
                <span className="ml-1.5 font-mono text-[10px] font-normal text-stone-400 align-middle">v{VERSION}</span>
              </div>
              <div className="text-[11px] text-stone-500 -mt-0.5">
                Comparateur cross-site · matching produits
              </div>
            </div>
          </div>
          <form onSubmit={onSubmit} className="ml-auto flex items-center gap-2 flex-1 max-w-xl">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("search.placeholder")}
                className="pl-9 bg-white"
                aria-label={t("search.aria")}
              />
            </div>
            <Button type="submit" disabled={query.trim().length < 2 || isFetching}>
              {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              <span className="hidden sm:inline ml-1">{t("search.compare")}</span>
            </Button>
          </form>
          {/* Language switcher */}
          <div className="flex items-center gap-0.5 shrink-0">
            {(["fr", "en", "es", "de"] as Lang[]).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={`px-1.5 py-1 text-[11px] font-semibold rounded transition-colors ${
                  lang === l
                    ? "bg-stone-900 text-white"
                    : "text-stone-500 hover:text-stone-900 hover:bg-stone-100"
                }`}
                aria-label={l.toUpperCase()}
              >
                {LANG_LABELS[l]}
              </button>
            ))}
          </div>
        </div>
        {submittedQuery && (
          <div className="mx-auto max-w-7xl px-4 pb-3 -mt-1 flex flex-wrap gap-2 items-center text-xs">
            <span className="text-stone-500">{t('search.suggestions')}</span>
            {SUGGESTIONS.slice(0, 6).map((s) => (
              <button
                key={s}
                onClick={() => handleSuggestion(s)}
                className="px-2 py-1 rounded-full bg-stone-100 hover:bg-stone-200 transition border border-stone-200 text-stone-700"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {/* Group selector — sous-header sticky */}
        <div className="border-b border-stone-200 bg-white">
          <div className="mx-auto max-w-7xl px-4 py-2 flex items-center gap-2 flex-wrap">
            <span className="text-[11px] uppercase tracking-wide text-stone-500 mr-1">
              Univers :
            </span>
            {groups.map((g) => {
              const isActive = g.id === activeGroupId;
              return (
                <button
                  key={g.id}
                  onClick={() => selectGroup(g.id)}
                  className={`px-2.5 py-1 rounded-full text-xs border transition flex items-center gap-1.5 ${
                    isActive
                      ? "bg-stone-900 text-white border-stone-900"
                      : `bg-white text-stone-700 border-stone-200 hover:border-stone-400 ${g.accent ?? ""}`
                  }`}
                  title={g.description ?? g.name}
                >
                  {g.icon && <span className="text-[13px]">{g.icon}</span>}
                  <span className="font-medium">{g.name}</span>
                  <span className={`text-[10px] ${isActive ? "opacity-70" : "opacity-60"}`}>
                    ({g.sites.length})
                  </span>
                </button>
              );
            })}
            <button
              onClick={() => setShowGroupEditor(true)}
              className="ml-auto px-2 py-1 rounded-full text-[11px] text-stone-600 hover:bg-stone-100 transition border border-stone-200"
              title={t("groups.manageTitle")}
            >
              Gérer les groupes
            </button>
          </div>
          {showGroupEditor && (
            <GroupMatrixModal
              groups={groups}
              onGroupsChange={persistGroups}
              onClose={() => setShowGroupEditor(false)}
            />
          )}
        </div>
      </header>

      <main className="mx-auto max-w-7xl w-full px-4 py-6 flex-1 grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        {/* Sidebar filtres */}
        <aside className="space-y-4 lg:sticky lg:top-[120px] lg:self-start lg:max-h-[calc(100vh-140px)] lg:overflow-y-auto pr-1">
          {/* Search field — filters displayed products (right area) without re-running search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400" />
            <Input
              type="text"
              value={liveFilter}
              onChange={(e) => setLiveFilter(e.target.value)}
              placeholder={submittedQuery.length >= 2 ? t("liveFilter.placeholder") : t("search.placeholder")}
              className="pl-9 bg-white"
              aria-label={t("liveFilter.aria")}
            />
            {liveFilter && (
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                <Badge variant="secondary" className="text-[10px]">
                  {filtered.length} / {data?.products?.length ?? 0}
                </Badge>
                <button
                  onClick={() => setLiveFilter("")}
                  className="text-stone-400 hover:text-stone-700"
                  aria-label={t("liveFilter.clear")}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Filter className="h-4 w-4" /> Filtres
                  {activeFilterCount > 0 && (
                    <Badge variant="secondary" className="text-[10px]">
                      {activeFilterCount}
                    </Badge>
                  )}
                </CardTitle>
                {activeFilterCount > 0 && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={resetFilters}>
                    <X className="h-3 w-3 mr-1" /> Effacer
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Active filter balloons */}
              {activeFilterCount > 0 && (
                <div className="flex flex-wrap gap-1.5 pb-2 border-b border-stone-100">
                  {Array.from(activeBrands).map((v) => (
                    <FilterBalloon key={`brand-${v}`} label={v} onRemove={() => toggleSet(setActiveBrands)(v)} />
                  ))}
                  {Array.from(activeCategories).map((v) => (
                    <FilterBalloon key={`cat-${v}`} label={v} onRemove={() => toggleSet(setActiveCategories)(v)} />
                  ))}
                  {Array.from(activeSubcategories).map((v) => (
                    <FilterBalloon key={`subcat-${v}`} label={v} onRemove={() => toggleSet(setActiveSubcategories)(v)} />
                  ))}
                  {Array.from(activeSports).map((v) => (
                    <FilterBalloon key={`sport-${v}`} label={v} onRemove={() => toggleSet(setActiveSports)(v)} />
                  ))}
                  {Array.from(activeRanges).map((v) => (
                    <FilterBalloon key={`range-${v}`} label={v} onRemove={() => toggleSet(setActiveRanges)(v)} />
                  ))}
                  {Array.from(activeGenders).map((v) => (
                    <FilterBalloon key={`gender-${v}`} label={v} onRemove={() => toggleSet(setActiveGenders)(v)} />
                  ))}
                  {Array.from(activeColors).map((v) => (
                    <FilterBalloon key={`color-${v}`} label={v} onRemove={() => toggleSet(setActiveColors)(v)} />
                  ))}
                  {Array.from(activeSizes).map((v) => (
                    <FilterBalloon key={`size-${v}`} label={v} onRemove={() => toggleSet(setActiveSizes)(v)} />
                  ))}
                  {onlyPromos && (
                    <FilterBalloon label="Promos" onRemove={() => setOnlyPromos(false)} />
                  )}
                  {onlyInStock && (
                    <FilterBalloon label="En stock" onRemove={() => setOnlyInStock(false)} />
                  )}
                  {minPrice !== null && (
                    <FilterBalloon label={`Min ${minPrice}€`} onRemove={() => setMinPrice(null)} />
                  )}
                  {maxPrice !== null && (
                    <FilterBalloon label={`Max ${maxPrice}€`} onRemove={() => setMaxPrice(null)} />
                  )}
                  {minSites > 1 && (
                    <FilterBalloon label={`Min ${minSites} sites`} onRemove={() => setMinSites(1)} />
                  )}
                </div>
              )}
              <div>
                <Label className="text-xs text-stone-500">{t('sidebar.sort')}</Label>
                <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="siteCount_desc">{t('sidebar.sortSiteCount')}</SelectItem>
                    <SelectItem value="price_asc">{t('sidebar.sortPriceAsc')}</SelectItem>
                    <SelectItem value="price_desc">{t('sidebar.sortPriceDesc')}</SelectItem>
                    <SelectItem value="savings_desc">{t('sidebar.sortSavings')}</SelectItem>
                    <SelectItem value="rating_desc">{t('sidebar.sortRating')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Separator />

              <div className="space-y-2">
                <Label className="text-xs text-stone-500">{t('sidebar.display')}</Label>
                <div className="flex items-center justify-between">
                  <span className="text-sm">{t('sidebar.promosOnly')}</span>
                  <Switch checked={onlyPromos} onCheckedChange={setOnlyPromos} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">{t('sidebar.inStockOnly')}</span>
                  <Switch checked={onlyInStock} onCheckedChange={setOnlyInStock} />
                </div>
              </div>

              <Separator />

              {/* Prix min/max avec slider double sens */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-stone-500">{t('sidebar.priceRange')}</Label>
                  {(minPrice !== null || maxPrice !== null) && (
                    <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1" onClick={() => { setMinPrice(null); setMaxPrice(null); }}>
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
                {/* Champs texte min / max côte à côte */}
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <Input
                      type="number"
                      min={0}
                      placeholder={t("sidebar.priceMin")}
                      value={minPrice ?? ""}
                      onChange={(e) => {
                        const v = e.target.value ? Number(e.target.value) : null;
                        setMinPrice(v);
                        // Empêcher min > max
                        if (v !== null && maxPrice !== null && v > maxPrice) setMaxPrice(v);
                      }}
                      className="bg-white text-xs h-8"
                    />
                  </div>
                  <span className="text-stone-400 text-xs">—</span>
                  <div className="flex-1">
                    <Input
                      type="number"
                      min={0}
                      placeholder={t("sidebar.priceMax")}
                      value={maxPrice ?? ""}
                      onChange={(e) => {
                        const v = e.target.value ? Number(e.target.value) : null;
                        setMaxPrice(v);
                        // Empêcher max < min
                        if (v !== null && minPrice !== null && v < minPrice) setMinPrice(v);
                      }}
                      className="bg-white text-xs h-8"
                    />
                  </div>
                </div>
                {/* Slider calibré sur les prix observés */}
                {data?.filters?.priceRange && (() => {
                  const pr = data.filters.priceRange;
                  const lo = minPrice ?? pr.min;
                  const hi = maxPrice ?? pr.max;
                  // Si min et max sont égaux (un seul prix), on élargit la plage pour que le slider soit utilisable
                  const sliderMin = pr.min;
                  const sliderMax = pr.max === pr.min ? pr.min + 1 : pr.max;
                  return (
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min={sliderMin}
                          max={sliderMax}
                          value={Math.min(lo, sliderMax)}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            setMinPrice(v);
                            if (v > hi) setMaxPrice(v);
                          }}
                          className="flex-1 accent-stone-900"
                          aria-label={t("sidebar.priceMinAria")}
                        />
                        <input
                          type="range"
                          min={sliderMin}
                          max={sliderMax}
                          value={Math.max(hi, sliderMin)}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            setMaxPrice(v);
                            if (v < lo) setMinPrice(v);
                          }}
                          className="flex-1 accent-stone-900"
                          aria-label={t("sidebar.priceMaxAria")}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] text-stone-400">
                        <span>{sliderMin}€</span>
                        <span>{sliderMax}€</span>
                      </div>
                    </div>
                  );
                })()}
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-stone-500">
                  Sites proposant le produit : min {minSites}
                </Label>
                <input
                  type="range"
                  min={1}
                  max={9}
                  value={minSites}
                  onChange={(e) => setMinSites(Number(e.target.value))}
                  className="w-full accent-stone-900"
                />
              </div>

              <Separator />

              {/* Export CSV */}
              {filtered.length > 0 && (
                <div className="space-y-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => downloadCsv(filtered)}
                  >
                    <Download className="h-3.5 w-3.5 mr-1.5" />
                    Exporter CSV ({filtered.length} produits)
                  </Button>
                  {isDebugMode && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"
                      onClick={() => downloadCategorizedCsv(filtered)}
                      title="Une ligne par produit, avec toutes les métadonnées de classification (sport, catégorie, sous-cat, gamme, genre, EAN, score de match, raison du match). Visible seulement en mode dev-debug."
                    >
                      <Layers className="h-3.5 w-3.5 mr-1.5" />
                      Debug CSV catégorisé ({filtered.length} produits)
                    </Button>
                  )}
                </div>
              )}

              <Separator />
              {data && data.filters.brands.length > 0 && (
                <FilterSection
                  title={t("filter.brands")}
                  icon={<Tag className="h-3.5 w-3.5" />}
                  options={data.filters.brands}
                  active={activeBrands}
                  onToggle={toggleSet(setActiveBrands)}
                />
              )}

              {/* Filtres dynamiques : sports */}
              {data && data.filters.sports.length > 0 && (
                <FilterSection
                  title={t("filter.sports")}
                  icon={<Mountain className="h-3.5 w-3.5" />}
                  options={data.filters.sports}
                  active={activeSports}
                  onToggle={toggleSet(setActiveSports)}
                />
              )}

              {/* Filtres dynamiques : catégories */}
              {data && data.filters.categories.length > 0 && (
                <FilterSection
                  title={t("filter.categories")}
                  icon={<Layers className="h-3.5 w-3.5" />}
                  options={data.filters.categories}
                  active={activeCategories}
                  onToggle={toggleSet(setActiveCategories)}
                />
              )}

              {/* Filtres dynamiques : sous-catégories */}
              {data && data.filters.subcategories.length > 0 && (
                <FilterSection
                  title={t("filter.subcategories")}
                  icon={<Layers className="h-3.5 w-3.5" />}
                  options={data.filters.subcategories}
                  active={activeSubcategories}
                  onToggle={toggleSet(setActiveSubcategories)}
                />
              )}

              {/* Filtres dynamiques : gamme */}
              {data && data.filters.ranges.length > 0 && (
                <FilterSection
                  title={t("filter.range")}
                  icon={<Star className="h-3.5 w-3.5" />}
                  options={data.filters.ranges}
                  active={activeRanges}
                  onToggle={toggleSet(setActiveRanges)}
                />
              )}

              {/* Filtres dynamiques : genre */}
              {data && data.filters.genders.length > 0 && (
                <FilterSection
                  title={t("filter.gender")}
                  icon={<Star className="h-3.5 w-3.5" />}
                  options={data.filters.genders}
                  active={activeGenders}
                  onToggle={toggleSet(setActiveGenders)}
                />
              )}

              {/* Filtres dynamiques : couleurs */}
              {data && data.filters.colors.length > 0 && (
                <FilterSection
                  title={t("filter.colors")}
                  icon={<Star className="h-3.5 w-3.5" />}
                  options={data.filters.colors}
                  active={activeColors}
                  onToggle={toggleSet(setActiveColors)}
                />
              )}

              {/* Filtres dynamiques : tailles */}
              {data && data.filters.sizes.length > 0 && (
                <FilterSection
                  title={t("filter.sizes")}
                  icon={<Star className="h-3.5 w-3.5" />}
                  options={data.filters.sizes}
                  active={activeSizes}
                  onToggle={toggleSet(setActiveSizes)}
                />
              )}

              <Separator />

              <div>
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-stone-500">
                    Sites ({selectedSites.length}/{ALL_SITE_IDS.length})
                  </Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 text-[10px] px-1"
                    onClick={() => setShowShopTree(!showShopTree)}
                  >
                    {showShopTree ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </Button>
                </div>

                <div className="mt-2 space-y-1 max-h-80 overflow-y-auto pr-1">
                  {/* Treeview : pour chaque groupe builtin, afficher ses sites */}
                  {DEFAULT_GROUPS.filter((g) => g.id !== "all").map((group) => {
                    const groupSites = group.sites.filter((id) => ALL_SITE_IDS.includes(id));
                    if (groupSites.length === 0) return null;

                    // Compter les sites sélectionnés dans ce groupe
                    const selectedInGroup = groupSites.filter((id) => selectedSites.includes(id));
                    const allSelected = selectedInGroup.length === groupSites.length;
                    const someSelected = selectedInGroup.length > 0 && !allSelected;

                    return (
                      <div key={group.id} className="rounded-md">
                        {/* Ligne de groupe (en-tête) */}
                        <div className="flex items-center gap-1 px-1 py-1 bg-stone-100 rounded-t-md sticky top-0 z-10">
                          <Checkbox
                            checked={allSelected}
                            ref={undefined}
                            onCheckedChange={() => {
                              if (allSelected) {
                                // Tout désélectionner
                                setUserOff((prev) => {
                                  const next = new Set(prev);
                                  groupSites.forEach((id) => next.add(id));
                                  return next;
                                });
                              } else {
                                // Tout sélectionner
                                setUserOff((prev) => {
                                  const next = new Set(prev);
                                  groupSites.forEach((id) => next.delete(id));
                                  return next;
                                });
                              }
                            }}
                            className="data-[state=indeterminate]:opacity-50"
                            {...(someSelected ? { "data-state": "indeterminate" as const } : {})}
                          />
                          <span className="text-[11px] font-semibold text-stone-700 flex-1">
                            {group.icon} {group.name}
                          </span>
                          <span className="text-[10px] text-stone-500 tabular-nums">
                            {selectedInGroup.length}/{groupSites.length}
                          </span>
                        </div>
                        {/* Sites du groupe */}
                        {showShopTree && (
                          <div className="ml-1 border-l border-stone-200 pl-1">
                            {groupSites.map((id) => {
                              const meta = SITES[id];
                              const stat = statsBySite.get(id);
                              const isSelected = selectedSites.includes(id);
                              return (
                                <label
                                  key={id}
                                  className="flex items-center gap-2 cursor-pointer rounded p-1 hover:bg-stone-50 group/row"
                                >
                                  <Checkbox
                                    checked={isSelected}
                                    onCheckedChange={() => toggleSite(id)}
                                    className="h-3.5 w-3.5"
                                  />
                                  <span
                                    className={`text-xs font-medium px-1.5 py-0.5 rounded ${meta.accent} flex-1 truncate`}
                                  >
                                    {meta.name}
                                  </span>
                                  <span className="text-[10px] text-stone-500 tabular-nums text-right min-w-[3rem]">
                                    {stat && stat.count > 0 ? (
                                      <span className="font-medium text-stone-700">{stat.count}</span>
                                    ) : stat?.status === "error" ? (
                                      <span className="text-red-500">err</span>
                                    ) : stat?.status === "empty" ? (
                                      <span className="text-stone-400">0</span>
                                    ) : (
                                      <span className="text-stone-300">—</span>
                                    )}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {/* Sites non groupés (au cas où) */}
                  {(() => {
                    const grouped = new Set(DEFAULT_GROUPS.flatMap((g) => g.sites));
                    const ungrouped = ALL_SITE_IDS.filter((id) => !grouped.has(id));
                    if (ungrouped.length === 0) return null;
                    return (
                      <div className="rounded-md">
                        <div className="text-[11px] font-semibold text-stone-700 px-1 py-1 bg-stone-100 rounded-t-md">
                          {t("sidebar.other")}
                        </div>
                        {showShopTree && (
                          <div className="ml-1 border-l border-stone-200 pl-1">
                            {ungrouped.map((id) => {
                              const meta = SITES[id];
                              const stat = statsBySite.get(id);
                              const isSelected = selectedSites.includes(id);
                              return (
                                <label key={id} className="flex items-center gap-2 cursor-pointer rounded p-1 hover:bg-stone-50">
                                  <Checkbox checked={isSelected} onCheckedChange={() => toggleSite(id)} className="h-3.5 w-3.5" />
                                  <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${meta.accent} flex-1 truncate`}>
                                    {meta.name}
                                  </span>
                                  <span className="text-[10px] text-stone-500 tabular-nums text-right min-w-[3rem]">
                                    {stat && stat.count > 0 ? stat.count : "—"}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
                <div className="flex gap-2 mt-2">
                  <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={() => setUserOff(new Set())}>
                    Tout
                  </Button>
                  <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={() => setUserOff(new Set(computedGroupSites))}>
                    Aucun
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </aside>

        {/* Contenu principal */}
        <section className="space-y-4 min-w-0">
          {!submittedQuery && <EmptyState onSuggestion={handleSuggestion} />}

          {submittedQuery && isLoading && <LoadingState />}

          {submittedQuery && data && (
            <>
              {/* Bandeau résumé */}
              <Card>
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-stone-500">{t('summary.query')}</div>
                      <div className="font-semibold truncate max-w-[220px]">“{data.query}”</div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-stone-500">{t('summary.matched')}</div>
                      <div className="font-semibold">{data.totalProducts}</div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-stone-500">{t('summary.sitesResponding')}</div>
                      <div className="font-semibold">
                        {data.sites.filter((s) => s.status === "ok").length} / {data.sites.length}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-stone-500">{t('summary.phases')}</div>
                      <div className="text-xs font-medium text-stone-700">
                        <span title="Recherche">🔎 {(data.phases.searchMs / 1000).toFixed(1)}s</span>
                        {" · "}
                        <span title="Enrichissement pages produits">📄 {(data.phases.enrichMs / 1000).toFixed(1)}s</span>
                        {" · "}
                        <span title="Matching cross-site">🔗 {(data.phases.matchMs / 1000).toFixed(2)}s</span>
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-stone-500">{t('summary.duration')}</div>
                      <div className="font-semibold flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {(data.durationMs / 1000).toFixed(2)}s
                      </div>
                    </div>
                    {cheapestOverall && (
                      <div className="ml-auto">
                        <div className="text-[11px] uppercase tracking-wide text-stone-500">{t('summary.cheapest')}</div>
                        <div className="font-semibold text-emerald-700 flex items-center gap-1">
                          <TrendingDown className="h-3 w-3" />
                          {formatPrice(cheapestOverall.minPrice, cheapestOverall.minCurrency)}
                          <span className="text-[11px] font-normal text-stone-500">
                            @ {cheapestOverall.brand ?? cheapestOverall.title.slice(0, 24)}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Groupe vide : message informatif */}
                  {activeGroupId !== "all" && computedGroupSites.length === 0 && (
                    <div className="mt-3 flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
                      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                      <div>
                        <strong>Groupe « {groups.find((g) => g.id === activeGroupId)?.name} » vide.</strong>
                        {" "}Ce groupe ne contient actuellement aucune boutique. Ajoutez des boutiques
                        via les plugins correspondants, ou créez un groupe personnalisé avec les
                        boutiques existantes en cliquant sur « + Groupe ».
                      </div>
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    {data.sites.map((s) => (
                      <Badge
                        key={s.id}
                        variant="outline"
                        className={`py-1.5 px-2.5 gap-1.5 ${SITES[s.id].accent} ${s.status === "ok" ? "" : "opacity-60"}`}
                      >
                        {s.status === "ok" && <CheckCircle2 className="h-3 w-3" />}
                        {s.status === "error" && <XCircle className="h-3 w-3" />}
                        {s.status === "empty" && <AlertTriangle className="h-3 w-3" />}
                        <span className="font-medium">{s.name}</span>
                        <span className="text-[10px] opacity-80">
                          {s.count > 0 ? `(${s.count})` : s.status}
                        </span>
                        {s.status === "error" && s.error && (
                          <span className="text-[10px] opacity-60 italic ml-1" title={s.error}>
                            {s.error.slice(0, 50)}
                          </span>
                        )}
                      </Badge>
                    ))}
                  </div>

                  {data.totalProducts === 0 && data.sites.some((s) => s.status !== "ok") && (
                    <div className="mt-3 flex items-start gap-2 rounded-md bg-red-50 border border-red-200 p-3 text-xs text-red-900">
                      <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
                      <div>
                        <strong>{t('results.noProducts')}</strong>
                        <div className="mt-1 space-y-0.5">
                          {data.sites.filter((s) => s.status !== "ok").map((s) => (
                            <div key={s.id}>
                              <span className="font-medium">{s.name}</span> :{" "}
                              {s.status === "error" && s.error ? s.error : "0 résultat"}
                              {s.error?.includes("403") && (
                                <span className="text-red-700"> — bloqué par Cloudflare (IP data-center non acceptée). Ce site fonctionne depuis une IP résidentielle.</span>
                              )}
                              {s.status === "empty" && s.id === "sportconrad" && (
                                <span className="text-red-700"> — API Makaira répond 500 depuis le data-center.</span>
                              )}
                              {s.error?.includes("Failed to fetch") && (
                                <span className="text-red-700"> — challenge anti-bot non résolu, même via Playwright.</span>
                              )}
                            </div>
                          ))}
                        </div>
                        <div className="mt-2 text-stone-600">
                          Astuce : dé-sélectionne les sites en erreur dans la sidebar et relance la recherche.
                          Les sites fonctionnels (Bergzeit, Sport Bittl, Ekosport, Montaz, Snowleader, Glisshop)
                          renvoient des produits en quelques secondes.
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Liste produits matchés */}
              {filtered.length === 0 ? (
                <Card>
                  <CardContent className="p-8 text-center text-stone-500">
                    {t('results.noMatch')}
                  </CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {filtered.map((p) => (
                    <MatchedProductCard key={p.id} product={p} />
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </main>

      <footer className="mt-auto border-t border-stone-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-4 text-xs text-stone-500 flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1.5">
            <Globe className="h-3 w-3" />
            11 sites agrégés + matching cross-site par EAN/marque/similarité
          </span>
          <span>
            Données indicatives — vérifiez toujours le prix final sur le site marchand.
          </span>
        </div>
      </footer>

      {/* Zone de logs dépliable (sticky en bas) */}
      <LogsPanel logs={logs} onClear={clearLogs} />
    </div>
  );
}

