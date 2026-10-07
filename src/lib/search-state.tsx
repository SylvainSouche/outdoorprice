// =============================================================================
// SearchStateContext — single source of truth for the search UI.
//
// Holds ALL state that was previously scattered across the page.tsx component:
//   - Search query (input + submitted)
//   - Group selection (active group + custom groups from localStorage)
//   - Site toggles (user-off set)
//   - Sort key
//   - Filter toggles (onlyPromos, onlyInStock)
//   - Price range (min + max)
//   - Min sites slider
//   - Live filter text
//   - 8 dynamic filter sets (brands, categories, subcategories, sports, ranges,
//     genders, colors, sizes)
//   - Derived values: filtered[], statsBySite, cheapestOverall, activeFilterCount
//
// Also exposes the event handlers: onSubmit, handleSuggestion, toggleSet,
// toggleSite, selectGroup, persistGroups, resetFilters.
//
// The context value is created ONCE in the provider (via useMemo) so that
// consumers re-render only when the underlying state changes.
// =============================================================================

"use client";

import { createContext, useContext, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  SITES,
  type SiteId,
  type MatchedProduct,
  type DynamicFilters,
  type ShopGroup,
} from "@/lib/scraper/types";
import {
  DEFAULT_GROUPS,
  ALL_SITE_IDS,
  loadCustomGroups,
  saveCustomGroups,
} from "@/lib/scraper/groups";
import {
  logError,
  logSearchResults,
  subscribeLogs,
  type LogEntry,
} from "@/lib/logs";

// ── Types ────────────────────────────────────────────────────────────────

export type SortKey = "price_asc" | "price_desc" | "savings_desc" | "siteCount_desc" | "rating_desc";

export interface SiteStat {
  id: SiteId;
  name: string;
  status: "ok" | "error" | "empty";
  count: number;
  durationMs?: number;
  error?: string;
}

export interface ApiResponse {
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

// ── Helper: defensive toArray (handles string/object/null/undefined) ─────
function toArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  if (typeof v === "string") return [v];
  if (typeof v === "object") return Object.values(v);
  return [v];
}

// ── Context shape ─────────────────────────────────────────────────────────

interface SearchStateValue {
  // Search
  query: string;
  setQuery: (v: string) => void;
  submittedQuery: string;
  isFetching: boolean;
  isLoading: boolean;
  onSubmit: (e?: React.FormEvent) => void;
  handleSuggestion: (s: string) => void;

  // Data
  data: ApiResponse | undefined;
  filtered: MatchedProduct[];
  statsBySite: Map<SiteId, SiteStat>;
  cheapestOverall: MatchedProduct | null;
  logs: LogEntry[];

  // Groups
  groups: ShopGroup[];
  activeGroupId: string;
  selectGroup: (id: string) => void;
  showGroupEditor: boolean;
  setShowGroupEditor: (v: boolean) => void;
  persistGroups: (next: ShopGroup[]) => void;
  computedGroupSites: SiteId[];
  selectedSites: SiteId[];

  // Site toggles
  userOff: Set<SiteId>;
  toggleSite: (id: SiteId) => void;
  setUserOff: React.Dispatch<React.SetStateAction<Set<SiteId>>>;

  // Sort
  sortKey: SortKey;
  setSortKey: (v: SortKey) => void;

  // Toggles
  onlyPromos: boolean;
  setOnlyPromos: (v: boolean) => void;
  onlyInStock: boolean;
  setOnlyInStock: (v: boolean) => void;
  showShopTree: boolean;
  setShowShopTree: (v: boolean) => void;

  // Price range
  minPrice: number | null;
  setMinPrice: (v: number | null) => void;
  maxPrice: number | null;
  setMaxPrice: (v: number | null) => void;

  // Min sites
  minSites: number;
  setMinSites: (v: number) => void;

  // Live filter
  liveFilter: string;
  setLiveFilter: (v: string) => void;

  // Dynamic filter sets
  activeBrands: Set<string>;
  setActiveBrands: React.Dispatch<React.SetStateAction<Set<string>>>;
  activeCategories: Set<string>;
  setActiveCategories: React.Dispatch<React.SetStateAction<Set<string>>>;
  activeSubcategories: Set<string>;
  setActiveSubcategories: React.Dispatch<React.SetStateAction<Set<string>>>;
  activeSports: Set<string>;
  setActiveSports: React.Dispatch<React.SetStateAction<Set<string>>>;
  activeRanges: Set<string>;
  setActiveRanges: React.Dispatch<React.SetStateAction<Set<string>>>;
  activeGenders: Set<string>;
  setActiveGenders: React.Dispatch<React.SetStateAction<Set<string>>>;
  activeColors: Set<string>;
  setActiveColors: React.Dispatch<React.SetStateAction<Set<string>>>;
  activeSizes: Set<string>;
  setActiveSizes: React.Dispatch<React.SetStateAction<Set<string>>>;
  toggleSet: (setter: React.Dispatch<React.SetStateAction<Set<string>>>) => (v: string) => void;

  // Derived
  activeFilterCount: number;
  resetFilters: () => void;

  // Debug
  isDebugMode: boolean;
  showDebug: boolean;
  setShowDebug: (v: boolean) => void;
}

const SearchStateContext = createContext<SearchStateValue | null>(null);

// ── Provider ─────────────────────────────────────────────────────────────

export function SearchStateProvider({ children }: { children: ReactNode }) {
  // Search
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");

  // Groups
  const [groups, setGroups] = useState<ShopGroup[]>(() => {
    if (typeof window === "undefined") return DEFAULT_GROUPS;
    const custom = loadCustomGroups();
    return custom.length > 0 ? [...DEFAULT_GROUPS, ...custom] : DEFAULT_GROUPS;
  });
  const [activeGroupId, setActiveGroupId] = useState<string>("all");
  const [showGroupEditor, setShowGroupEditor] = useState(false);

  // Site toggles
  const [userOff, setUserOff] = useState<Set<SiteId>>(new Set());
  const computedGroupSites: SiteId[] = useMemo(() => {
    if (activeGroupId === "all") return ALL_SITE_IDS;
    const group = groups.find((g) => g.id === activeGroupId);
    if (!group) return ALL_SITE_IDS;
    return group.sites.filter((s) => ALL_SITE_IDS.includes(s));
  }, [activeGroupId, groups]);
  const selectedSites = useMemo(
    () => computedGroupSites.filter((id) => !userOff.has(id)),
    [computedGroupSites, userOff]
  );

  // Filters
  const [sortKey, setSortKey] = useState<SortKey>("siteCount_desc");
  const [onlyPromos, setOnlyPromos] = useState(false);
  const [onlyInStock, setOnlyInStock] = useState(false);
  const [minPrice, setMinPrice] = useState<number | null>(null);
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  const [minSites, setMinSites] = useState<number>(1);
  const [showShopTree, setShowShopTree] = useState(true);
  const [liveFilter, setLiveFilter] = useState("");
  const isDebugMode = process.env.NEXT_PUBLIC_DEBUG_DUMP === "1";

  // Dynamic filter sets
  const [activeBrands, setActiveBrands] = useState<Set<string>>(new Set());
  const [activeCategories, setActiveCategories] = useState<Set<string>>(new Set());
  const [activeSubcategories, setActiveSubcategories] = useState<Set<string>>(new Set());
  const [activeSports, setActiveSports] = useState<Set<string>>(new Set());
  const [activeRanges, setActiveRanges] = useState<Set<string>>(new Set());
  const [activeGenders, setActiveGenders] = useState<Set<string>>(new Set());
  const [activeColors, setActiveColors] = useState<Set<string>>(new Set());
  const [activeSizes, setActiveSizes] = useState<Set<string>>(new Set());
  const [showDebug, setShowDebug] = useState(false);

  // React Query
  const { data, isLoading, isFetching, refetch } = useQuery<ApiResponse>({
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
      const json = await res.json();
      if (json?.sites) logSearchResults(json.sites);
      return json;
    },
    enabled: submittedQuery.length >= 2,
    staleTime: 60_000,
  });

  // Logs subscription
  const [logs, setLogs] = useState<LogEntry[]>([]);
  useEffect(() => {
    const unsub = subscribeLogs((next) => setLogs(next));
    return unsub;
  }, []);

  // ── Event handlers ───────────────────────────────────────────────────

  const resetDynamicFilters = useCallback(() => {
    setActiveBrands(new Set());
    setActiveCategories(new Set());
    setActiveSubcategories(new Set());
    setActiveSports(new Set());
    setActiveRanges(new Set());
    setActiveGenders(new Set());
    setActiveColors(new Set());
    setActiveSizes(new Set());
  }, []);

  const onSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      const q = query.trim();
      if (q.length < 2) return;
      setSubmittedQuery(q);
      resetDynamicFilters();
      refetch();
    },
    [query, refetch, resetDynamicFilters]
  );

  const handleSuggestion = useCallback(
    (s: string) => {
      setQuery(s);
      setSubmittedQuery(s);
      resetDynamicFilters();
      refetch();
    },
    [refetch, resetDynamicFilters]
  );

  const toggleSet = useCallback(
    (setter: React.Dispatch<React.SetStateAction<Set<string>>>) => (v: string) => {
      setter((prev) => {
        const next = new Set(prev);
        if (next.has(v)) next.delete(v);
        else next.add(v);
        return next;
      });
    },
    []
  );

  const toggleSite = useCallback((id: SiteId) => {
    setUserOff((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectGroup = useCallback((id: string) => {
    setActiveGroupId(id);
    setUserOff(new Set()); // reset user-off when switching groups
  }, []);

  const persistGroups = useCallback((next: ShopGroup[]) => {
    setGroups(next);
    saveCustomGroups(next);
  }, []);

  const resetFilters = useCallback(() => {
    resetDynamicFilters();
    setOnlyPromos(false);
    setOnlyInStock(false);
    setMinPrice(null);
    setMaxPrice(null);
    setMinSites(1);
  }, [resetDynamicFilters]);

  // ── Derived values ───────────────────────────────────────────────────

  const filtered = useMemo<MatchedProduct[]>(() => {
    if (!data) return [];
    let list = data.products;
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
    if (liveFilter.trim()) {
      const needle = liveFilter.trim().toLowerCase();
      list = list.filter((p) => {
        const md = p.metadata ?? ({} as any);
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
          ...p.offers.map((o) => o.siteName ?? ""),
        ].join(" \u0001 ").toLowerCase();
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

  // ── Context value ────────────────────────────────────────────────────
  const value: SearchStateValue = {
    query, setQuery,
    submittedQuery, isFetching, isLoading,
    onSubmit, handleSuggestion,
    data, filtered, statsBySite, cheapestOverall, logs,
    groups, activeGroupId, selectGroup, showGroupEditor, setShowGroupEditor,
    persistGroups, computedGroupSites, selectedSites,
    userOff, toggleSite, setUserOff,
    sortKey, setSortKey,
    onlyPromos, setOnlyPromos, onlyInStock, setOnlyInStock,
    showShopTree, setShowShopTree,
    minPrice, setMinPrice, maxPrice, setMaxPrice,
    minSites, setMinSites,
    liveFilter, setLiveFilter,
    activeBrands, setActiveBrands,
    activeCategories, setActiveCategories,
    activeSubcategories, setActiveSubcategories,
    activeSports, setActiveSports,
    activeRanges, setActiveRanges,
    activeGenders, setActiveGenders,
    activeColors, setActiveColors,
    activeSizes, setActiveSizes,
    toggleSet,
    activeFilterCount, resetFilters,
    isDebugMode, showDebug, setShowDebug,
  };

  return (
    <SearchStateContext.Provider value={value}>
      {children}
    </SearchStateContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────

export function useSearchState(): SearchStateValue {
  const ctx = useContext(SearchStateContext);
  if (!ctx) {
    throw new Error("useSearchState must be used within <SearchStateProvider>");
  }
  return ctx;
}
