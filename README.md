# OutdoorPrice — Comparateur de prix outdoor multi-sites

Moteur de recherche agrégatif qui interroge en parallèle **22 boutiques outdoor/cycling**,
récupère les fiches produits pour en extraire les métadonnées, identifie les
**produits similaires cross-site** pour les regrouper en une seule entrée, et
construit des **filtres dynamiques** à partir des métadonnées extraites.

Disponible en **app web** (`make run-server`) ou **app desktop Electron** (`make run`).

## 📖 Documentation

| Document | Audience | Content |
|---|---|---|
| **[USER_GUIDE.md](./docs/USER_GUIDE.md)** | End users | How to use the comparator: simple search, filters, groups, CSV export, languages |
| **[CONFIGURATION.md](./docs/CONFIGURATION.md)** | Developers / operators | Install, customize, run debug, test, write new shop scrapers, Chrome extension, Electron |
| **[DEVELOPMENT.md](./docs/DEVELOPMENT.md)** | Contributors | Architecture, intermodule communication, module functions, design choices |
| **[PROTOCOLES.md](./PROTOCOLES.md)** | AI agents / scraper authors | Per-shop scraping protocols (endpoints, selectors, gotchas) |

## Sites supportés (22)

| Site | Pays | Groupe | Statut (sandbox) |
|------|------|--------|------------------|
| Bergzeit | DE | Outdoor | ✅ |
| Sport Bittl | DE | Outdoor | ✅ |
| Ekosport | FR | Outdoor | ✅ (enrich. via Playwright) |
| Montaz | FR | Outdoor | ✅ |
| Snowleader | FR | Outdoor | ✅ (via Playwright) |
| Glisshop | FR | Outdoor | ✅ (via Playwright) |
| Sport Conrad | DE | Outdoor | ❌ Makaira 500 |
| Tradeinn | ES | Outdoor | ❌ Cloudflare 403 |
| Au Vieux Campeur | FR | Outdoor | ❌ HTTP 403 |
| Barrabes | ES | Outdoor | ✅ (Doofinder WS) |
| Telemark Pyrenees | FR | Outdoor | ✅ |
| Sportokay | DE | Outdoor | ✅ |
| Bergfreunde | FR | Outdoor | ✅ |
| Hardloop | FR | Outdoor | ✅ |
| Oliunid | FR | Outdoor | ✅ (clé Algolia cachée) |
| Varuste | FI | Outdoor | ✅ |
| DeporVillage | FR | Outdoor + Cycling | ✅ |
| ProBikeShop | FR | Cycling | ✅ (Doofinder WS) |
| Alltricks | FR | Cycling | ❌ Cloudflare |
| All4cycling | FR | Cycling | ✅ (Shopify SSR) |
| Bike24 | DE | Cycling | ❌ Akamai (via Electron) |
| Bike-Discount | DE | Cycling | ✅ (Shopware 6) |

**17 sites fonctionnels** depuis le sandbox. **5 bloqués** par anti-bot (Akamai/Cloudflare).
Les sites bloqués fonctionnent depuis une IP résidentielle ou via l'app Electron.

## Workflow en 3 phases

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────────┐
│  1. Recherche    │ →  │  2. Enrichissement    │ →  │  3. Matching        │
│  (sites parall.) │    │  (fetch pages produits)│    │  (Union-Find +      │
│                  │     │  extraction méta       │    │   multi-critères)   │
└─────────────────┘     └──────────────────────┘     └─────────────────────┘
                                                                ↓
                                                    ┌─────────────────────┐
                                                    │  Filtres dynamiques │
                                                    │  (marque, sport,    │
                                                    │   catégorie, etc.)  │
                                                    └─────────────────────┘
```

### Phase 1 — Recherche parallèle
Chaque site a son scraper dédié (`src/lib/scraper/sites/<site>.ts`) qui interroge
la page de recherche du marchand et extrait les résultats (titre, prix, image,
URL, promo). Les scrapers tournent en parallèle avec un timeout de 30s chacun.

### Phase 2 — Enrichissement
Pour chaque résultat (top-6 par site), on fetch la **page produit** et on extrait
les métadonnées en cascade depuis 4 sources :
1. **JSON-LD** `<script type="application/ld+json">` avec `@type Product`
2. **Microdata** HTML5 `[itemtype*="schema.org/Product"]`
3. **Meta tags** Open Graph (`og:brand`, `product:brand`, etc.)
4. **Tableaux techniques** (`dl/dt/dd`, `table tr td`, `.specs li`)
   + **breadcrumb** (fil d'ariane) pour la catégorie/sous-catégorie
   + **déclinaisons** couleur/taille via `data-attributes` et `aria-label`

Métadonnées extraites : `brand`, `category`, `subcategory`, `sport`, `range`
(gamme), `gender`, `color[]`, `sizes[]`, `weight` (+ `weightGrams`), `material`,
`ean`, `gtin`, `sku`, `mpn`, `modelYear`, `rating`, `reviewCount`, `attributes{}`.

La **taxonomie** (`src/lib/scraper/taxonomy.ts`) normalise les intitulés de
catégories heterogènes des différents sites vers une classification cohérente
(sport + catégorie + sous-catégorie + gamme).

### Phase 3 — Matching multi-critères
Regroupe les produits cross-site en produits logiques via **Union-Find** avec
stratégie en cascade (ne se base pas que sur le nom) :

1. **EAN / GTIN / MPN identique** → match parfait (score 1.0, raison `ean`/`gtin`/`mpn`)
2. **Score multi-critères pondéré** ≥ 0.55 :
   - marque identique (0.30)
   - catégorie identique (0.20)
   - sport identique (0.15)
   - sous-catégorie identique (0.10)
   - gamme identique (0.10)
   - similarité tokens titre - Jaccard (0.15)
   - raison : `multi:brand+category+sport`
3. **Similarité titre très haute** (Jaccard ≥ 0.85) sans métadonnées → match prudent
4. **Même marque + tokens modèle** (≥ 4 lettres) fortement chevauchants → `brand+model`

Résultat : 1 `MatchedProduct` = plusieurs `ProductOffer` cross-site, avec
`minPrice`, `maxPrice`, `savings`, `siteCount`, `matchScore`, `matchReason`.

### Filtres dynamiques
Construits à partir des métadonnées extraites de tous les produits matchés :
- Marques, Sports, Catégories, Sous-catégories, Gamme, Genre, Couleurs, Tailles
- Attributs techniques génériques (poids, matière, etc.)
- Fourchette de prix observée

## Démarrage rapide

```bash
# 1. Installer les prérequis et configurer
make config

# 2. Lancer le serveur de dev
make run-server
# → http://localhost:3000

# 3. (autre terminal) Tester un site seul
make check-site SITE=bergzeit Q="Dynafit"
make check-site SITE=sportbittl Q="Dynafit" --enrich

# 4. Lancer les tests
make test
```

## Prérequis

- **Node.js** 20+ (obligatoire)
- **Bun** (recommandé, sinon npm marche aussi)
- Aucune base de données requise

## Structure du projet

```
.
├── Makefile                          # Cibles : config, install, dev, test, lint, check-site, package-mac/win/linux
├── .env.example                      # Template de configuration (toutes les variables documentées)
├── .github/workflows/ci.yml          # CI : lint + tests sur chaque push/PR
├── README.md                         # Ce fichier
├── package.json                      # Dépendances + config electron-builder
├── vitest.config.ts                  # Config tests
│
├── docs/
│   ├── USER_GUIDE.md                # Guide utilisateur
│   ├── CONFIGURATION.md              # Install + customize + scraper author guide
│   ├── DEVELOPMENT.md               # Architecture
│   └── electron-packaging.md        # Build pipeline + 8 workarounds documentés
│
├── electron/
│   ├── main.ts                       # Process principal Electron (spawn Next.js standalone)
│   └── preload.ts                   # Bridge renderer ↔ main
│
├── extension/                        # Extension Chrome « Shop Protocol Recorder »
│   ├── manifest.json
│   ├── background.js
│   ├── devtools.html / devtools.js / panel.js
│   └── icons/
│
├── public/
│   ├── logo.svg                      # Source vectorielle de l'icône (lucide Mountain)
│   ├── icon-{16,32,64,128,256,512,1024}.png  # Générés depuis logo.svg (make icons)
│   └── icon-mac.png / icon.png      # Alias pour electron-builder
│
├── scripts/
│   ├── cli/
│   │   ├── check-site.ts             # CLI : vérifier un site seul
│   │   └── scrape-all.ts             # CLI : scraper tous les sites
│   ├── prepare-electron-standalone.js  # Prépare electron-resources/ pour electron-builder
│   ├── generate-icons.py            # Régénère les PNG depuis logo.svg (cairosvg)
│   └── build-release.sh             # Bump version + tarball + zip extension
│
├── src/
│   ├── app/
│   │   ├── page.tsx                  # UI principale (1420 lignes — À refactoriser, cf. P1.1)
│   │   ├── layout.tsx                 # Layout racine + Geist fonts
│   │   ├── providers.tsx             # TanStack Query provider
│   │   ├── globals.css               # Tailwind 4 + variables CSS
│   │   └── api/
│   │       ├── search/route.ts       # POST/GET /api/search
│   │       └── groups/route.ts       # POST/GET /api/groups (localStorage côté client)
│   │
│   └── lib/scraper/
│       ├── types.ts                  # Types partagés (ProductResult, MatchedProduct, SITES record)
│       ├── http.ts                   # Client HTTP (axios + Playwright fallback + parsePrice + absUrl)
│       ├── browserPool.ts            # Pool Chromium headless (anti-Cloudflare)
│       ├── cache.ts                   # Cache LRU in-memory (TTL configurable)
│       ├── error.ts                  # ScraperError class typée (categories: blocked/auth/parse/timeout/...)
│       ├── enrich.ts                 # Extraction métadonnées (JSON-LD → microdata → OG → tables)
│       ├── matcher.ts                # Matching multi-critères (Union-Find + Jaccard)
│       ├── filters.ts                # Construction filtres dynamiques
│       ├── taxonomy.ts               # Classification sport/catégorie/sous-catégorie/gamme
│       ├── registry.ts               # Orchestrateur workflow (parallel scrapers + enrich + match)
│       └── sites/                    # 22 scrapers (1 fichier par site) + index.ts
│           ├── index.ts              # Registre : import + export SCRAPERS[]
│           ├── bergzeit.ts
│           ├── ekosport.ts
│           ├── glisshop.ts
│           ├── montaz.ts
│           ├── snowleader.ts
│           ├── sportbittl.ts
│           ├── sportconrad.ts
│           ├── tradeinn.ts
│           ├── auvieuxcampeur.ts
│           ├── barrabes.ts
│           ├── probikeshop.ts
│           ├── alltricks.ts
│           ├── telemarkpyrenees.ts
│           ├── sportokay.ts
│           ├── bergfreunde.ts
│           ├── hardloop.ts
│           ├── oliunid.ts
│           ├── varuste.ts
│           ├── deporvillage.ts
│           ├── all4cycling.ts
│           ├── bike24.ts
│           └── bikediscount.ts
│
└── tests/
    ├── http.test.ts                  # Tests parsePrice, absUrl, cleanTitle
    ├── taxonomy.test.ts              # Tests classification
    ├── matcher.test.ts               # Tests matching multi-critères
    ├── enrich.test.ts                # Tests guessBrand, parseWeightGrams
    ├── filters.test.ts               # Tests normalisation tailles EU/US/UK
    ├── csv.test.ts                   # Tests export CSV défensif
    └── fixtures/                     # HTML fixtures pour tests régression scrapers (cf. P1.2)
        ├── bergzeit/search.html      # HTML de recherche sauvegardé
        └── bergzeit/expected.json    # Résultats attendus
```

> **Note :** L'ancien README listait 9 scrapers — c'était faux depuis ~v0.12.
> Le compte réel est **22 scrapers** (vérifié via `grep -c '^  [a-z0-9]\+: {' src/lib/scraper/types.ts`).

## Makefile — cibles principales

| Cible | Description |
|-------|-------------|
| `make config` | Installer les prérequis + .env + Playwright/Chromium |
| `make install` | Installer les dépendances Node |
| `make env` | Créer `.env` depuis `.env.example` |
| `make playwright` | Installer Chromium (fallback anti-bot) |
| `make run-server` | Lancer le serveur de dev (port 3000) |
| `make test` | Lancer les tests Vitest |
| `make lint` | ESLint |
| `make check-all` | Lint + tests |
| `make check-site SITE=<id> Q="<query>"` | Vérifier un site seul (avec enrichissement) |
| `make check-bergzeit Q="Dynafit"` | Raccourci : Bergzeit |
| `make check-sportbittl Q="Dynafit"` | Raccourci : Sport Bittl |
| `make check-ekosport Q="Dynafit"` | Raccourci : Ekosport |
| `make check-montaz Q="Dynafit"` | Raccourci : Montaz |
| `make check-snowleader Q="Dynafit"` | Raccourci : Snowleader |
| `make check-glisshop Q="Dynafit"` | Raccourci : Glisshop |
| `make check-sportconrad Q="Dynafit"` | Raccourci : Sport Conrad (bloqué sandbox) |
| `make check-tradeinn Q="Dynafit"` | Raccourci : Tradeinn (bloqué sandbox) |
| `make check-auvieuxcampeur Q="Dynafit"` | Raccourci : Au Vieux Campeur (bloqué sandbox) |
| `make build` | Build de production |
| `make clean` | Nettoyer les artefacts |
| `make help` | Aide |

## CLI — vérifier un site seul

```bash
# Vérifier Bergzeit pour "Dynafit" (avec enrichissement page produit)
bun run scripts/cli/check-site.ts bergzeit "Dynafit" --enrich

# Sortie JSON
bun run scripts/cli/check-site.ts sportbittl "Dynafit" --json

# Sans enrichissement (juste la recherche)
bun run scripts/cli/check-site.ts bergzeit "Petzl GriGri"

# Scraper tous les sites
bun run scripts/cli/scrape-all.ts "Dynafit"
```

Sites valides : `bergzeit`, `ekosport`, `glisshop`, `montaz`, `snowleader`,
`sportbittl`, `sportconrad`, `tradeinn`, `auvieuxcampeur`, `barrabes`,
`probikeshop`, `alltricks`, `telemarkpyrenees`, `sportokay`, `bergfreunde`,
`hardloop`, `oliunid`, `varuste`, `deporvillage`, `all4cycling`,
`bike24`, `bikediscount`.

(Voir `src/lib/scraper/types.ts` pour la liste officielle à jour.)

## API

### `POST /api/search`
```json
{
  "query": "Dynafit",
  "onlySites": ["bergzeit"]   // optionnel
}
```

Réponse :
```json
{
  "query": "Dynafit",
  "totalProducts": 12,
  "products": [MatchedProduct],
  "filters": DynamicFilters,
  "durationMs": 4200,
  "phases": { "searchMs": 1900, "enrichMs": 2200, "matchMs": 5 },
  "anySuccess": true,
  "demo": false,
  "sites": [{ "id": "bergzeit", "name": "Bergzeit", "status": "ok", "count": 24 }]
}
```

### `GET /api/search?q=<query>&site=<site1>&site=<site2>`
Variante GET (mêmes paramètres en query string).

## Tests

```bash
make test                    # une fois
bun run test:watch           # mode watch
```

Couverture :
- **http.test.ts** : `parsePrice` (FR/DE/EN/CH, virgule/point, apostrophe), `absUrl`, `cleanTitle`
- **taxonomy.test.ts** : classification sport/catégorie/gamme, insensibilité casse/accents
- **matcher.test.ts** : match par EAN, multi-critères, refus même site, calcul prix min/savings, tri
- **enrich.test.ts** : `guessBrandFromTitle`, `parseWeightGrams`

## Ajouter un site — workflow drop-in (depuis v0.12)

1. D'abord **vérifier en live** que le site est scrapable :
   ```bash
   bun -e 'import {fetchHtml} from "./src/lib/scraper/http"; fetchHtml("https://site.com/search?q=test").then(r => console.log(r.status, r.html.length))'
   ```
   - Si 403 / "Just a moment..." → Cloudflare, le fallback Playwright tentera de le résoudre
   - Si 200 et `< 5KB` → probablement un challenge, Playwright requis
   - Si 200 et `> 100KB` → OK, on peut parser le HTML

2. **Capturer le protocole** avec l'extension Chrome **Shop Protocol Recorder**
   (cf. `extension/README.md`) — génère un `protocol.md` + archive zip avec
   les requêtes capturées, sample product, JSON-LD, etc.

3. **Créer `src/lib/scraper/sites/<nouveausite>.ts`** — fichier **auto-suffisant**
   qui exporte `site` (métadonnées + groupes) et `scraper` (logique de scraping).
   Template minimal :

   ```ts
   import * as cheerio from "cheerio";
   import { SiteMeta, Scraper, ProductResult } from "../types";
   import { fetchHtml, parsePrice, absUrl, cleanTitle } from "../http";

   export const site: SiteMeta = {
     id: "nouveausite",
     name: "Nouveau Site",
     baseUrl: "https://www.nouveausite.com",
     country: "FR",
     currency: "EUR",
     accent: "bg-cyan-100 text-cyan-800 border-cyan-200",
     groups: ["cycling"],  // ou ["outdoor"], ou ["cycling", "outdoor"]
   };

   export const scraper: Scraper = {
     site,
     capabilities: { engine: "html", usesPlaywright: true },
     async search(query, signal) {
       const url = `${site.baseUrl}/search?q=${encodeURIComponent(query)}`;
       const { html } = await fetchHtml(url, { signal, referer: site.baseUrl, timeoutMs: 25000 });
       const $ = cheerio.load(html);
       // ... parser les cartes produit
       return products;
     },
   };
   ```

4. **Ajouter 1 ligne d'import dans `src/lib/scraper/sites/index.ts`** :

   ```ts
   import { scraper as nouveausite } from "./nouveausite";
   // ...
   export const SCRAPERS: Scraper[] = [/* ... */ , nouveausite];
   ```

5. **Ajouter 1 entrée au record `SITES` dans `src/lib/scraper/types.ts`** :
   (7 lignes : id, name, baseUrl, country, currency, accent, groups)
   ```ts
   nouveausite: {
     id: "nouveausite",
     name: "Nouveau Site",
     baseUrl: "https://www.nouveausite.com",
     country: "FR",
     currency: "EUR",
     accent: "bg-cyan-100 text-cyan-800 border-cyan-200",
     groups: ["cycling"],
   },
   ```
   > Pourquoi SITES reste dans types.ts : c'est le seul registre client-safe
   > (pas d'import transitif de axios/playwright). Le fichier scraper est
   > server-only (utilise http.ts qui importe axios). Séparer les deux évite
   > que le bundle client ne tire des modules Node-only.

6. **Tester** : `make check-site SITE=nouveausite Q="test"`

C'est tout. Plus besoin de modifier `groups.ts` ou le `Makefile`. Les groupes
builtin (`outdoor`, `cycling`, `it`) sont **auto-dérivés** depuis le champ
`groups` déclaré dans `SITES`.

## robots.txt — non pris en compte

Ce projet est un **outil de comparaison de prix à usage personnel et non
commercial**, pas un service de crawl ou d'indexation à grande échelle. À ce
titre, le client HTTP (`src/lib/scraper/http.ts`) **ne consulte pas** le
`robots.txt` des sites ciblés et n'applique pas leurs règles d'indexation.

Si vous réutilisez ce code dans un cadre **commercial ou de service public**,
vous DEVEZ réintroduire la consultation du `robots.txt` (ex : package
[`robots-parser`](https://www.npmjs.com/package/robots-parser)).

## Anti-bot — Playwright (optionnel)

Si un site bloque axios (status 4xx, page Cloudflare, exception réseau), le
client HTTP retente automatiquement avec Playwright (Chromium headless) si
Playwright est installé. Pour activer Playwright pour **toutes** les requêtes :

```bash
echo "SCRAPE_USE_PLAYWRIGHT=1" >> .env
```

`make config` installe Playwright + Chromium automatiquement.

## Stack technique

- **Next.js 16** (App Router, Turbopack) + TypeScript 5
- **Tailwind CSS 4** + **shadcn/ui** (composants)
- **TanStack Query** (cache/re-fetch côté client)
- **axios** + **cheerio** (scraping HTTP + parsing HTML)
- **Playwright** (fallback Chromium headless pour anti-bot)
- **Vitest** (tests)
- **Bun** (runtime recommandé, npm compatible)
