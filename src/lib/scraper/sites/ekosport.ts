// Scraper Ekosport (FR, EUR)
// --------------------------------------------------------------------------
// Protocole (cf. PROTOCOLES.md) :
//   1) Récupérer appId et index via Intershop :
//      GET https://www.ekosport.fr/INTERSHOP/rest/WFS/EKO-FR-Site/-;loc=fr_FR/algolia-configurations
//      → data.applicationID, data.indexName
//   2) Récupérer la clé API à durée limitée :
//      GET https://www.ekosport.fr/INTERSHOP/rest/WFS/EKO-FR-Site/-;loc=fr_FR/algolia-api-key
//        → { data: { apiKey, expiresIn } }  (expire sous 15 jours, renouvelée en continu)
//   3) Requête Algolia :
//      POST https://<APP_ID>-dsn.algolia.net/1/indexes/*/queries
//        Body: { requests: [{ indexName, params: "query=…&hitsPerPage=…&page=…&attributesToRetrieve=…" }] }
//        page est numérotée à partir de 0.
//
// Index : EKO-FR-PRD-LIVE-product-fr
//
// Champs utiles :
//   prices.sale     → prix payé
//   prices.list     → prix catalogue
//   marque          → marque (et non « brand »)
//   couleur, genre  → tableaux, valeurs préfixées d'un souligné : « _Bleu »
//   v_l_pointure_eu → pointures EU (trois systèmes cohabitent : US, EU, Mondopoint)
//   altImagesUrl.L  → image 600 px ; imageUrl n'est qu'une vignette de 80 px
//
// Pièges :
//   - imageUrl fait 80 px : inutilisable en liste — utiliser altImagesUrl.L
//   - Les valeurs de facettes portent un souligné initial, qui passerait dans l'affichage
//   - Trois systèmes de tailles dans le même enregistrement
//   - Aucun EAN dans l'index
//   - Les endpoints Intershop sont derrière Cloudflare → il faut Playwright
//     pour les traverser ; Algolia elle-même ne l'est pas.
// --------------------------------------------------------------------------
import axios from "axios";
import { SiteMeta, ProductResult, Scraper } from "../types";

import { pickUserAgent, absUrl, fetchJsonViaPlaywright } from "../http";
import { ScraperError } from "../error";
import { queryAlgolia } from "../algoliaClient";
import { logger } from "../../logger";

interface AlgoliaConfig {
  data?: {
    applicationID?: string;
    appId?: string;  // alias
    indexName?: string;
  };
}

interface AlgoliaKey {
  data?: {
    apiKey?: string;
    expiresIn?: number;
  };
}

interface AlgoliaHit {
  objectID?: string;
  libelle?: string;
  titre?: string;
  name?: string;
  marque?: string;
  prices?: {
    sale?: number;
    list?: number;
    prix?: number;
    prix_barre?: number;
  };
  imageUrl?: string;
  altImagesUrl?: { L?: string; M?: string; S?: string };
  url?: string;
  link?: string;
  sku?: string;
  v_l_pointure_eu?: string[];
  couleur?: string[];
  genre?: string[];
}

interface AlgoliaResponse {
  results?: {
    hits?: AlgoliaHit[];
    nbHits?: number;
  }[];
}

const REST_BASE = "https://www.ekosport.fr/INTERSHOP/rest/WFS/EKO-FR-Site/-;loc=fr_FR";
const DEFAULT_INDEX = "EKO-FR-PRD-LIVE-product-fr";

/** Retire le souligné initial des valeurs de facettes (« _Bleu » → « Bleu »). */
function stripUnderscore(s: string | undefined): string | undefined {
  if (!s) return undefined;
  return s.replace(/^_+/, "");
}

async function fetchAlgoliaConfig(): Promise<{ appId: string; indexName: string }> {
  // L'endpoint est Cloudflare-protégé → on passe par Playwright.
  const data = (await fetchJsonViaPlaywright(`${REST_BASE}/algolia-configurations`, {
    timeoutMs: 30000,
    referer: `${site.baseUrl}/`,
  })) as AlgoliaConfig;
  const appId = data?.data?.applicationID || data?.data?.appId || "";
  const indexName = data?.data?.indexName || DEFAULT_INDEX;
  if (!appId) throw new ScraperError("ekosport", "applicationID Algolia manquant", { category: "auth" });
  return { appId, indexName };
}

async function fetchApiKey(): Promise<string> {
  const data = (await fetchJsonViaPlaywright(`${REST_BASE}/algolia-api-key`, {
    timeoutMs: 30000,
    referer: `${site.baseUrl}/`,
  })) as AlgoliaKey;
  const apiKey = data?.data?.apiKey;
  if (!apiKey) throw new ScraperError("ekosport", "clé API Algolia manquante", { category: "auth" });
  return apiKey;
}

export const site: SiteMeta = {
  id: "ekosport",
  name: "Ekosport",
  baseUrl: "https://www.ekosport.fr",
  country: "FR",
  currency: "EUR",
  accent: "bg-orange-100 text-orange-800 border-orange-200",
  groups: ["all"],
};

export const scraper: Scraper = {
  site,
    capabilities: { engine: "algolia", usesPlaywright: true },
  async search(query, signal) {
    const { appId, indexName } = await fetchAlgoliaConfig();
    const apiKey = await fetchApiKey();

    // On restreint attributesToRetrieve : le site demande 70 facettes + analytique,
    // sans usage pour un comparateur.
    const attributesToRetrieve = [
      "objectID",
      "libelle",
      "titre",
      "name",
      "marque",
      "prices",
      "imageUrl",
      "altImagesUrl",
      "url",
      "link",
      "sku",
      "v_l_pointure_eu",
      "couleur",
      "genre",
    ].join(",");

    const data = await queryAlgolia(
      {
        siteId: "ekosport",
        appId,
        apiKey,
        referer: `${site.baseUrl}/`,
        signal,
      },
      [
        {
          indexName,
          params: {
            query,
            hitsPerPage: 24,
            page: 0,
            attributesToRetrieve,
          },
        },
      ]
    );

    const hits = data.results?.[0]?.hits ?? [];
    const products: ProductResult[] = [];
    const seen = new Set<string>();

    hits.slice(0, 24).forEach((h) => {
      const title = (h.libelle || h.titre || h.name || "").trim();
      if (!title) return;
      // URL produit : préfixe standard Intershop /p/<sku> ou champ url/link
      const sku = h.sku || h.objectID || "";
      const linkRaw = h.url || h.link || (sku ? `/p/${sku}` : "");
      const href = absUrl(linkRaw, site.baseUrl);
      if (!href || seen.has(href)) return;
      seen.add(href);

      const sale = h.prices?.sale ?? h.prices?.prix;
      const list = h.prices?.list ?? h.prices?.prix_barre;
      const realOriginal =
        list && sale && list > sale ? list : null;
      const discount =
        realOriginal && sale
          ? Math.round((1 - sale / realOriginal) * 100)
          : null;

      // Image : altImagesUrl.L (600 px) plutôt que imageUrl (80 px)
      const imgRaw = h.altImagesUrl?.L || h.altImagesUrl?.M || h.imageUrl || "";

      const brand = stripUnderscore(h.marque);

      products.push({
        site: "ekosport",
        siteName: site.name,
        title: brand ? `${brand} ${title}` : title,
        url: href,
        price: sale != null ? sale : null,
        originalPrice: realOriginal ?? null,
        currency: "EUR",
        image: absUrl(imgRaw, site.baseUrl),
        availability: "unknown",
        discount,
      });
    });

    return products;
  },
};
