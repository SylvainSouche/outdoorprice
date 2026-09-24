// Debug dump utility — saves raw API responses to the debug/ directory.
import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";

const DEBUG_DIR = "debug";

export function isDebugDump(): boolean {
  return process.env.DEBUG_DUMP === "1";
}

export function isDebugVerbose(): boolean {
  return process.env.DEBUG_VERBOSE === "1";
}

export function createDebugSession(query: string): string {
  if (!isDebugDump()) return "";
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30);
  const dir = join(DEBUG_DIR, `${ts}_${slug}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "_query.txt"),
    `Query: ${query}\nTimestamp: ${new Date().toISOString()}\nVersion: ${getVersion()}\n`);
  return dir;
}

export function dumpSearchResults(
  dir: string,
  query: string,
  results: Array<{
    site: { id: string; name: string; baseUrl: string };
    products: unknown[];
    status: string;
    error?: string;
    durationMs?: number;
  }>
): void {
  if (!isDebugDump() || !dir) return;
  const summary = results.map((r) => ({
    site: r.site.id, name: r.site.name, status: r.status,
    productCount: r.products.length, durationMs: r.durationMs, error: r.error,
  }));
  writeFileSync(join(dir, "summary.json"), JSON.stringify(summary, null, 2));
  for (const r of results) {
    writeFileSync(join(dir, `${r.site.id}.json`), JSON.stringify({
      site: r.site, status: r.status, error: r.error,
      durationMs: r.durationMs, productCount: r.products.length, products: r.products,
    }, null, 2));
  }
  if (isDebugVerbose()) console.log(`[debug] Dumped ${results.length} site results to ${dir}/`);
}

export function dumpMatchedResults(
  dir: string,
  matched: unknown[],
  phases: { searchMs: number; enrichMs: number; matchMs: number }
): void {
  if (!isDebugDump() || !dir) return;
  writeFileSync(join(dir, "matched.json"), JSON.stringify(
    { phases, matchedCount: matched.length, products: matched }, null, 2));
  if (isDebugVerbose()) console.log(`[debug] Dumped ${matched.length} matched products to ${dir}/matched.json`);
}

export function debugLog(msg: string, ...args: unknown[]): void {
  if (isDebugVerbose()) console.log(`[debug] ${msg}`, ...args);
}

function getVersion(): string {
  try { return readFileSync("VERSION", "utf8").trim(); } catch { return "unknown"; }
}
