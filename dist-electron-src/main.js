"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const child_process_1 = require("child_process");
const path = require("path");
const net = require("net");
let mainWindow = null;
let serverProcess = null;
const DEBUG = process.env.ELECTRON_DEBUG === "1" || process.argv.includes("--debug");
function dbg(msg) { if (DEBUG)
    console.log(`[debug] ${msg}`); }
function findFreePort(startPort) {
    return new Promise((resolve) => {
        const srv = net.createServer();
        srv.listen(startPort, () => {
            const port = srv.address().port;
            srv.close(() => resolve(port));
        });
        srv.on("error", () => resolve(findFreePort(startPort + 1)));
    });
}
function waitForServer(port, retries = 60) {
    return new Promise((resolve, reject) => {
        let attempts = 0;
        const hosts = ["127.0.0.1", "0.0.0.0", "::1"];
        let hostIdx = 0;
        const tryConnect = () => {
            const host = hosts[hostIdx % hosts.length];
            hostIdx++;
            dbg(`waitForServer: attempt ${attempts + 1}/${retries * hosts.length} → ${host}:${port}`);
            const socket = net.createConnection(port, host);
            socket.setTimeout(1000);
            socket.on("connect", () => {
                dbg(`waitForServer: connected via ${host}:${port}`);
                socket.destroy();
                resolve();
            });
            socket.on("error", () => {
                if (++attempts >= retries * hosts.length)
                    reject(new Error("Server not ready"));
                else
                    setTimeout(tryConnect, 500);
            });
            socket.on("timeout", () => {
                socket.destroy();
                if (++attempts >= retries * hosts.length)
                    reject(new Error("Server not ready (timeout)"));
                else
                    setTimeout(tryConnect, 500);
            });
        };
        tryConnect();
    });
}
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
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
    if (DEBUG)
        mainWindow.webContents.openDevTools();
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        electron_1.shell.openExternal(url);
        return { action: "deny" };
    });
    mainWindow.on("closed", () => { mainWindow = null; });
}
async function startServer(port) {
    const isDev = !electron_1.app.isPackaged;
    if (isDev) {
        // DEV MODE: spawn `next dev` as child process
        const projectRoot = path.resolve(__dirname, "..");
        dbg(`Dev mode — spawning next dev from ${projectRoot}`);
        serverProcess = (0, child_process_1.spawn)("npx", ["next", "dev", "-p", String(port), "-H", "0.0.0.0"], {
            cwd: projectRoot,
            env: {
                ...process.env,
                PORT: String(port),
                HOSTNAME: "0.0.0.0",
                NODE_ENV: "development",
                SCRAPE_PLAYWRIGHT_FALLBACK: "1",
            },
            stdio: ["ignore", "pipe", "pipe"],
            shell: true, // needed for npx to resolve on all platforms
        });
    }
    else {
        // PRODUCTION MODE: spawn the standalone Next.js server
        // CRITICAL: set ELECTRON_RUN_AS_NODE=1 so the Electron binary runs as plain Node.js
        // Without this, spawning process.execPath launches another Electron window (recursive loop!)
        const serverPath = path.join(process.resourcesPath, "app", ".next", "standalone", "server.js");
        dbg(`Production mode — spawning standalone server from ${serverPath}`);
        serverProcess = (0, child_process_1.spawn)(process.execPath, [serverPath], {
            env: {
                ...process.env,
                ELECTRON_RUN_AS_NODE: "1", // Run Electron binary as Node.js, not as GUI app
                PORT: String(port),
                HOSTNAME: "0.0.0.0",
                NODE_ENV: "production",
                SCRAPE_PLAYWRIGHT_FALLBACK: "1",
            },
            stdio: ["ignore", "pipe", "pipe"],
        });
    }
    serverProcess.stdout?.on("data", (data) => {
        const msg = data.toString().trim();
        if (msg)
            console.log(`[server] ${msg}`);
    });
    serverProcess.stderr?.on("data", (data) => {
        const msg = data.toString().trim();
        if (msg)
            console.error(`[server] ${msg}`);
    });
    serverProcess.on("exit", (code) => {
        console.log(`[server] Process exited with code ${code}`);
        if (mainWindow && !mainWindow.isDestroyed())
            mainWindow.close();
    });
}
electron_1.app.whenReady().then(async () => {
    const port = await findFreePort(3456);
    console.log(`[electron] Starting server on port ${port}...`);
    dbg(`Debug: ${DEBUG}, Packaged: ${electron_1.app.isPackaged}`);
    dbg(`Electron: ${process.versions.electron}, Node: ${process.versions.node}`);
    try {
        await startServer(port);
        await waitForServer(port);
        console.log(`[electron] Server ready on port ${port}`);
        // Strip same-URL redirect headers (Next.js 16 Turbopack bug)
        const ses = electron_1.session.defaultSession;
        ses.webRequest.onHeadersReceived((details, callback) => {
            const responseHeaders = details.responseHeaders || {};
            const status = details.statusLine || "";
            if (status.includes("30") && responseHeaders["Location"]) {
                const location = Array.isArray(responseHeaders["Location"])
                    ? responseHeaders["Location"][0]
                    : responseHeaders["Location"];
                if (location && (location.includes("localhost") || location.includes("127.0.0.1"))) {
                    dbg(`onHeadersReceived: stripping redirect to ${location}`);
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
        dbg(`Loading ${url}`);
        createWindow();
        mainWindow.loadURL(url);
        mainWindow.once("ready-to-show", () => {
            dbg("window ready to show");
            mainWindow?.show();
        });
        // Fallback show
        setTimeout(() => {
            if (mainWindow && !mainWindow.isVisible()) {
                dbg("Fallback: showing window");
                mainWindow.show();
            }
        }, 5000);
    }
    catch (err) {
        console.error(`[electron] Failed: ${err}`);
        mainWindow = new electron_1.BrowserWindow({ width: 600, height: 400 });
        mainWindow.loadURL(`data:text/html,<h1>Failed</h1><pre>${err}</pre>`);
    }
});
electron_1.app.on("activate", () => {
    if (mainWindow === null && serverProcess) {
        createWindow();
        mainWindow?.loadURL("http://localhost:3456");
    }
});
electron_1.app.on("window-all-closed", () => electron_1.app.quit());
electron_1.app.on("before-quit", () => {
    if (serverProcess) {
        console.log("[electron] Stopping server...");
        serverProcess.kill("SIGTERM");
        setTimeout(() => { if (serverProcess)
            serverProcess.kill("SIGKILL"); }, 3000);
    }
});
