import { app, BrowserWindow, shell } from "electron";
import type { ChildProcess } from "child_process";
import { spawn } from "child_process";
import * as path from "path";
import * as net from "net";
import * as http from "http";

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;

const DEBUG = process.env.ELECTRON_DEBUG === "1" || process.argv.includes("--debug");
function dbg(msg: string) { if (DEBUG) console.log(`[debug] ${msg}`); }

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

function waitForServer(port: number, retries = 60): Promise<void> {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const hosts = ["127.0.0.1", "0.0.0.0", "::1"];
    let hostIdx = 0;
    const tryConnect = () => {
      const host = hosts[hostIdx % hosts.length];
      hostIdx++;
      dbg(`waitForServer: attempt ${attempts + 1}/${retries} → ${host}:${port}`);
      const socket = net.createConnection(port, host);
      socket.setTimeout(1000);
      socket.on("connect", () => {
        dbg(`waitForServer: connected via ${host}:${port}`);
        socket.destroy();
        resolve();
      });
      socket.on("error", (err) => {
        if (++attempts >= retries * hosts.length) reject(new Error(`Server not ready: ${err.message}`));
        else setTimeout(tryConnect, 500);
      });
      socket.on("timeout", () => {
        socket.destroy();
        if (++attempts >= retries * hosts.length) reject(new Error("Server not ready (timeout)"));
        else setTimeout(tryConnect, 500);
      });
    };
    tryConnect();
  });
}

// Fetch the HTML content directly via HTTP — bypasses Electron's redirect handling
function fetchPageContent(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
      // Follow redirects manually but stop on same-URL redirect
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
        const location = res.headers.location || "";
        dbg(`fetchPage: got ${res.statusCode} redirect to ${location} — ignoring (same URL bug)`);
        // Just get the body anyway — Next.js sends the body with the redirect
      }
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        dbg(`fetchPage: got ${body.length} bytes of HTML`);
        resolve(body);
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error("fetchPage timeout"));
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400, height: 900,
    minWidth: 1024, minHeight: 700,
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

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.on("closed", () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  const port = await findFreePort(3456);
  console.log(`[electron] Starting server on port ${port}...`);
  dbg(`Debug mode: ON`);
  dbg(`Electron: ${process.versions.electron}, Node: ${process.versions.node}, Platform: ${process.platform} ${process.arch}`);

  const projectRoot = path.resolve(__dirname, "..");
  dbg(`Project root: ${projectRoot}`);

  const cmd = "npx";
  const args = ["next", "dev", "-p", String(port), "-H", "0.0.0.0"];
  dbg(`Spawning: ${cmd} ${args.join(" ")}`);

  serverProcess = spawn(cmd, args, {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: "0.0.0.0",
      NODE_ENV: "development",
      SCRAPE_PLAYWRIGHT_FALLBACK: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });

  serverProcess.stdout?.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) console.log(`[next] ${msg}`);
  });
  serverProcess.stderr?.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) console.error(`[next] ${msg}`);
  });

  serverProcess.on("exit", (code) => {
    console.log(`[next] Server exited with code ${code}`);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  });

  try {
    await waitForServer(port);

    // APPROACH: Load the page via Electron's loadURL but with a custom
    // session that strips the redirect header before Chromium sees it.
    // This is the correct fix — intercept at the network layer, not the
    // navigation layer.

    // Set up a request interceptor that strips Location headers from
    // responses that would cause a same-URL redirect.
    const { session } = require("electron");
    const ses = session.defaultSession;

    ses.webRequest.onHeadersReceived((details: any, callback: (response: any) => void) => {
      const responseHeaders = details.responseHeaders || {};
      const url = details.url;
      const status = details.statusLine || "";

      // If this is a redirect response (3xx) with Location pointing to the same host,
      // strip the Location header to prevent the redirect
      if (status.includes("30") && responseHeaders["Location"]) {
        const location = Array.isArray(responseHeaders["Location"])
          ? responseHeaders["Location"][0]
          : responseHeaders["Location"];

        if (location && location.includes("localhost")) {
          dbg(`onHeadersReceived: stripping Location header from ${status} → ${location}`);
          // Change status to 200 and remove Location
          callback({
            responseHeaders: { ...responseHeaders, Location: undefined },
            statusLine: "HTTP/1.1 200 OK",
          });
          return;
        }
      }

      callback({ responseHeaders });
    });

    const url = `http://localhost:${port}`;
    console.log(`[electron] Ready at ${url}`);
    createWindow();

    dbg(`loadURL: ${url}`);
    mainWindow!.loadURL(url);

    mainWindow!.once("ready-to-show", () => {
      dbg("window ready to show");
      mainWindow?.show();
    });

    // Fallback: show after 5s
    setTimeout(() => {
      if (mainWindow && !mainWindow.isVisible()) {
        dbg("Fallback: showing window after 5s");
        mainWindow.show();
      }
    }, 5000);

  } catch (err) {
    console.error(`[electron] Failed to start: ${err}`);
    mainWindow = new BrowserWindow({ width: 600, height: 400 });
    mainWindow.loadURL(`data:text/html,<h1>Failed</h1><pre>${err}</pre>`);
  }
});

app.on("activate", () => {
  if (mainWindow === null && serverProcess) {
    createWindow();
    mainWindow?.loadURL("http://localhost:3456");
  }
});

app.on("window-all-closed", () => app.quit());

app.on("before-quit", () => {
  if (serverProcess) {
    console.log("[electron] Stopping server...");
    serverProcess.kill("SIGTERM");
    setTimeout(() => {
      if (serverProcess) {
        console.log("[electron] Force killing server...");
        serverProcess.kill("SIGKILL");
      }
    }, 3000);
  }
});
