// Barrel file — re-exports all scrapers.
//
// ============================================================================
// DROP-IN WORKFLOW — Adding a new shop
// ============================================================================
// 1. Create `sites/<id>.ts` that exports:
//      - `site: SiteMeta` (with id, name, baseUrl, country, currency, accent, groups)
//      - `scraper: Scraper` (with capabilities + search function)
// 2. Add ONE line to the SCRAPERS array below:
//      `import { scraper as <id> } from "./<id>";`
//    then push `<id>,` into the array.
// 3. Add ONE entry to SITES in `../types.ts` (client-safe metadata only).
//
// That's it — 1 file dropped + 2 single-line edits. No Makefile or groups.ts
// changes needed (groups are derived from the `groups` field in SITES).
// ============================================================================

import { scraper as bergzeit } from "./bergzeit";
import { scraper as ekosport } from "./ekosport";
import { scraper as glisshop } from "./glisshop";
import { scraper as montaz } from "./montaz";
import { scraper as snowleader } from "./snowleader";
import { scraper as sportbittl } from "./sportbittl";
import { scraper as sportconrad } from "./sportconrad";
import { scraper as tradeinn } from "./tradeinn";
import { scraper as auvieuxcampeur } from "./auvieuxcampeur";
import { scraper as barrabes } from "./barrabes";
import { scraper as probikeshop } from "./probikeshop";
import { scraper as alltricks } from "./alltricks";
import { scraper as telemarkpyrenees } from "./telemarkpyrenees";
import { scraper as sportokay } from "./sportokay";
import { scraper as bergfreunde } from "./bergfreunde";
import { scraper as hardloop } from "./hardloop";
import { scraper as oliunid } from "./oliunid";
import { scraper as varuste } from "./varuste";
import { scraper as deporvillage } from "./deporvillage";
import { scraper as all4cycling } from "./all4cycling";
import { scraper as bike24 } from "./bike24";
import { scraper as bikediscount } from "./bikediscount";

import type { Scraper, SiteId } from "../types";

export const SCRAPERS: Scraper[] = [
  bergzeit,
  ekosport,
  glisshop,
  montaz,
  snowleader,
  sportbittl,
  sportconrad,
  tradeinn,
  auvieuxcampeur,
  barrabes,
  probikeshop,
  alltricks,
  telemarkpyrenees,
  sportokay,
  bergfreunde,
  hardloop,
  oliunid,
  varuste,
  deporvillage,
  all4cycling,
  bike24,
  bikediscount,
];

// === Auto-derived lookups ===

/** Playwright-using sites — derived from capabilities. */
export const PLAYWRIGHT_SITES = new Set<SiteId>(
  SCRAPERS
    .filter((s) => s.capabilities?.usesPlaywright)
    .map((s) => s.site.id)
);

/** Challenge sites (Cloudflare etc.) — derived from capabilities. */
export const CHALLENGE_SITES = new Set<SiteId>(
  SCRAPERS
    .filter((s) => s.capabilities?.challenge)
    .map((s) => s.site.id)
);

/** Map of siteId → scraper for quick lookup. */
export const SCRAPER_BY_SITE = Object.fromEntries(
  SCRAPERS.map((s) => [s.site.id, s])
) as Record<string, Scraper>;

// Re-export individual scrapers for backwards compatibility (legacy imports)
export {
  bergzeit as bergzeitScraper,
  ekosport as ekosportScraper,
  glisshop as glisshopScraper,
  montaz as montazScraper,
  snowleader as snowleaderScraper,
  sportbittl as sportbittlScraper,
  sportconrad as sportconradScraper,
  tradeinn as tradeinnScraper,
  auvieuxcampeur as auvieuxcampeurScraper,
  barrabes as barrabesScraper,
  probikeshop as probikeshopScraper,
  alltricks as alltricksScraper,
  telemarkpyrenees as telemarkpyreneesScraper,
  sportokay as sportokayScraper,
  bergfreunde as bergfreundeScraper,
  hardloop as hardloopScraper,
  oliunid as oliunidScraper,
  varuste as varusteScraper,
  deporvillage as deporvillageScraper,
  all4cycling as all4cyclingScraper,
};
