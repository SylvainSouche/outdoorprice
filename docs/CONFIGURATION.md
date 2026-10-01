# Configuration Guide — OutdoorPrice

> How to install, customize, run debug, test, and write new shop scrapers.
> For architecture see [DEVELOPMENT.md](./DEVELOPMENT.md).
> For end-user features see [USER_GUIDE.md](./USER_GUIDE.md).

## Table of Contents

1. [Installation](#1-installation)
2. [Environment Variables](#2-environment-variables)
3. [Running the Application](#3-running-the-application)
4. [Debug Mode](#4-debug-mode)
5. [Testing](#5-testing)
6. [Linting & Build](#6-linting--build)
7. [Versioning & Release](#7-versioning--release)
8. [Writing a New Shop Scraper](#8-writing-a-new-shop-scraper)
9. [Chrome Extension Installation](#9-chrome-extension-installation)
10. [Customization](#10-customization)

---

## 1. Installation

### Prerequisites

- **Bun** (recommended) or Node.js 18+
- **Playwright Chromium** (for sites behind Cloudflare)

### Steps

```bash
# 1. Clone / extract the project
cd outdoorprice

# 2. Install dependencies
bun install          # or: npm install

# 3. Install Playwright Chromium (for Cloudflare-protected sites)
make playwright      # or: npx playwright install chromium

# 4. Create .env file
make env             # creates .env from .env.example

# 5. All-in-one (install + env + playwright)
make config
```

### Verify installation

```bash
make version         # should print the current version
make check-env       # verify Node/Bun/npm are present
make run-server             # start dev server → http://localhost:3000
```

---

## 2. Environment Variables

All variables are **optional** — the app runs with sensible defaults if `.env` is missing or empty.
Run `make env` to create `.env` from `.env.example` (which lists every variable the codebase actually reads).

### `.env` file

```bash
# All variables below are OPTIONAL. Defaults shown.

# Scraping behaviour
SCRAPE_SITE_TIMEOUT_MS=30000         # Per-site timeout (challenge sites use 2x)
SCRAPE_CACHE_TTL_MS=120000           # In-memory cache TTL (2 min)
SCRAPE_MAX_PARALLEL_PLAYWRIGHT=3     # Max concurrent Playwright browsers

# Optional: Proxy for scraping (recommended for data-center IPs)
# PROXY_URL=socks5://user:pass@host:port
# PROXY_URL=http://user:pass@host:port

# Optional: Anti-bot jitter (200-700ms random delay between requests)
# SCRAPE_JITTER=1

# Optional: Force Playwright for all sites
# SCRAPE_USE_PLAYWRIGHT=1

# Optional: Disable Playwright fallback
# SCRAPE_PLAYWRIGHT_FALLBACK=0

# Cloudflare / anti-bot (Alltricks, etc.)
SCRAPE_CLOUDFLARE_TIMEOUT_MS=20000
# SCRAPE_USE_CHROME=0                 # Default: enabled (uses real Chrome)
# SCRAPE_HEADED=1                     # Default: 0 (headless) — set 1 for debugging
# PLAYWRIGHT_CHANNEL=chrome           # Override browser channel
```

> **Note:** There is **no database**. OutdoorPrice stores custom groups in
> localStorage on the client side; no `DATABASE_URL` is required. (Any
> references to Prisma or DATABASE_URL in older docs were dead code and have
> been removed in v0.14.21.)

### Debug env vars (set by `make dev-debug`)

```bash
# Server-side: dump raw responses to debug/
DEBUG_DUMP=1

# Server-side: verbose console logging
DEBUG_VERBOSE=1

# Client-side: show "Debug CSV catégorisé" button
NEXT_PUBLIC_DEBUG_DUMP=1
```

---

## 3. Running the Application

### Development server

```bash
make run-server                          # http://localhost:3000
# or with custom port:
make run-server PORT=3001
```

### Production build

```bash
make build                        # next build
make start                        # NODE_ENV=production next start
```

### Check a single scraper

```bash
make check-site SITE=bergzeit Q="Dynafit"
# or:
bun run scripts/cli/check-site.ts bergzeit "Dynafit" --json --enrich
```

**Options:**
- `--json` — output raw JSON
- `--enrich` — run full workflow (search + enrich + match)

### Scrape all sites

```bash
make scrape-all Q="Dynafit"
# or:
bun run scripts/cli/scrape-all.ts "Dynafit" --json
```

---

## 4. Debug Mode

### Starting in debug mode

```bash
make run-server-debug              # Dumps raw responses + shows debug CSV button
make run-server-debug-verbose      # Above + verbose console logging
```

### What debug mode does

**Server-side** (`DEBUG_DUMP=1`):
- Creates `debug/<timestamp>_<query-slug>/` directory
- Writes `<siteId>.json` per site (raw search results)
- Writes `matched.json` (final matched products)
- Writes `_query.txt` (query header)

**Client-side** (`NEXT_PUBLIC_DEBUG_DUMP=1`):
- Shows "Debug CSV catégorisé" button in the sidebar
- The categorized CSV exports one row per product with all classification fields:
  - sport, category, sub_category, gamme, genre, couleurs, tailles
  - ean, gtin, sku, mpn, model_year, weight, rating, review_count
  - match_score, match_reason, sites, price_min, price_max

### Inspecting debug dumps

```bash
ls debug/                    # List all debug sessions
cat debug/*/matched.json    # View matched products from latest session
cat debug/*/bergzeit.json   # View Bergzeit's raw response
```

### Using the debug CSV

1. Run `make run-server-debug`
2. Search for a product (e.g. "castelli giro")
3. Click "Debug CSV catégorisé" in the sidebar
4. Open the CSV in Excel/LibreOffice
5. Compare classification (sport, category, gamme) with the full CSV export
6. Identify misclassified products and adjust rules in `taxonomy.ts` or `enrich.ts`

---

## 5. Testing

### Run all tests

```bash
make test                    # or: bun test
```

### Run specific test file

```bash
bun test tests/matcher.test.ts
bun test tests/enrich.test.ts
```

### Watch mode

```bash
bun run test:watch           # vitest in watch mode
```

### Test files

| File | What it covers |
|---|---|
| `tests/http.test.ts` | Price parsing (FR/DE/EN/Swiss), URL resolution |
| `tests/matcher.test.ts` | Product matching cascade (EAN, brand, gender veto, etc.) |
| `tests/enrich.test.ts` | Brand detection (100+ brands), weight parsing, color extraction |
| `tests/taxonomy.test.ts` | Category classification (sport, category, range) |
| `tests/filters.test.ts` | Size normalization (EU/US/UK) |
| `tests/csv.test.ts` | CSV export defensive against bad metadata |

### Writing tests

Tests use Vitest. Place test files in `tests/` with `.test.ts` extension.

```typescript
import { describe, it, expect } from "vitest";
import { guessBrandFromTitle } from "@/lib/scraper/enrich";

describe("guessBrandFromTitle", () => {
  it("detects cycling brands", () => {
    expect(guessBrandFromTitle("Castelli Espresso")).toBe("Castelli");
  });
});
```

---

## 6. Linting & Build

### ESLint

```bash
make lint                    # or: bunx eslint .
```

**Note:** Most rules are turned off (no-explicit-any, no-unused-vars, etc.). The config extends `eslint-config-next/core-web-vitals` + `typescript`.

### Build

```bash
make build                   # next build (output: standalone)
```

### Check everything

```bash
make check-all               # lint + test
```

---

## 7. Versioning & Release

### Version convention

| Change type | Command | When to use |
|---|---|---|
| Bug fix, small tweak | `make release` | CSV fix, UI adjustment, label change |
| New scraper, feature, refactor | `make release-minor` | New shop added, new filter, i18n |
| Breaking change | `make release-major` | API change, schema migration |

### What `make release` does

1. Reads `VERSION` file (e.g. "0.11.5")
2. Bumps the version (patch: 0.11.5 → 0.11.6)
3. Updates **4 files** in sync:
   - `VERSION`
   - `src/lib/version.ts`
   - `package.json`
   - `extension/manifest.json`
4. Moves old tarballs to `download/old/`
5. Builds `download/outdoorprice-<version>.tar.gz`
6. Builds `download/shop-protocol-extension-<version>.zip`

### Build artifacts

```
download/
├── outdoorprice-0.13.1.tar.gz          # Full project tarball
├── shop-protocol-extension-0.11.5.zip  # Chrome extension
└── old/                                  # Previous versions
```

---

## 8. Writing a New Shop Scraper

### Overview

Adding a new shop is a **3-step drop-in workflow**:
1. Create `src/lib/scraper/sites/<id>.ts` (self-contained file)
2. Add 1 import line to `sites/index.ts`
3. Add 1 entry to `SITES` in `types.ts`

No changes needed to `Makefile`, `groups.ts`, or any other file.

### Step 1: Capture the protocol (recommended)

Use the Chrome extension to capture how the shop's search works:

1. Load the extension (see [§9 below](#9-chrome-extension-installation))
2. Open the shop's website
3. F12 → "Shop Protocol" tab
4. Click "Start recording"
5. Type a search query, click a product
6. Click "Stop"
7. Click "Download archive (.zip)"

The archive contains a `protocol.md` with all the info you need: endpoints, selectors, sample product, JSON-LD structure.

### Step 2: Create the scraper file

Create `src/lib/scraper/sites/<yoursite>.ts`:

```typescript
import * as cheerio from "cheerio";
import { SiteMeta, Scraper, ProductResult } from "../types";
import { fetchHtml, parsePrice, absUrl, cleanTitle } from "../http";

export const site: SiteMeta = {
  id: "yoursite",
  name: "Your Site",
  baseUrl: "https://www.yoursite.com",
  country: "FR",
  currency: "EUR",
  accent: "bg-cyan-100 text-cyan-800 border-cyan-200",  // Tailwind classes for UI badge
  groups: ["cycling"],  // or ["outdoor"], or ["outdoor", "cycling"]
};

export const scraper: Scraper = {
  site,
  capabilities: {
    engine: "html",           // or "doofinder", "graphql", "rest", "playwright"
    usesPlaywright: false,     // true if site needs Playwright (Cloudflare, JS-rendered)
    challenge: false,          // true if site is known to block (longer timeout)
  },
  async search(query: string, signal: AbortSignal): Promise<ProductResult[]> {
    const url = `${site.baseUrl}/search?q=${encodeURIComponent(query)}`;
    const { html } = await fetchHtml(url, {
      signal,
      referer: site.baseUrl,
      timeoutMs: 25000,
      // playwrightFallback: true,  // auto-retry via Playwright if axios fails
      // waitForSelector: ".product-card",  // for Playwright
    });

    const $ = cheerio.load(html);
    const products: ProductResult[] = [];
    const seen = new Set<string>();

    // Parse product cards (adapt selectors to the actual HTML structure)
    $(".product-card").slice(0, 24).each((_, el) => {
      const $el = $(el);
      const title = cleanTitle($el.find(".product-title").text());
      if (!title) return;
      const href = absUrl($el.find("a").attr("href"), site.baseUrl);
      if (!href || seen.has(href)) return;
      seen.add(href);

      const price = parsePrice($el.find(".price").text());
      const originalPrice = parsePrice($el.find(".old-price").text()) || null;
      const img = $el.find("img").attr("src") || null;
      const discount = originalPrice && price && originalPrice > price
        ? Math.round((1 - price / originalPrice) * 100)
        : null;

      products.push({
        site: "yoursite",
        siteName: site.name,
        title,
        url: href,
        price,
        originalPrice,
        currency: "EUR",
        image: absUrl(img, site.baseUrl),
        availability: "unknown",
        discount,
      });
    });

    return products;
  },
};
```

### Step 3: Register in `sites/index.ts`

Add 2 lines:

```typescript
// 1. Add the import (alphabetical order is nice)
import { scraper as yoursite } from "./yoursite";

// 2. Add to the SCRAPERS array
export const SCRAPERS: Scraper[] = [
  // ... existing scrapers ...
  yoursite,  // ← add here
];
```

### Step 4: Add to `SITES` in `types.ts`

Add 1 entry (7 lines) to the `SITES` record:

```typescript
export const SITES: Record<string, SiteMeta> = {
  // ... existing entries ...
  yoursite: {
    id: "yoursite",
    name: "Your Site",
    baseUrl: "https://www.yoursite.com",
    country: "FR",
    currency: "EUR",
    accent: "bg-cyan-100 text-cyan-800 border-cyan-200",
    groups: ["cycling"],
  },
};
```

### Step 5: Test

```bash
make check-site SITE=yoursite Q="test query"
```

### Scraper templates by engine type

#### HTML engine (cheerio) — most common
For shops that serve server-rendered HTML (Shopify, Magento, custom). See `bergzeit.ts`, `all4cycling.ts`, `montaz.ts`.

#### Doofinder engine (Playwright)
For shops using Doofinder Layer widget (Glisshop, Barrabes, ProBikeShop). See `probikeshop.ts` as template — opens the search modal, types into the Doofinder layer, extracts `.dfd-card-*` elements.

#### GraphQL engine
For shops with a public GraphQL API (Snowleader, Ekosport). See `snowleader.ts` as template.

### Key helpers from `http.ts`

| Function | Purpose |
|---|---|
| `fetchHtml(url, opts)` | Main fetcher (axios + Playwright fallback) |
| `parsePrice(raw)` | Parse FR/DE/EN/Swiss price strings |
| `absUrl(href, base)` | Resolve relative URLs |
| `cleanTitle(raw)` | Collapse whitespace |
| `fetchJsonViaPlaywright(url)` | For Cloudflare-protected JSON APIs |
| `fetchJsonPostViaPlaywright(apiUrl, opts)` | POST via Playwright (with Cloudflare cookies) |

### Key helpers from `enrich.ts` (available during enrichment)

| Function | Purpose |
|---|---|
| `guessBrandFromTitle(title)` | Detect brand from 100+ known brands |
| `parseWeightGrams(raw)` | Parse "850 g" / "1.2 kg" → grams |
| `extractColorsFromTitle(title)` | Extract color names from title suffixes |
| `classifyTaxonomy(...inputs)` | Normalize category → sport/category/range |

### Capabilities reference

```typescript
interface ScraperCapabilities {
  engine: "html" | "doofinder" | "graphql" | "rest" | "playwright" | "custom";
  usesPlaywright?: boolean;  // true = needs headless browser
  challenge?: boolean;        // true = known to block (gets 60s timeout instead of 30s)
  needsHeaded?: boolean;     // true = needs visible browser (rare)
  relevance?: "strict" | "loose";  // strict = drop products with no query token in title
}
```

#### Relevance filtering (`relevance: "strict"`)

When `relevance: "strict"` is set, the registry **post-filters** each site's search results: any product whose title doesn't contain at least one token from the user's search query is dropped. This prevents cycling shops from returning irrelevant results when searching for outdoor products (e.g. searching "Atomic Hawx" ski boots on ProBikeShop — a cycling shop that returns cycling jerseys).

Currently set to `"strict"` on all 4 cycling shops: `probikeshop`, `alltricks`, `all4cycling`, `deporvillage`.

Outdoor shops use the default (`"loose"`) — they're more likely to return relevant results since they specialize in the searched categories.

### Updating PROTOCOLES.md

After creating a new scraper, document its protocol in `PROTOCOLES.md`:
- Point d'entrée (URL, method, headers)
- Corps de requête
- Champs utiles (selectors)
- Pièges (gotchas)
- Statut live

---

## 9. Chrome Extension Installation

### Load unpacked

1. Open `chrome://extensions/`
2. Toggle **Developer mode** ON (top-right)
3. Click **Load unpacked**
4. Select the `extension/` folder
5. The "Shop Protocol Recorder" extension should appear

### Usage

1. Open any e-commerce site
2. F12 → **Shop Protocol** tab (next to Console, Network, etc.)
3. Enter the shop name (auto-derived from the URL if empty)
4. Click **Start recording**
5. On the page: type a search, click a product, browse variants
6. Click **Stop**
7. Click **Generate protocol.md**
8. Click **⬇ Download archive (.zip)** for the full package

### Archive contents

```
shop-protocol-<name>-<timestamp>.zip
├── protocol.md              ← Markdown summary (for AI)
├── capture.json              ← Raw captured requests
├── manifest.json             ← Archive metadata
├── README.md                 ← Quick-start guide
└── requests/
    ├── 001-SEARCH-GET-www.shop.com-search.response.html
    ├── 001-SEARCH-GET-www.shop.com-search.meta.json
    ├── 002-PRODUCT-GET-www.shop.com-products-x.response.html
    └── 002-PRODUCT-GET-www.shop.com-products-x.meta.json
```

---

## 10. Electron Desktop App

The app can run as a desktop application (macOS/Windows/Linux) using Electron. This is the recommended way to run it — no browser needed, and Playwright uses your **real system Chrome** (real TLS fingerprint) for maximum anti-bot bypass.

### Running in Electron (dev mode)

```bash
make run
```

This starts the Next.js server on port 3456 and opens an Electron window. The env var `PLAYWRIGHT_CHANNEL=chrome` is set automatically — Playwright will use your installed Google Chrome instead of bundled Chromium.

### Building a distributable

```bash
make package-mac        # macOS .app + .dmg (unsigned — see below)
make package-win        # Windows .exe (NSIS installer)
make package-linux      # Linux .AppImage
```

Output goes to `dist-electron/`:

| Platform | Output | Format |
|---|---|---|
| macOS | `OutdoorPrice-<version>.dmg` | Disk image (unsigned) |
| Windows | `OutdoorPrice Setup <version>.exe` | NSIS installer |
| Linux | `OutdoorPrice-<version>.AppImage` | Portable AppImage |

**Note on macOS signing:** v0.14.19+ disables code-signing by default
(`identity: null` + `CSC_IDENTITY_AUTO_DISCOVERY=false`). The `.app` is
unsigned — Gatekeeper will refuse to open it by default. To run it:

```bash
xattr -cr dist-electron/mac-arm64/OutdoorPrice.app   # strip quarantine
open dist-electron/mac-arm64/OutdoorPrice.app
```

See [`docs/electron-packaging.md`](./electron-packaging.md) for the full
build pipeline, all workarounds, and how to re-enable signing for public
distribution.

### Why Electron helps with anti-bot

When running in Electron:
- Playwright uses `channel: "chrome"` → launches your **real Chrome binary** (not Chromium)
- Real Chrome has a different **TLS fingerprint** (JA3) than Chromium — Akamai/Cloudflare can't distinguish it from a regular user
- The app runs on your **residential IP** (not a data-center IP)
- Headful mode (`headless: false`) passes behavioral checks
- The Chrome window is positioned off-screen (`--window-position=-32000,-32000`) so you don't see it

### System Chrome requirement

For the Akamai bypass to work, Google Chrome must be installed:
- **macOS**: `/Applications/Google Chrome.app/`
- **Windows**: `C:\Program Files\Google\Chrome\Application\chrome.exe`
- **Linux**: `/usr/bin/google-chrome` or `/usr/bin/chromium-browser`

If Chrome isn't found, Playwright falls back to bundled Chromium (which may be detected by Akamai).

---

## 11. Customization

### Adding a custom shop group

1. Click **"Gérer les groupes"** in the header
2. In the matrix modal, enter a new group name + emoji
3. Click **Créer**
4. Check/uncheck shops in the matrix to add them to your group
5. The group is saved in localStorage and persists across sessions

### Adding brands to `KNOWN_BRANDS`

Edit `src/lib/scraper/enrich.ts` → `KNOWN_BRANDS` array:

```typescript
const KNOWN_BRANDS = [
  // ... existing ...
  "YourBrand", "YOURBRAND",
];
```

### Adding model→brand inference

Edit `src/lib/scraper/enrich.ts` → `MODEL_TO_BRAND`:

```typescript
const MODEL_TO_BRAND: Record<string, string> = {
  // ... existing ...
  "yourmodel": "YourBrand",
};
```

### Adding taxonomy rules

Edit `src/lib/scraper/taxonomy.ts`:

```typescript
const CATEGORY_RULES = [
  // ... existing ...
  { patterns: [/yourcategory/i], out: { category: "Your Category" } },
];
```

### Customizing the UI accent colors

Edit `types.ts` → `SITES` entry:

```typescript
accent: "bg-pink-100 text-pink-800 border-pink-200",  // Tailwind classes
```

### Changing the default language

Edit `src/lib/i18n.tsx` → `LangProvider`:

```typescript
const [lang, setLangState] = useState<Lang>(() => {
  // Change "fr" to "en", "es", or "de"
  return "fr";
});
```

### Proxy configuration

Set `PROXY_URL` in `.env`:

```bash
# SOCKS5 (recommended for scraping)
PROXY_URL=socks5://user:pass@host:port

# HTTP/HTTPS
PROXY_URL=http://user:pass@host:port
```

The proxy is used by both axios and Playwright automatically.
