# UI Architecture — Component Decomposition

> **Historical context:** `page.tsx` started as a 1420-line monolithic component (v0.14.22). Over 5 iterations (v0.14.23 → v0.14.27) it was decomposed into 8 focused files totaling 1658 lines. The orchestrator itself (`page.tsx`) shrank to 52 lines — a 96.3% reduction.

## File inventory (v0.14.27)

| File | Lines | Role | Local state | Reads from context |
|------|------:|------|-------------|---------------------|
| `src/app/page.tsx` | 52 | **Orchestrator** — wires provider + 3 layout zones | None | None |
| `src/lib/search-state.tsx` | 477 | **Context provider** — single source of truth for all UI state + logic | All 20 useState + useQuery | (IS the context) |
| `src/components/AppHeader.tsx` | 144 | Search bar + language switcher + group selector pills + suggestions | None | query, setQuery, isFetching, groups, activeGroupId, selectGroup, showGroupEditor, persistGroups, onSubmit, handleSuggestion |
| `src/components/FilterSidebar.tsx` | 473 | All filter controls (live filter, sort, toggles, price slider, min-sites, CSV export, 8 filter sections, shop tree, logs panel) | None | liveFilter, sortKey, onlyPromos, onlyInStock, minPrice, maxPrice, minSites, showShopTree, activeBrands...activeSizes, selectedSites, statsBySite, filtered, activeFilterCount, resetFilters, toggleSet, toggleSite, setUserOff, isDebugMode, logs |
| `src/components/ProductList.tsx` | 91 | Results area — EmptyState / LoadingState / ResultsSummary + product grid + AppFooter | None | submittedQuery, isLoading, data, filtered, cheapestOverall, groups, handleSuggestion |
| `src/components/ResultsSummary.tsx` | 174 | Summary card — query/matched/sites/phases/cheapest + per-site badges + error messages | None | (props only — takes 10 props from parent) |
| `src/components/LoadingState.tsx` | 51 | Skeleton cards shown during search | None | None (pure presentational) |
| `src/components/GroupMatrixModal.tsx` | 196 | Group editor modal — matrix of sites × groups with create/delete | 2 useState (new group name + icon input) | (props only — takes 3 props) |
| **Total** | **1658** | | | |

## Architecture diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  page.tsx (52 lines)                                             │
│                                                                  │
│  <SearchStateProvider>                                           │
│    <div>                                                         │
│      <AppHeader />                                               │
│      <main>                                                      │
│        <FilterSidebar />                                         │
│        <ProductList />                                           │
│      </main>                                                     │
│      <AppFooter />                                               │
│    </div>                                                        │
│  </SearchStateProvider>                                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ provides context value
                              ▼
        ┌─────────────────────────────────────────┐
        │  SearchStateProvider                      │
        │  (search-state.tsx — 477 lines)          │
        │                                           │
        │  ┌─ STATE (20 useState) ──────────────┐ │
        │  │  query, submittedQuery              │ │
        │  │  groups, activeGroupId, showGroupEd│ │
        │  │  userOff                            │ │
        │  │  sortKey, onlyPromos, onlyInStock   │ │
        │  │  minPrice, maxPrice, minSites       │ │
        │  │  showShopTree, liveFilter           │ │
        │  │  activeBrands, activeCategories...  │ │
        │  │  activeSports, activeRanges,        │ │
        │  │  activeGenders, activeColors,       │ │
        │  │  activeSizes                        │ │
        │  │  showDebug, logs                    │ │
        │  └─────────────────────────────────────┘ │
        │                                           │
        │  ┌─ DERIVED (useMemo) ─────────────────┐ │
        │  │  computedGroupSites: SiteId[]       │ │
        │  │  selectedSites: SiteId[]            │ │
        │  │  filtered: MatchedProduct[]          │ │
        │  │  statsBySite: Map<SiteId, SiteStat> │ │
        │  │  cheapestOverall: MatchedProduct?   │ │
        │  │  activeFilterCount: number          │ │
        │  └─────────────────────────────────────┘ │
        │                                           │
        │  ┌─ DATA FETCHING ─────────────────────┐ │
        │  │  useQuery(["search", ...])           │ │
        │  │    → ApiResponse | undefined          │ │
        │  │    POST /api/search                  │ │
        │  └─────────────────────────────────────┘ │
        │                                           │
        │  ┌─ EVENT HANDLERS (useCallback) ───────┐│
        │  │  onSubmit(e?)                        │ │
        │  │  handleSuggestion(s)                │ │
        │  │  toggleSet(setter)(v)                │ │
        │  │  toggleSite(id)                      │ │
        │  │  selectGroup(id)                    │ │
        │  │  persistGroups(next)                │ │
        │  │  resetFilters()                     │ │
        │  │  resetDynamicFilters()              │ │
        │  └─────────────────────────────────────┘ │
        └───────────────────────────────────────────┘
                              │
                              │ useSearchState() hook
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
┌─────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│  AppHeader       │ │  FilterSidebar    │ │  ProductList     │
│  (144 lines)     │ │  (473 lines)      │ │  (91 lines)      │
│                  │ │                    │ │                   │
│  Reads:          │ │  Reads:            │ │  Reads:          │
│   query          │ │   liveFilter       │ │   submittedQuery │
│   setQuery       │ │   sortKey          │ │   isLoading      │
│   isFetching     │ │   onlyPromos       │ │   data           │
│   groups         │ │   onlyInStock      │ │   filtered       │
│   activeGroupId  │ │   minPrice/maxPric │ │   cheapestOverall│
│   selectGroup    │ │   minSites         │ │   activeGroupId  │
│   showGroupEdit  │ │   activeBrands...  │ │   computedGroupS │
│   persistGroups  │ │   selectedSites    │ │   groups         │
│   onSubmit       │ │   statsBySite      │ │   handleSuggest  │
│   handleSuggest  │ │   filtered         │ │                   │
│                  │ │   activeFilterCount│ │  Renders:         │
│  Renders:        │ │   resetFilters     │ │   EmptyState      │
│   search input   │ │   toggleSet        │ │   LoadingState    │
│   lang switcher  │ │   toggleSite       │ │   ResultsSummary │
│   group pills    │ │   setUserOff       │ │   product grid    │
│   suggestions    │ │   isDebugMode      │ │   AppFooter       │
│   GroupMatrixMod │ │   logs             │ │                   │
│                  │ │                    │ │                   │
│  Renders:        │ │  Renders:          │ │                   │
│   <header>       │ │   <aside>          │ │   <section>       │
│   - logo         │ │   - live filter    │ │   - summary card  │
│   - search form  │ │   - filter card   │ │   - product grid  │
│   - lang buttons │ │   - sort select    │ │                   │
│   - suggestions  │ │   - toggles        │ │                   │
│   - group pills  │ │   - price slider   │ │                   │
│   - manage btn   │ │   - min-sites      │ │                   │
│   - GroupModal   │ │   - CSV export    │ │                   │
│                  │ │   - 8 filter sects│ │                   │
│                  │ │   - shop tree     │ │                   │
│                  │ │   <LogsPanel>     │ │                   │
└─────────────────┘ └──────────────────┘ └──────────────────┘
                              │
                              │ renders child components
                              ▼
        ┌───────────────────────────────────────────┐
        │  Child components (pure presentational)    │
        │                                            │
        │  ResultsSummary (174 lines)               │
        │    ↳ props: query, sites, phases,         │
        │      cheapestOverall, groups, ...         │
        │                                            │
        │  LoadingState (51 lines)                   │
        │    ↳ no props                              │
        │                                            │
        │  GroupMatrixModal (196 lines)              │
        │    ↳ props: groups, onGroupsChange, onClose│
        │    ↳ local state: newGroupName, newGroupIc│
        │                                            │
        │  MatchedProductCard                        │
        │  OfferRow                                  │
        │  ColorSwatches                             │
        │  FilterSection                             │
        │  FilterBalloon                             │
        │  EmptyState                                │
        │  LogsPanel                                 │
        └───────────────────────────────────────────┘
```

## Data flow

### State ownership

**ALL UI state lives in `SearchStateProvider`** — no component below it has its own state (except `GroupMatrixModal`'s 2 input fields for the new-group form).

```
SearchStateProvider (owns ALL state)
        │
        │ provides via React Context
        ▼
  useSearchState() hook
        │
        ├── AppHeader       (reads: search + group state)
        ├── FilterSidebar   (reads: all filter state)
        └── ProductList     (reads: results state)
```

### Event flow

Events bubble up through context handlers — components never modify state directly:

```
User clicks "Outdoor" group pill in AppHeader
        │
        ▼
  selectGroup("outdoor")     ← handler from context
        │
        ▼
  SearchStateProvider:
    setActiveGroupId("outdoor")
    setUserOff(new Set())    ← reset disabled sites
        │
        ▼
  computedGroupSites recomputes (useMemo)
  selectedSites recomputes (useMemo)
  useQuery refetches (queryKey changed)
        │
        ▼
  data updates → filtered recomputes → ProductList re-renders
```

### Filter flow

```
User toggles "Dynafit" brand in FilterSidebar
        │
        ▼
  toggleSet(setActiveBrands)("Dynafit")  ← handler from context
        │
        ▼
  activeBrands state updates
        │
        ▼
  filtered recomputes (useMemo dependency: activeBrands)
        │
        ▼
  ProductList re-renders with new filtered list
  FilterSidebar re-renders (activeFilterCount changed)
```

## Decomposition history

| Version | page.tsx lines | What was extracted | Cumulative reduction |
|---------|---------------:|--------------------|---------------------:|
| v0.14.22 (start) | 1420 | — | 0% |
| v0.14.23 | 1199 | LoadingState, GroupMatrixModal | −15.5% |
| v0.14.26 | 1089 | ResultsSummary | −23.3% |
| v0.14.27 | **52** | AppHeader, FilterSidebar, ProductList + SearchStateProvider | **−96.3%** |

## Design principles applied

### 1. Single source of truth
All state in one provider — no prop drilling, no duplicated state, no sync bugs.

### 2. Context over props
With 20+ state variables and 7+ handlers, passing them as props would require 30+ props per component. Context eliminates this — each component reads only what it needs via `useSearchState()`.

### 3. Pure presentational leaf components
`LoadingState`, `ResultsSummary`, `GroupMatrixModal` take props and render. No context dependency. Easy to test in isolation, easy to reuse.

### 4. Orchestrator pattern
`page.tsx` does exactly ONE thing: compose the layout. No logic, no state, no handlers. If you want to understand the page structure, read 52 lines instead of 1420.

### 5. Co-location of related concerns
- State + logic → `search-state.tsx` (one file)
- Header UI → `AppHeader.tsx`
- Filter UI → `FilterSidebar.tsx`
- Results UI → `ProductList.tsx`

Each file has a single, clear responsibility. To add a new filter, you touch 2 files: `search-state.tsx` (add state) + `FilterSidebar.tsx` (add UI). Nothing else changes.

## How to add a new feature

### Add a new filter (e.g. "material" filter)

1. **`search-state.tsx`**: Add `const [activeMaterials, setActiveMaterials] = useState<Set<string>>(new Set())`
2. **`search-state.tsx`**: Add `activeMaterials` to the `filtered` useMemo + to the context value
3. **`FilterSidebar.tsx`**: Add a `<FilterSection>` for materials (reads `activeMaterials` from context)
4. Done. No other file changes.

### Add a new sort option

1. **`search-state.tsx`**: Add the case to the `switch (sortKey)` block in the `filtered` useMemo
2. **`FilterSidebar.tsx`**: Add a `<SelectItem>` for the new option
3. Done.

### Add a new result view (e.g. "compare" mode)

1. **`ProductList.tsx`**: Add the new view alongside `EmptyState`/`LoadingState`/`ResultsSummary`
2. Done. (Or add a new tab/switch in `FilterSidebar` if it needs a toggle.)

## Bugs fixed during decomposition

1. **`selectGroup` was referenced but never defined** — clicking a group pill would crash at runtime. Fixed in v0.14.27: now properly defined in the context.

2. **`toggleSite` was referenced but never defined** — clicking a site checkbox would crash. Fixed in v0.14.27.

3. **Alltricks price regex** — `\d{1,3}` didn't match 4-digit prices (e.g. "1099,99"). Fixed to `\d{1,4}` in v0.14.26 during fixture test work.

4. **Union-Find score aggregation** — `matchScores` entries became orphaned when groups merged transitively. Fixed in v0.14.23 (P1.3).

## Testing strategy

The decomposition makes testing easier:

- **Pure functions** (parseHtml, extractProducts, matchProducts, etc.) → unit tested with fixtures (175 tests)
- **Context provider** → could be tested by rendering `<SearchStateProvider>` + a test consumer (not done yet, but the isolation makes it possible)
- **Leaf components** (LoadingState, ResultsSummary, GroupMatrixModal) → could be tested with React Testing Library (not done yet)
- **Full page** → Playwright E2E (not done yet, but the small page.tsx makes it easier to write)
