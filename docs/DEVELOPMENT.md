# Development Documentation — OutdoorPrice

> Architecture, intermodule communication, module functions, and design choices.
> For installation/customization see [CONFIGURATION.md](./CONFIGURATION.md).
> For end-user features see [USER_GUIDE.md](./USER_GUIDE.md).

## Table of Contents

1. [Project Structure](#1-project-structure)
2. [Architecture Overview](#2-architecture-overview)
3. [Scraper Engine (`src/lib/scraper/`)](#3-scraper-engine)
4. [API Routes](#4-api-routes)
5. [UI Layer (`src/app/page.tsx`)](#5-ui-layer)
6. [Supporting Libraries](#6-supporting-libraries)
7. [Chrome Extension](#7-chrome-extension)
8. [Build & Release System](#8-build--release-system)
9. [Test Suite](#9-test-suite)
10. [Key Design Decisions](#10-key-design-decisions)

---

## 1. Project Structure

```
outdoorprice/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── api/
│   │   │   ├── route.ts              # GET / healthcheck
│   │   │   ├── groups/route.ts       # GET/POST/DELETE /api/groups
│   │   │   └── search/route.ts       # POST/GET /api/search (main)
│   │   ├── layout.tsx                # RootLayout (fonts + Providers)
│   │   ├── page.tsx                  # Single-page UI (2000+ lines)
│   │   ├── providers.tsx             # QueryClientProvider + LangProvider
│   │   └── globals.css
│   ├── components/ui/                # shadcn/ui primitives
│   ├── hooks/                        # use-mobile, use-toast
│   └── lib/
│       ├── cache.ts                  # In-memory LRU cache
│       ├── csv.ts                    # CSV export (offers + categorized)
│       ├── debug.ts                  # DEBUG_DUMP session writer
│       ├── i18n.tsx                  # FR/EN/ES/DE translations
│       ├── logs.ts                   # Client log buffer
│       ├── version.ts               # VERSION constant
│       └── scraper/                  # ⭐ Core scraper engine
│           ├── browserPool.ts        # Shared Chromium instance
│           ├── enrich.ts             # Product-page metadata extraction
│           ├── error.ts              # ScraperError v2 (typed categories)
│           ├── filters.ts            # DynamicFilters builder
│           ├── groups.ts             # Builtin + custom group management
│           ├── http.ts               # HTTP client + Playwright fallback
│           ├── matcher.ts            # Cross-site Union-Find matcher
│           ├── playwright.ts         # Playwright wrapper
│           ├── registry.ts           # Orchestrator
│           ├── taxonomy.ts            # Category normalizer
│           ├── types.ts              # Shared types + SITES record
│           └── sites/                 # 20 shop scrapers
│               ├── index.ts          # Barrel file
│               ├── bergzeit.ts       # ...
│               └── all4cycling.ts    # (20 files total)
├── extension/                        # Chrome DevTools extension
├── scripts/                          # CLI tools + build/release
├── tests/                            # Vitest unit tests
├── Makefile                          # Main entry point
├── package.json
├── next.config.ts
├── eslint.config.mjs
├── PROTOCOLES.md                     # Per-shop scraping protocols
├── README.md
├── VERSION                           # e.g. "0.11.5"
└── worklog.md                        # Dev journal
```

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Browser (Client)                             │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐    │
│  │ Search   │  │ Sidebar  │  │ Product  │  │ Logs Panel │    │
│  │ Header   │  │ Filters  │  │ Grid     │  │            │    │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └─────┬──────┘    │
│       │              │              │              │            │
│       └──────────────┴──────────────┴──────────────┘           │
│                          │ useQuery (React Query)               │
│                          ▼                                      │
│                   fetch("/api/search")                          │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTP POST
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Next.js Server (API Route)                    │
│                                                                  │
│  /api/search/route.ts                                           │
│    1. Validate query + sites                                     │
│    2. Check in-memory cache (LRU, 2-min TTL)                    │
│    3. Call aggregateMatched(query, { onlySites })               │
│    4. Cache result + return JSON                                │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Scraper Engine (registry.ts)                   │
│                                                                  │
│  Phase 1: SEARCH (parallel)                                      │
│    ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐            │
│    │bergzeit │ │ekosport │ │glisshop│ │ ... 20   │            │
│    │.ts      │ │.ts      │ │.ts     │ │ scrapers  │            │
│    └────┬────┘ └────┬────┘ └────┬────┘ └────┬─────┘            │
│         │           │           │            │                    │
│         ▼           ▼           ▼            ▼                    │
│    ┌─────────────────────────────────────────────┐             │
│    │  http.ts (axios + Playwright fallback)       │             │
│    │  browserPool.ts (shared Chromium)            │             │
│    └─────────────────────────────────────────────┘             │
│                          │                                       │
│                          ▼ ProductResult[] (raw, per-site)      │
│                                                                  │
│  Phase 2: ENRICH (top N=6 per site)                             │
│    ┌─────────────────────────────────────────────┐             │
│    │  enrich.ts                                    │             │
│    │  - fetch product page                         │             │
│    │  - extract: JSON-LD, microdata, meta tags,   │             │
│    │    specs table, breadcrumbs, variations      │             │
│    │  - guessBrandFromTitle, classifyTaxonomy      │             │
│    └─────────────────────────────────────────────┘             │
│                          │ EnrichedItem[]                       │
│                          ▼                                       │
│  Phase 3: MATCH (cross-site grouping)                           │
│    ┌─────────────────────────────────────────────┐             │
│    │  matcher.ts (Union-Find)                      │             │
│    │  Cascade: EAN → vetoes → cosmetic → multi    │             │
│    └─────────────────────────────────────────────┘             │
│                          │ MatchedProduct[]                     │
│                          ▼                                       │
│  filters.ts → DynamicFilters (facets for UI)                    │
└─────────────────────────────────────────────────────────────────┘
```

### Data flow summary

```
User types "Dynafit" → submittedQuery set
  → useQuery fires POST /api/search
    → registry.aggregateMatched("Dynafit", { onlySites })
      → 22 scrapers run in parallel (Phase 1: search)
      → top 6 products per site get enriched (Phase 2: enrich)
      → all products matched cross-site (Phase 3: match)
      → filters.ts builds DynamicFilters
    → response cached (2-min TTL)
  → data.products + data.filters arrive at client
    → useMemo(filtered) applies client-side filters:
      - userOff (site checkbox toggling — no re-fetch)
      - onlyPromos, onlyInStock, minPrice, maxPrice, minSites
      - activeBrands/Categories/... (8 dynamic filter sets)
      - liveFilter (sidebar search field — exact-text substring match)
    → MatchedProductCard[] rendered
```

---

## 3. Scraper Engine

### `types.ts` — Shared types + client-safe site registry

**Role:** Defines all TypeScript interfaces shared between server and client. Also holds the `SITES` record (client-safe metadata only — no imports of axios/playwright).

**Key types:**
- `SiteId = string` — plain string (drop-in friendly)
- `SiteMeta { id, name, baseUrl, country, currency, accent, groups }` — per-shop metadata
- `ProductResult` — raw product from a scraper
- `ProductMetadata` — enriched data (brand, category, ean, weight, colors, sizes, etc.)
- `MatchedProduct` — grouped product with multiple `ProductOffer[]`
- `Scraper { site, capabilities, search() }` — scraper interface
- `DynamicFilters` — facets for the UI sidebar
- `ShopGroup` — group definition

**`SITES: Record<string, SiteMeta>`** — 20 entries with `groups` field (e.g. `groups: ["outdoor"]` or `groups: ["cycling"]` or `groups: ["outdoor", "cycling"]`). Client-safe because it contains **only data** — no function imports.

**Design choice:** `SITES` lives in `types.ts` (not `sites/index.ts`) because the client UI (`page.tsx`) needs it for rendering badges, and importing from `sites/index.ts` would transitively pull in axios/playwright (Node-only).

### `http.ts` — HTTP client with anti-bot headers + Playwright fallback

**Role:** Shared HTTP layer for all HTML-based scrapers.

**Key functions:**
- `pickUserAgent()` — random from 5 browser User-Agents
- `createHttpClient({ timeoutMs, referer })` — axios instance with realistic headers (Sec-Ch-Ua, Accept-Language, etc.)
- `fetchHtml(url, opts)` — main fetcher:
  - If `SCRAPE_USE_PLAYWRIGHT=1` → straight to Playwright
  - Otherwise: axios → if blocked (status ≥ 400 or HTML contains "just a moment"/"cloudflare") → retry via Playwright
- `parsePrice(raw)` — handles FR ("1 234,56 €"), DE ("1.234,56 EUR"), EN ("1,234.56"), Swiss ("CHF 1'234.50")
- `absUrl(href, base)` — relative→absolute URL resolver
- `cleanTitle(raw)` — collapse whitespace
- `fetchJsonViaPlaywright(url)` — for JSON rendered inside `<pre>` (Cloudflare-protected APIs)
- `fetchJsonPostViaPlaywright(apiUrl, opts)` — boots Chromium, solves Cloudflare, then runs `fetch()` inside `page.evaluate`

**Design choices:**
- Robots.txt **not consulted** (personal-use tool, not a public indexer — see file header)
- `SCRAPE_JITTER=1` adds 200-700ms random delay to look human
- Proxy support via `PROXY_URL` env (HTTP/HTTPS/SOCKS5)

### `enrich.ts` — Product page metadata extraction

**Role:** Fetches each product page and extracts structured `ProductMetadata`.

**Key functions:**
- `enrichProduct(p, signal)` — main entry, merges data from:
  1. **JSON-LD** (`<script type="application/ld+json">` with `@type Product`)
  2. **Microdata** (`[itemtype*=schema.org/Product]` + `itemprop`)
  3. **Meta tags** (`og:brand`, `product:gtin`, etc.)
  4. **Specs table** (`dl/dt/dd`, `table tr`, `.specs li`)
  5. **Breadcrumb** (`schema.org/BreadcrumbList`)
  6. **Variations** (color swatches, size selectors)
- `guessBrandFromTitle(title)` — scans `KNOWN_BRANDS` list (100+ brands: Dynafit, Castelli, Shimano, etc.) + model→brand inference (e.g. "Speedgoat" → "Hoka")
- `parseWeightGrams(raw)` — "850 g" / "1.2 kg" → grams
- `extractColorsFromTitle(title)` — recognizes `/<color>` suffixes, `couleur: X` patterns

**Design choices:**
- Always returns an object (never throws) — on network failure, falls back to `guessBrandFromTitle(title)`
- `ENRICH_TOP_N_PER_SITE = 6` — only top 6 per site enriched (performance)
- Calls `classifyTaxonomy()` to normalize raw categories into consistent sport/category/subcategory/range

### `matcher.ts` — Cross-site Union-Find matcher

**Role:** Groups `ProductResult` entries from different sites into `MatchedProduct` (one logical product = multiple offers).

**Matching cascade (in priority order):**
1. **Strong ID** (EAN/GTIN/MPN ≥6 chars) → score 1.0, reason "ean"
2. **Hard vetoes** (reject regardless of other scores):
   - `gender-mismatch` — "Speedgoat 7 W" vs "Speedgoat 7 M"
   - `product-line-mismatch` — GTX vs non-GTX, Mid vs Low, Pro vs base
   - `model-version-mismatch` — Speedgoat 6 vs 7
3. **Same-site cosmetic variant** — same brand + title Jaccard ≥ 0.85 → reason "cosmetic-variant"
4. **Multi-criteria cross-site score** — brand 0.30 + category 0.20 + sport 0.15 + subcategory 0.10 + range 0.10 + title sim 0.15. Match if ≥ 0.55 AND title sim ≥ 0.4
5. **Title-only similarity** ≥ 0.85 → reason "title-similarity"
6. **Brand + model tokens** — same brand + Jaccard ≥ 0.5 → reason "brand+model"

**Design choices:**
- `STOP_TOKENS` strips FR/EN/DE color words, gender words, generic product nouns, outdoor colorway names
- `stripColorSuffix(title)` truncates at last gender marker or first `/`
- Union-Find with path compression
- Results sorted by `siteCount DESC`, then `minPrice ASC`

### `registry.ts` — Orchestrator

**Role:** Runs all scrapers → enriches → matches.

**Key functions:**
- `aggregateSearch(query, opts)` — runs all scrapers in parallel
  - HTTP scrapers: concurrent with random stagger (≤800ms)
  - Playwright scrapers: limited to `MAX_PARALLEL_PLAYWRIGHT` (default 3) via worker-pool cursor
- `aggregateMatched(query, opts)` — full workflow:
  1. **Search phase** → `aggregateSearch()`
  2. **Enrich phase** → `runPool(toEnrich, 8, enrichProduct)` (8 concurrent enrichments)
  3. **Match phase** → `prepareItems()` → `matchProducts()`
  4. Returns `{ products, filters, rawResults, phases: { searchMs, enrichMs, matchMs }, anySuccess }`

**Design choices:**
- `runScraperWithRetry` — aborts after `PER_SITE_TIMEOUT` (30s default, 60s for challenge sites); retries once if empty
- `ScraperError` caught per-site — no error crashes the aggregate
- **No demo fallback** — if all sites fail, response is empty
- `DEBUG_DUMP=1` writes raw per-site JSON + `matched.json` to `debug/`

### `filters.ts` — DynamicFilters builder

**Role:** Builds facet lists for the UI sidebar from `MatchedProduct[]`.

- `buildDynamicFilters(products)` — counts brands, categories, subcategories, sports, ranges, genders, colors, sizes, attributes, priceRange. Caps each list (e.g. brands.slice(0, 30)).
- `normalizeSizeValue(raw)` — "42" → "eu:42", "US 10.5" → "us:10.5", "M" → "m"

### `groups.ts` — Group management

**Role:** Builtin group metadata + custom group persistence.

- `DEFAULT_GROUPS` — derived from `BUILTIN_GROUP_META` + each `SITES[id].groups` field
- `loadCustomGroups()` / `saveCustomGroups()` — localStorage persistence
- `getSitesForGroup(groups, groupId)` — returns site IDs for a group

**Design:** Adding a shop to a group = setting `groups: ["cycling"]` in `sites/<id>.ts`. No edit to `groups.ts` needed.

### `sites/index.ts` — Barrel file + auto-derived lookups

**Role:** Imports all 22 scrapers, derives lookups.

- `SCRAPERS: Scraper[]` — array of all scrapers
- `PLAYWRIGHT_SITES` — derived from `SCRAPERS.filter(s => s.capabilities?.usesPlaywright)`
- `CHALLENGE_SITES` — derived from `SCRAPERS.filter(s => s.capabilities?.challenge)`
- `SCRAPER_BY_SITE` — `Record<siteId, Scraper>`

### `browserPool.ts` — Shared Chromium instance

**Role:** Single Chromium instance with reusable per-call contexts.

- `acquireContext(referer?)` — lazily launches browser, creates new `BrowserContext`
- `releaseContext(context)` — closes context, keeps browser alive
- Anti-detection: hides `navigator.webdriver`, fakes `navigator.languages`/`plugins`/`vendor`, spoofs WebGL

**Design:** ~80 MB total memory instead of ~80 MB × N (one browser, N contexts).

### `playwright.ts` — Playwright wrapper

**Role:** Fallback for JS-rendered / Cloudflare-protected sites.

- `fetchHtmlWithPlaywright(url, opts)` — 2 attempts; waits for challenge self-resolution (up to 12s), then races for product selectors
- Anti-Cloudflare: never uses `networkidle` (Cloudflare keeps long-polling)

### `taxonomy.ts` — Category normalizer

**Role:** Normalizes raw category strings into consistent taxonomy.

- `classifyTaxonomy(...inputs)` → `{ sport?, category?, subcategory?, range? }`
- `SPORT_RULES` — 12 sports (Ski de randonnée, Alpinisme, Escalade, Trail, VTT, etc.)
- `CATEGORY_RULES` — ~20 categories (Peaux de ski, Chaussures, Sacs à dos, etc.)
- `RANGE_RULES` — Compétition, Performance, Loisir, Ultralight, Freeride

### `error.ts` — Typed scraper errors

**Role:** Structured error class with categories for the logs panel.

- `ScraperErrorCategory = "blocked" | "timeout" | "empty" | "network" | "parse" | "auth" | "unknown"`
- `ScraperError.inferCategory(message, statusCode)` — e.g. HTTP 403 → "blocked"
- `isRetryable()` — timeout, network, transient blocked

---

## 4. API Routes

### `POST /api/search` — Main search endpoint

**Request body:**
```json
{
  "query": "castelli giro",
  "onlySites": ["all4cycling", "probikeshop"],
  "group": "cycling"
}
```

**Response:**
```json
{
  "query": "castelli giro",
  "totalProducts": 15,
  "products": [MatchedProduct, ...],
  "filters": DynamicFilters,
  "durationMs": 8234,
  "phases": { "searchMs": 3200, "enrichMs": 4100, "matchMs": 934 },
  "anySuccess": true,
  "demo": false,
  "sites": [{ "id": "all4cycling", "name": "All4cycling", "status": "ok", "count": 24, "durationMs": 2800 }],
  "cached": false
}
```

**Key behaviors:**
- `query.length >= 2` required
- `X-Custom-Groups` header: base64 JSON of user's custom groups (server can't read localStorage)
- In-memory LRU cache (2-min TTL, 50 entries)
- If group is selected but empty → short-circuits with empty response

### `GET/POST/DELETE /api/groups` — Group management

- **GET** → `{ groups: [...DEFAULT_GROUPS, ...customFromHeader] }`
- **POST** `{ id, name, sites }` → validates, returns `{ group: ShopGroup }`
- **DELETE** `?id=<groupId>` → refuses builtin groups

---

## 5. UI Layer

### `page.tsx` — Single-page application (2000+ lines)

**State variables (17 total):**

| Variable | Type | Purpose |
|---|---|---|
| `query` | string | Search input value |
| `submittedQuery` | string | Actually triggers useQuery |
| `groups` | ShopGroup[] | Builtin + custom |
| `activeGroupId` | string | Active group ("all" by default) |
| `sortKey` | SortKey | Sort order |
| `onlyPromos` | boolean | Filter: on-sale only |
| `onlyInStock` | boolean | Filter: in-stock only |
| `minPrice` | number\|null | Price floor |
| `maxPrice` | number\|null | Price ceiling |
| `minSites` | number | Min sites offering product |
| `liveFilter` | string | Free-text product filter (sidebar search field — filters displayed results without re-fetching) |
| `userOff` | Set<SiteId> | Deselected sites (client-side) |
| `showShopTree` | boolean | Treeview expand/collapse |
| `activeBrands` | Set<string> | Selected brands |
| `activeCategories` | Set<string> | Selected categories |
| ... (8 filter sets total) | | |
| `showDebug` | boolean | Unused (dead code) |

**Data flow:**
```
query → onSubmit → submittedQuery → useQuery → data
                                                  ↓
filtered = useMemo(data.products + all filters)
                                                  ↓
filtered.map(p => <MatchedProductCard>)
```

**Key design:** `selectedSites` is **NOT** in `queryKey` — toggling a site checkbox filters client-side without re-fetching.

### Components

| Component | Purpose |
|---|---|
| `Home()` | Main page, holds all state |
| `Header` | Top bar: logo, search, language switcher |
| `MatchedProductCard` | Product card with image, badges, price, expandable offers |
| `OfferRow` | Single offer row (site badge + price + link) |
| `FilterSection` | Collapsible sidebar section for one facet |
| `FilterBalloon` | Active filter pill with X |
| `LogsPanel` | Bottom dock with error/warning/info filters |
| `EmptyState` | Welcome card before search |
| `ColorSwatches` | Color circles for metadata.color |

---

## 6. Supporting Libraries

### `csv.ts` — CSV export

- `exportMatchedCsv(products)` — one row per offer (18 columns)
- `exportCategorizedCsv(products)` — one row per product (26 columns, debug mode)
- `toArray(v)` — defensive helper for non-array metadata fields

### `i18n.tsx` — Internationalization

- `LangProvider` — React context, persists to localStorage
- `useLang()` → `{ lang, setLang, t }`
- `t(key, params)` — supports `{param}` interpolation and `{n} word{s}` pluralization
- 4 languages: FR, EN, ES, DE (~60 keys each)

### `logs.ts` — Client log buffer

- In-memory buffer (max 500 entries, FIFO)
- `logInfo/logWarn/logError(site?, message)` — push entries
- `subscribeLogs(listener)` — pub/sub for the LogsPanel
- `logSearchResults(sites)` — parses API response, emits per-site logs with human-friendly error messages

### `cache.ts` — In-memory LRU cache

- `getCached(query, sites, group)` / `setCached(query, data, ...)`
- 50 entries max, 2-min TTL
- Key = `query | sorted-sites-csv | group`

### `debug.ts` — Debug session writer

- `createDebugSession(query)` → creates `debug/<timestamp>_<slug>/`
- `dumpSearchResults(dir, query, results)` → per-site JSON
- `dumpMatchedResults(dir, matched, phases)` → `matched.json`

---

## 7. Chrome Extension

### Architecture

```
extension/
├── manifest.json              # MV3, devtools_page
├── devtools.html/js           # Creates "Shop Protocol" DevTools panel
├── panel.html/js              # Panel UI + capture logic
├── protocol-generator.js      # Builds protocol.md from captured requests
├── background.js              # Minimal service worker
└── vendor/jszip.min.js        # Bundled JSZip for archive download
```

### Capture pipeline

1. **Record** — `chrome.devtools.network.onRequestFinished` captures all XHR/fetch/WebSocket traffic
2. **Categorize** — `isSearchRequest()` (sophisticated GraphQL-aware heuristic) / `isProductRequest()` (URL patterns) / WebSocket / Other
3. **Filter noise** — 30+ filters for analytics, Shopify telemetry, app scripts, fonts, reviews
4. **Auto-derive shop name** — from inspected tab URL via `chrome.devtools.inspectedWindow.eval`
5. **Generate protocol.md** — markdown with: sample product, JSON-LD extraction, product card HTML, field list, WS frames
6. **Download archive (.zip)** — protocol.md + capture.json + manifest.json + README.md + requests/ folder

### Key heuristics

- **GraphQL false-positive filtering** — distinguishes `query searchProducts(...)` from `query GetSlideCartOffers(...)` by inspecting operation names
- **HTML response handling** — 50KB limit (was 5KB), JSON-LD ItemList extraction, product card HTML extraction, result count detection from `<title>`

---

## 8. Build & Release System

### `Makefile`

| Target | Description |
|---|---|
| `make dev` | Start dev server |
| `make dev-debug` | Start with `DEBUG_DUMP=1 NEXT_PUBLIC_DEBUG_DUMP=1` |
| `make dev-debug-verbose` | Start with full debug logging |
| `make test` | Run Vitest |
| `make lint` | Run ESLint |
| `make check-site SITE=<id> Q="<query>"` | Test one scraper |
| `make scrape-all Q="<query>"` | Scrape all sites |
| `make release` | Bump patch version + build tarball + zip |
| `make release-minor` | Bump minor version |
| `make release-major` | Bump major version |
| `make build` | Production build |
| `make clean` | Remove .next/dist/logs |

### `scripts/build-release.sh`

1. Reads `VERSION`, bumps it (--patch/--minor/--major)
2. Writes new version to 4 files: `VERSION`, `src/lib/version.ts`, `package.json`, `extension/manifest.json`
3. Moves old tarballs to `download/old/`
4. Builds `download/outdoorprice-<version>.tar.gz` (excludes node_modules, .next, .git, etc.)
5. Builds `download/shop-protocol-extension-<version>.zip`

### Versioning convention

| Change type | Command | Example |
|---|---|---|
| Bug fix, small UI tweak | `make release` | 0.11.5 → 0.11.6 |
| New scraper, refactor, new feature | `make release-minor` | 0.11.5 → 0.12.0 |
| Breaking change | `make release-major` | 0.11.5 → 1.0.0 |

---

## 9. Test Suite

| File | What it covers |
|---|---|
| `tests/http.test.ts` | `parsePrice` (FR/DE/EN/Swiss formats), `absUrl`, `cleanTitle` |
| `tests/matcher.test.ts` | Full matching cascade: EAN, brand+cat, gender veto, product-line veto, model-version veto, cosmetic variants, cross-site multi-criteria, title similarity |
| `tests/enrich.test.ts` | `guessBrandFromTitle` (100+ brands incl. cycling), `parseWeightGrams`, `extractColorsFromTitle` |
| `tests/taxonomy.test.ts` | `classifyTaxonomy` (sport/category/subcategory/range detection) |
| `tests/filters.test.ts` | `normalizeSizeValue` (EU/US/UK sizes, S/M/L) |
| `tests/csv.test.ts` | `exportCategorizedCsv` defensive against bad metadata |

Run: `make test` or `bun test`

---

## 10. Key Design Decisions

### 1. Drop-in scraper workflow
Adding a shop = 1 file + 2 one-line edits. No Makefile/groups.ts changes needed.

### 2. Capability-driven registry
`PLAYWRIGHT_SITES`, `CHALLENGE_SITES`, timeouts — all derived from each scraper's `capabilities` field. No hard-coded lists.

### 3. Three-phase pipeline
Search → Enrich → Match, each timed. Enrichment bounded to top-N per site (perf); all products participate in matching.

### 4. Union-Find matcher with hard vetoes
Gender, product-line, model-version vetoes prevent false positives that pure weighted scoring would create.

### 5. Client-side site filtering
Toggling a site checkbox filters locally without re-fetching. `queryKey` excludes `selectedSites`.

### 6. SITES in types.ts (client-safe)
The `SITES` record contains only data (no function imports) so the UI can import it without pulling Node-only deps into the client bundle.

### 7. Single shared Chromium
One browser instance, reusable contexts (~80 MB total vs ~80 MB × N).

### 8. No demo fallback
If all sites fail, response is empty. Real errors shown.

### 9. In-memory LRU cache
2-min TTL, 50 entries. Reduces redundant scrapes during rapid UI interactions.

### 10. Self-contained release
`output: "standalone"` in next.config.ts. `build-release.sh` bumps 4 version files in lockstep.
