# User Guide — OutdoorPrice

> How to use the outdoor/cycling price comparator.
> For installation see [CONFIGURATION.md](./CONFIGURATION.md).
> For architecture see [DEVELOPMENT.md](./DEVELOPMENT.md).

## Table of Contents

### Quick Start
1. [Simple Usage](#1-simple-usage)
2. [Understanding Results](#2-understanding-results)

### Advanced Features
3. [Shop Groups](#3-shop-groups)
4. [Filters & Sorting](#4-filters--sorting)
5. [Live Product Filter](#5-live-product-filter)
6. [Price Range Filter](#6-price-range-filter)
7. [CSV Export](#7-csv-export)
8. [Language Switch](#8-language-switch)
9. [Logs Panel](#9-logs-panel)

### Complete Feature Reference
10. [All Features](#10-all-features)

---

## 1. Simple Usage

### Searching for a product

1. Type a product name in the search bar at the top (e.g. "Dynafit Speed Radical")
2. Press **Enter** or click **Compare**
3. Wait a few seconds — the app searches 20 shops in parallel
4. Results appear as cards in the main area

### What happens behind the scenes

```
You type "Dynafit"
  → 20 shops are searched simultaneously
  → Product pages are fetched for the top results
  → Metadata is extracted (brand, category, EAN, colors, sizes…)
  → Cross-site matching groups identical products together
  → You see one card per product, with all offers from different shops
```

### Tips for good searches

- **Use the product name**, not just the brand: "Speed Radical" is better than "Dynafit"
- **2 characters minimum** to trigger search
- **Try the suggestion chips** below the search bar for quick tests

---

## 2. Understanding Results

### Product card

Each card represents **one product** matched across multiple shops:

```
┌──────────────────────────────────────────────────┐
│ [Image]   Castelli Giro 2026 Jersey              │
│           Castelli · Cycling · Maillot            │
│           3 sites · 5 offers                      │
│                                                   │
│           dès 89,95 €   (was 129,95 € -31%)      │
│           ┌─────────────────────────────────┐    │
│           │ ▼ Show offers                    │    │
│           └─────────────────────────────────┘    │
└──────────────────────────────────────────────────┘
```

- **Brand** (e.g. "Castelli") — detected from the product page or title
- **Sport / Category** — classified automatically (e.g. "Cycling · Maillot")
- **X sites · Y offers** — how many shops have this product
- **Price** — the cheapest offer found (with original price + discount if on sale)
- **Show offers** — click to expand and see all offers from each shop

### Expanded offers list

```
┌──────────────────────────────────────────────────┐
│  ● All4cycling     89,95 €   -31%   In stock   →  │
│  ● ProBikeShop     94,90 €   -27%   In stock   →  │
│  ● DeporVillage   109,00 €          Out of stock→ │
└──────────────────────────────────────────────────┘
```

Each offer shows:
- **Shop name** (colored badge)
- **Price** (current + original + discount %)
- **Availability** (In stock / Out of stock)
- **→** link to the shop's product page

### Summary bar

Above the results, a summary shows:
- Your search query
- Number of matched products
- Number of responding sites
- Search / Enrichment / Matching phase timings
- The cheapest product found

---

## 3. Shop Groups

### Switching groups

In the header, click a group badge to filter which shops are searched:

| Group | Description |
|---|---|
| **Toutes** | All 20 shops |
| **⛰ Outdoor** | Hiking, skiing, climbing, trail (17 shops) |
| **🚴 Cycling** | Road, MTB, gravel cycling (4 shops) |
| **💻 IT** | Empty (add shops via custom groups) |

### Managing groups

1. Click **"Gérer les groupes"** in the header
2. A matrix popup appears: rows = shops, columns = groups
3. Check/uncheck boxes to add/remove shops from groups
4. A shop can belong to multiple groups (e.g. DeporVillage is in both Outdoor + Cycling)

### Creating a custom group

1. Open the group manager
2. At the bottom, enter a name (e.g. "Triathlon") and an emoji
3. Click **Créer**
4. Check the boxes for the shops you want in your new group
5. Close the popup — your group now appears in the header

Custom groups are saved in your browser (localStorage) and persist across sessions.

---

## 4. Filters & Sorting

### Sort options

| Option | Description |
|---|---|
| Plus de sites | Most shops offering the product (default) |
| Prix croissant | Cheapest first |
| Prix décroissant | Most expensive first |
| Économie max | Biggest savings first |
| Mieux notés | Highest rated first |

### Toggle filters

| Filter | What it does |
|---|---|
| **Promos uniquement** | Only show products with a discount |
| **En stock uniquement** | Only show products available (not out of stock) |

### Dynamic facet filters

The sidebar automatically builds filter lists from the search results:

- **Marques** — filter by brand (Castelli, Dynafit, Hoka, etc.)
- **Sports** — filter by sport (Ski de randonnée, Trail, Cycling, etc.)
- **Catégories** — filter by product type (Maillot, Chaussures, Skis, etc.)
- **Sous-catégories** — filter by sub-category (Homme, Femme, Mixte, etc.)
- **Gamme** — filter by range (Compétition, Loisir, Ultralight, etc.)
- **Genre** — filter by gender (Homme, Femme, Mixte)
- **Couleurs** — filter by color (with color swatches)
- **Tailles** — filter by size (EU 42, US 10.5, S, M, L, etc.)

Each filter shows the count of matching products. Click to toggle. Multiple filters within the same category are OR'd; across categories they're AND'd.

### Active filter balloons

Active filters appear as removable pills above the results:

```
[Promos ×] [Castelli ×] [Cycling ×] [Max 100€ ×]
```

Click the **×** on any pill to remove that filter. Click **Effacer** to clear all.

### Min sites slider

The **"Sites proposant le produit : min N"** slider filters products to only show those available at N or more shops. Useful for finding products with the best price competition.

---

## 5. Search Field (Sidebar)

### What it does

The **search field at the top of the left sidebar** (above the filter balloons) lets you filter the **currently displayed products** in the right area by free text — **without re-running the search**.

### Where it is

```
┌─ Left sidebar ────────────┐  ┌─ Right area (results) ──────┐
│ ┌───────────────────────┐ │  │                             │
│ │ 🔍 Search field...    │ │  │  Product card 1             │
│ └───────────────────────┘ │  │  Product card 2             │
│ ┌───────────────────────┐ │  │  Product card 3  ← filtered │
│ │ Filtres          [×] │ │  │  Product card 4  ← filtered │
│ │ [Promos] [Castelli]   │ │  │  Product card 5             │
│ └───────────────────────┘ │  │                             │
│ ┌───────────────────────┐ │  │                             │
│ │ Tri: Plus de sites    │ │  │                             │
│ │ □ Promos uniquement    │ │  │                             │
│ │ □ En stock uniquement  │ │  │                             │
│ │ Fourchette de prix     │ │  │                             │
│ │ ...                    │ │  │                             │
│ └───────────────────────┘ │  │                             │
└───────────────────────────┘  └─────────────────────────────┘
```

### How it works

- Type any text — the products in the right area are filtered **instantly** as you type
- The search is **exact text** (not keywords): typing "castelli giro" matches only products containing that exact phrase, not products with both "castelli" AND "giro" separately
- It searches across all product fields: title, brand, category, sport, range, gender, colors, sizes, AND shop names
- If you empty the field, all products are displayed once more
- It does **not** re-run the search — it only filters the already-loaded results

### Examples

| You type | What matches |
|---|---|
| `castelli` | All Castelli products (case-insensitive) |
| `castelli giro` | Only products with the exact phrase "castelli giro" |
| `bergzeit` | Products that have an offer from Bergzeit |
| `noir` | Products with "noir" in title, color, or any field |
| `gtx` | Products with "GTX" in the title (Gore-Tex variant) |
| *(empty)* | All products shown (no filtering) |

### Count badge

When the filter is active, a badge shows `X / Y` (filtered count / total count) inside the search field. Click the **×** to clear.

---

## 6. Price Range Filter

### Dual min/max inputs

The **"Fourchette de prix"** section in the sidebar has two text inputs:

- **min €** — minimum price
- **max €** — maximum price

Type a value in either field. The slider automatically adjusts. If you set min > max, the other field auto-corrects.

### Range slider

Below the inputs, a dual-thumb slider calibrated to the actual price range of your search results:

- Left thumb = minimum price
- Right thumb = maximum price
- The slider bounds show the cheapest (left) and most expensive (right) prices found

### Two-way binding

- Type in the text field → slider moves
- Drag the slider → text field updates
- Both work together seamlessly

---

## 7. CSV Export

### Standard CSV

Click **"Exporter CSV (N produits)"** in the sidebar to download a CSV with:
- One row per **offer** (so a product with 3 offers = 3 rows)
- Columns: produit_id, titre, marque, categorie, sport, genre, couleurs, tailles, score_match, nb_offres, offre_site, offre_prix, offre_prix_barre, offre_remise_pct, offre_devise, offre_dispo, offre_url

### Debug categorized CSV (debug mode only)

When running in debug mode (`make dev-debug`), an additional amber button appears:

**"Debug CSV catégorisé (N produits)"**

This exports:
- One row per **product** (not per offer)
- All classification fields: sport, catégorie, sous-catégorie, gamme
- All metadata: EAN, GTIN, SKU, MPN, weight, rating, review count
- Match info: score, reason (why products were grouped)
- Aggregated: sites list, price min/max

Use this to debug classification by comparing with the standard CSV.

---

## 8. Language Switch

### Switching languages

In the header (top-right), 4 buttons let you switch the UI language:

```
[FR] [EN] [ES] [DE]
```

The selected language is highlighted in dark. Your choice is saved in localStorage and persists across sessions.

### What's translated

~60 UI strings are translated across all 4 languages:
- Header, search bar, suggestions
- Sidebar: filters, sort options, price range, display toggles, export buttons
- Filter section titles (brands, sports, categories, etc.)
- Summary panel (query, matched products, phases, duration)
- Results: empty states, error messages, tips
- Product cards: promo, offers, in/out of stock
- Logs panel: title, level filters, empty state
- Group manager: modal, matrix, create/delete

### What's NOT translated

- Product titles (come from the shops themselves)
- Brand names (Castelli, Dynafit, etc.)
- Shop names (Bergzeit, All4cycling, etc.)
- Category names from taxonomy rules (currently FR only)

---

## 9. Logs Panel

### What it shows

A collapsible panel at the bottom of the screen shows per-site search results and errors:

```
┌──────────────────────────────────────────────────────────────┐
│ Logs                                          [▼ click to expand] │
│ ┌────────┐ ┌────────┐ ┌────────┐  [Filter by site...]  [Vider] │
│ │Errors 1│ │Warn 2  │ │Info 8  │                                │
│ └────────┘ └────────┘ └────────┘                                │
│                                                                │
│  [12:34:56] [bergzeit]     ✅ 24 products found (2.8s)         │
│  [12:34:57] [all4cycling]  ✅ 24 products found (2.6s)         │
│  [12:34:58] [tradeinn]     ❌ IP blocked by anti-bot...        │
│  [12:34:59] [sportconrad]  ⚠️  0 results (API returned 500)   │
└──────────────────────────────────────────────────────────────┘
```

### Log levels

| Level | Color | When |
|---|---|---|
| **Error** | Red | Site failed (blocked, timeout, parse error) |
| **Warning** | Amber | Site returned 0 results |
| **Info** | Green | Site returned products successfully |

### Filtering logs

- **Level buttons** (Errors / Warnings / Messages) — toggle to show/hide each level
- **"Filtrer par site"** input — type a site name (e.g. "bergzeit") to filter logs
- **Vider** button — clear the log buffer

### Understanding error messages

| Message | Meaning |
|---|---|
| "IP bloquée par anti-bot" | Cloudflare blocked the request (data-center IP). Works from residential IP. |
| "le site n'a pas répondu dans le délai imparti" | Timeout (30s default, 60s for challenge sites) |
| "clé API manquante ou expirée" | Auth issue (rare) |
| "erreur réseau" | DNS / connection refused |
| "la structure du site a changé" | Selectors need updating (parse error) |

---

## 10. All Features

### Search
- ✅ Multi-site parallel search (20 shops)
- ✅ Query minimum 2 characters
- ✅ Suggestion chips for quick searches
- ✅ Search results cached for 2 minutes

### Results
- ✅ Cross-site product matching (EAN, brand, category, title similarity)
- ✅ One card per product, multiple offers per card
- ✅ Expandable offer list with per-shop details
- ✅ Price (current + original + discount %)
- ✅ Availability (in stock / out of stock)
- ✅ Direct link to each shop's product page
- ✅ Product images
- ✅ Brand, sport, category, subcategory, range badges
- ✅ Color swatches
- ✅ EAN, weight, rating (when available)

### Filters
- ✅ Sort: by site count, price, savings, rating
- ✅ Toggle: promos only, in stock only
- ✅ Price range: dual min/max inputs + slider
- ✅ Min sites slider
- ✅ Dynamic facet filters: brands, sports, categories, subcategories, range, gender, colors, sizes
- ✅ Sidebar search field (filters displayed results, exact text, no re-search)
- ✅ Active filter balloons (removable pills)
- ✅ Clear all filters button

### Shop Management
- ✅ Treeview of shops grouped by category (Outdoor, Cycling, IT, Other)
- ✅ Per-shop checkboxes (client-side filtering, no re-fetch)
- ✅ Per-shop product count (right-aligned)
- ✅ Colored shop name badges
- ✅ Group selector in header
- ✅ Custom group creation (matrix view)
- ✅ Shop can belong to multiple groups

### Export
- ✅ Standard CSV (one row per offer)
- ✅ Debug categorized CSV (one row per product, all metadata)
- ✅ UTF-8 BOM for Excel compatibility

### Internationalization
- ✅ 4 languages: French, English, Spanish, German
- ✅ Language switcher in header
- ✅ Persists in localStorage

### Debug
- ✅ Debug mode (`make dev-debug`) with:
  - Raw response dumps in `debug/` directory
  - Debug CSV export button
  - Verbose console logging (`make dev-debug-verbose`)
- ✅ Logs panel with level filters and site filter
- ✅ Per-site error categorization (blocked, timeout, parse, etc.)

### Chrome Extension
- ✅ Shop Protocol Recorder DevTools panel
- ✅ Captures XHR/fetch/WebSocket traffic
- ✅ Categorizes requests (search, product, websocket, other)
- ✅ Generates protocol.md with sample product + field list
- ✅ Downloads archive (.zip) with protocol.md + raw capture + per-request files
- ✅ Auto-derives shop name from inspected tab URL
- ✅ Click any request to see full un-truncated body
- ✅ 30+ noise filters (analytics, Shopify telemetry, fonts, etc.)
