#!/usr/bin/env bun
//
// CLI : scraper tous les sites pour une requête
//
// Usage :
//   bun run scripts/cli/scrape-all.ts "<query>" [--json] [--sites=ekosport,snowleader]
//
import { aggregateMatched } from "../../src/lib/scraper/registry";
import { SITES } from "../../src/lib/scraper/types";
import { type SiteId } from "../../src/lib/scraper/types";

const VALID_SITES = Object.keys(SITES) as SiteId[];

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: bun run scripts/cli/scrape-all.ts "<query>" [--json] [--sites=...]');
    process.exit(1);
  }
  const query = args[0];
  const asJson = args.find((a) => a === "--json");
  const sitesArg = args.find((a) => a.startsWith("--sites="));
  const onlySites = sitesArg
    ? (sitesArg.replace("--sites=", "").split(",") as SiteId[]).filter((s) =>
        VALID_SITES.includes(s)
      )
    : undefined;

  const result = await aggregateMatched(query, onlySites && onlySites.length ? { onlySites } : {});

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`\n=== Recherche agrégée : "${query}" ===`);
    console.log(`Phase recherche : ${(result.phases.searchMs / 1000).toFixed(2)}s`);
    console.log(`Phase enrichissement : ${(result.phases.enrichMs / 1000).toFixed(2)}s`);
    console.log(`Phase matching : ${(result.phases.matchMs / 1000).toFixed(2)}s`);
    console.log(`Produits matchés : ${result.products.length}`);
    console.log(`Démo : ${result.demo ? "oui (sites bloqués)" : "non"}\n`);

    console.log("--- Statut par site ---");
    for (const r of result.rawResults) {
      const dur = r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : "—";
      console.log(`  ${r.site.name.padEnd(20)} ${r.status.padEnd(8)} ${r.products.length} produits  ${dur}`);
    }

    console.log("\n--- Produits matchés ---");
    for (const p of result.products) {
      console.log(`\n  [${p.id}] ${p.title}`);
      console.log(`      Marque: ${p.brand ?? "—"} | Sport: ${p.sport ?? "—"} | Cat: ${p.category ?? "—"}`);
      console.log(`      Sites: ${p.siteCount} | Score: ${p.matchScore ?? "—"} | Raison: ${p.matchReason ?? "—"}`);
      console.log(`      Prix: ${p.minPrice} ${p.minCurrency} → ${p.maxPrice} ${p.minCurrency} (savings: ${p.savings ?? "—"})`);
      for (const o of p.offers) {
        const promo = o.discount ? ` (-${o.discount}%)` : "";
        console.log(`        - ${o.siteName.padEnd(20)} ${o.price} ${o.currency}${promo} [${o.availability}]`);
      }
    }
  }
}

main().catch((e) => {
  console.error("Erreur fatale :", e);
  process.exit(1);
});
