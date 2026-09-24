// =============================================================================
// BrowserPool — shared Chromium browser instance with reusable contexts.
// -----------------------------------------------------------------------------
// Instead of launching a new browser per scraper call (≈1s + 80MB each),
// we keep a single browser instance and create lightweight contexts per call.
// Contexts are isolated (cookies, cache, sessions) but share the browser
// process — much faster and lower memory.
//
// Usage:
//   import { acquireContext, releaseContext } from "./browserPool";
//   const { context, browser } = await acquireContext();
//   try {
//     const page = await context.newPage();
//     await page.goto("https://example.com");
//     // ...
//   } finally {
//     await releaseContext(context, browser);
//   }
//
// The browser is lazily launched on first use and kept alive for the
// process lifetime. If it crashes, the next acquireContext() re-launches.
// =============================================================================

import type { Browser, BrowserContext } from "playwright";

let _browser: Browser | null = null;
let _launchPromise: Promise<Browser> | null = null;
let _availability: "unknown" | "ok" | "missing" = "unknown";

/** Common launch options shared by all browser instances. */
const LAUNCH_OPTS = {
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-blink-features=AutomationControlled",
    "--disable-features=IsolateOrigins,site-per-process",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-popup-blocking",
    "--window-size=1920,1080",
  ],
};

/** Common context options. */
function contextOpts(referer?: string): Record<string, unknown> {
  return {
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    viewport: { width: 1920, height: 1080 },
    extraHTTPHeaders: {
      "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      ...(referer ? { Referer: referer } : {}),
    },
  };
}

/** Anti-detection init script (applied to every context). */
const ANTI_DETECT_SCRIPT = () => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  Object.defineProperty(navigator, "languages", { get: () => ["fr-FR", "fr", "en"] });
  Object.defineProperty(navigator, "plugins", {
    get: () => [
      { name: "PDF Viewer", filename: "internal-pdf-viewer" },
      { name: "Chrome PDF Viewer", filename: "internal-pdf-viewer" },
      { name: "Chromium PDF Viewer", filename: "internal-pdf-viewer" },
    ],
  });
  Object.defineProperty(navigator, "vendor", { get: () => "Google Inc." });
  const getParameter = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function (this: WebGLRenderingContext, p: number) {
    if (p === 37445) return "Intel Inc.";
    if (p === 37446) return "Intel Iris OpenGL Engine";
    return getParameter.call(this, p);
  } as any;
};

/** Get or launch the shared browser. */
async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.isConnected()) return _browser;
  if (_launchPromise) return _launchPromise;

  _launchPromise = (async () => {
    const pw = await import("playwright" as any).catch(() => null);
    if (!pw) {
      _availability = "missing";
      throw new Error("Playwright non installé");
    }
    _availability = "ok";

    const opts: any = { ...LAUNCH_OPTS };
    const proxyUrl = process.env.PROXY_URL?.trim();
    if (proxyUrl) {
      try {
        const u = new URL(proxyUrl);
        opts.proxy = {
          server: `${u.protocol}//${u.hostname}:${u.port}`,
          username: u.username || undefined,
          password: u.password || undefined,
        };
      } catch {
        /* ignore */
      }
    }

    // When running inside Electron, use the system Chrome (real TLS fingerprint)
    // to bypass Akamai/Cloudflare TLS fingerprinting.
    // Set PLAYWRIGHT_CHANNEL=chrome in .env or the Electron main process.
    const channel = process.env.PLAYWRIGHT_CHANNEL?.trim();
    if (channel) {
      opts.channel = channel;
      // Use Chrome's new headless mode (passes anti-bot checks, no visible window)
      // --headless=new is Chrome 112+ and is much harder to detect than --headless
      opts.headless = true;
      opts.args = [
        ...(opts.args || []),
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
      ];
    }

    const browser = await pw.chromium.launch(opts);
    _browser = browser;

    // Auto-cleanup on process exit
    browser.on("disconnected", () => {
      _browser = null;
      _launchPromise = null;
    });

    _launchPromise = null;
    return browser;
  })();

  return _launchPromise;
}

/** Acquire a fresh browser context from the shared browser.
 *  Returns { context, browser } — call releaseContext() when done. */
export async function acquireContext(referer?: string): Promise<{
  context: BrowserContext;
  browser: Browser;
}> {
  const browser = await getBrowser();
  const context = await browser.newContext(contextOpts(referer) as any);
  await context.addInitScript(ANTI_DETECT_SCRIPT);
  return { context, browser };
}

/** Release a context (closes it but keeps the browser alive). */
export async function releaseContext(context: BrowserContext): Promise<void> {
  try {
    await context.close();
  } catch {
    /* ignore */
  }
}

/** Check if Playwright is available. */
export async function isPlaywrightAvailable(): Promise<boolean> {
  if (_availability === "ok") return true;
  if (_availability === "missing") return false;
  try {
    await getBrowser();
    return true;
  } catch {
    return false;
  }
}

/** Close the shared browser (for graceful shutdown). */
export async function closeBrowser(): Promise<void> {
  if (_browser) {
    try {
      await _browser.close();
    } catch {
      /* ignore */
    }
    _browser = null;
    _launchPromise = null;
  }
}

/** Get the common launch options (for scrapers that still launch their own browser). */
export function getLaunchOpts(): Record<string, unknown> {
  return { ...LAUNCH_OPTS };
}

/** Get the common context options. */
export function getContextOpts(referer?: string): Record<string, unknown> {
  return contextOpts(referer);
}

/** Get the anti-detect init script. */
export function getAntiDetectScript(): () => void {
  return ANTI_DETECT_SCRIPT;
}
