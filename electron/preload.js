"use strict";
// electron/preload.ts — Preload script for the Electron renderer
// --------------------------------------------------------------------------
// Runs in an isolated context with Node.js access, but exposes a safe API
// to the renderer (React UI) via contextBridge.
// --------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld("electronAPI", {
    platform: process.platform,
    isElectron: true,
    // Can add IPC methods here later (e.g., for protocol recorder integration)
    on: (channel, callback) => {
        electron_1.ipcRenderer.on(channel, (_event, ...args) => callback(...args));
    },
    send: (channel, ...args) => {
        electron_1.ipcRenderer.send(channel, ...args);
    },
});
