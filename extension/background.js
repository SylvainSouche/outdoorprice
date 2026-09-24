// background.js — service worker for Shop Protocol Recorder.
// Currently minimal : just initializes on install. The actual recording
// happens in the DevTools panel via chrome.devtools.network API.
chrome.runtime.onInstalled.addListener((details) => {
  console.log("[Shop Protocol Recorder] installed", details);
});
