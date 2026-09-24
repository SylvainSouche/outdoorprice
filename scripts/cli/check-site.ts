#!/usr/bin/env bun
//
// CLI : vérifier un site tout seul
//
// Usage :
//   bun run scripts/cli/check-site.ts <site-id> "<query>" [--json] [--enrich]
//
// Exemples :
//   bun run scripts/cli/check-site.ts bergzeit "Dynafit"
//   bun run scripts/cli/check-site.ts sportbittl "Dynafit" --json
//   bun run scripts/cli/check-site.ts bergzeit "Petzl GriGri" --enrich
//
// Liste des sites : bergzeit, ekosport, glisshop, montaz, snowleader, sportbittl,
//                  sportconrad, tradeinn, auvieuxcampeur, barrabes, probikeshop, alltricks
//
import { SCRAPER_BY_SITE, aggregateSearch, aggregateMatched } from "../../src/lib/scraper/registry";
import { SITES } from "../../src/lib/scraper/types";
import { type SiteId } from "../../src/lib/scraper/types";

const VALID_SITES = Object.keys(SITES) as SiteId[];

function usage() {
  console.error(`Usage: bun run scripts/cli/check-site.ts <site-id> "<query>" [--json] [--enrich]`);
  console.error(`Sites valides : ${VALID_SITES.join(", ")}`);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) usage();

  const siteId = args[0] as SiteId;
  const query = args[1];
  const asJson = args.includes("--json");
  const withEnrich = args.includes("--enrich");

  if (!VALID_SITES.includes(siteId)) {
    console.error(`Site inconnu : ${siteId}`);
    console.error(`Sites valides : ${VALID_SITES.join(", ")}`);
    process.exit(1);
  }
  if (!query || query.length < 2) {
    console.error("Requête trop courte (min 2 caractères)");
    process.exit(1);
  }

  if (!asJson) {
    console.log(`\n=== Vérification du site : ${SITES[siteId].name} (${SITES[siteId].country}) ===`);
    console.log(`URL de base : ${SITES[siteId].baseUrl}`);
    console.log(`Requête : "${query}"`);
    console.log(`Mode enrichissement : ${withEnrich ? "oui" : "non"}\n`);
  }

  const start = Date.now();

  if (withEnrich) {
    // Workflow complet enrichi sur ce site uniquement
    const result = await aggregateMatched(query, { onlySites: [siteId] });
    if (asJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Phase recherche : ${(result.phases.searchMs / 1000).toFixed(2)}s`);
      console.log(`Phase enrichissement : ${(result.phases.enrichMs / 1000).toFixed(2)}s`);
      console.log(`Phase matching : ${(result.phases.matchMs / 1000).toFixed(2)}s`);
      console.log(`Produits matchés : ${result.products.length}`);
      console.log(`Démo : ${result.demo ? "oui (site bloqué)" : "non"}\n`);
      for (const p of result.products) {
        console.log(`  [${p.id}] ${p.title}`);
        console.log(`      Marque: ${p.brand ?? "—"} | Catégorie: ${p.category ?? "—"} | Sport: ${p.sport ?? "—"}`);
        console.log(`      Score match: ${p.matchScore ?? "—"} | Raison: ${p.matchReason ?? "—"}`);
        for (const o of p.offers) {
          const promo = o.discount ? ` (-${o.discount}%)` : "";
          console.log(`      - ${o.siteName} : ${o.price} ${o.currency}${promo} [${o.availability}]`);
        }
        console.log();
      }
    }
  } else {
    // Recherche simple sans enrichissement
    const results = await aggregateSearch(query, { onlySites: [siteId] });
    const r = results[0];
    if (asJson) {
      console.log(JSON.stringify(r, null, 2));
    } else {
      console.log(`Statut : ${r.status}`);
      console.log(`Durée : ${(r.durationMs ?? 0) / 1000}s`);
      if (r.error) console.log(`Erreur : ${r.error}`);
      console.log(`Produits : ${r.products.length}\n`);
      for (const p of r.products) {
        const promo = p.discount ? ` (-${p.discount}%)` : "";
        console.log(`  - ${p.title}`);
        console.log(`    Prix : ${p.price} ${p.currency}${promo} [${p.availability}]`);
        console.log(`    URL : ${p.url}`);
        if (p.image) console.log(`    Image : ${p.image}`);
        console.log();
      }
    }
  }

  if (!asJson) {
    console.log(`Durée totale : ${((Date.now() - start) / 1000).toFixed(2)}s`);
  }
}

main().catch((e) => {
  console.error("Erreur fatale :", e);
  process.exit(1);
});
