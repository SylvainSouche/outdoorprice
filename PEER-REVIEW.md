# Peer Review — OutdoorPrice (2026-08-22)

Périmètre : projet complet après la session du 2026-08-22 (18 scrapers,
matching, UI, tooling, extension). Revue par lecture de code — pas d'exécution
systématique de chaque chemin.

## MUST CORRECT

### M1. `.env.example` inexistant mais référencé par `make env` / `make config`
`Makefile:101` fait `cp .env.example .env` — le fichier n'existe pas : `make
config` casse sur une installation fraîche. Par ailleurs les variables
d'environnement ajoutées pendant la session ne sont documentées nulle part :
`SCRAPE_HEADED`, `SCRAPE_USE_CHROME`, `SCRAPE_CLOUDFLARE_TIMEOUT_MS`,
`SCRAPE_USE_PLAYWRIGHT`, `PROXY_URL`. → Créer `.env.example` documenté.

### M2. Oliunid : un Chromium lancé à CHAQUE recherche pour extraire la clé
`fetchAlgoliaKey()` fait un `fetchHtml` de la home à chaque `search()` ; la
home 403 en axios → fallback Playwright → Chromium complet (~1,5 s + 80 Mo)
pour une clé valide ~7 jours. → Cache en mémoire du process avec TTL (24 h) +
invalidation sur 403 Algolia.

### M3. PROTOCOLES.md contient des sections contradictoires
Les sections historiques (« Tradeinn — bloqué », « Alltricks — BLOQUÉ »,
conclusion « 4 sites fonctionnels ») coexistent avec les sections du
2026-08-22 qui les démentent. Un lecteur qui scanne le fichier retient
l'information périmée. → Annoter les sections remplacées (« obsolète, cf
section du 2026-08-22 ») et corriger la conclusion d'entrée.

## SHOULD CORRECT

### S1. Registry : fuite du timer de la 1re tentative + listeners accumulés
`runScraperWithRetry` : si `raceWithDeadline` rejette (scraper en erreur), le
`clearTimeout(timeout)` du premier timer n'est jamais exécuté — l'abort
part sur un contrôleur mort (inoffensif mais sale). Les `addEventListener`
sur le signal externe s'accumulent à chaque retry sans `removeEventListener`.
→ try/finally autour de chaque tentative.

### S2. `PER_SITE_TIMEOUT = 30 s` trop juste pour les sites Turnstile headed
Alltricks headed : ~2,4 s de navigation + jusqu'à 20 s de challenge + extraction
≈ 26–28 s — le race hard-kill à 30 s peut trancher des recherches valides.
→ Rendre le délai configurable (`SCRAPE_SITE_TIMEOUT_MS`) et/ou l'augmenter
pour les sites Playwright.

### S3. Taxonomie d'erreurs scraper non standardisée
Chaque scraper lance des `Error` avec des phrases françaises ad hoc ; le
LogsPanel et le CLI n'ont donc que le statut (ok/empty/error) + du texte.
Un `ScraperError { site, cause: "blocked_cloudflare" | "parse" | "network" |
"key_rejected" }` permettrait des messages UI stables et un compteur de
causes. → Introduire le type et migrer progressivement.

### S4. `matchScore` incohérent après le split anti-conflation
Les scores/reasons sont collectés par racine d'union-find ; les sous-groupes
issus du split partagent les scores de la racine → un sous-groupe peut
afficher un score calculé sur des paires qui ne lui appartiennent plus.
→ Recalculer les scores par sous-groupe (paires internes).

### S5. `page.tsx` : monolithe de ~1 700 lignes
Un seul fichier contient le header, la sidebar de filtres, les cartes
produit, la GroupMatrixModal et les handlers de recherche. Maintenable mais
au bord de la limite. → Extraction progressive : `ProductCard`,
`FilterSidebar`, `GroupMatrixModal` dans `src/components/`.

### S6. Aucun test des parseurs HTML sur fixtures
Les fonctions d'extraction (sportokay, bergfreunde, varuste, telemark) sont
pures et testables sur HTML figé — c'est là que les régressions de sélecteurs
se produisent. → Sauver 1 page HTML par site dans `tests/fixtures/` et tester
les extractions.

### S7. Pas de cache de résultats de recherche
Relancer la même requête re-scrape les 13 sites (Playwright compris). Un cache
mémoire (query+sites → réponse, TTL 2 min) rendrait l'UI nettement plus
réactive sans changer le modèle.

## CORRECT IF NOT IN A RUSH

### C1. Réutilisation d'un client Algolia (Ekosport + Oliunid)
Deux implémentations parallèles (config, clé, multi-queries). Un helper
commun réduirait la duplication quand un 3e site Algolia arrivera.

### C2. Pool de navigateurs Playwright
Chaque scraper lance/ferme son Chromium. Un navigateur partagé par process
(avec contexts isolés) réduirait latence (~1 s par launch) et mémoire.

### C3. Groupes custom : localStorage + header base64 non signé
Acceptable pour une app locale ; si le serveur est exposé, n'importe quel
client peut injecter des groupes arbitraires via `X-Custom-Groups`.
Documenter la limite, ou signer/valider côté serveur.

### C4. `csv.ts` non testé
L'échappement (guillemets, virgules, retours ligne) est le genre de code qui
casse silencieusement. 6 cas de test suffiraient.

### C5. Extension : `manifest.json` versionné à la main
Le zip est versionné depuis le manifest (bien) mais le bump de version reste
manuel — oublier de bumper donne deux zips « différents » de même version.

## BEST DONE NEXT TIME

- N1. Un logger structuré (niveau + contexte site) à la place des
  `console.log` préfixés à la main dans les scrapers.
- N2. CI minimale (GitHub Actions : `make check-all`) — tout existe déjà.
- N3. Ranger les captures de protocole (`upload/`, `download/`) comme
  fixtures versionnées plutôt que documents jetables.
- N4. Penser le rate-limitingpoli global (concurrency par domaine) dès
  qu'un 19e site arrive — aujourd'hui le stagger + MAX_PARALLEL_PLAYWRIGHT
  suffisent, mais rien ne protège un même domaine multi-endpoints.

## Points positifs relevés

- Documentation de protocole exceptionnelle (PROTOCOLES.md + headers de
  fichiers scraper jumeaux) : chaque workaround Cloudflare/Didomi/Turnstile
  est expliqué avec sa raison.
- La résolution auto de clés (Hardloop buildManifest, Oliunid home SSR)
  est robuste et bien documentée.
- Le garde-fou post-union du matcher (split par signature) est une réponse
  élégante au problème de fermeture transitive.
- Tests : ce qui est pur (parsePrice, matcher, filters) est testé — 57/57.
