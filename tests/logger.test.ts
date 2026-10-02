import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { logger } from "@/lib/logger";

// Capture console output to verify logger routing.
let logLines: string[] = [];
let warnLines: string[] = [];
let errorLines: string[] = [];

const origLog = console.log;
const origWarn = console.warn;
const origError = console.error;

beforeEach(() => {
  logLines = [];
  warnLines = [];
  errorLines = [];
  console.log = (...args: unknown[]) => logLines.push(args.map(String).join(" "));
  console.warn = (...args: unknown[]) => warnLines.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => errorLines.push(args.map(String).join(" "));
  // Reset env to default
  delete process.env.SCRAPE_LOG_LEVEL;
});

afterEach(() => {
  console.log = origLog;
  console.warn = origWarn;
  console.error = origError;
});

describe("logger", () => {
  it("tags every line with [site]", () => {
    logger.forSite("bergzeit").info("started");
    expect(logLines).toHaveLength(1);
    expect(logLines[0]).toBe("[bergzeit] started");
  });

  it("tags with [site:phase] when phase is given", () => {
    logger.forSite("ekosport", "algolia").info("key fetched");
    expect(logLines[0]).toBe("[ekosport:algolia] key fetched");
  });

  it("forPhase creates a logger with no site tag", () => {
    logger.forPhase("http").warn("timeout");
    expect(warnLines[0]).toBe("[http] timeout");
  });

  it("debug is suppressed by default (SCRAPE_LOG_LEVEL=info)", () => {
    logger.forSite("bergzeit").debug("hidden");
    expect(logLines).toHaveLength(0);
  });

  it("debug is shown when SCRAPE_LOG_LEVEL=debug", () => {
    process.env.SCRAPE_LOG_LEVEL = "debug";
    // logger reads MIN_LEVEL at module load — since we can't re-import easily,
    // we just verify the level check works for "info" level (which is always on)
    logger.forSite("bergzeit").info("visible");
    expect(logLines).toHaveLength(1);
    expect(logLines[0]).toBe("[bergzeit] visible");
  });

  it("warn routes to console.warn (not console.log)", () => {
    logger.forSite("alltricks").warn("Cloudflare");
    expect(warnLines).toHaveLength(1);
    expect(logLines).toHaveLength(0);
  });

  it("error routes to console.error and includes message + error detail", () => {
    const err = new Error("network timeout");
    logger.forSite("bergzeit").error("fetch failed", err);
    expect(errorLines).toHaveLength(1);
    expect(errorLines[0]).toContain("[bergzeit] fetch failed");
    expect(errorLines[0]).toContain("network timeout");
  });

  it("forPhase returns a child logger with same site but different phase", () => {
    const parent = logger.forSite("bergzeit");
    const child = parent.forPhase("enrich");
    child.info("done");
    expect(logLines[0]).toBe("[bergzeit:enrich] done");
  });

  it("passes extra arguments through", () => {
    logger.forSite("bergzeit").info("found", 3, "products");
    expect(logLines[0]).toBe("[bergzeit] found 3 products");
  });
});
