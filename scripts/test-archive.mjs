// Test the archive-building logic of panel.js
// We can't directly import panel.js (it's a Chrome extension script that
// uses chrome.devtools API at module load), so we extract the testable
// functions and replicate the archive-building logic with a mock JSZip.

import JSZip from "../extension/vendor/jszip.min.js";
import { generateProtocol } from "../extension/protocol-generator.js";

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { console.log(`✅ ${name}`); pass++; }
  else { console.log(`❌ ${name}`); fail++; }
}

// === Replicate the helper functions from panel.js ===
function sanitizeFilename(s, maxLen = 50) {
  return String(s || "")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, maxLen) || "unknown";
}

function buildRequestFilename(idx, req) {
  const cat = (req.category || "other").toUpperCase();
  const method = (req.method || "GET").toUpperCase();
  let host = "unknown";
  let path = "";
  try {
    const u = new URL(req.url);
    host = u.host;
    path = u.pathname;
  } catch {
    host = req.url.split("/")[2] || "unknown";
  }
  const hostPart = sanitizeFilename(host, 40);
  const pathPart = sanitizeFilename(path, 40);
  return `${idx}-${cat}-${method}-${hostPart}${pathPart ? "-" + pathPart : ""}`;
}

function pickExtension(contentType, body) {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("json")) return "json";
  if (ct.includes("html")) return "html";
  if (ct.includes("xml")) return "xml";
  if (ct.includes("css")) return "css";
  if (ct.includes("javascript")) return "js";
  if (ct.includes("text/plain")) return "txt";
  if (ct.includes("form-urlencoded")) return "txt";
  const trimmed = (body || "").trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  if (trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html")) return "html";
  return "txt";
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

const CATEGORY = { SEARCH: "search", PRODUCT: "product", WEBSOCKET: "websocket", OTHER: "other" };

// === Mock captured requests (Shopify all4cycling scenario) ===
const mockHtmlResponse = `<!doctype html>
<html><head><title>Recherche : 231 résultats</title></head>
<body>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"ItemList","itemListElement":[
  {"@type":"ListItem","position":1,"item":{"@type":"Product","name":"Castelli Giro 4","sku":"CSG4-001","brand":{"@type":"Brand","name":"Castelli"},"offers":{"@type":"Offer","price":"149.95","priceCurrency":"EUR"}}}
]}
</script>
</body></html>`;

const mockJsonResponse = JSON.stringify({
  data: { products: { total: 523, items: [
    { id: "abc123", title: "Test Product", price: 99.95, brand: "TestBrand", ean: "1234567890123" }
  ]}}
});

const mockRequests = [
  {
    method: "GET",
    url: "https://www.all4cycling.com/fr/search/suggest?q=castelli+giro&section_id=predictive-search",
    category: "search",
    headers: { "content-type": "text/html", "origin": "https://www.all4cycling.com" },
    body: "",
    startedAt: "2026-08-26T10:00:00Z",
    responseStatus: 200,
    responseContentType: "text/html",
    responseBody: mockHtmlResponse,
  },
  {
    method: "POST",
    url: "https://www.all4cycling.com/api/2026-04/graphql.json",
    category: "other",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: 'query GetSlideCartOffers { shop { metafield(namespace: "$app:candyrack") { value } } }' }),
    startedAt: "2026-08-26T10:00:01Z",
    responseStatus: 200,
    responseContentType: "application/json",
    responseBody: mockJsonResponse,
  },
  {
    method: "GET",
    url: "https://www.all4cycling.com/fr/products/sottocasco-castelli-summer-skull-nero",
    category: "product",
    headers: {},
    body: "",
    startedAt: "2026-08-26T10:00:02Z",
    responseStatus: 200,
    responseContentType: "text/html",
    responseBody: "<!doctype html><html><body><h1>Sottocasco Castelli</h1></body></html>",
  },
  {
    method: "GET",
    url: "wss://eu1-layer.doofinder.com/layer/1/websocket?hashid=ab5ee4283e3582ee7ecdb6e65abbf338",
    category: "websocket",
    headers: {},
    body: "",
    startedAt: "2026-08-26T10:00:03Z",
    responseStatus: 101,
    responseContentType: "websocket",
    responseBody: "",
    wsFrames: [
      { direction: "→", data: '["5","51","lv:abc","phx_join",{"config":{"hashid":"ab5ee4283e3582ee7ecdb6e65abbf338"}}]' },
      { direction: "←", data: JSON.stringify(["5","52","lv:abc","event",{"results":[{"title":"Test","price":99.95}],"total":523}]) },
    ],
  },
];

// === Unit tests on helpers ===
console.log("\n=== Helper unit tests ===");
check("pickExtension(json) → json", pickExtension("application/json", '{"a":1}') === "json");
check("pickExtension(html) → html", pickExtension("text/html", "<!doctype html>") === "html");
check("pickExtension(json sniff)", pickExtension("", '{"x":1}') === "json");
check("pickExtension(html sniff)", pickExtension("", "<html>") === "html");
check("pickExtension(txt default)", pickExtension("", "plain text") === "txt");
check("pickExtension(form-urlencoded)", pickExtension("application/x-www-form-urlencoded", "q=test") === "txt");

check("sanitizeFilename basic", sanitizeFilename("www.example.com") === "www-example-com");
check("sanitizeFilename trims dashes", sanitizeFilename("---abc---") === "abc");
check("sanitizeFilename limits length", sanitizeFilename("a".repeat(100), 10).length === 10);
check("sanitizeFilename empty → 'unknown'", sanitizeFilename("") === "unknown");

const fname = buildRequestFilename("001", mockRequests[0]);
check("buildRequestFilename has index", fname.startsWith("001-"));
check("buildRequestFilename has category", fname.includes("SEARCH"));
check("buildRequestFilename has method", fname.includes("GET"));
check("buildRequestFilename has host", fname.includes("www-all4cycling-com"));
check("buildRequestFilename has path", fname.includes("fr-search-suggest"));

const wsFname = buildRequestFilename("004", mockRequests[3]);
check("WS filename has WEBSOCKET cat", wsFname.includes("WEBSOCKET"));
check("WS filename has eu1-layer.doofinder.com", wsFname.includes("eu1-layer-doofinder-com"));

// === Build the actual zip archive (replicating downloadArchive() logic) ===
console.log("\n=== Archive build test ===");
const shopName = "all4cycling";
const zip = new JSZip();

// 1. protocol.md
const protocolMd = generateProtocol({ shopName, requests: mockRequests });
zip.file("protocol.md", protocolMd);
check("protocol.md added to zip", protocolMd.length > 1000);
check("protocol.md contains sample product", protocolMd.includes("Castelli Giro 4") || protocolMd.includes("Sottocasco") || protocolMd.includes("Test Product"));

// 2. capture.json
const captureData = {
  shopName,
  capturedAt: new Date().toISOString(),
  totalRequests: mockRequests.length,
  requests: mockRequests.map((r) => ({
    method: r.method, url: r.url, category: r.category, headers: r.headers, body: r.body,
    responseStatus: r.responseStatus, responseContentType: r.responseContentType,
    responseBody: r.responseBody, wsFrames: r.wsFrames,
  })),
};
zip.file("capture.json", JSON.stringify(captureData, null, 2));

// 3. manifest.json
const categoryCounts = mockRequests.reduce((acc, r) => { acc[r.category] = (acc[r.category] || 0) + 1; return acc; }, {});
const totalResponseBodySize = mockRequests.reduce((sum, r) => sum + (r.responseBody?.length || 0), 0);
const manifest = {
  archiveVersion: "1.0",
  shopName,
  capturedAt: new Date().toISOString(),
  totalRequests: mockRequests.length,
  categoryCounts,
  totalResponseBodyBytes: totalResponseBodySize,
  totalResponseBodyHumanReadable: formatBytes(totalResponseBodySize),
};
zip.file("manifest.json", JSON.stringify(manifest, null, 2));
check("manifest categoryCounts has search=1", manifest.categoryCounts.search === 1);
check("manifest categoryCounts has product=1", manifest.categoryCounts.product === 1);
check("manifest categoryCounts has websocket=1", manifest.categoryCounts.websocket === 1);
check("manifest categoryCounts has other=1", manifest.categoryCounts.other === 1);
check("manifest totalRequests is 4", manifest.totalRequests === 4);

// 5. requests/ folder
const usedFilenames = new Set();
for (let i = 0; i < mockRequests.length; i++) {
  const req = mockRequests[i];
  const idx = String(i + 1).padStart(3, "0");
  const baseName = buildRequestFilename(idx, req);
  let uniqueBase = baseName;
  let dedupe = 2;
  while (usedFilenames.has(uniqueBase)) {
    uniqueBase = `${baseName}-${dedupe}`;
    dedupe++;
  }
  usedFilenames.add(uniqueBase);

  if (req.responseBody) {
    const ext = pickExtension(req.responseContentType, req.responseBody);
    zip.file(`requests/${uniqueBase}.response.${ext}`, req.responseBody);
  }
  const meta = {
    index: i + 1, category: req.category, method: req.method, url: req.url,
    requestHeaders: req.headers, requestBody: req.body,
    responseStatus: req.responseStatus, responseContentType: req.responseContentType,
    responseBodySize: req.responseBody?.length || 0,
    responseBodyFile: req.responseBody ? `${uniqueBase}.response.${pickExtension(req.responseContentType, req.responseBody)}` : null,
    wsFramesFile: req.category === "websocket" ? `${uniqueBase}.ws-frames.json` : null,
    wsFrameCount: req.wsFrames?.length || 0,
    capturedAt: req.startedAt,
  };
  zip.file(`requests/${uniqueBase}.meta.json`, JSON.stringify(meta, null, 2));

  if (req.category === "websocket" && req.wsFrames?.length > 0) {
    const framesJson = JSON.stringify({
      url: req.url, method: req.method, responseStatus: req.responseStatus,
      frameCount: req.wsFrames.length, frames: req.wsFrames,
    }, null, 2);
    zip.file(`requests/${uniqueBase}.ws-frames.json`, framesJson);
  }
}

// Generate the actual zip
const blob = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
import { writeFileSync, statSync } from "node:fs";
writeFileSync("/tmp/test-archive.zip", blob);
const stat = statSync("/tmp/test-archive.zip");
console.log(`\nArchive size: ${formatBytes(stat.size)}`);

// Verify zip contents by re-reading it
const zip2 = await JSZip.loadAsync(blob);
const files = Object.keys(zip2.files).sort();
console.log("\nFiles in archive:");
for (const f of files) {
  if (!zip2.files[f].dir) {
    console.log(`  ${f} (${zip2.files[f]._data ? "binary" : "text"})`);
  }
}

// Validate expected files are present (using prefix matching since dots in paths get sanitized)
const expectedFilePrefixes = [
  "protocol.md",
  "capture.json",
  "manifest.json",
  "requests/001-SEARCH-GET-www-all4cycling-com-fr-search-suggest.response.html",
  "requests/001-SEARCH-GET-www-all4cycling-com-fr-search-suggest.meta.json",
  "requests/002-OTHER-POST-www-all4cycling-com-api-2026-04-graphql-json.response.json",
  "requests/002-OTHER-POST-www-all4cycling-com-api-2026-04-graphql-json.meta.json",
  "requests/003-PRODUCT-GET-www-all4cycling-com-fr-products-sottocasco-castelli-summer-s.response.html",
  "requests/003-PRODUCT-GET-www-all4cycling-com-fr-products-sottocasco-castelli-summer-s.meta.json",
  "requests/004-WEBSOCKET-GET-eu1-layer-doofinder-com-layer-1-websocket.meta.json",
  "requests/004-WEBSOCKET-GET-eu1-layer-doofinder-com-layer-1-websocket.ws-frames.json",
];
console.log("\nExpected vs actual files:");
for (const expected of expectedFilePrefixes) {
  // The sanitizer replaces dots with dashes, so "graphql.json" becomes "graphql-json" in the filename.
  // We match against the actual files list (already includes the sanitized form).
  const found = files.includes(expected);
  check(`Archive contains ${expected}`, found);
}

// Read back the manifest.json to verify it's parseable
const manifestContent = await zip2.file("manifest.json").async("string");
const parsedManifest = JSON.parse(manifestContent);
check("Re-read manifest.json parses", parsedManifest.totalRequests === 4);
check("Re-read manifest has categoryCounts", parsedManifest.categoryCounts.search === 1);

// Read back a request meta.json
const metaContent = await zip2.file(files.find((f) => f.includes("001-SEARCH") && f.endsWith("meta.json"))).async("string");
const parsedMeta = JSON.parse(metaContent);
check("Re-read request meta.json parses", parsedMeta.method === "GET");
check("Re-read meta has category", parsedMeta.category === "search");
check("Re-read meta has responseBodyFile", parsedMeta.responseBodyFile.endsWith(".response.html"));

// Read back WS frames
const wsFramesContent = await zip2.file(files.find((f) => f.includes("004-WEBSOCKET") && f.endsWith("ws-frames.json"))).async("string");
const parsedWsFrames = JSON.parse(wsFramesContent);
check("Re-read WS frames parses", parsedWsFrames.frameCount === 2);
check("Re-read WS frames has 2 frames", Array.isArray(parsedWsFrames.frames) && parsedWsFrames.frames.length === 2);

console.log(`\n${pass}/${pass + fail} checks passed.`);
process.exit(fail > 0 ? 1 : 0);
