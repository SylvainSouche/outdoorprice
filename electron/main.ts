// electron/main.ts — Electron main process
// --------------------------------------------------------------------------
// Runs Next.js IN-PROCESS (no child process). The HTTP server lives inside
// the Electron main process — when Electron quits, everything stops.
//
// On quit: HTTP server closes + Playwright browsers are cleaned up.
// --------------------------------------------------------------------------

import { app, BrowserWindow, shell } from "electron";
import * as path from "path";
import * as http from "http";
import * as net from "net";

let mainWindow: BrowserWindow | null = null;
let httpServer: http.Server | null = null;
let nextApp: any = null;

// --- Find a free port ---
function findFreePort(startPort: number): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(startPort, () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on("error", () => resolve(findFreePort(startPort + 1)));
  });
}

// --- Start Next.js server IN-PROCESS ---
async function startNextServer(port: number): Promise<void> {
  const projectRoot = path.resolve(__dirname, "..");
  const isDev = !app.isPackaged;

  // Use Next.js programmatic API — runs in this process, no child process
  const next = require("next");
  nextApp = next({
    dev: isDev,
    dir: projectRoot,
    conf: {
      // Don't override next.config.ts — just set runtime env
    },
  });

  await nextApp.prepare();
  const handler = nextApp.getRequestHandler();

  httpServer = http.createServer((req, res) => {
    // Parse URL for static file serving
    const parsedUrl = new URL(req.url || "/", `http://localhost:${port}`);
    handler(req, res, parsedUrl);
  });

  return new Promise((resolve, reject) => {
    httpServer!.listen(port, "127.0.0.1", () => {
      console.log(`[electron] Next.js server listening on http://127.0.0.1:${port}`);
      resolve();
    });
    httpServer!.on("error", reject);
  });
}

// --- Create the main window ---
function createWindow(url: string) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "OutdoorPrice",
    backgroundColor: "#fafaf9",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
    show: false,
  });

  mainWindow.loadURL(url);
  mainWindow.once("ready-to-show", () => mainWindow?.show());

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => { mainWindow = null; });
}

// --- Cleanup everything ---
async function cleanup() {
  console.log("[electron] Cleaning up...");
  // 1. Close HTTP server (stops Next.js)
  if (httpServer) {
    await new Promise<void>((resolve) => {
      httpServer!.close(() => resolve());
    });
    httpServer = null;
  }
  // 2. Close Next.js app
  if (nextApp) {
    try { await nextApp.close(); } catch { /* ignore */ }
    nextApp = null;
  }
  // 3. Playwright browsers are cleaned up by browserPool.ts on process exit
  //    (browser.on('disconnected') sets _browser = null)
}

// --- App lifecycle ---
app.whenReady().then(async () => {
  const port = await findFreePort(3456);
  console.log(`[electron] Starting Next.js on port ${port}...`);

  // Set env vars for the scraper engine
  process.env.SCRAPE_PLAYWRIGHT_FALLBACK = "1";

  try {
    await startNextServer(port);
    const url = `http://localhost:${port}`;
    console.log(`[electron] Ready at ${url}`);
    createWindow(url);
  } catch (err) {
    console.error(`[electron] Failed to start: ${err}`);
    mainWindow = new BrowserWindow({ width: 600, height: 400 });
    mainWindow.loadURL(`data:text/html,<h1>Failed to start</h1><pre>${err}</pre>`);
  }
});

// macOS: re-create window when dock icon is clicked
app.on("activate", () => {
  if (mainWindow === null && httpServer) {
    createWindow(`http://localhost:3456`);
  }
});

// ALL platforms: quit when all windows are closed
app.on("window-all-closed", () => {
  app.quit();
});

// Cleanup on quit — stops HTTP server + Next.js + Playwright
app.on("before-quit", async (event) => {
  event.preventDefault();
  await cleanup();
  app.exit(0);
});
