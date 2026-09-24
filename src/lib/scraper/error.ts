// ScraperError — typed error class for scraper failures.
// Replaces plain `new Error(...)` with structured error info
// so the UI/logs can show the site, status code, and category.
//
// Usage:
//   throw new ScraperError("bergzeit", "Cloudflare 403", {
//     statusCode: 403,
//     category: "blocked",
//   });
//
// Categories:
//   "blocked"     — anti-bot block (Cloudflare, Turnstile, etc.)
//   "timeout"     — scraper exceeded its time budget
//   "empty"       — site responded OK but 0 products
//   "network"     — connection refused, DNS failure, etc.
//   "parse"       — HTML/JSON structure changed, selectors broken
//   "auth"        — API key missing or expired
//   "unknown"     — anything else

export type ScraperErrorCategory =
  | "blocked"
  | "timeout"
  | "empty"
  | "network"
  | "parse"
  | "auth"
  | "unknown";

export class ScraperError extends Error {
  readonly siteId: string;
  readonly statusCode?: number;
  readonly category: ScraperErrorCategory;
  readonly cause?: unknown;

  constructor(
    siteId: string,
    message: string,
    opts: {
      statusCode?: number;
      category?: ScraperErrorCategory;
      cause?: unknown;
    } = {}
  ) {
    super(message);
    this.name = "ScraperError";
    this.siteId = siteId;
    this.statusCode = opts.statusCode;
    this.category = opts.category ?? ScraperError.inferCategory(message, opts.statusCode);
    this.cause = opts.cause;

    // Preserve stack trace (V8 only)
    if (typeof Error.captureStackTrace === "function") {
      Error.captureStackTrace(this, ScraperError);
    }
  }

  /** Infer the error category from the message + status code. */
  static inferCategory(message: string, statusCode?: number): ScraperErrorCategory {
    const msg = message.toLowerCase();
    if (statusCode === 403 || msg.includes("cloudflare") || msg.includes("just a moment"))
      return "blocked";
    if (msg.includes("timeout") || msg.includes("timed out"))
      return "timeout";
    if (statusCode === 401 || msg.includes("api key") || msg.includes("401"))
      return "auth";
    if (msg.includes("econnrefused") || msg.includes("dns") || msg.includes("network"))
      return "network";
    if (msg.includes("parse") || msg.includes("selector") || msg.includes("json"))
      return "parse";
    if (msg.includes("0 résultat") || msg.includes("empty"))
      return "empty";
    return "unknown";
  }

  /** Human-readable summary for the logs panel. */
  toLogString(): string {
    const parts = [this.message];
    if (this.statusCode) parts.push(`(HTTP ${this.statusCode})`);
    parts.push(`[${this.category}]`);
    return parts.join(" ");
  }

  /** Returns true if this error is likely transient (retry might help). */
  isRetryable(): boolean {
    return (
      this.category === "timeout" ||
      this.category === "network" ||
      (this.category === "blocked" && !this.message.includes("ne se résout"))
    );
  }
}
