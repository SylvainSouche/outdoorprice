// devtools.js — created the "Shop Protocol" panel inside Chrome DevTools.
// The panel itself is loaded from panel.html.
chrome.devtools.panels.create(
  "Shop Protocol",
  "icons/icon-16.png",
  "panel.html",
  function (panel) {
    console.log("[Shop Protocol Recorder] panel created", panel);
  }
);
