# Electron Packaging — Architecture & Workarounds

This document explains **why** the Electron build pipeline is structured the way it is. Every non-obvious decision is recorded here so future maintainers (including future-you) don't accidentally "simplify" something that exists for a real reason.

## TL;DR — How the packaged app works

```
OutdoorPrice.app/
├── Contents/
│   ├── MacOS/
│   │   └── OutdoorPrice                  ← Electron binary (GUI)
│   ├── Resources/
│   │   ├── app.asar                       ← dist-electron-src/main.js, preload.js, package.json
│   │   └── standalone/                    ← Next.js production server (real files, not in asar)
│   │       ├── server.js                  ← spawned by main.js
│   │       ├── package.json
│   │       ├── modules/                   ← renamed from node_modules/ (see workaround #1)
│   │       │   └── next/
│   │       ├── .next/
│   │       │   ├── BUILD_ID
│   │       │   ├── required-server-files.json
│   │       │   └── static/                ← browser JS/CSS chunks
│   │       └── public/                    ← static assets (logo, icons)
│   └── Info.plist
```

**Runtime flow:**

1. Electron binary starts → loads `app.asar/dist-electron-src/main.js`
2. `main.js` spawns `process.execPath` (itself) with `ELECTRON_RUN_AS_NODE=1` and `server.js` as the argument
3. The child process runs as plain Node.js (no GUI), boots the Next.js standalone server
4. `main.js` waits for the server to accept TCP connections on port 3456 (or next free port)
5. `main.js` opens a `BrowserWindow` pointing at `http://localhost:3456`

---

## Workaround #1 — Renaming `node_modules/` to `modules/`

### Reason

electron-builder silently strips directories named `node_modules/` from `extraResources`, even when the glob filter is `["**/*"]`. This is undocumented behavior that took several hours to diagnose.

### What we do

In `scripts/prepare-electron-standalone.js`, when copying `.next/standalone/node_modules/` to `electron-resources/standalone/`, we rename the directory to `modules/`.

### How the runtime finds modules

Node.js's `require()` searches `node_modules/` directories up the tree, but it ALSO searches directories listed in the `NODE_PATH` environment variable. So in `electron/main.ts`:

```ts
const modulesDir = path.join(standaloneDir, "modules");
serverProcess = spawn(process.execPath, [serverJs], {
  env: {
    ...process.env,
    NODE_PATH: modulesDir,          // ← tells require() to look here
    ELECTRON_RUN_AS_NODE: "1",
    // ...
  },
});
```

When `server.js` does `require('next')`, Node searches `NODE_PATH`, finds `modules/next/`, and loads it.

### Why we don't just use `asar: false`

Setting `asar: false` in the electron-builder config would let us ship `node_modules/` as a real directory inside the asar-unpacked area, eliminating this workaround entirely. We chose not to because:

- The asar archive provides a (small) integrity check — tampered files fail to load
- The compression savings are ~5% on JS bundles
- We've already paid the workaround cost; switching now is churn

If this workaround ever causes problems, switching to `asar: false` is the cleanest escape hatch.

### Alternatives we considered

- **`asarUnpack`**: keeps asar for most files, unpacks specific packages. More config, more brittle.
- **Custom server.js that bundles dependencies**: would require webpack/esbuild setup, breaks Next.js's automatic code tracing.

---

## Workaround #2 — `ELECTRON_RUN_AS_NODE=1`

### Reason

`process.execPath` in an Electron app points to the Electron binary itself, not to a separate Node.js binary. If you spawn it normally, it tries to open a new Electron window (recursive loop — dozens of windows open until the system runs out of resources).

### What we do

Set `ELECTRON_RUN_AS_NODE=1` in the child process's environment. This is a built-in Electron flag that makes the binary behave as plain Node.js — no GUI, no Chromium, just a Node.js runtime.

### How

```ts
serverProcess = spawn(process.execPath, [serverJs], {
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",     // ← critical
    NODE_PATH: modulesDir,
    // ...
  },
});
```

### Alternatives we considered

- **Bundle a separate Node.js binary**: would double the app size (Electron already includes Node.js internally).
- **Use `child_process.fork()`**: doesn't help — `fork()` uses `process.execPath` too.

---

## Workaround #3 — Next.js `output: "standalone"`

### Reason

Next.js's default production build expects you to run `next start`, which requires the entire `node_modules/next/` package plus all of its transitive dependencies. Bundling all of that into the Electron app would balloon the size from ~280MB to ~500MB+.

### What we do

Set `output: "standalone"` in `next.config.ts`. This makes Next.js trace all the files actually needed at runtime and produce a self-contained `.next/standalone/server.js` plus a minimal `node_modules/` containing only the packages the server actually imports.

### How

```ts
// next.config.ts
const nextConfig: NextConfig = {
  output: "standalone",
  // ...
};
```

The standalone `server.js` is a ~50-line Node.js script that:
1. Sets `process.chdir(__dirname)` so Next.js finds `.next/`
2. Calls `require('next')` (resolved via `NODE_PATH`)
3. Calls `startServer({ dir, hostname, port, ... })`

### Trade-off

You can't use `next start` directly in production — you must use the generated `server.js`. This means:
- Custom server code goes inside `server.js` (or you modify it post-build)
- Some Next.js features that depend on `next` CLI won't work (rare)

---

## Workaround #4 — Pre-flight check in `electron/main.ts`

### Reason

When the standalone files are missing from the packaged `.app` (because `prepare-standalone` wasn't run, or electron-builder didn't pick them up), Node.js throws a cryptic `spawn ENOENT` error pointing at the Electron binary itself — not at the actually-missing file. This was very confusing to debug.

### What we do

Before spawning the server, `main.ts` checks that all 8 expected files/directories exist in `Resources/standalone/`. If any are missing, it prints a clear list of what's missing and how to fix it.

### How

```ts
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
  for (const [name, p] of missing) console.error(`[electron]   - ${name}: ${p}`);
  throw new Error(`Missing ${missing.length} standalone files (see log above)`);
}
```

---

## Workaround #5 — Skipping junk entries in `prepare-standalone.js`

### Reason

Next.js's file tracing is overly aggressive and includes files from the project root that have no business being in a production server bundle: `download/`, `extension/`, `skills/`, `upload/`, `tsconfig.json`, `components.json`, `VERSION`, `.env`. These add ~5MB to the bundle and could leak development environment variables.

### What we do

`prepare-standalone.js` has a `SKIP_ENTRIES` set that filters out these files when copying.

### How

```js
const SKIP_ENTRIES = new Set([
  "download", "extension", "skills", "upload",
  "tsconfig.json", "components.json", "VERSION", ".env",
]);
```

### If you add a new top-level directory

Add it to `SKIP_ENTRIES` if it shouldn't be in the production server bundle. If it SHOULD be in the bundle (e.g., a `data/` directory the server reads at runtime), don't add it — but make sure it's listed in `next.config.ts`'s `outputFileTracingIncludes` if Next.js's automatic tracing doesn't pick it up.

---

## Workaround #6 — Merging `.next/static/` into `standalone/.next/static/`

### Reason

Next.js's standalone output includes `.next/BUILD_ID`, `.next/required-server-files.json`, and `.next/server/` (the server-side bundle), but it does NOT include `.next/static/` (the browser-side JS/CSS chunks). Without these, the HTML loads but has no styles or client-side JavaScript.

### What we do

`prepare-standalone.js` copies `.next/static/` from the project root into `electron-resources/standalone/.next/static/` after copying the standalone output.

### How

```js
// In prepare-electron-standalone.js:
copyDir(staticSrc, path.join(dest, ".next", "static"));
```

---

## Workaround #9 — Force-copying Playwright packages into standalone

### Reason

Next.js's standalone file tracing only copies **entry points** (`index.js`, `index.mjs`) for packages loaded via dynamic `import("playwright")`. The actual `lib/` directory — which contains the browser automation code, the Chromium launcher, the stealth plugin, etc. — is NOT traced.

Without this fix, scrapers that use Playwright (alltricks, glisshop, barrabes, probikeshop, auvieuxcampeur, bike24) throw `"Playwright non installé"` at runtime in the packaged app, even though the npm package IS installed in `node_modules/`.

### What we do

`prepare-standalone.js` explicitly copies the FULL packages from `node_modules/` into `electron-resources/standalone/modules/` after the standalone tracing:

```js
const PACKAGES_TO_FORCE_COPY = [
  "playwright",                    // browser automation (chromium, firefox, webkit)
  "playwright-core",               // core engine (lib/ directory with the actual code)
  "playwright-extra",              // stealth plugin wrapper
  "puppeteer-extra-plugin-stealth", // stealth evasion scripts
];
for (const pkgName of PACKAGES_TO_FORCE_COPY) {
  copyDir(
    path.join(nodeModulesSrc, pkgName),
    path.join(modulesDest, pkgName)
  );
}
```

This adds ~19 MB to the standalone bundle (5 MB playwright + 14 MB playwright-core) but is required for Playwright-dependent scrapers to work.

### How the runtime finds them

The `NODE_PATH` env var set in `electron/main.ts` points to `.../standalone/modules`. When a scraper does `import("playwright")`, Node.js searches `NODE_PATH` and finds `modules/playwright/index.js`, which `require()`s `playwright-core`, which has its full `lib/` directory present.

### Alternatives we considered

- **`outputFileTracingIncludes` in next.config.ts**: Next.js has a config option to force-include files in the standalone trace, but it's unreliable for complex package trees with many subdirectories.
- **Static `require("playwright")` instead of dynamic `import()`**: would make the tracer pick it up, but would also bundle Playwright into the client-side bundle (wasteful — Playwright is server-only).

---

## Workaround #10 — Copying `public/` into `standalone/public/`

### Reason

Same as #6 — Next.js's standalone output does not include the `public/` directory. Assets in `public/` (like `logo.svg`, `icon-*.png`) are served at the root URL (`/logo.svg`) and won't be found without this copy.

### What we do

`prepare-standalone.js` copies `public/` from the project root into `electron-resources/standalone/public/`.

---

## Workaround #8 — Disabling macOS code-signing

### Reason

electron-builder **auto-discovers** any "Developer ID Application" certificate in your Keychain and tries to use it to sign the `.app`. The signing process:

1. Takes 30-60 seconds (slow)
2. Requires notarization to actually be useful (slow + requires Apple ID credentials)
3. Fails frequently (keychain access prompts, expired certs, network issues)
4. Is unnecessary for local / personal-distribution apps

### What we do

In `package.json`'s `mac` config:

```json
"mac": {
  "identity": null,
  "hardenedRuntime": false,
  "gatekeeperAssess": false,
  "notarize": false
}
```

And in `Makefile`'s `package-mac` target:

```makefile
CSC_IDENTITY_AUTO_DISCOVERY=false bunx electron-builder --mac --arm64 --publish=never
```

This is **belt + suspenders**:
- `identity: null` in config tells electron-builder "don't sign, period"
- `CSC_IDENTITY_AUTO_DISCOVERY=false` env var overrides any auto-discovery (in case config is ignored)
- `--publish=never` prevents electron-builder from trying to publish to GitHub releases or similar

### Trade-off

The `.app` will be **unsigned**. macOS Gatekeeper will refuse to open it by default. Users must either:

1. **Strip the quarantine attribute** (recommended for local use):
   ```bash
   xattr -cr /path/to/OutdoorPrice.app
   open /path/to/OutdoorPrice.app
   ```

2. **Right-click → Open** in Finder (one-time bypass for Gatekeeper)

3. **Ad-hoc sign it themselves** (no Developer ID needed):
   ```bash
   codesign --force --deep --sign - /path/to/OutdoorPrice.app
   ```

### When to re-enable signing

If you ever want to distribute the app publicly (e.g., via your website, GitHub releases, Mac App Store), you'll need to:

1. Have a paid Apple Developer account ($99/year)
2. Generate a "Developer ID Application" certificate in Apple Developer portal
3. Install it in Keychain
4. Set up notarization credentials (App-specific password)
5. Remove the `"identity": null`, `"notarize": false` lines from `package.json`
6. Add a `notarize` config with your Apple ID:
   ```json
   "mac": {
     "identity": "Your Name (XXXXXXXXXX)",
     "notarize": {
       "teamId": "XXXXXXXXXX"
     }
   }
   ```
7. Set `APPLE_ID` and `APPLE_APP_SPECIFIC_PASSWORD` env vars before building

The `make package-mac` target would need the env vars unset (or you'd need a separate `make package-mac-signed` target).

---

## Build pipeline (step-by-step)

When you run `make package-mac`:

1. **`bunx tsc electron/main.ts electron/preload.ts ...`**
   Compiles TypeScript → `dist-electron-src/main.js` + `preload.js`. This is what gets packaged into `app.asar`.

2. **`bun run build`** (== `next build`)
   Produces `.next/` including `.next/standalone/` (because of `output: "standalone"`).

3. **`node scripts/prepare-electron-standalone.js`**
   Reads `.next/standalone/` and `.next/static/` and `public/`, writes `electron-resources/standalone/` with:
   - `node_modules/` renamed to `modules/`
   - `.next/static/` merged in
   - `public/` copied in
   - Junk entries skipped

4. **`bunx electron-builder --mac --arm64`**
   Reads `package.json`'s `build` config:
   - `files` → packs `dist-electron-src/`, `package.json`, `next.config.ts` into `app.asar`
   - `extraResources` → copies `electron-resources/standalone/` to `Resources/standalone/` (real files, not in asar)
   - `mac.icon` → uses `public/icon-mac.png` as the .app icon
   - Produces `dist-electron/mac-arm64/OutdoorPrice.app` and `dist-electron/OutdoorPrice-0.14.18.dmg`

---

## Debugging

### Run the packaged app with debug traces

```bash
make run-packaged
# or:
ELECTRON_DEBUG=1 ./dist-electron/mac-arm64/OutdoorPrice.app/Contents/MacOS/OutdoorPrice
```

You'll see:
- The chosen port
- Whether the app thinks it's packaged
- The exact spawn command (`Production mode — spawning: node .../Resources/standalone/server.js`)
- `NODE_PATH`, `cwd`, `resourcesPath`
- The server's stdout/stderr prefixed with `[server]`
- Renderer console messages forwarded as `[renderer:level]`
- `did-start-loading`, `did-finish-load`, `did-fail-load` events
- Pre-flight check result (`Pre-flight OK: all 8 standalone files present`)

### Verify the packaged structure

```bash
make verify-packaged
```

Checks that all 8 expected standalone files exist in `Resources/standalone/`.

### Test the standalone server in isolation

Bypass Electron entirely and run the standalone server directly with Node.js:

```bash
cd dist-electron/mac-arm64/OutdoorPrice.app/Contents/Resources/standalone
ELECTRON_RUN_AS_NODE=1 \
NODE_PATH=$(pwd)/modules \
PORT=3999 HOSTNAME=127.0.0.1 \
NODE_ENV=production \
../../MacOS/OutdoorPrice server.js
```

Then `curl http://127.0.0.1:3999/` — should return HTML.

### Common errors

| Error | Cause | Fix |
|---|---|---|
| `spawn ENOTDIR` | Old build with `app.asar/node_modules/next/dist/bin/next` path (asar is a file, not a dir) | Rebuild with `make package-mac` |
| `spawn ENOENT` on the Electron binary path | `Resources/standalone/` doesn't exist | Run `make package-mac` (which runs `prepare-standalone`); verify with `make verify-packaged` |
| `Cannot find module 'next'` | `NODE_PATH` not set correctly | Check `electron/main.ts` production mode block sets `NODE_PATH: modulesDir` |
| `Could not find a production build in the './.next' directory` | `.next/BUILD_ID` missing from standalone | `prepare-standalone.js` failed to copy `.next/` — check its output |
| Window opens but page is unstyled | `.next/static/` missing from standalone | `prepare-standalone.js` failed to merge `.next/static/` — check its output |
| Build takes 60+ seconds, then "no identity found" | electron-builder trying to code-sign with a missing/expired cert | Already fixed in v0.14.18 — `identity: null` disables signing. If you upgraded from older, check `package.json`'s `mac` block has `"identity": null` |
| `xcrun: error: unable to look up ...` during build | Same as above — code-signing failure | Same fix as above |
| App opens then immediately closes ("app is damaged") | macOS quarantine attribute on unsigned .app | `xattr -cr /path/to/OutdoorPrice.app` |

---

## File map

| File | Purpose |
|---|---|
| `electron/main.ts` | Electron main process — spawns the Next.js server, opens BrowserWindow |
| `electron/preload.ts` | Preload script — runs in renderer before page loads (currently minimal) |
| `next.config.ts` | Next.js config — sets `output: "standalone"` |
| `package.json` | electron-builder config (`build` field), scripts, dependencies |
| `Makefile` | Build targets — `package-mac`, `package-win`, `package-linux`, `prepare-standalone`, `verify-packaged`, `run-packaged`, `icons`, `clean` |
| `scripts/prepare-electron-standalone.js` | Builds `electron-resources/standalone/` from `.next/standalone/` + `.next/static/` + `public/` |
| `scripts/generate-icons.py` | Generates PNG icons at multiple sizes from `public/logo.svg` |
| `public/logo.svg` | Vector source for the app icon (editable) |
| `public/icon-{16,32,64,128,256,512,1024}.png` | Generated PNG icons (do not edit — regenerate with `make icons`) |
| `public/icon-mac.png` | Alias of `icon-1024.png` — used by `mac.icon` |
| `public/icon.png` | Alias of `icon-512.png` — used by `linux.icon` |
| `public/icon-256.png` | Used by `win.icon` |
| `.gitignore` | Excludes `dist-electron/`, `dist-electron-src/`, `electron-resources/`, `.next/` |
