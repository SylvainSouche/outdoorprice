// =============================================================================
// Structured logger for the scraper subsystem.
//
// Replaces ad-hoc `console.log("[site] message")` calls with a tiny tagged
// logger that:
//   - prefixes every line with the site id and (optional) phase
//   - routes through a single function so future-you can swap to pino/winston
//     without touching every scraper
//   - respects SCRAPE_LOG_LEVEL env var ("debug" | "info" | "warn" | "error")
//     — default is "info"
//
// Usage:
//   import { logger } from "@/lib/logger";
//   const log = logger.forSite("bergzeit");
//   log.info("search started");            // → "[bergzeit] search started"
//   log.debug("fetched 24 products");       // → "[bergzeit] debug: fetched 24 products"
//   log.warn("3 products had no price");
//   log.error("network timeout", err);
//
//   // with a phase tag
//   const log = logger.forSite("ekosport", "algolia");
//   log.info("key fetched");                // → "[ekosport:algolia] key fetched"
//
// Design notes:
//   - We deliberately do NOT use pino/winston. They're heavy, they want a
//     transport, they add 100KB to the bundle. The 60 lines below cover 95%
//     of what we need: tag + level + message + optional error.
//   - Output goes to console.* so it shows up in Next.js dev server,
//     Electron terminal, and CI logs identically.
//   - No structured JSON output. This is a personal tool, not a SaaS —
//     human-readable lines are more useful than parseable logs.
// =============================================================================

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const MIN_LEVEL: LogLevel = (() => {
  const v = (process.env.SCRAPE_LOG_LEVEL || "info").toLowerCase();
  return (v in LEVEL_ORDER) ? (v as LogLevel) : "info";
})();

/** True if the given level is enabled by SCRAPE_LOG_LEVEL (or higher). */
function levelEnabled(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[MIN_LEVEL];
}

interface LoggerOptions {
  /** Site id ("bergzeit", "ekosport", ...). */
  site?: string;
  /** Phase tag ("algolia", "enrich", "match", ...). Optional. */
  phase?: string;
}

/** Build the `[site:phase]` prefix. */
function buildPrefix(opts: LoggerOptions): string {
  if (opts.site && opts.phase) return `[${opts.site}:${opts.phase}]`;
  if (opts.site) return `[${opts.site}]`;
  if (opts.phase) return `[${opts.phase}]`;
  return "[scraper]";
}

class Logger {
  constructor(private opts: LoggerOptions) {}

  /** Returns a new logger with the same site/phase but a different phase. */
  forPhase(phase: string): Logger {
    return new Logger({ ...this.opts, phase });
  }

  debug(msg: string, ...rest: unknown[]): void {
    if (!levelEnabled("debug")) return;
    console.log(`${buildPrefix(this.opts)} ${msg}`, ...rest);
  }

  info(msg: string, ...rest: unknown[]): void {
    if (!levelEnabled("info")) return;
    console.log(`${buildPrefix(this.opts)} ${msg}`, ...rest);
  }

  warn(msg: string, ...rest: unknown[]): void {
    if (!levelEnabled("warn")) return;
    console.warn(`${buildPrefix(this.opts)} ${msg}`, ...rest);
  }

  error(msg: string, err?: unknown): void {
    if (!levelEnabled("error")) return;
    const detail = err instanceof Error
      ? `${err.message}\n${err.stack ?? ""}`
      : (err !== undefined ? String(err) : "");
    console.error(`${buildPrefix(this.opts)} ${msg}${detail ? " — " + detail : ""}`);
  }
}

/** Top-level logger factory — entry point for the whole module. */
export const logger = {
  /** Create a logger tagged with a site id (and optional phase). */
  forSite(site: string, phase?: string): Logger {
    return new Logger({ site, phase });
  },

  /** Generic logger with no site tag (for infrastructure: http, registry, ...). */
  forPhase(phase: string): Logger {
    return new Logger({ phase });
  },

  /** Bare log — only used by the http.ts / registry.ts level. */
  raw: new Logger({}),
};
