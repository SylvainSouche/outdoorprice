#!/usr/bin/env node
//
// prepare-electron-standalone.js
//
// Copies Next.js standalone output into a clean directory that
// electron-builder will package via `extraResources`.
//
// WHY THIS SCRIPT EXISTS
// ----------------------
// electron-builder silently strips directories named `node_modules/` from
// `extraResources`, even when the glob filter is `["**","*"]`. This breaks
// Next.js's standalone server, which does `require('next')` and needs
// its bundled `node_modules/` to be present at runtime.
//
// The workaround: rename `node_modules/` to `modules/` when copying.
// Then in electron/main.ts we set `NODE_PATH=<resources>/standalone/modules`
// so Node's module resolution finds `next`, `react`, etc. inside `modules/`.
//
// OUTPUT LAYOUT
// -------------
// electron-resources/standalone/
//   server.js          (from .next/standalone/server.js)
//   package.json       (from .next/standalone/package.json)
//   modules/           (from .next/standalone/node_modules/  -- RENAMED)
//   .next/             (from .next/standalone/.next/  -- manifests, server pages)
//     static/          (merged from .next/static/  -- browser JS/CSS chunks)
//   public/            (from public/)
//
// USAGE
// -----
//   node scripts/prepare-electron-standalone.js
//   (called automatically by `bun run electron:build`)
//

const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const standaloneSrc = path.join(projectRoot, ".next", "standalone");
const staticSrc = path.join(projectRoot, ".next", "static");
const publicSrc = path.join(projectRoot, "public");
const dest = path.join(projectRoot, "electron-resources", "standalone");

// Directories in .next/standalone/ that Next.js's file tracing mistakenly
// picked up but aren't needed at runtime. Skipping them keeps the bundle
// small and avoids shipping stale dev artifacts.
const SKIP_ENTRIES = new Set([
  "download",
  "extension",
  "skills",
  "upload",
  "tsconfig.json",
  "components.json",
  "VERSION",
  ".env",
]);

function log(msg) {
  console.log(`[prepare-standalone] ${msg}`);
}

function die(msg) {
  console.error(`[prepare-standalone] ERROR: ${msg}`);
  process.exit(1);
}

// Sanity checks
if (!fs.existsSync(standaloneSrc)) {
  die(`Standalone source not found at ${standaloneSrc}. Run "next build" first.`);
}
if (!fs.existsSync(path.join(standaloneSrc, "server.js"))) {
  die(`server.js not found in ${standaloneSrc}. The build may be incomplete.`);
}
if (!fs.existsSync(path.join(standaloneSrc, "node_modules"))) {
  die(`node_modules/ not found in ${standaloneSrc}. Standalone tracing failed.`);
}
if (!fs.existsSync(path.join(standaloneSrc, ".next"))) {
  die(`.next/ not found in ${standaloneSrc}. Standalone tracing failed.`);
}
if (!fs.existsSync(staticSrc)) {
  die(`.next/static not found at ${staticSrc}.`);
}
if (!fs.existsSync(publicSrc)) {
  die(`public/ not found at ${publicSrc}.`);
}

// Wipe & recreate destination
log(`Cleaning ${dest}`);
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });

// Cross-platform recursive copy that resolves symlinks to real files
// (electron-builder can't follow symlinks reliably across platforms).
function copyDir(src, dst, skipSet) {
  fs.mkdirSync(dst, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (skipSet && skipSet.has(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isSymbolicLink()) {
      const real = fs.realpathSync(s);
      const stat = fs.statSync(real);
      if (stat.isDirectory()) copyDir(real, d);
      else fs.copyFileSync(real, d);
    } else if (entry.isDirectory()) {
      copyDir(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

// 1. Copy .next/standalone/ → electron-resources/standalone/
//    - Skipping junk entries (download, extension, skills, upload, etc.)
//    - Renaming node_modules/ → modules/  (dodge electron-builder filter)
log(`Copying .next/standalone/ → ${path.relative(projectRoot, dest)}`);
const entries = fs.readdirSync(standaloneSrc, { withFileTypes: true });
for (const entry of entries) {
  if (SKIP_ENTRIES.has(entry.name)) {
    log(`  skip: ${entry.name}`);
    continue;
  }
  const s = path.join(standaloneSrc, entry.name);
  const d = path.join(dest, entry.name === "node_modules" ? "modules" : entry.name);
  if (entry.isDirectory()) {
    copyDir(s, d);
    log(`  dir : ${entry.name} → ${path.relative(projectRoot, d)}`);
  } else {
    fs.copyFileSync(s, d);
    log(`  file: ${entry.name}`);
  }
}

// 2. Merge .next/static/ → standalone/.next/static/  (browser JS/CSS chunks)
log(`Merging .next/static/ → standalone/.next/static/`);
copyDir(staticSrc, path.join(dest, ".next", "static"));

// 3. Copy public/ → standalone/public/  (static assets served at /)
//    Next.js standalone does NOT auto-include public/, so we add it manually.
log(`Copying public/ → standalone/public/`);
copyDir(publicSrc, path.join(dest, "public"));

// 4. Sanity-check the result
const requiredFiles = [
  "server.js",
  "package.json",
  "modules/next/package.json",
  ".next/BUILD_ID",
  ".next/required-server-files.json",
  ".next/static",
  "public",
];
for (const rel of requiredFiles) {
  if (!fs.existsSync(path.join(dest, rel))) {
    die(`Required output missing: ${rel}`);
  }
}

// Summary
function dirSize(p) {
  let total = 0;
  for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
    const full = path.join(p, entry.name);
    if (entry.isDirectory()) total += dirSize(full);
    else if (entry.isFile()) total += fs.statSync(full).size;
  }
  return total;
}
const sizeBytes = dirSize(dest);

log(`Done. Destination: ${dest}`);
log(`Size: ${(sizeBytes / 1024 / 1024).toFixed(1)} MB`);
log(`Top-level contents:`);
for (const entry of fs.readdirSync(dest, { withFileTypes: true })) {
  log(`  ${entry.isDirectory() ? "DIR " : "FILE"} ${entry.name}`);
}
