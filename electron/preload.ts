// electron/preload.ts — Preload script for the Electron renderer
// --------------------------------------------------------------------------
// Runs in an isolated context with Node.js access, but exposes a safe API
// to the renderer (React UI) via contextBridge.
// --------------------------------------------------------------------------

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  isElectron: true,
  // Can add IPC methods here later (e.g., for protocol recorder integration)
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    ipcRenderer.on(channel, (_event, ...args) => callback(...args));
  },
  send: (channel: string, ...args: unknown[]) => {
    ipcRenderer.send(channel, ...args);
  },
});
