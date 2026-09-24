# Shop Protocol Recorder — Chrome DevTools Extension

A DevTools extension that records network/WebSocket traffic on an e-commerce
site while you search and browse products, then generates a `protocol.md`
document describing the search and product endpoints. The generated document
follows the same format as `PROTOCOLES.md` in the main project, so you can
hand it to an AI assistant (or use it yourself) to write a new scraper plugin.

## Installation (developer mode)

1. Open Chrome and navigate to `chrome://extensions/`
2. Toggle **Developer mode** ON (top-right corner)
3. Click **Load unpacked**
4. Select this `extension/` folder (the one containing `manifest.json`)
5. The "Shop Protocol Recorder" extension should appear in the list

## Usage

1. Open the e-commerce site you want to analyze (e.g. `https://www.tradeinn.com`)
2. Open Chrome DevTools (`F12` or `Cmd+Option+I` on Mac)
3. Navigate to the **Shop Protocol** tab (next to Console, Network, etc.)
4. Enter the shop name in the input field (e.g. `tradeinn`) — this is used
   as the file name and the title of the generated protocol
5. Click **Start recording**
6. In the page (not in DevTools):
   - Type a search query in the shop's search box and submit it
   - Click on a product from the search results
   - Optionally click on a different color/size variant
   - Optionally navigate to a second product to capture more variants
7. Click **Stop** in the DevTools panel
8. Review the captured requests (color-coded by category)
9. Click **Generate protocol.md**
10. Click **Download .md** to save the file, or **Copy to clipboard** to paste
    it directly into the chat with the AI

## What it captures

The extension records all XHR/fetch/WebSocket requests on the inspected tab,
filtering out static assets (JS, CSS, images, fonts) and common analytics
beacons (Google Analytics, DoubleClick, Facebook Pixel, Hotjar, Clarity,
Cloudflare Insights).

Each request is categorized as one of:

| Category   | Color   | Detection criteria |
|------------|---------|-------------------|
| SEARCH     | green   | GET with `?q=` / `?query=` / `?search=` / `?keyword=` / `?palabras=` etc., or POST with a JSON/form body containing a search-like field, or GraphQL with `search` in the query |
| PRODUCT    | blue    | URL matches `/p/<slug>`, `/product/`, `/produit/`, `/detalle/`, `/dp/<ASIN>`, `/<slug>-<SKU>.html`, `?p=<id>` etc., or `/api/.../product/...` |
| WEBSOCKET  | amber   | URL starts with `ws://` or `wss://`. WebSocket frames are captured (up to 200 per connection) and the largest frames containing product data are highlighted in the protocol |
| OTHER      | grey    | All other XHR requests (hidden by default — toggle the "Other XHR" checkbox to see them) |

For each captured request, the protocol includes:

- HTTP method and full URL
- Notable headers (Content-Type, Store, X-Makaira-Instance, Authorization,
  Origin, Referer, X-Requested-With, X-Algolia-*, X-CSRF-Token, Cookie
  preview, etc.)
- Request body (pretty-printed if JSON, up to 10 KB)
- Response status and Content-Type, **with the total response size** in chars
- Response body preview (pretty-printed if JSON, up to 50 KB — 10× more than v1)
- For JSON responses: auto-detected "useful fields" (paths like
  `data.items[].title`, `prices.sale`, `ean`, `brand` etc.) — up to 50 paths
- **Array counts** (pagination info): for each array detected in the JSON,
  shows the path and number of items (e.g. `data.items` → 24 items)
- ⭐ **Sample product (full)**: the first complete product object extracted
  from the response, shown WITHOUT truncation. This is the most useful
  artifact for writing a scraper — you see ALL fields available for ONE
  product, including nested price/image/variant structures.
- For WebSocket (Doofinder Phoenix LiveView) frames: up to 15 frames shown,
  with each up to 10 KB. Frames containing product data are highlighted first,
  with a sample product extracted from them too.

## Generated protocol format

The output is a Markdown document following this template:

```markdown
# Protocol — <shop name>

> Generated on <date> by Shop Protocol Recorder.
> Source: N requests captured (X search, Y product, Z WebSocket).

## Résumé exécutif

| Type      | Méthode | Endpoint       | Host              |
|-----------|---------|----------------|-------------------|
| SEARCH    | POST    | /graphql/      | api.snowleader.com|
| PRODUCT   | GET     | /p/<slug>      | www.bergzeit.fr   |
| WEBSOCKET | WS      | /layer/1/ws    | eu1-layer.doofinder.com |

## Recherche (Search)

### Endpoint 1

**Point d'entrée**
POST https://api.snowleader.com/graphql/

**En-têtes notables**
Content-Type: application/json
Store: Store_View_COM_FR
...

**Corps de requête**
{ "query": "query productList($search: String...) { ... }",
  "variables": { "search": "Dynafit", "currentPage": 1 } }

**Réponse (aperçu 200)**
{ "data": { "products": { "items": [...] } } }

**Champs utiles détectés**
- data.products.items[].name
- data.products.items[].price_range.minimum_price.final_price.value
- ...

## Page produit (Product detail)
...

## Recommandations pour le scraper
1. Vérifier les en-têtes...
2. Pour les pages produit, vérifier si un JSON-LD est servi...
3. Pour les API JSON, reproduire exactement le corps...
4. Pour les WebSockets, reproduire la trame Phoenix...
5. Tester avec `make check-site SITE=<new-site> Q="test"`...
```

## Workflow suggestion

1. Use the extension to capture a real session on the target shop
2. **Recommended**: click **"⬇ Download archive (.zip)"** — produces a single
   self-contained `shop-protocol-<name>-<timestamp>.zip` file containing:
   - `protocol.md` — the main markdown artifact
   - `capture.json` — raw JSON of all captured requests with full bodies
   - `manifest.json` — archive metadata (counts, sizes)
   - `README.md` — quick-start guide for the AI assistant
   - `requests/` — one file per captured request (response body + metadata)
3. Hand the `.zip` to your AI assistant (or extract and paste `protocol.md`)
4. The AI uses the protocol to write `src/lib/scraper/sites/<new-shop>.ts`
5. Add the new shop to `src/lib/scraper/types.ts` (SiteId + SITES entry)
6. Add it to `src/lib/scraper/registry.ts` (SCRAPERS array)
7. Test with `make check-site SITE=<new-shop> Q="Dynafit"`
8. Add it to a shop group (Outdoor, Cycling, IT, or a custom one)

### Alternative: download individual files

If you don't need the full archive, you can still download files separately:
- **"Download .md"** — just the `protocol.md` file
- **"Download raw JSON (full bodies)"** — just the `capture.json` with full response bodies

### Archive layout (zip)

```
shop-protocol-all4cycling-2026-08-26T10-30-00.zip
├── protocol.md              ← Start here. Markdown summary for the AI.
├── capture.json             ← Raw capture for jq/offline analysis.
├── manifest.json            ← Archive metadata (shopName, counts, sizes).
├── README.md                ← Quick-start guide (also for the AI).
└── requests/
    ├── 001-SEARCH-GET-www.all4cycling.com-fr-search.response.html
    ├── 001-SEARCH-GET-www.all4cycling.com-fr-search.meta.json
    ├── 002-OTHER-POST-www.all4cycling.com-api-graphql.response.json
    ├── 002-OTHER-POST-www.all4cycling.com-api-graphql.meta.json
    ├── 003-WEBSOCKET-GET-eu1-layer.doofinder.com-layer.meta.json
    └── 003-WEBSOCKET-GET-eu1-layer.doofinder.com-layer.ws-frames.json
```

Each file in `requests/` follows the convention `NNN-CATEGORY-METHOD-host-path.{response.EXT,meta.json,ws-frames.json}`.
The extension (`.html`, `.json`, `.xml`, `.txt`) is chosen automatically based on the response content-type.

## Limitations & known issues

- **WebSocket frames**: Chrome DevTools API exposes `har.webSocketMessages`
  for WSS connections in Chrome 99+. Older versions won't capture frames.
- **Service workers (SSE)**: Server-Sent Events streams aren't captured as
  discrete requests by the HAR API — they appear as a single long-lived
  connection. The extension will show the connection but not the individual
  events.
- **CORS preflight (OPTIONS)**: included in the capture but not categorized
  as search/product — they show up under "Other XHR".
- **Responses larger than 50 KB** are truncated in the protocol.md preview.
  To see the FULL body, either:
  - **Click the request** in the captured-requests list to open the detail
    modal (shows the full un-truncated body, up to several MB)
  - **Click "Download raw JSON"** to export all captured requests with their
    full bodies as a single `.json` file (analyze with `jq`, paste into a LLM,
    or grep for specific fields)
- **Empty response body**: this happens when the response is finished but
  `har.getContent()` hasn't been called yet. The panel now waits up to 5s
  for all bodies to be fetched before generating the protocol — but if you
  still see an empty body, click "Generate" again after a second.
- **WebSocket frames truncated to 200 KB each** at capture time. Phoenix
  LiveView frames are usually 10-50 KB so this rarely matters, but very large
  batches of products in a single frame can exceed this.
- **Cloudflare challenge pages**: if the shop is behind Cloudflare and the
  browser solves a JS challenge, the challenge request itself may appear in
  the capture. The extension filters out known analytics but not Cloudflare
  challenges.

## File structure

```
extension/
├── manifest.json              # MV3 manifest
├── devtools.html              # DevTools page (creates the panel)
├── devtools.js                # Creates the "Shop Protocol" panel
├── panel.html                 # Panel UI (HTML)
├── panel.js                   # Panel logic + request capture + archive builder
├── protocol-generator.js      # Generates the .md from captured requests
├── background.js              # Service worker (minimal)
├── vendor/
│   └── jszip.min.js           # JSZip library (for .zip archive generation)
├── icons/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
└── README.md                  # This file
```

## Development & debugging

- To debug the panel itself: right-click anywhere in the panel → "Inspect".
  This opens a DevTools window for the panel — use the Console to inspect
  `window.__capturedRequests` after stopping a recording.
- To reload the extension after editing the source: go to
  `chrome://extensions/` and click the reload icon on the extension card.
- Logs are prefixed with `[Shop Protocol Recorder]` and visible in the
  extension's service worker console (chrome://extensions/ → "Inspect views:
  service worker").

## Privacy

The extension does **not** transmit any data over the network. All captured
requests stay in your browser (in memory, cleared when you close DevTools).
Nothing is sent to any external server.
