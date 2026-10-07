// electron/main.ts — Electron main process for OutdoorPrice
// --------------------------------------------------------------------------
// ARCHITECTURE:
//   1. Start Next.js server (dev: `next dev`, prod: `next start`)
//   2. Wait for server to accept TCP connections
//   3. Open BrowserWindow pointing at the server
//   4. Strip same-URL redirect headers (Next.js 16 Turbopack bug workaround)
//
// PRODUCTION PACKAGING:
//   When packaged with electron-builder, the app is an asar archive containing:
//     - dist-electron-src/main.js  (this file, compiled)
//     - dist-electron-src/preload.js
//     - .next/                     (Next.js production build)
//     - node_modules/              (all dependencies)
//     - package.json
//
//   app.getAppPath() → path to the asar (e.g. /.../app.asar)
//   Node.js reads inside .asar transparently — no extraction needed.
//   process.execPath → the Electron binary itself.
//   ELECTRON_RUN_AS_NODE=1 → makes process.execPath behave as plain Node.js
//   (without this, spawning process.execPath opens a new Electron window → loop)
//
// CLEANUP:
//   On quit: SIGTERM → wait 3s → SIGKILL the server child process.
// --------------------------------------------------------------------------

import { app, BrowserWindow, shell, session } from "electron";
import type { ChildProcess } from "child_process";
import { spawn } from "child_process";
import * as path from "path";
import * as net from "net";
import * as fs from "fs";

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;

const DEBUG = process.env.ELECTRON_DEBUG === "1" || process.argv.includes("--debug");
function dbg(msg: string) { if (DEBUG) console.log(`[debug] ${msg}`); }

// ============================================================================
// Port management
// ============================================================================

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

// ============================================================================
// Wait for HTTP server to be ready
// ============================================================================

function waitForServer(port: number, maxAttempts = 30): Promise<void> {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    // Try both IPv4 and IPv6 — Next.js may bind to either depending on -H flag
    const tryConnect = () => {
      const socket = net.createConnection({ port, host: "127.0.0.1" });
      socket.setTimeout(1000);
      socket.on("connect", () => {
        dbg(`Server is ready (connected via 127.0.0.1:${port})`);
        socket.destroy();
        resolve();
      });
      socket.on("error", () => {
        if (++attempts >= maxAttempts) {
          reject(new Error(`Server not ready after ${maxAttempts} attempts`));
        } else {
          setTimeout(tryConnect, 1000);
        }
      });
      socket.on("timeout", () => {
        socket.destroy();
        if (++attempts >= maxAttempts) {
          reject(new Error(`Server not ready after ${maxAttempts} attempts (timeout)`));
        } else {
          setTimeout(tryConnect, 1000);
        }
      });
    };
    tryConnect();
  });
}

// ============================================================================
// Start Next.js server
// ============================================================================

async function startServer(port: number): Promise<void> {
  const isDev = !app.isPackaged;

  if (isDev) {
    // ── DEV MODE ──────────────────────────────────────────────────────────
    // Spawn `next dev` from the project root.
    // The user has the full source tree with node_modules installed.
    const projectRoot = path.resolve(__dirname, "..");
    dbg(`Dev mode — spawning: npx next dev -p ${port} -H 0.0.0.0`);
    dbg(`  cwd: ${projectRoot}`);

    serverProcess = spawn("npx", ["next", "dev", "-p", String(port), "-H", "0.0.0.0"], {
      cwd: projectRoot,
      env: {
        ...process.env,
        PORT: String(port),
        HOSTNAME: "0.0.0.0",
        NODE_ENV: "development",
        SCRAPE_PLAYWRIGHT_FALLBACK: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });
  } else {
    // ── PRODUCTION MODE ───────────────────────────────────────────────────
    // Uses Next.js standalone output (output: "standalone" in next.config.ts).
    // The standalone server.js is a self-contained Node.js script that calls
    // require('next') internally — no `next` CLI needed.
    //
    // Packaged layout (via electron-builder extraResources):
    //   Resources/
    //     standalone/
    //       server.js          ← this is what we spawn
    //       node_modules/next/ ← resolved by require('next') inside server.js
    //       .next/static/      ← copied from .next/static
    //       public/            ← copied from public/
    //     app.asar             ← contains only main.js / preload.js / package.json
    //
    // ELECTRON_RUN_AS_NODE=1:
    //   Without this, spawning process.execPath opens a NEW Electron window
    //   (recursive loop). With it, the binary runs as plain Node.js.
    //
    const standaloneDir = path.join(process.resourcesPath, "standalone");
    const serverJs = path.join(standaloneDir, "server.js");
    const modulesDir = path.join(standaloneDir, "modules");

    // ── PRE-FLIGHT CHECK ─────────────────────────────────────────────────
    // Verify every file the standalone server needs is actually present in
    // the packaged .app. If any are missing, fail fast with a clear error
    // (otherwise Node throws a cryptic `spawn ENOENT` on the binary path).
    const required: Array<[string, string]> = [
      ["standalone dir", standaloneDir],
      ["server.js", serverJs],
      ["modules/next/package.json", path.join(modulesDir, "next", "package.json")],
      ["modules/next/dist/server/lib/start-server.js", path.join(modulesDir, "next", "dist", "server", "lib", "start-server.js")],
      [".next/BUILD_ID", path.join(standaloneDir, ".next", "BUILD_ID")],
      [".next/required-server-files.json", path.join(standaloneDir, ".next", "required-server-files.json")],
      [".next/static", path.join(standaloneDir, ".next", "static")],
      ["public", path.join(standaloneDir, "public")],
    ];
    const missing = required.filter(([, p]) => !fs.existsSync(p));
    if (missing.length > 0) {
      console.error("[electron] FATAL: standalone server files missing in packaged app:");
      for (const [name, p] of missing) {
        console.error(`[electron]   - ${name}: ${p}`);
      }
      console.error("[electron] This usually means prepare-electron-standalone.js didn't run,");
      console.error("[electron] or electron-builder's extraResources config didn't pick it up.");
      console.error("[electron] Try: rm -rf dist-electron electron-resources && bun run electron:build");
      throw new Error(`Missing ${missing.length} standalone files (see log above)`);
    }
    dbg(`Pre-flight OK: all ${required.length} standalone files present`);

    // ── macOS DOCK ICON FIX (LSUIElement approach) ───────────────────────
    // The app's Info.plist has LSUIElement=true (set via electron-builder's
    // extendInfo in package.json). This tells macOS to treat the app as a
    // background agent by default — no dock icon for ANY process launched
    // from this binary.
    //
    // The main process calls app.setActivationPolicy("regular") at startup
    // (in app.whenReady) to show ITS dock icon. The child process (spawned
    // below with ELECTRON_RUN_AS_NODE=1) never calls setActivationPolicy,
    // so it stays hidden — no more "Exec" icon.
    //
    // No need for setActivationPolicy("accessory") here — LSUIElement already
    // makes the default state "hidden". We just need the main process to
    // opt IN to showing a dock icon, which it does at startup.

    dbg(`Production mode — spawning: node ${serverJs}`);
    dbg(`  cwd: ${standaloneDir}`);
    dbg(`  resourcesPath: ${process.resourcesPath}`);
    dbg(`  NODE_PATH: ${modulesDir}`);
    dbg(`  ELECTRON_RUN_AS_NODE: 1`);

    serverProcess = spawn(process.execPath, [
      serverJs,
    ], {
      cwd: standaloneDir,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        NODE_PATH: modulesDir,
        PORT: String(port),
        HOSTNAME: "0.0.0.0",
        NODE_ENV: "production",
        SCRAPE_PLAYWRIGHT_FALLBACK: "1",
      },
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  // Log server output
  if (serverProcess.pid) {
    dbg(`Server child process spawned, pid=${serverProcess.pid}`);
  }

  serverProcess.stdout?.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) console.log(`[server] ${msg}`);
  });
  serverProcess.stderr?.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) console.error(`[server] ${msg}`);
  });

  serverProcess.on("error", (err: Error) => {
    console.error(`[server] spawn ERROR: ${err.message}`);
    console.error(`[server]   code: ${(err as NodeJS.ErrnoException).code}`);
    console.error(`[server]   syscall: ${(err as NodeJS.ErrnoException).syscall}`);
    console.error(`[server]   path: ${(err as NodeJS.ErrnoException).path}`);
    console.error(`[server]   errno: ${(err as NodeJS.ErrnoException).errno}`);
  });

  serverProcess.on("exit", (code, signal) => {
    console.log(`[server] Process exited with code=${code} signal=${signal}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }
  });
}

// ============================================================================
// Window management
// ============================================================================

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

  if (DEBUG) {
    mainWindow.webContents.openDevTools();
  }

  // Open external links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("did-start-loading", () => dbg("webContents: did-start-loading"));
  mainWindow.webContents.on("did-finish-load", () => dbg("webContents: did-finish-load"));
  mainWindow.webContents.on("did-fail-load", (_e: any, code: number, desc: string, url: string) => {
    dbg(`webContents: did-fail-load code=${code} desc=${desc} url=${url}`);
  });
  mainWindow.webContents.on("console-message", (_e: any, level: number, message: string, line: number, sourceId: string) => {
    dbg(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });

  mainWindow.loadURL(url);

  mainWindow.once("ready-to-show", () => {
    dbg("Window ready to show");
    mainWindow?.show();
  });

  // Fallback: show window after 5s even if ready-to-show didn't fire
  // (can happen if the redirect header strip confuses the load state)
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      dbg("Fallback: showing window after 5s timeout");
      mainWindow.show();
    }
  }, 5000);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ============================================================================
// App lifecycle
// ============================================================================

app.whenReady().then(async () => {
  // LSUIElement=true in Info.plist makes macOS treat this app as a background
  // agent by default (no dock icon). We call setActivationPolicy("regular")
  // to show OUR dock icon. The child process (spawned with ELECTRON_RUN_AS_NODE)
  // never calls this, so it stays hidden — no more "Exec" icon.
  if (process.platform === "darwin") {
    app.setActivationPolicy("regular");
    dbg("macOS: activation policy → 'regular' (main app dock icon visible)");
  }

  const port = await findFreePort(3456);
  console.log(`[electron] Starting server on port ${port}...`);
  dbg(`Debug: ${DEBUG}, Packaged: ${app.isPackaged}`);
  dbg(`Electron: ${process.versions.electron}, Node: ${process.versions.node}`);
  dbg(`Platform: ${process.platform} ${process.arch}`);
  dbg(`process.execPath: ${process.execPath}`);
  dbg(`process.resourcesPath: ${process.resourcesPath}`);
  dbg(`app.getAppPath(): ${app.getAppPath()}`);
  dbg(`__dirname: ${__dirname}`);
  dbg(`cwd: ${process.cwd()}`);
  dbg(`argv: ${JSON.stringify(process.argv)}`);
  dbg(`env.ELECTRON_RUN_AS_NODE: ${process.env.ELECTRON_RUN_AS_NODE ?? "(unset)"}`);
  dbg(`env.NODE_PATH: ${process.env.NODE_PATH ?? "(unset)"}`);

  try {
    // 1. Start the Next.js server
    await startServer(port);

    // 2. Wait for it to accept connections
    await waitForServer(port);
    console.log(`[electron] Server ready on port ${port}`);

    // 3. Strip same-URL redirect headers (Next.js 16 Turbopack dev-mode bug)
    //    In dev mode, Next.js issues a redirect from localhost to localhost
    //    (same URL → infinite loop in Chromium). We intercept the response
    //    headers and strip the Location header, changing status to 200.
    //    This is NOT needed in production mode (next start doesn't redirect).
    if (!app.isPackaged) {
      const ses = session.defaultSession;
      ses.webRequest.onHeadersReceived((details: any, callback: (response: any) => void) => {
        const responseHeaders = details.responseHeaders || {};
        const status = details.statusLine || "";
        if (status.includes("30") && responseHeaders["Location"]) {
          const location = Array.isArray(responseHeaders["Location"])
            ? responseHeaders["Location"][0]
            : responseHeaders["Location"];
          if (location && (location.includes("localhost") || location.includes("127.0.0.1"))) {
            dbg(`Stripping redirect: ${status} → ${location}`);
            callback({
              responseHeaders: { ...responseHeaders, Location: undefined },
              statusLine: "HTTP/1.1 200 OK",
            });
            return;
          }
        }
        callback({ responseHeaders });
      });
    }

    // 4. Open the window
    const url = `http://localhost:${port}`;
    dbg(`Loading ${url}`);
    createWindow(url);

  } catch (err) {
    console.error(`[electron] Failed to start: ${err}`);
    mainWindow = new BrowserWindow({ width: 600, height: 400 });
    mainWindow.loadURL(
      `data:text/html,<html><body style="font-family:monospace;padding:20px">` +
      `<h2>Failed to start</h2><pre>${err}</pre>` +
      `<p>Try running with ELECTRON_DEBUG=1 for verbose output.</p>` +
      `</body></html>`
    );
  }
});

// macOS: re-create window when dock icon is clicked
app.on("activate", () => {
  if (mainWindow === null && serverProcess) {
    createWindow("http://localhost:3456");
  }
});

// All platforms: quit when all windows are closed
app.on("window-all-closed", () => {
  app.quit();
});

// Cleanup: kill the server child process on quit
app.on("before-quit", () => {
  if (serverProcess) {
    console.log("[electron] Stopping server...");
    serverProcess.kill("SIGTERM");
    // Force kill after 3s if graceful shutdown fails
    setTimeout(() => {
      if (serverProcess) {
        console.log("[electron] Force killing server...");
        serverProcess.kill("SIGKILL");
      }
    }, 3000);
  }
});
