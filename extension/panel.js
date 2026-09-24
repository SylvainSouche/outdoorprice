// panel.js — logic for the Shop Protocol Recorder DevTools panel.
// --------------------------------------------------------------------------
// Uses chrome.devtools.network API to capture all requests on the inspected
// tab. Each request is categorized (search / product / websocket / other)
// and stored. When the user clicks "Generate protocol.md", the protocol-
// generator.js builds a markdown document from the captured requests.
// --------------------------------------------------------------------------

const CATEGORY = {
  SEARCH: "search",
  PRODUCT: "product",
  WEBSOCKET: "websocket",
  OTHER: "other",
};

// Limites de capture — généreuses pour permettre l'analyse complète
const MAX_WS_FRAMES_CAPTURED = 200;  // par connexion WS
const MAX_FRAME_SIZE = 200000;        // 200 KB par frame (on garde tout, pas de troncation)

// State
let recording = false;
let captured = [];
let filters = { search: true, product: true, websocket: true, other: false };
let pendingGetContent = 0;  // nombre de getContent en cours (pour attendre avant génération)

// DOM
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");
const counterEl = document.getElementById("counter");
const requestsEl = document.getElementById("requests");
const generateBtn = document.getElementById("generateBtn");
const downloadBtn = document.getElementById("downloadBtn");
const copyBtn = document.getElementById("copyBtn");
const downloadRawBtn = document.getElementById("downloadRawBtn");
const downloadArchiveBtn = document.getElementById("downloadArchiveBtn");
const protocolOutput = document.getElementById("protocolOutput");
const shopNameInput = document.getElementById("shopName");
const filterCheckboxes = {
  search: document.getElementById("showSearch"),
  product: document.getElementById("showProduct"),
  websocket: document.getElementById("showWebSocket"),
  other: document.getElementById("showOther"),
};

// ----- categorize (mirror of protocol-generator.js) -----

function isSearchRequest(req) {
  const url = (req.url || "").toLowerCase();
  const method = (req.method || "GET").toUpperCase();
  const body = req.body || "";
  const contentType = (req.headers?.["Content-Type"] || req.headers?.["content-type"] || "").toLowerCase();

  const searchParams = ["q=", "query=", "search=", "searchTerm=", "keyword=", "keywords=", "palabras=", "suche=", "recherche=", "term="];
  if (method === "GET") {
    if (searchParams.some((p) => url.includes("?" + p) || url.includes("&" + p))) {
      return true;
    }
    if (/\/(search(-result)?|recherche|resultat-recherche|suche|suchergebnis|buscar)(\?|\/|$)/i.test(url)) return true;
    if (/\/search\/suggest/i.test(url)) return true;
  }

  if (method === "POST" && contentType.includes("x-www-form-urlencoded")) {
    const bodyLower = body.toLowerCase();
    if (searchParams.some((p) => bodyLower.includes(p))) return true;
  }

  if (method === "POST" && contentType.includes("json")) {
    try {
      const parsed = JSON.parse(body);
      const isGraphQLEnvelope = typeof parsed.query === "string"
        && /^\s*(query|mutation|subscription|fragment)\s+/i.test(parsed.query);
      if (!isGraphQLEnvelope) {
        const keys = Object.keys(parsed);
        const searchKeys = ["search", "q", "keyword", "keywords", "searchPhrase", "searchString", "palabras", "suche", "term", "text"];
        if (keys.some((k) => searchKeys.includes(k.toLowerCase()))) return true;
        if (parsed.variables && typeof parsed.variables === "object") {
          const varKeys = Object.keys(parsed.variables);
          if (varKeys.some((k) => searchKeys.includes(k.toLowerCase()))) return true;
        }
      }
      if (isGraphQLEnvelope) {
        const queryStr = parsed.query.toLowerCase();
        const searchOps = [
          /\bsearch\b/i, /\bsearchproducts\b/i, /\bpredictivesearch\b/i,
          /\bproductsearch\b/i, /\bproducts\s*\(/i, /\bsearch\b\s*\(/i,
          /\bquery:\s*["']/i,
        ];
        const nonSearchOps = [
          /\bslidecartoffers\b/i, /\bconsentmanagement\b/i, /\bcart\b/i,
          /\bwishlist\b/i, /\bmetafield\b/i,
        ];
        const hasSearchOp = searchOps.some((re) => re.test(queryStr));
        const hasNonSearchOp = nonSearchOps.some((re) => re.test(queryStr));
        if (hasSearchOp && !hasNonSearchOp) return true;
      }
    } catch {}
  }

  if (url.includes("/graphql") && url.includes("search")) return true;
  return false;
}

function isProductRequest(req) {
  const url = req.url || "";
  const urlLower = url.toLowerCase();
  const method = (req.method || "GET").toUpperCase();

  const productPatterns = [
    /\/p\/[\w-]+/i,
    /\/product\//i,
    /\/products\//i,             // Shopify
    /\/produit\//i,
    /\/produkte\//i,
    /\/producto\//i,
    /\/detalle\//i,
    /\/detail\//i,
    /\/item\//i,
    /\/dp\/[\w]+/i,
    /\/sku\//i,
    /-[a-z0-9]{6,}\.html/i,
    /\?p=\d+/i,
  ];
  if (method === "GET" && productPatterns.some((p) => p.test(urlLower))) {
    if (!isSearchRequest(req)) return true;
  }
  if (/\/api\/.*\/(product|item|detail|p)\//i.test(urlLower)) return true;
  return false;
}

function categorize(req) {
  const url = req.url || "";
  const urlLower = url.toLowerCase();
  if (url.startsWith("ws://") || url.startsWith("wss://")) {
    return CATEGORY.WEBSOCKET;
  }
  if (urlLower.includes("doofinder.com") && urlLower.includes("/layer/")) {
    return CATEGORY.WEBSOCKET;
  }
  if (urlLower.includes("/websocket") || (urlLower.includes("/ws/") && urlLower.includes("socket"))) {
    return CATEGORY.WEBSOCKET;
  }
  if (isSearchRequest(req)) return CATEGORY.SEARCH;
  if (isProductRequest(req)) return CATEGORY.PRODUCT;
  return CATEGORY.OTHER;
}

// ----- Recording -----

function setStatus(state) {
  recording = state;
  if (recording) {
    statusEl.textContent = "recording";
    statusEl.className = "status status-recording";
    startBtn.disabled = true;
    stopBtn.disabled = false;
  } else {
    statusEl.textContent = "idle";
    statusEl.className = "status status-idle";
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }
}

function updateCounter() {
  counterEl.textContent = `${captured.length} requests captured`;
  generateBtn.disabled = captured.length === 0;
  downloadRawBtn.disabled = captured.length === 0;
  if (downloadArchiveBtn) downloadArchiveBtn.disabled = captured.length === 0;
}

function renderRequests() {
  if (captured.length === 0) {
    requestsEl.innerHTML = '<div class="empty">No requests yet. Click "Start recording" and use the shop.</div>';
    return;
  }
  const visible = captured.filter((r) => filters[r.category]);
  if (visible.length === 0) {
    requestsEl.innerHTML = '<div class="empty">No requests match the current filter.</div>';
    return;
  }
  requestsEl.innerHTML = visible.map((r, i) => {
    const tagClass = `tag-${r.category}`;
    const tagLabel = r.category.toUpperCase();
    const methodDisplay = r.category === CATEGORY.WEBSOCKET ? "WS" : r.method;
    const method = `<span class="req-method">${methodDisplay}</span>`;
    let host = r.url;
    let pathname = "";
    try {
      const u = new URL(r.url);
      host = u.host;
      pathname = u.pathname;
    } catch {}
    // Indicateur visuel de la taille du corps de réponse (très utile pour repérer la "bonne" réponse)
    const respSize = r.responseBody ? r.responseBody.length : 0;
    const sizeLabel = respSize > 0
      ? `<span style="color:${respSize > 10000 ? '#10b981' : '#9ca3af'};font-size:10px;margin-left:4px;">${(respSize / 1024).toFixed(1)}KB</span>`
      : "";
    // For WebSocket, show frame count if we have frames
    const frameCount = r.wsFrames?.length ?? 0;
    const framesLabel = r.category === CATEGORY.WEBSOCKET && frameCount > 0
      ? `<span style="color:#f59e0b;font-size:10px;margin-left:4px;">${frameCount} frames</span>`
      : "";
    const statusLabel = r.responseStatus
      ? `<span style="color:${r.responseStatus >= 400 ? '#ef4444' : '#9ca3af'};font-size:10px;margin-left:4px;">[${r.responseStatus}]</span>`
      : "";
    const idx = captured.indexOf(r);
    return `<div class="request ${r.category}" data-idx="${idx}" title="${r.url}">
      ${method}
      <span class="req-url">${host}${pathname}</span>
      <span class="req-tag ${tagClass}">${tagLabel}</span>
      ${statusLabel}
      ${sizeLabel}
      ${framesLabel}
    </div>`;
  }).join("");

  // Attach click handlers for the details modal
  document.querySelectorAll(".request").forEach((el) => {
    el.addEventListener("click", () => {
      const idx = parseInt(el.dataset.idx, 10);
      showRequestDetails(captured[idx]);
    });
  });
}

function startRecording() {
  if (recording) return;
  captured = [];
  wsFramesByUrl = new Map();
  pendingGetContent = 0;
  chrome.devtools.network.onRequestFinished.addListener(onRequestFinished);
  try {
    chrome.devtools.network.onWebSocketFrameSent.addListener(onWsFrameSent);
    chrome.devtools.network.onWebSocketFrameReceived.addListener(onWsFrameReceived);
  } catch (e) {
    console.warn("[Shop Protocol] WebSocket frame listeners not available:", e);
  }
  try {
    chrome.devtools.network.getHAR((harLog) => {
      if (!harLog || !harLog.entries) return;
      console.log(`[Shop Protocol] HAR has ${harLog.entries.length} pre-existing entries`);
      for (const entry of harLog.entries) {
        const existing = captured.find((r) => r.url === entry.request.url && r.method === entry.request.method);
        if (existing) continue;
        onRequestFinished(entry);
      }
    });
  } catch (e) {
    console.warn("[Shop Protocol] getHAR not available:", e);
  }
  setStatus(true);
  updateCounter();
  renderRequests();
}

function stopRecording() {
  if (!recording) return;
  chrome.devtools.network.onRequestFinished.removeListener(onRequestFinished);
  try {
    chrome.devtools.network.onWebSocketFrameSent.removeListener(onWsFrameSent);
    chrome.devtools.network.onWebSocketFrameReceived.removeListener(onWsFrameReceived);
  } catch {}
  setStatus(false);
  window.__capturedRequests = captured;
  window.__wsFramesByUrl = wsFramesByUrl;
}

/** Map<wsUrl, frames[]> — accumule les frames WebSocket par URL de connexion. */
let wsFramesByUrl = new Map();

function onWsFrameSent(har) {
  const wsUrl = findWsUrlByRequestId(har.requestId);
  if (!wsUrl) return;
  const arr = wsFramesByUrl.get(wsUrl) ?? [];
  const data = har.data || "";
  // Ne PAS tronquer à la capture — on garde jusqu'à MAX_FRAME_SIZE chars par frame
  arr.push({
    direction: "→",
    data: data.length > MAX_FRAME_SIZE ? data.slice(0, MAX_FRAME_SIZE) + ` …[truncated at capture: ${data.length} chars]` : data,
    opcode: har.opcode,
    time: har.timestamp,
  });
  wsFramesByUrl.set(wsUrl, arr);
  refreshWsFramesInUi(wsUrl);
}

function onWsFrameReceived(har) {
  const wsUrl = findWsUrlByRequestId(har.requestId);
  if (!wsUrl) return;
  const arr = wsFramesByUrl.get(wsUrl) ?? [];
  const data = har.data || "";
  arr.push({
    direction: "←",
    data: data.length > MAX_FRAME_SIZE ? data.slice(0, MAX_FRAME_SIZE) + ` …[truncated at capture: ${data.length} chars]` : data,
    opcode: har.opcode,
    time: har.timestamp,
  });
  wsFramesByUrl.set(wsUrl, arr);
  refreshWsFramesInUi(wsUrl);
}

function findWsUrlByRequestId(requestId) {
  if (!requestId) return null;
  const wsReqs = captured.filter((r) => r.category === CATEGORY.WEBSOCKET);
  if (wsReqs.length === 1) return wsReqs[0].url;
  return wsReqs[wsReqs.length - 1]?.url ?? null;
}

function clearAll() {
  captured = [];
  wsFramesByUrl = new Map();
  pendingGetContent = 0;
  updateCounter();
  renderRequests();
  protocolOutput.value = "";
  downloadBtn.disabled = true;
  copyBtn.disabled = true;
  hideModal();
}

// ----- Request handler -----

function onRequestFinished(har) {
  const url = har.request.url;
  if (!url) return;
  const urlLower = url.toLowerCase();
  // Filtre les assets statiques
  if (/\.(js|css|png|jpg|jpeg|gif|svg|woff2?|ttf|ico|mp4|webm)(\?|$)/.test(urlLower)) return;
  // Analytics et tracking communs
  if (urlLower.includes("google-analytics.com")) return;
  if (urlLower.includes("doubleclick.net")) return;
  if (urlLower.includes("facebook.com/tr")) return;
  if (urlLower.includes("/tr?id=")) return;
  if (urlLower.includes("hotjar")) return;
  if (urlLower.includes("cloudflareinsights")) return;
  if (urlLower.includes("clarity.ms")) return;
  if (urlLower.includes("bing.com/bat")) return;
  if (urlLower.includes("connect.facebook.net")) return;
  // Telemetry Shopify (Monorail + Storefront API runtime metrics)
  if (urlLower.includes("monorail-edge.shopifysvc.com")) return;
  if (urlLower.includes("well-known/shopify/monorail")) return;
  if (urlLower.includes("otlp.http-production.shopifysvc.com")) return;
  if (urlLower.includes("otlp-http-production.shopifysvc.com")) return;
  // Shopify extensions CDN (CandyRack, etc. assets)
  if (urlLower.includes("cdn.shopify.com/extensions/")) return;
  // Apps Shopify courantes (CandyRack, Appmate wishlist, Richpanel support,
  // KiwiSizing, Poinzilla, Bikematrix, Returngo) — pas pertinentes pour le
  // protocole de recherche.
  if (urlLower.includes("candyrack")) return;
  if (urlLower.includes("appmate.io")) return;
  if (urlLower.includes("widgetconfig.richpanel.com")) return;
  if (urlLower.includes("app.kiwisizing.com")) return;
  if (urlLower.includes("api.poinzilla.com")) return;
  if (urlLower.includes("cdn.bikematrix.io")) return;
  if (urlLower.includes("returngo.co")) return;
  // Fonts et assets CDN externes (Google Fonts, Shopify CDN assets)
  if (urlLower.includes("fonts.googleapis.com")) return;
  if (urlLower.includes("fonts.gstatic.com")) return;
  // Bazaarvoice (reviews) — pas pertinent pour le scraper
  if (urlLower.includes("bazaarvoice.com")) return;
  // Yotpo (reviews) — pas pertinent
  if (urlLower.includes("yotpo.com")) return;
  // Trustpilot widget
  if (urlLower.includes("trustpilot.com")) return;
  // Shopify pay / shop-app
  if (urlLower.includes("shop-app-pay-hop")) return;
  if (urlLower.includes("shop.app/pay/")) return;
  // Shopify storefront assets (moderate.specr, etc.)
  if (urlLower.includes("/cdn/shopifycloud/storefront/assets/")) return;
  // data: URLs (embedded base64 images)
  if (urlLower.startsWith("data:")) return;
  // Bike24 telemetry (Akamai mPulse/Boomerang, GrowthBook, SAP Emarsys)
  if (urlLower.includes("go-mpulse.net")) return;
  if (urlLower.includes("cdn.growthbook.io")) return;
  if (urlLower.includes("emarsys.net")) return;
  if (urlLower.includes("up-static.bike24.com")) return;
  // Shopify /api/2026-04/graphql.json and /api/unstable/graphql.json
  // These are app queries (cart, consent, etc.) — but ONLY filter them out
  // if they're not search queries (the categorize() function handles that).
  // We don't filter them here to avoid hiding real search GraphQL queries.

  const headers = {};
  for (const h of har.request.headers || []) {
    headers[h.name] = h.value;
  }
  let body = "";
  if (har.request.postData) {
    body = har.request.postData.text || "";
  }

  const req = {
    url: url,
    method: har.request.method,
    headers: headers,
    body: body,
    startedAt: har.startedDateTime,
    time: har.time,
    category: null,
    responseBody: "",
    responseStatus: null,
    responseContentType: "",
  };

  // Detect WebSocket via 3 signals
  const resourceType = har._resourceType || (har._event && har._event._resourceType);
  if (
    url.startsWith("ws://") || url.startsWith("wss://")
    || resourceType === "websocket"
    || urlLower.includes("/websocket") && urlLower.includes("doofinder")
    || urlLower.includes("layer/") && urlLower.includes("doofinder.com")
  ) {
    req.category = CATEGORY.WEBSOCKET;
    if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
      req.url = url.replace(/^https?:/, "wss:").replace(/^http:/, "ws:");
    }
    if (wsFramesByUrl.has(req.url)) {
      req.wsFrames = wsFramesByUrl.get(req.url).slice(0, MAX_WS_FRAMES_CAPTURED);
    }
    req.responseBody = "";
    req.responseStatus = har.response?.status || 101;
    req.responseContentType = "websocket";
  } else {
    req.category = categorize(req);
  }

  captured.push(req);
  updateCounter();
  renderRequests();

  // On first capture, try to auto-derive the shop name from the inspected tab
  // (in case the panel was opened before the page was loaded).
  if (captured.length === 1 && typeof autoDeriveShopName === "function") {
    autoDeriveShopName();
  }

  // Get response body asynchronously — incrémente pendingGetContent pour
  // pouvoir attendre toutes les réponses avant de générer le protocol.md
  if (req.category !== CATEGORY.WEBSOCKET) {
    pendingGetContent++;
    try {
      har.getContent((content, mimeType) => {
        req.responseBody = content || "";
        req.responseStatus = har.response?.status;
        req.responseContentType = mimeType || har.response?.content?.mimeType || "";
        // For WebSocket requests, capture some frames if available
        if (req.category === CATEGORY.WEBSOCKET && har.webSocketMessages) {
          req.wsFrames = har.webSocketMessages.slice(0, MAX_WS_FRAMES_CAPTURED).map((m) => ({
            direction: m.type === "send" ? "→" : "←",
            data: m.data || "",
          }));
        }
        pendingGetContent--;
        renderRequests();
      });
    } catch (e) {
      console.warn("[Shop Protocol] getContent failed:", e);
      pendingGetContent--;
    }
  }
}

function refreshWsFramesInUi(wsUrl) {
  const req = captured.find((r) => r.url === wsUrl && r.category === CATEGORY.WEBSOCKET);
  if (!req) return;
  const frames = wsFramesByUrl.get(wsUrl) ?? [];
  req.wsFrames = frames.slice(0, MAX_WS_FRAMES_CAPTURED);
  renderRequests();
  updateCounter();
}

// ----- Filter checkboxes -----

for (const [cat, checkbox] of Object.entries(filterCheckboxes)) {
  checkbox.addEventListener("change", () => {
    filters[cat] = checkbox.checked;
    renderRequests();
  });
}

// ----- Wait for all getContent calls to finish -----
// Returns a Promise that resolves when pendingGetContent === 0.
// Polls every 100ms, with a 5s timeout.
function waitForAllBodies(timeoutMs = 5000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (pendingGetContent === 0) return resolve(true);
      if (Date.now() - start > timeoutMs) {
        console.warn(`[Shop Protocol] waitForAllBodies timeout (${pendingGetContent} still pending)`);
        return resolve(false);
      }
      setTimeout(check, 100);
    };
    check();
  });
}

// ----- Generate protocol.md -----

async function generateProtocol() {
  const shopName = shopNameInput.value || "UnknownShop";
  // Wait for all getContent callbacks to finish so the response bodies
  // are populated. This is the #1 fix for "extension only provides start
  // of answer" — many bodies were empty when the user clicked Generate.
  const ok = await waitForAllBodies();
  if (!ok) {
    console.warn("[Shop Protocol] Génération du protocol avec des corps de réponse encore en cours de récupération.");
  }
  try {
    const mod = await import(chrome.runtime.getURL("protocol-generator.js"));
    const md = mod.generateProtocol({ shopName, requests: captured });
    protocolOutput.value = md;
    downloadBtn.disabled = false;
    copyBtn.disabled = false;
  } catch (e) {
    protocolOutput.value = generateProtocolInline(shopName, captured);
    downloadBtn.disabled = false;
    copyBtn.disabled = false;
    console.warn("[Shop Protocol] Using inline fallback generator:", e);
  }
}

function generateProtocolInline(shopName, requests) {
  const name = shopName?.trim() || "UnknownShop";
  const date = new Date().toISOString().slice(0, 10);
  const searchReqs = requests.filter((r) => r.category === CATEGORY.SEARCH);
  const productReqs = requests.filter((r) => r.category === CATEGORY.PRODUCT);
  const wsReqs = requests.filter((r) => r.category === CATEGORY.WEBSOCKET);

  let md = `# Protocol — ${name}\n\n`;
  md += `> Généré le ${date} (${requests.length} requêtes capturées)\n\n`;
  md += `## Search endpoints (${searchReqs.length})\n\n`;
  for (const r of searchReqs.slice(0, 5)) {
    md += `### ${r.method} ${r.url}\n\n`;
    if (r.body) md += `\`\`\`\n${r.body.slice(0, 10000)}\n\`\`\`\n\n`;
    if (r.responseBody) md += `\`\`\`\n${r.responseBody.slice(0, 50000)}\n\`\`\`\n\n`;
  }
  md += `## Product endpoints (${productReqs.length})\n\n`;
  for (const r of productReqs.slice(0, 5)) {
    md += `### ${r.method} ${r.url}\n\n`;
    if (r.responseBody) md += `\`\`\`\n${r.responseBody.slice(0, 50000)}\n\`\`\`\n\n`;
  }
  if (wsReqs.length > 0) {
    md += `## WebSockets (${wsReqs.length})\n\n`;
    for (const r of wsReqs) {
      md += `### ${r.url}\n\n`;
      if (r.wsFrames) {
        for (const f of r.wsFrames.slice(0, 15)) {
          md += `**Frame [${f.direction}]** ${f.data.length} chars\n\n\`\`\`\n${f.data.slice(0, 10000)}\n\`\`\`\n\n`;
        }
      }
    }
  }
  return md;
}

function downloadProtocol() {
  const md = protocolOutput.value;
  if (!md) return;
  const blob = new Blob([md], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `protocol-${shopNameInput.value || "shop"}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ----- Download raw JSON -----
// Exporte TOUTES les requêtes capturées avec leur corps complets (sans troncation).
// Très utile pour analyser hors-ligne avec jq ou pour fournir le contexte brut
// à un LLM qui ne peut pas voir les 50KB de la réponse.
function downloadRawJson() {
  if (captured.length === 0) return;
  const exportData = {
    shopName: shopNameInput.value || "UnknownShop",
    capturedAt: new Date().toISOString(),
    totalRequests: captured.length,
    requests: captured.map((r) => ({
      method: r.method,
      url: r.url,
      category: r.category,
      headers: r.headers,
      body: r.body,
      responseStatus: r.responseStatus,
      responseContentType: r.responseContentType,
      responseBody: r.responseBody,  // FULL body, no truncation
      wsFrames: r.wsFrames,           // FULL frames, no truncation
    })),
  };
  const json = JSON.stringify(exportData, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `capture-${shopNameInput.value || "shop"}-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ----- Download archive (.zip) -----
// Builds a single self-contained .zip file containing:
//   protocol.md      — generated markdown (the main artifact for the AI)
//   capture.json      — raw JSON of all captured requests (full bodies, no truncation)
//   manifest.json     — metadata (shop name, capture date, request counts)
//   README.md         — explains the archive layout
//   requests/         — one folder per captured request with:
//     NNN-CAT-METHOD-host.response.<ext>   — response body (extension based on content-type)
//     NNN-CAT-METHOD-host.meta.json        — request metadata (method, URL, headers, body, status)
//     NNN-CAT-METHOD-host.ws-frames.json   — WebSocket frames (only for WS requests)
//
// Uses JSZip (loaded via <script src="vendor/jszip.min.js"> in panel.html).
// If JSZip is not available, falls back to downloading raw JSON.

async function downloadArchive() {
  if (captured.length === 0) return;

  // Wait for any pending getContent() calls so all bodies are populated
  await waitForAllBodies();

  if (typeof JSZip === "undefined") {
    console.warn("[Shop Protocol] JSZip not loaded — falling back to raw JSON download");
    downloadRawJson();
    alert("JSZip library not loaded. Falling back to raw JSON download. Reload the extension to enable .zip archive.");
    return;
  }

  const shopName = (shopNameInput.value || "shop").trim();
  const safeShopName = shopName.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
  const dateStr = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const zip = new JSZip();

  // === 1. Generate protocol.md (if not already generated, generate it now) ===
  let protocolMd = protocolOutput.value;
  if (!protocolMd) {
    try {
      const mod = await import(chrome.runtime.getURL("protocol-generator.js"));
      protocolMd = mod.generateProtocol({ shopName, requests: captured });
      protocolOutput.value = protocolMd;
      downloadBtn.disabled = false;
      copyBtn.disabled = false;
    } catch (e) {
      console.warn("[Shop Protocol] Failed to generate protocol.md:", e);
      protocolMd = generateProtocolInline(shopName, captured);
    }
  }
  zip.file("protocol.md", protocolMd);

  // === 2. capture.json — full raw capture, no truncation ===
  const captureData = {
    shopName,
    capturedAt: new Date().toISOString(),
    totalRequests: captured.length,
    extensionVersion: "0.11.0",
    requests: captured.map((r) => ({
      method: r.method,
      url: r.url,
      category: r.category,
      headers: r.headers,
      body: r.body,
      responseStatus: r.responseStatus,
      responseContentType: r.responseContentType,
      responseBody: r.responseBody,
      wsFrames: r.wsFrames,
    })),
  };
  zip.file("capture.json", JSON.stringify(captureData, null, 2));

  // === 3. manifest.json — archive metadata ===
  const categoryCounts = captured.reduce((acc, r) => {
    acc[r.category] = (acc[r.category] || 0) + 1;
    return acc;
  }, {});
  const totalResponseBodySize = captured.reduce((sum, r) => sum + (r.responseBody?.length || 0), 0);
  const manifest = {
    archiveVersion: "1.0",
    shopName,
    capturedAt: new Date().toISOString(),
    extensionVersion: "0.11.0",
    totalRequests: captured.length,
    categoryCounts,
    totalResponseBodyBytes: totalResponseBodySize,
    totalResponseBodyHumanReadable: formatBytes(totalResponseBodySize),
    files: {
      "protocol.md": "The main artifact — markdown describing all search/product/WebSocket endpoints with sample products and extraction tips. Hand this to your AI assistant.",
      "capture.json": "Raw JSON of every captured request with full response bodies (no truncation). Use with jq for offline analysis.",
      "manifest.json": "This file. Archive metadata.",
      "README.md": "Quick-start guide for the AI assistant receiving this archive.",
      "requests/": "One file per captured request: <NNN>-<CAT>-<METHOD>-<host>.{response.ext,meta.json,ws-frames.json}",
    },
  };
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));

  // === 4. README.md — quick-start for the AI ===
  const readme = generateArchiveReadme(shopName, captured, manifest);
  zip.file("README.md", readme);

  // === 5. requests/ folder — one file per request ===
  const usedFilenames = new Set();
  for (let i = 0; i < captured.length; i++) {
    const req = captured[i];
    const idx = String(i + 1).padStart(3, "0");
    const baseName = buildRequestFilename(idx, req);
    // Deduplicate filename if multiple requests map to the same name
    let uniqueBase = baseName;
    let dedupe = 2;
    while (usedFilenames.has(uniqueBase)) {
      uniqueBase = `${baseName}-${dedupe}`;
      dedupe++;
    }
    usedFilenames.add(uniqueBase);

    // Response body file (with appropriate extension)
    if (req.responseBody) {
      const ext = pickExtension(req.responseContentType, req.responseBody);
      zip.file(`requests/${uniqueBase}.response.${ext}`, req.responseBody);
    }

    // Request metadata file
    const isWs = req.category === CATEGORY.WEBSOCKET;
    const meta = {
      index: i + 1,
      category: req.category,
      method: req.method,
      url: req.url,
      requestHeaders: req.headers,
      requestBody: req.body,
      responseStatus: req.responseStatus,
      responseContentType: req.responseContentType,
      responseBodySize: req.responseBody?.length || 0,
      responseBodyFile: req.responseBody ? `${uniqueBase}.response.${pickExtension(req.responseContentType, req.responseBody)}` : null,
      wsFramesFile: isWs && req.wsFrames?.length > 0 ? `${uniqueBase}.ws-frames.json` : null,
      wsFrameCount: req.wsFrames?.length || 0,
      capturedAt: req.startedAt,
    };
    zip.file(`requests/${uniqueBase}.meta.json`, JSON.stringify(meta, null, 2));

    // For WS requests, also add the ws-frames.json file (in addition to meta.json)
    if (isWs && req.wsFrames?.length > 0) {
      const framesJson = JSON.stringify({
        url: req.url,
        method: req.method,
        responseStatus: req.responseStatus,
        frameCount: req.wsFrames.length,
        frames: req.wsFrames,
      }, null, 2);
      zip.file(`requests/${uniqueBase}.ws-frames.json`, framesJson);
    }
  }

  // === 6. Generate and download the zip ===
  try {
    const blob = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `shop-protocol-${safeShopName}-${dateStr}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    console.log(`[Shop Protocol] Archive downloaded: ${a.download} (${formatBytes(blob.size)})`);
  } catch (e) {
    console.error("[Shop Protocol] Failed to generate zip:", e);
    alert(`Failed to generate zip archive: ${e.message}. Falling back to raw JSON download.`);
    downloadRawJson();
  }
}

/** Sanitize a string for use as a filename component. */
function sanitizeFilename(s, maxLen = 50) {
  return String(s || "")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, maxLen) || "unknown";
}

/** Build a base filename for a request: NNN-CAT-METHOD-host-path. */
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
    // WS URLs that aren't parseable by URL()
    host = req.url.split("/")[2] || "unknown";
  }
  // Compose: 001-SEARCH-GET-www.all4cycling.com-fr-search-suggest
  const hostPart = sanitizeFilename(host, 40);
  const pathPart = sanitizeFilename(path, 40);
  return `${idx}-${cat}-${method}-${hostPart}${pathPart ? "-" + pathPart : ""}`;
}

/** Pick a file extension based on content-type and content sniffing. */
function pickExtension(contentType, body) {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("json")) return "json";
  if (ct.includes("html")) return "html";
  if (ct.includes("xml")) return "xml";
  if (ct.includes("css")) return "css";
  if (ct.includes("javascript")) return "js";
  if (ct.includes("text/plain")) return "txt";
  if (ct.includes("form-urlencoded")) return "txt";
  // Sniff: starts with { or [ → JSON
  const trimmed = (body || "").trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  if (trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html")) return "html";
  return "txt";
}

/** Format a byte count as a human-readable string. */
function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/** Generate the README.md content for the archive. */
function generateArchiveReadme(shopName, requests, manifest) {
  const date = new Date().toISOString().slice(0, 10);
  const totalSize = manifest.totalResponseBodyHumanReadable;
  const cats = manifest.categoryCounts;

  let md = `# Shop Protocol Archive — ${shopName}\n\n`;
  md += `> Captured on ${date} using the **Shop Protocol Recorder** Chrome extension (v${manifest.extensionVersion}).\n`;
  md += `> This archive is a self-contained bundle you can hand to an AI assistant to write a scraper plugin.\n\n`;

  md += `## What's inside\n\n`;
  md += `| File | Description |\n`;
  md += `|------|-------------|\n`;
  md += `| \`protocol.md\` | ⭐ The main artifact — markdown describing every search/product/WebSocket endpoint with sample products, useful fields, and extraction tips. **Start here.** |\n`;
  md += `| \`capture.json\` | Raw JSON of all ${requests.length} captured requests with FULL response bodies (no truncation). Use with \`jq\` for offline analysis. |\n`;
  md += `| \`manifest.json\` | Archive metadata (counts, sizes, file layout). |\n`;
  md += `| \`README.md\` | This file. |\n`;
  md += `| \`requests/\` | One subfolder per captured request — each with its response body (extension matches content-type) and metadata file. |\n\n`;

  md += `## Summary\n\n`;
  md += `- **Shop**: ${shopName}\n`;
  md += `- **Total requests**: ${requests.length}\n`;
  md += `- **Categories**: ${Object.entries(cats).map(([k, v]) => `${v} ${k}`).join(", ")}\n`;
  md += `- **Total response body size**: ${totalSize}\n\n`;

  md += `## How to use this archive\n\n`;
  md += `### Option A — Quick (recommended)\n`;
  md += `1. Open \`protocol.md\` and read it.\n`;
  md += `2. Hand \`protocol.md\` to your AI assistant and ask: "Write a scraper plugin for the \`outdoorprice\` project based on this protocol."\n`;
  md += `3. If the AI needs more detail on a specific endpoint, share the corresponding file from \`requests/\`.\n\n`;
  md += `### Option B — Offline analysis with jq\n`;
  md += `\`\`\`bash\n`;
  md += `# List all search endpoints with their response sizes\n`;
  md += `jq '.requests[] | select(.category == "search") | {url, responseStatus, size: (.responseBody | length)}' capture.json\n\n`;
  md += `# Find the largest response (likely the main search response)\n`;
  md += `jq '.requests | max_by(.responseBody | length) | {url, size: (.responseBody | length)}' capture.json\n\n`;
  md += `# Extract the first product from a JSON response\n`;
  md += `jq '.requests[] | select(.category == "search") | .responseBody | fromjson | .data.products.items[0]' capture.json 2>/dev/null | head -50\n`;
  md += `\`\`\`\n\n`;
  md += `### Option C — Per-request inspection\n`;
  md += `Each file in \`requests/\` follows this naming convention:\n`;
  md += `\`\`\`\n`;
  md += `NNN-CATEGORY-METHOD-host-path.response.EXT   ← response body (json/html/txt)\n`;
  md += `NNN-CATEGORY-METHOD-host-path.meta.json      ← request metadata (headers, body, status)\n`;
  md += `NNN-CATEGORY-METHOD-host-path.ws-frames.json  ← WebSocket frames (WS requests only)\n`;
  md += `\`\`\`\n`;
  md += `Open the \`.response.EXT\` file directly in your editor or browser to see the full un-truncated body.\n\n`;

  md += `## Next steps for the scraper\n\n`;
  md += `1. Read \`protocol.md\` to identify the search engine type (REST / GraphQL / HTML SSR / WebSocket Doofinder).\n`;
  md += `2. Create \`src/lib/scraper/sites/${shopName.toLowerCase().replace(/[^a-z0-9]/g, "")}.ts\` modeled on an existing scraper:\n`;
  md += `   - REST + JSON → see \`bergzeit.ts\`, \`sportbittl.ts\`\n`;
  md += `   - GraphQL → see \`snowleader.ts\`, \`ekosport.ts\`\n`;
  md += `   - HTML SSR (Shopify/Magento) → use \`cheerio\` to parse the response, look for JSON-LD \`<script type="application/ld+json">\` blocks first\n`;
  md += `   - WebSocket Doofinder → see \`barrabes.ts\`, \`probikeshop.ts\` (Playwright-based)\n`;
  md += `3. Add the shop to \`src/lib/scraper/types.ts\` (SiteId + SITES entry).\n`;
  md += `4. Register it in \`src/lib/scraper/registry.ts\` (SCRAPERS array).\n`;
  md += `5. Add it to a shop group in \`src/lib/scraper/groups.ts\`.\n`;
  md += `6. Test: \`make check-site SITE=${shopName.toLowerCase().replace(/[^a-z0-9]/g, "")} Q="test"\`\n\n`;
  return md;
}

async function copyProtocol() {
  const md = protocolOutput.value;
  if (!md) return;
  await navigator.clipboard.writeText(md);
  copyBtn.textContent = "Copied!";
  setTimeout(() => { copyBtn.textContent = "Copy to clipboard"; }, 1500);
}

// ----- Request details modal -----
// Affiche le contenu complet d'une requête capturée (sans troncation) dans
// une modale. Permet de naviguer dans la réponse quand elle est trop grosse
// pour le protocol.md.

function showRequestDetails(req) {
  const modal = document.getElementById("detailsModal");
  const title = document.getElementById("detailsTitle");
  const meta = document.getElementById("detailsMeta");
  const tabs = document.getElementById("detailsTabs");
  const content = document.getElementById("detailsContent");

  // Build title
  let host = req.url;
  try { host = new URL(req.url).host + new URL(req.url).pathname; } catch {}
  title.textContent = `${req.method || "WS"} ${host}`;

  // Build meta
  const metaParts = [];
  metaParts.push(`<span class="tag-${req.category}">${req.category.toUpperCase()}</span>`);
  if (req.responseStatus) metaParts.push(`Status: <strong>${req.responseStatus}</strong>`);
  if (req.responseContentType) metaParts.push(`Type: <code>${req.responseContentType}</code>`);
  if (req.responseBody) metaParts.push(`Response: <strong>${(req.responseBody.length / 1024).toFixed(1)} KB</strong>`);
  if (req.body) metaParts.push(`Request body: <strong>${(req.body.length / 1024).toFixed(1)} KB</strong>`);
  if (req.wsFrames?.length) metaParts.push(`WS frames: <strong>${req.wsFrames.length}</strong>`);
  meta.innerHTML = metaParts.join(" · ");

  // Build tabs
  const tabDefs = [];
  if (req.body) tabDefs.push({ id: "request", label: "Request body", content: () => formatBody(req.body, req.headers?.["content-type"] || req.headers?.["Content-Type"]) });
  if (req.responseBody) tabDefs.push({ id: "response", label: "Response body", content: () => formatBody(req.responseBody, req.responseContentType) });
  if (req.headers && Object.keys(req.headers).length > 0) {
    tabDefs.push({ id: "headers", label: "Headers", content: () => formatHeaders(req.headers) });
  }
  if (req.wsFrames?.length) {
    tabDefs.push({ id: "ws", label: `WS frames (${req.wsFrames.length})`, content: () => formatWsFrames(req.wsFrames) });
  }
  if (tabDefs.length === 0) {
    tabDefs.push({ id: "empty", label: "(no data)", content: () => "<p>No body, headers, or frames captured for this request.</p>" });
  }

  tabs.innerHTML = tabDefs.map((t, i) => `<button class="tab-btn ${i === 0 ? "active" : ""}" data-tab="${t.id}">${t.label}</button>`).join("");
  content.innerHTML = "";

  function showTab(tabId) {
    tabs.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    const btn = tabs.querySelector(`[data-tab="${tabId}"]`);
    if (btn) btn.classList.add("active");
    const tab = tabDefs.find((t) => t.id === tabId);
    content.innerHTML = tab ? tab.content() : "<p>No data</p>";
  }

  tabs.querySelectorAll(".tab-btn").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  showTab(tabDefs[0].id);

  modal.classList.add("open");
}

function hideModal() {
  const modal = document.getElementById("detailsModal");
  if (modal) modal.classList.remove("open");
}

function formatBody(body, contentType) {
  if (!body) return "<p>(empty)</p>";
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("json")) {
    try {
      const parsed = JSON.parse(body);
      const pretty = JSON.stringify(parsed, null, 2);
      return `<pre class="json-body">${escapeHtml(pretty)}</pre>`;
    } catch {
      return `<pre>${escapeHtml(body)}</pre>`;
    }
  }
  if (ct.includes("html")) {
    return `<pre>${escapeHtml(body)}</pre>`;
  }
  return `<pre>${escapeHtml(body)}</pre>`;
}

function formatHeaders(headers) {
  if (!headers) return "<p>(no headers)</p>";
  const lines = Object.entries(headers).map(([k, v]) => `<div><strong>${escapeHtml(k)}:</strong> <code>${escapeHtml(String(v))}</code></div>`);
  return `<div class="headers-list">${lines.join("")}</div>`;
}

function formatWsFrames(frames) {
  if (!frames || frames.length === 0) return "<p>(no frames captured)</p>";
  return frames.map((f, i) => {
    const size = (f.data || "").length;
    let display = f.data || "";
    // Try to parse and pretty-print
    try {
      const parsed = JSON.parse(f.data);
      display = JSON.stringify(parsed, null, 2);
    } catch {
      // Try Phoenix array [join_ref, msg_id, topic, event, payload]
      try {
        const arr = JSON.parse(f.data);
        if (Array.isArray(arr) && arr.length >= 5 && arr[4] && typeof arr[4] === "object") {
          display = `[${JSON.stringify(arr[0])}, ${JSON.stringify(arr[1])}, ${JSON.stringify(arr[2])}, ${JSON.stringify(arr[3])},\n  ${JSON.stringify(arr[4], null, 2)}\n]`;
        }
      } catch {}
    }
    return `<div class="ws-frame">
      <div class="ws-frame-header">Frame ${i + 1} [${f.direction}] ${size.toLocaleString()} chars</div>
      <pre>${escapeHtml(display.slice(0, 100000))}${display.length > 100000 ? `\n…[truncated at 100KB, total ${display.length} chars]` : ""}</pre>
    </div>`;
  }).join("");
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ----- Event listeners -----

startBtn.addEventListener("click", startRecording);
stopBtn.addEventListener("click", stopRecording);
clearBtn.addEventListener("click", clearAll);
generateBtn.addEventListener("click", generateProtocol);
downloadBtn.addEventListener("click", downloadProtocol);
copyBtn.addEventListener("click", copyProtocol);
if (downloadRawBtn) {
  downloadRawBtn.addEventListener("click", downloadRawJson);
}
if (downloadArchiveBtn) {
  downloadArchiveBtn.addEventListener("click", downloadArchive);
}

// Modal close handlers (added after DOM is ready)
document.addEventListener("DOMContentLoaded", () => {
  const modal = document.getElementById("detailsModal");
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) hideModal();
    });
  }
  const closeBtn = document.getElementById("detailsClose");
  if (closeBtn) closeBtn.addEventListener("click", hideModal);
});

// Init
setStatus(false);
updateCounter();
renderRequests();

// Auto-derive the shop name from the inspected tab URL when the user hasn't
// set it manually. Uses chrome.devtools.inspectedWindow.eval to read the
// inspected page's location.href, then extracts the second-level domain
// (e.g. "all4cycling" from "https://www.all4cycling.com/fr/search?q=...").
// Only runs once on panel load AND when the first request is captured
// (in case the page wasn't loaded yet at panel open).
function autoDeriveShopName() {
  // Don't override if user has typed something
  if (shopNameInput.value.trim()) return;
  try {
    chrome.devtools.inspectedWindow.eval("location.href", (result, isException) => {
      if (isException || !result) return;
      try {
        const u = new URL(result);
        // Extract second-level domain (e.g. "all4cycling" from "www.all4cycling.com")
        const parts = u.hostname.split(".");
        let sld = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
        // Special case : .co.uk, .com.au, .com.fr — take the part before the last 2
        if (parts.length >= 3 && (parts[parts.length - 2] === "co" || parts[parts.length - 2] === "com")) {
          sld = parts[parts.length - 3];
        }
        sld = sld.toLowerCase().replace(/[^a-z0-9-]/g, "");
        // Only set if still empty (user may have typed something in the meantime)
        if (sld && sld.length >= 3 && !shopNameInput.value.trim()) {
          shopNameInput.value = sld;
          shopNameInput.placeholder = sld;
          console.log(`[Shop Protocol] Auto-derived shop name: ${sld} (from ${u.hostname})`);
        }
      } catch (e) {
        // URL parse failed — ignore
      }
    });
  } catch (e) {
    // chrome.devtools.inspectedWindow not available — ignore
  }
}
autoDeriveShopName();

console.log("[Shop Protocol Recorder] panel loaded");
