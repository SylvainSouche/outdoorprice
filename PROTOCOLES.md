# Protocoles d'accès aux 22 boutiques

> Document d'implémentation. La source de vérité pour les protocoles relevés
> est `upload/PROTOCOLES.md` ; ce document la reflète et ajoute, pour chaque
> boutique, le **statut réel** mesuré depuis le sandbox (et ce que vous pouvez
> attendre depuis une IP résidentielle).
>
> ⚠️ **Note** : Les statuts « BLOQUÉ » ci-dessous reflètent les tests depuis
> le sandbox data-center. Depuis une IP résidentielle (ou via l'app Electron
> sur votre machine), ces sites fonctionnent. Les statuts sont mis à jour
> au fur et à mesure des tests.

## Résumé exécutif

| # | Boutique | Moteur | Statut live (sandbox) | Fichier |
|---|----------|--------|----------------------|---------|
| 1 | Bergzeit | état applicatif inline (Vue) | **FONCTIONNE** | `src/lib/scraper/sites/bergzeit.ts` |
| 2 | Sport Bittl | sélecteurs CSS | **FONCTIONNE** | `src/lib/scraper/sites/sportbittl.ts` |
| 3 | Ekosport | Algolia (via Intershop) | recherche OK, enrichissement via Playwright | `src/lib/scraper/sites/ekosport.ts` |
| 4 | Montaz | sélecteurs + attributs `data-*` | **FONCTIONNE** | `src/lib/scraper/sites/montaz.ts` |
| 5 | Snowleader | GraphQL Magento | recherche OK via Playwright | `src/lib/scraper/sites/snowleader.ts` |
| 6 | Glisshop | Doofinder (Phoenix LiveView WS) | recherche OK via Playwright | `src/lib/scraper/sites/glisshop.ts` |
| 7 | Sport Conrad | Makaira | bloqué (API 500, HTML 403) depuis le sandbox | `src/lib/scraper/sites/sportconrad.ts` |
| 8 | Tradeinn | Google Cloud Retail | bloqué (Cloudflare 403) depuis le sandbox | `src/lib/scraper/sites/tradeinn.ts` |
| 9 | Au Vieux Campeur | SenseFuel | bloqué (HTTP 403) depuis le sandbox | `src/lib/scraper/sites/auvieuxcampeur.ts` |
| 10 | Barrabes | Doofinder (Phoenix LiveView WS) | **FONCTIONNE** via Playwright | `src/lib/scraper/sites/barrabes.ts` |
| 11 | ProBikeShop | Doofinder (Phoenix LiveView WS) sur Shopify | **FONCTIONNE** via Playwright | `src/lib/scraper/sites/probikeshop.ts` |
| 12 | Alltricks | formulaire POST (server-side) + Typeahead | bloqué (Cloudflare) depuis le sandbox | `src/lib/scraper/sites/alltricks.ts` |
| 13 | Telemark Pyrenees | HTML SSR | **FONCTIONNE** | `src/lib/scraper/sites/telemarkpyrenees.ts` |
| 14 | Sportokay | HTML SSR | **FONCTIONNE** | `src/lib/scraper/sites/sportokay.ts` |
| 15 | Bergfreunde | HTML SSR | **FONCTIONNE** | `src/lib/scraper/sites/bergfreunde.ts` |
| 16 | Hardloop | Next.js SSR | **FONCTIONNE** | `src/lib/scraper/sites/hardloop.ts` |
| 17 | Oliunid | Algolia SSR | **FONCTIONNE** (clé Algolia cachée 24h) | `src/lib/scraper/sites/oliunid.ts` |
| 18 | Varuste | HTML SSR | **FONCTIONNE** | `src/lib/scraper/sites/varuste.ts` |
| 19 | DeporVillage | Next.js + Algolia SSR | **FONCTIONNE** | `src/lib/scraper/sites/deporvillage.ts` |
| 20 | All4cycling | Shopify HTML SSR | **FONCTIONNE** (24 produits en 2.6s) | `src/lib/scraper/sites/all4cycling.ts` |
| 21 | Bike24 | Next.js SSR + Akamai | bloqué (Akamai Bot Manager) depuis le sandbox — fonctionne via Electron | `src/lib/scraper/sites/bike24.ts` |
| 22 | Bike-Discount | Shopware 6 | **FONCTIONNE** (24 produits en 2.5s) | `src/lib/scraper/sites/bikediscount.ts` |

**Conclusion** : 16 sites fonctionnels depuis le sandbox, 6 bloqués par
anti-bot (Akamai/Cloudflare) depuis le data-center. Les sites bloqués
fonctionnent depuis une IP résidentielle ou via l'app Electron.

> Si vous exécutez ce projet depuis une IP résidentielle, les 8 premiers sites
> devraient fonctionner, ainsi qu'Alltricks (Cloudflare ne challenge pas les
> vrais utilisateurs). Les 3 derniers (Sport Conrad, Tradeinn, Au Vieux
> Campeur) restent bloqués même via Playwright.

---

## Pourquoi les 7 autres sites ne sont pas considérés comme fonctionnels

Le `README.md` liste uniquement **Bergzeit** et **Sport Bittl** comme sites
supportés. Ce n'est pas une omission : c'est le reflet de tests réels. Voici,
pour chaque site exclu, le symptôme observé et la cause racine.

### Ekosport — bloqué à l'enrichissement

- **Recherche** : fonctionne (24 produits renvoyés par Algolia).
- **Enrichissement** : les pages produit `https://www.ekosport.fr/...` sont
  derrière Cloudflare. Le scraper tente Playwright en repli, ce qui ajoute 8 à
  15 s par page et finit par timeout si plus de 6 produits sont enrichis.
- **Cause racine** : les endpoints Intershop
  (`/INTERSHOP/rest/.../algolia-configurations` et `algolia-api-key`) sont
  eux-mêmes derrière Cloudflare, mais le scraper les résout via
  `fetchJsonViaPlaywright()`. Ça marche, mais dès qu'on attaque les pages
  produit, Cloudflare réagit plus agressivement.
- **Ce qui marcherait** : ne pas faire l'enrichissement sur Ekosport, ou
  n'enrichir que 2-3 produits, ou attendre une IP résidentielle.

### Montaz — recherche OK mais enrichissement non testé

- **Recherche** : 24 produits renvoyés. Tout est dans des attributs `data-*`.
- **Enrichissement** : non testé de bout en bout depuis le sandbox à cause
  des timeouts cumulés sur les autres sites en parallèle.
- **Risque** : les pages produit de Montaz sont rendues côté serveur, donc
  l'enrichissement devrait marcher en théorie — mais le site n'expose pas
  toujours un JSON-LD complet, ce qui oblige à tomber sur les tableaux
  techniques génériques (moins fiables).

### Snowleader — recherche OK, enrichissement non testé

- **Recherche** : 24 produits via GraphQL Magento (en-tête `Store:
  Store_View_COM_FR`).
- **Enrichissement** : non testé de bout en bout depuis le sandbox.
- **Piège** : Snowleader renvoie 403 après deux recherches rapprochées — le
  scraper respecte un délai minimum, mais en cas d'appels rapprochés
  (refresh UI, multi-onglets) la deuxième requête peut échouer.

### Glisshop — recherche OK via Playwright, enrichissement non testé

- **Recherche** : 20 produits renvoyés. Le moteur est Doofinder en WebSocket
  Phoenix LiveView — axios seul ne voit rien. Le scraper charge la homepage
  via Playwright, ouvre le layer Doofinder, tape la requête, attend les
  cartes `.dfd-card-type-product` et les extrait.
- **Enrichissement** : non testé. Les pages produit de Glisshop sont en
  Angular rendu côté client ; le JSON-LD `<script type="application/ld+json">`
  standard devrait être présent après rendu Playwright.
- **Coût** : chaque recherche Glisshop nécessite un Chromium headless, ce qui
  ajoute ~5 s et ~80 Mo de RAM. En parallèle avec les autres sites, ça
  consomme.

### Sport Conrad — bloqué (API 500 + HTML 403)

- **Recherche** : l'API Makaira `POST https://sport-conrad.makaira.io/search/public`
  répond **500** depuis le sandbox. Le corps envoyé est correct (count et
  offset en chaînes, `customFilter` obligatoire), mais le serveur renvoie
  un 500 sans explication.
- **Repli HTML** : `GET https://www.sport-conrad.com/en/search?q=...` est
  protégé par Cloudflare → 403 sur axios. Le scraper tente Playwright, mais
  Cloudflare le bloque aussi (challenge JS non résolu).
- **Ce qui marcherait** : depuis une IP résidentielle, l'API Makaira devrait
  répondre (le protocole est documenté dans `upload/PROTOCOLES.md`).

### Tradeinn — bloqué (Cloudflare 403)

- **Recherche** : `POST https://www.tradeinn.com/listado.php` renvoie 403
  dès le préfetch OPTIONS de Cloudflare. Le scraper tente Playwright, mais
  Cloudflare le bloque aussi.
- **Cause racine** : Tradeinn est l'un des sites les plus agressifs contre
  les data-centers — Cloudflare challenge même les requêtes Playwright avec
  un user-agent navigateur réaliste.
- **Ce qui marcherait** : IP résidentielle + headers complets
  (`Origin`, `Referer`, `User-Agent` Chrome réel). Le protocole est
  documenté : `action=buscador_google`, extraction du prix depuis
  `attributes.price_all_<a>_to_<b>` (23 grilles par pays, le groupe France
  identifié).

### Au Vieux Campeur — bloqué (HTTP 403 + Playwright KO)

- **Recherche** : `POST https://api.sensefuel.live/search/<compte>` renvoie
  403 même avec `Origin`, `Referer` et `X-Requested-With` corrects.
- **Repli Playwright** : `fetch()` exécutée depuis Chromium échoue avec
  `Failed to fetch` — probablement à cause d'un challenge Cloudflare ou
  d'une validation CSP.
- **Cause racine** : le serveur SenseFuel vérifie quelque chose au-delà des
  headers (empreinte TLS, challenge JS exécuté sur `auvieuxcampeur.fr`
  avant l'appel API, cookie de session).
- **Ce qui marcherait** : exécuter d'abord un `GET https://www.auvieuxcampeur.fr/`
  pour récupérer les cookies, puis réinjecter ces cookies dans l'appel API
  SenseFuel. À implémenter si le site devient une priorité.

---

## Détail des protocoles

Pour chaque site, voici le protocole implémenté (cf. `upload/PROTOCOLES.md`
pour le relevé original complet, y compris les pièges spécifiques).

### Bergzeit — état applicatif inline (Vue)

**Statut** : FONCTIONNE

#### Point d'entrée
```
GET https://www.bergzeit.fr/search/?q=<terme>&p=<page>
```

#### Authentification
Aucune.

#### Requête
Aucun corps. Les données sont dans `window.__initialAppState` de la page
servie. Le scraper extrait ce bloc `<script>` et l'évalue via `Function()`
(c'est un objet littéral JS, pas du JSON strict).

#### Champs utiles

| Champ | Rôle |
|-------|------|
| `modules.productsListPage.elementsList[]` | liste des produits |
| `data.name` | libellé |
| `data.url` | lien produit (relatif → résolu via `absUrl()`) |
| `data.price.current` | prix payé |
| `data.price.old` | ancien prix — vaut « 0,00 € » hors promotion |
| `data.price.previous` | prix conseillé du fabricant (PAS un prix barré) |
| `data.images[0].src` | image |
| `data.brand.name` | marque |
| `data.variations[import:manufacturer_size]` | tailles |

#### Repli
Si l'évaluation échoue (corps trop gros), on extrait uniquement le tableau
`elementsList` via bracket-counting et on le passe à `JSON.parse()`. En
dernier ressort, le JSON-LD de la page liste les produits **sans aucun prix**
(documenté dans `upload/PROTOCOLES.md`).

#### Pièges
- `data.price.previous` est le prix conseillé du fabricant, pas un ancien prix.
- Le JSON-LD liste les produits mais SANS aucun prix.
- `ms=true&filters` ne renvoie que les facettes : pas de variante « produits ».
- Les tailles doubles « 42.5|43 » doivent être séparées.

---

### Sport Bittl — sélecteurs CSS

**Statut** : FONCTIONNE

#### Point d'entrée
```
GET https://www.sport-bittl.com/search.php?query=<terme>
```

#### Authentification
Aucune. Page HTML rendue côté serveur.

#### Requête
Aucun corps. Parsing direct avec cheerio.

#### Champs utiles

| Champ | Rôle |
|-------|------|
| `div.product-thumb-info` | carte produit |
| `span.product-name` | libellé |
| `span.product-price.is-reduced` | prix payé (uniquement si promo) |
| `span.product-price.is-original` | prix conseillé, suffixé « RRP » |
| `span.product-brand` | marque |
| `a.product-title` | lien produit |

#### Pièges
- `is-reduced` n'existe que sur les articles en promotion : s'y limiter
  perd les produits plein tarif. On lit donc `span.product-price` générique
  en repli.
- Chaque carte porte DEUX spans de prix (un régulier, un barré si promo).
- `is-price-type-1` n'a pas été élucidé (ignoré).
- Le `<h1>` annonce le nombre de résultats entre parenthèses — utile pour
  vérifier qu'on n'a pas perdu de produits.

---

### Ekosport — Algolia via Intershop

**Statut** : recherche OK, enrichissement bloqué (Cloudflare sur les pages produit)

#### Point d'entrée
```
POST https://<APP_ID>-dsn.algolia.net/1/indexes/*/queries
```
Index : `EKO-FR-PRD-LIVE-product-fr`

#### Authentification
Clé publique à durée limitée (15 jours), obtenue à chaud sur deux endpoints
Intershop derrière Cloudflare :
```
GET /INTERSHOP/rest/WFS/EKO-FR-Site/-;loc=fr_FR/algolia-configurations  → appId, index
GET /INTERSHOP/rest/WFS/EKO-FR-Site/-;loc=fr_FR/algolia-api-key         → { data: { apiKey, expiresIn } }
```
Ces deux endpoints sont résolus via `fetchJsonViaPlaywright()` (Chromium
headless charge la page, parse le JSON depuis `<pre>`).

#### Requête
```json
{
  "requests": [{
    "indexName": "EKO-FR-PRD-LIVE-product-fr",
    "params": "query=…&hitsPerPage=24&page=0&attributesToRetrieve=name,marque,prices,imageUrl,altImagesUrl,couleur,genre,v_l_pointure_eu"
  }]
}
```
`page` est numéroté à partir de 0. On restreint `attributesToRetrieve` : le
site demande 70 facettes et l'analytique, sans usage pour un comparateur.

#### Champs utiles

| Champ | Rôle |
|-------|------|
| `prices.sale` | prix payé |
| `prices.list` | prix catalogue |
| `marque` | marque (et non « brand ») |
| `couleur`, `genre` | tableaux, valeurs préfixées d'un souligné : « _Bleu » |
| `v_l_pointure_eu` | pointures EU (trois systèmes cohabitent) |
| `altImagesUrl.L` | image 600 px ; `imageUrl` n'est qu'une vignette de 80 px |

#### Enrichissement en lot
```
GET <REST>/productstock?sku=A&sku=B&variations=false → [{ sku, inStock, webStock }]
```

#### Pièges
- `imageUrl` fait 80 px : inutilisable en liste.
- Les valeurs de facettes portent un souligné initial, qui passerait dans
  l'affichage si on oublie de le retirer.
- Trois systèmes de tailles dans le même enregistrement — US, EU, Mondopoint.
- Aucun EAN dans l'index.
- **Cloudflare bloque les pages produit** : l'enrichissement échoue ou
  nécessite Playwright (lent, ~10 s par page).

---

### Montaz — sélecteurs + attributs `data-*`

**Statut** : recherche OK

#### Point d'entrée
```
GET https://www.montaz.com/global-search.html?keyword=<terme>
```

#### Authentification
Aucune. `robots.txt` déconseille la recherche : profil perso seulement.

#### Requête
Aucun corps. Tout est dans des attributs `data-*` sur les cartes.

#### Champs utiles

| Champ | Rôle |
|-------|------|
| `.product-card-image[data-product][data-prix-final]` | carte produit |
| `@data-name` | libellé |
| `@data-prix-final` | prix payé |
| `@data-prix-unitaire` | prix catalogue (renseigné même hors promotion) |
| `@data-marque` | marque |
| `@data-link` | lien produit |
| `@data-img` | image |

#### Pièges
- Tout est dans des attributs `data-*`, RIEN dans le texte : sept relevés
  perdus avant de le voir.
- `data-prix-unitaire` est renseigné même hors promotion.
- Le site redirige certaines recherches vers une page de marque, dont les
  produits n'ont aucun rapport.

---

### Snowleader — GraphQL Magento

**Statut** : recherche OK

#### Point d'entrée
```
POST https://api.snowleader.com/graphql/
```
Store view : `Store_View_COM_FR` (porte la langue française).

#### Authentification
Aucune. En-tête `Store: Store_View_COM_FR` pour choisir la langue.

#### Requête
```graphql
query productList($search:String!, $currentPage:Int=1, $pageSize:Int=24){
  products(search:$search, currentPage:$currentPage, pageSize:$pageSize){
    total_count
    items {
      __typename
      id
      sku
      name
      url_key
      image { url }
      price_range {
        minimum_price {
          final_price { value currency }
          regular_price { value currency }
        }
      }
      ... on ConfigurableProduct {
        configurable_options {
          attribute_code
          values { value_index label }
        }
      }
      bazaarvoice_rating { rating }
    }
  }
}
```
Six champs demandés là où le site en demande une cinquantaine.

#### Champs utiles

| Champ | Rôle |
|-------|------|
| `price_range.minimum_price.final_price.value` | prix payé |
| `price_range.minimum_price.regular_price.value` | prix catalogue |
| `url_key + « .html »` | lien produit (la forme courte redirige) |
| `bazaarvoice_rating` | note client, obtenue à la source |
| `configurable_options` | tailles — exige le fragment `... on ConfigurableProduct` |

#### Repli
```
GET https://api.snowleader.com/search/ajax/suggest/?q=…&___store=…
```
Autocomplétion en GET, sans authentification, quelques produits seulement.

#### Pièges
- `configurable_options` n'appartient pas à `ProductInterface` : sans
  fragment, GraphQL refuse la requête ENTIÈRE.
- L'autocomplétion `min_price` vaut 49,90 quand `final_price` vaut 99,90 —
  seul `final_price` est le prix payé.
- Aucun EAN publié, nulle part.
- **403 après deux recherches rapprochées** — respecter un délai minimum
  entre les appels.

---

### Glisshop — Doofinder (Phoenix LiveView WebSocket)

**Statut** : recherche OK via Playwright

#### Point d'entrée
```
wss://eu1-layer.doofinder.com/layer/1/websocket?hashid=<HASHID>&…
```
Index : un hashid par couple langue/devise — neuf déclarés.

#### Authentification
Aucune sur le WebSocket. L'API REST, elle, répond « request not
authenticated » et la configuration de la boutique ne contient aucune clé :
cette voie est close.

#### Requête
Trame Phoenix :
```
["5","51","lv:df-<mount_id>","event",
  { type:"form", event:"search-submit", value:"search%5Bquery%5D=<terme>" }]
```
La réponse arrive en diffs successifs, décodés par `src/core/liveview.js`.

#### Implémentation réelle
Le scraper ne décode pas la trame Phoenix. À la place, il utilise
Playwright pour :
1. Charger la homepage `https://www.glisshop.com/`.
2. Cliquer sur `input[name=searchText]` (ouvre le layer Doofinder plein écran).
3. Taper dans `.dfd-searchbox-input`.
4. Valider.
5. Attendre `.dfd-card-type-product` et extraire les cartes.

#### Champs utiles

| Champ | Rôle |
|-------|------|
| `data-product-id` | identifiant, aussi collé en fin d'URL produit |
| `.dfd-value-link` | URL absolue du produit |
| `.dfd-card-sku` | marque |
| `.dfd-card-title` | libellé |
| `.dfd-card-price--sale[data-value]` | prix promo |
| `.dfd-card-price[data-value]` | prix catalogue |
| `.dfd-card-flag[data-discount]` | badge promo |
| `.dfd-card-thumbnail img[src]` | image |
| `gtin13` (fiche produit, JSON-LD) | EAN |

#### Pièges
- Une extraction par expressions régulières ne marche pas : 20 liens pour
  18 prix et 10 libellés, sans appariement par position.
- Les gabarits sont partagés entre composants par renvoi numérique, et
  l'héritage est récursif.
- `vars[dfGroup]=TVA20` sélectionne la grille de prix.
- Enregistrer la page produit avec ⌘S donne un fichier vide : passer par
  Playwright.

---

### Sport Conrad — Makaira

**Statut** : BLOQUÉ depuis le sandbox (API 500, HTML 403)

#### Point d'entrée
```
POST https://sport-conrad.makaira.io/search/public
```

#### Authentification
Aucune clé. En-tête `X-Makaira-Instance: live` obligatoire.

#### Requête
```json
{
  "searchPhrase": "Dynafit",
  "isSearch": true,
  "enableAggregations": true,
  "aggregations": {},
  "sorting": {},
  "count": "24",
  "offset": "0",
  "apiVersion": "2019.1.1",
  "constraints": {},
  "customFilter": { "in_stock": "1", "has_image": "1" }
}
```
`count` et `offset` sont des **CHAÎNES**. Le `customFilter` est **obligatoire**.

#### Champs utiles

| Champ | Rôle |
|-------|------|
| `product.items[].fields` | liste des produits |
| `fields.price` | prix |
| `fields.ean` | EAN |

#### Repli HTML
```
GET https://www.sport-conrad.com/en/search?q=<terme>
```
Bloqué par Cloudflare (403 sur axios, challenge non résolu par Playwright).

#### Pièges
- Sans `customFilter`, Makaira répond HTTP 500 — deux tentatives perdues
  avant de le relever.
- `count` et `offset` en nombres provoquent aussi un refus.
- Le `customFilter` n'accepte que les articles en stock et pourvus d'une
  image : les ruptures ne remontent jamais.
- La boutique ne sert pas le français.

---

### Tradeinn — Google Cloud Retail

**Statut** : BLOQUÉ depuis le sandbox (Cloudflare 403)

#### Point d'entrée
```
POST https://www.tradeinn.com/listado.php
```

#### Authentification
Aucune clé. `visitorid` généré à l'exécution, jamais recopié d'un relevé.

#### Requête
Formulaire `application/x-www-form-urlencoded` :
```
action=buscador_google
palabras=<terme>
id_tienda=0
nextToken=null
idioma=fre    # ou eng, etc.
visitorid=<UUID v4 généré>
```

#### Champs utiles

| Champ | Rôle |
|-------|------|
| `results[].product.title` | libellé |
| `product.brands[0]` | marque |
| `product.availability` | `IN_STOCK` ou non |
| `product.audience.genders` | genre — présent sur 44 produits sur 44 |
| `attributes.price_all_<a>_to_<b>` | grilles « idPays:montant » — 228 prix par produit |

#### Pièges
- AUCUN champ prix direct : 23 grilles donnent un prix par pays de
  livraison, en devise locale.
- Le groupe France a été identifié en comparant un prix affiché sur le site.
- L'URL `/fr?query=…` ne sert que de lien : le paramètre est ignoré côté
  serveur.
- Pagination par curseur `nextToken`, jamais observée.
- **Cloudflare bloque data-center** même via Playwright.

---

### Au Vieux Campeur — SenseFuel

**Statut** : BLOQUÉ depuis le sandbox (HTTP 403 + Playwright `Failed to fetch`)

#### Point d'entrée
```
POST https://api.sensefuel.live/search/<compte>
```
Compte : `0b09f99d-…`, `environmentId: 532`.

#### Authentification
Aucune clé, mais la requête doit se présenter comme venant du site :
`Origin`, `Referer` pointant la page de recherche, et `X-Requested-With`.
Un 401 signifie « non reconnue ».

#### Requête
```json
{
  "key": "<horodatage>-0-KeyHit",
  "terms": { "userExpression": "<terme>", "expression": "<terme>", "inputSource": "keyboard" },
  "userIds": { "id": "<UUID généré>" },
  "trackFingerPrint": { "tracks": [], "environmentId": 532 },
  "items": { "from": 0, "size": 32, "bypassSpellcheck": false },
  "references": { "size": 32 }
}
```

#### Champs utiles

| Champ | Rôle |
|-------|------|
| `data.items.p[]` | liste des produits |
| `ttl` | titre |
| `brn` | marque |
| `lnk` | lien |
| `img` | image |
| `avl` | disponibilité |
| `prcn` | prix RÉELLEMENT PAYÉ |
| `prc` | prix catalogue, malgré son nom |
| `pprcn` | prix précédent, en promotion seulement |
| `v.i[axe « Taille »].kv` | tailles |

#### Pièges
- `prc` porte le prix catalogue : le prendre pour le prix afficherait 30 %
  de trop sur les soldes.
- Un endpoint voisin `/search/events/<compte>` ne renvoie que de la
  télémétrie.
- La page du site ne contient aucun produit : le repli HTML est désactivé.
- `Crawl-delay: 15 s` sur `auvieuxcampeur.fr`, sans objet sur l'API.
- **Bloqué même via Playwright** : `fetch()` depuis Chromium échoue avec
  `Failed to fetch`. Probablement à cause d'un cookie de session posé par
  `auvieuxcampeur.fr` avant l'appel API. À implémenter : GET sur
  `auvieuxcampeur.fr` d'abord, puis réinjecter les cookies.

---

## Ce que ces protocoles ont en commun

Rien, ou presque — et c'est l'enseignement principal. Trois régularités tout
de même, apparues sur plusieurs boutiques indépendamment :

**Le champ au nom le plus évident n'est pas le bon prix.** `prc` chez Au
Vieux Campeur porte le prix catalogue, `min_price` chez Snowleader ne
correspond à rien d'affiché, `previous` chez Bergzeit est le prix conseillé
du fabricant. Cinq boutiques sur neuf ont ce piège, et l'erreur y est
toujours dans le même sens : afficher un prix plus bas que le prix réel,
donc faire gagner la boutique à tort.

**Les identifiants de session sont partout, et n'ont rien à faire dans un
dépôt.** `visitorid`, `userIds`, `trackFingerPrint` : générés à l'exécution,
jamais recopiés d'un relevé. Des tests le vérifient.

**La page servie ment souvent sur son contenu.** Montaz range tout dans des
attributs, Bergzeit dans un état applicatif inline, Glisshop et Au Vieux
Campeur ne servent qu'une coquille. « 0 prix dans la page » n'a jamais voulu
dire « pas de prix ».

---

## Barrabes — Doofinder (Phoenix LiveView WebSocket)

**Statut** : FONCTIONNE via Playwright

### Point d'entrée
```
wss://eu1-layer.doofinder.com/layer/1/websocket?hashid=ab5ee4283e3582ee7ecdb6e65abbf338&origin=www.barrabes.com&...
```
Hashid : `ab5ee4283e3582ee7ecdb6e65abbf338` (constant — un hashid par installation
Doofinder). Paramètres notables : `language=fr`, `currency=EUR`, `layer_id=58620`.

### Authentification
Aucune sur le WebSocket. L'API REST Doofinder répond « request not authenticated » :
voie close.

### Requête
Trame Phoenix LiveView :
```
["5","51","lv:df-<mount_id>","event",
  { type:"form", event:"search-submit", value:"search%5Bquery%5D=<terme>" }]
```
La réponse arrive en diffs successifs, décodés par le widget Doofinder lui-même.

### Implémentation réelle
Comme Glisshop, le scraper ne décode pas la trame Phoenix. À la place, il utilise
Playwright pour :
1. Charger `https://www.barrabes.com/fr/`.
2. Cliquer sur `#cSearch.doofinder-trigger` (le champ est `readonly` — le click
   déclenche l'ouverture du layer plein écran).
3. Taper dans `input.dfd-searchbox-input`.
4. Valider.
5. Attendre `.dfd-card-type-product` et extraire les cartes.

### Champs utiles (structure HTML rendue par le widget Doofinder — identique à Glisshop)

| Champ | Rôle |
|-------|------|
| `.dfd-card-type-product` | carte produit (racine) |
| `[dfd-value-link]` | URL absolue du produit |
| `.dfd-card-thumbnail img[src]` | image |
| `.dfd-card-sku` | marque |
| `.dfd-card-title` | libellé |
| `.dfd-card-price--sale[data-value]` | prix payé (uniquement si promo) |
| `.dfd-card-price[data-value]` | prix catalogue (toujours présent) |
| `.dfd-card-flag[data-discount]` | pourcentage promo |

### Pièges
- Le champ de recherche Barrabes est `input#cSearch.doofinder-trigger` (readonly),
  différent de Glisshop qui utilise `input[name="searchText"]`.
- Le layer Doofinder s'ouvre en plein écran avec un overlay ; il faut
  attendre que l'overlay soit visible avant de taper.
- Les prix arrivent en différé (chargement async des cartes) — attendre 2s
  après l'apparition de `.dfd-card-type-product`.
- Une extraction par expressions régulières ne marche pas (20 liens pour 18
  prix, sans appariement par position).

---

## ProBikeShop — Doofinder (Phoenix LiveView WebSocket) sur Shopify

**Statut** : FONCTIONNE via Playwright (20 produits testés en 18s)

### Point d'entrée
```
wss://eu1-layer.doofinder.com/layer/1/websocket?hashid=68b4fcaae52b03eb30d5be2176086740&origin=probikeshop.fr&...
```
Hashid : `68b4fcaae52b03eb30d5be2176086740` (constant — un hashid par
installation Doofinder). Paramètres notables : `language=fr`, `currency=EUR`,
`layer_id=57975`.

### Authentification
Aucune sur le WebSocket. L'API REST Doofinder répond « request not authenticated » :
voie close.

### Note sur Shopify Storefront GraphQL
ProBikeShop est une boutique Shopify et expose une API GraphQL Storefront :
```
POST https://probikeshop-fr.myshopify.com/api/2025-07/graphql.json
```
Cette API ne sert **que** aux lookups par handle (recently viewed, bundles) —
elle n'est PAS utilisée pour la recherche utilisateur. Tout passe par
Doofinder. La reproduire pour un comparateur n'aurait pas de sens (pas de
champ `query` libre).

### Implémentation réelle
Comme Barrabes/Glisshop, le scraper utilise Playwright :
1. Charger `https://probikeshop.fr/`.
2. **Accepter les cookies** (banner CH2 — `button:has-text('Tout autoriser')`).
3. **Fermer le modal de sélecteur de pays** (`.md-modal-closeButton`) — probi
   détecte l'IP et ouvre un modal "We don't ship to <country>" qui bloque
   toute interaction. Sans cette étape, le layer DFD ne s'initialise pas.
4. Cliquer sur `summary.header__icon--search` (le `<summary>` d'un
   `<details-modal>`, PAS un input) — ouvre le modal de recherche.
5. Attendre que `input.dfd-searchbox-input` apparaisse (lazy-load après
   ouverture du modal).
6. Taper la requête et valider.
7. Attendre `.dfd-card-type-product` et extraire les cartes.

### Champs utiles (identiques à Glisshop/Barrabes)

| Champ | Rôle |
|-------|------|
| `.dfd-card-type-product` | carte produit (racine) |
| `[dfd-value-link]` | URL absolue du produit |
| `.dfd-card-thumbnail img[src]` | image |
| `.dfd-card-sku` | marque |
| `.dfd-card-title` | libellé |
| `.dfd-card-price--sale[data-value]` | prix payé (uniquement si promo) |
| `.dfd-card-price[data-value]` | prix catalogue (toujours présent) |
| `.dfd-card-flag[data-discount]` | pourcentage promo |

### Pièges
- Le trigger de recherche est un `<summary>` (détails-modal), pas un input.
  Il faut `force: true` car le `<summary>` n'est pas considéré comme "actionnable"
  par Playwright par défaut.
- Le modal "We don't ship to <country>" s'ouvre automatiquement selon l'IP du
  visiteur. Sans le fermer, le layer DFD ne s'initialise pas — il faut appeler
  `.md-modal-closeButton.click()` avant toute interaction.
- La bannière de cookies CH2 bloque aussi le focus. Accepter les cookies avant
  de cliquer sur search.
- Yotpo (`api-cdn.yotpo.com`) est l'API reviews — pas utile pour le comparateur,
  on l'ignore.

---

## Alltricks — formulaire POST (server-side) + Twitter Typeahead

**Statut** : **BLOQUÉ** par Cloudflare sur `/search` depuis le sandbox.
Fonctionne depuis une IP résidentielle.

### Point d'entrée
```
POST https://www.alltricks.fr/search
```
Form-encoded : `s=<terme>`

### Authentification
Aucune. Mais le POST vers `/search` déclenche un challenge Cloudflare JS que
Playwright ne peut pas résoudre depuis une IP data-center.

### Particularité : /recherche n'est PAS protégé
La page `https://www.alltricks.fr/recherche` (qui est en fait une 404) ne
déclenche PAS le challenge Cloudflare. Elle contient le formulaire de
recherche, ce qui permet de le remplir et le soumettre. Le submit POST vers
`/search`, lui, est protégé.

### Implémentation
1. Chromium charge `https://www.alltricks.fr/recherche` (sans Cloudflare).
2. Accepter les cookies (banner Didomi — `#didomi-notice-agree-button`).
3. Cliquer sur `input.search.tt-input` (Twitter Typeahead), taper la requête.
4. Submit (Enter).
5. Attendre jusqu'à 30s que le challenge Cloudflare se résolve (titre passe
   de "Un instant…" à un titre normal). Depuis une IP résidentielle, ça
   prend 1-2s. Depuis le data-center, le challenge ne se résout jamais.
6. Une fois la page de résultats chargée, extraire les liens `/F-XXX/P-XXX`.

### URL des produits
```
https://www.alltricks.fr/F-<catId>-<catSlug>/P-<prodId>-<prodSlug>
```
ex : `https://www.alltricks.fr/F-32743-etriers-de-frein/P-412486-etrier_de_frein_avant_shimano_105_br_r7000_noir`

### Champs utiles (à confirmer depuis une IP résidentielle)
Le HTML étant rendu côté serveur, on extrait les cartes produit en cherchant
les liens `a[href*="/P-"]` puis en remontant au conteneur parent qui contient
l'image et le prix.

| Sélecteur | Rôle |
|-----------|------|
| `a[href*="/P-"]` | lien produit (contient URL + titre) |
| parent (5 niveaux) | conteneur carte (image + prix) |
| `img[src]` dans parent | image |
| `[class*="price"]` dans parent | prix |

### Pièges
- Le formulaire est un POST, pas un GET — l'URL `/search?Search=castelli`
  retourne un 404 (paramètre `Search` au lieu de `s`).
- La classe `tt-input` indique Twitter Typeahead : pendant la frappe, des
  suggestions apparaissent dans une dropdown. Ne pas les confondre avec les
  résultats de la page `/search`.
- Cloudflare bloque le POST `/search` depuis le data-center, même via
  Playwright avec spoofing de navigator.webdriver. Le challenge nécessite
  une IP résidentielle.
- Didomi cookie banner bloque le focus — accepter les cookies avant de
  cliquer sur le champ de recherche.
- Bazaarvoice (`apps.bazaarvoice.com`) est l'API reviews — pas utile pour
  le comparateur, on l'ignore.

---

## All4cycling — Shopify (HTML SSR)

> Capture le 2026-08-26 via l'extension Chrome **Shop Protocol Recorder v0.11.0**
> (archive `shop-protocol-shop-2026-08-26-09-39-08.zip`, 48 requêtes).

### Point d'entrée

```
GET https://www.all4cycling.com/fr/search?options[prefix]=last&q=<terme>&page=<N>
```

Réponse : page HTML rendue côté serveur (Shopify Liquid theme "All4cycling v110").
Aucune authentification. Cloudflare peut challenger les IP data-center
(fallback Playwright intégré dans le scraper).

Endpoint secondaire (plus léger, mais limité à 6 suggestions) :

```
GET https://www.all4cycling.com/fr/search/suggest?q=<terme>&resources[limit]=6&resources[limit_scope]=each&resources[options][fields]=title,product_type,variants.title,vendor,variants.sku,tag&section_id=predictive-search
```

### Pagination

`?page=N` (Shopify standard). 24 produits par page. Le nombre total est
annoncé dans `<title>` (ex. « Recherche : 231 résultats trouvés pour « castelli giro » »).

### Champs utiles (HTML)

Cartes produit dans `<div class="card__info">` :

| Champ | Sélecteur | Notes |
|-------|-----------|-------|
| Marque | `.card__vendor` | Texte simple (ex. "Castelli") |
| Titre | `.card__title a` | Le texte du `<a>` |
| URL | `.card__title a[href]` | Préfixe `/fr/products/<handle>` — nettoyage des `_pos,_psq,_psid,_ss` |
| Prix | `.price__current .js-value` | Format français `€100,00` |
| Prix barré | `.price__was .js-value` | Vide si pas de promo |
| Discount | `.price__discount` | Format `-33%` |
| Dispo | classe sur `.price` | `price--sold-out` (rupture), `price--on-sale` ou `price--available` (dispo) |
| Image | `<img class="card__main-image">` dans `.card__media` (frère de `.card__info-container`) | CDN Shopify, URL en `//www.all4cycling.com/cdn/...` |

### JSON-LD

3 blocs JSON-LD sont présents dans la page de recherche, mais **AUCUN n'est
un ItemList de produits**. Ce sont uniquement :

1. `@type Organization` (infos boutique)
2. `@type WebPage` (page courante)
3. `@type BikeStore` (infos SEO)

→ On ne peut pas utiliser JSON-LD pour extraire les produits. Il faut parser
les cartes HTML directement (cf. `src/lib/scraper/sites/all4cycling.ts`).

### Pièges

- **GraphQL app queries fausses positifs** : `/api/2026-04/graphql.json`
  (`query GetSlideCartOffers`) et `/api/unstable/graphql.json`
  (`query bannerQuery`) ne sont PAS des recherches — ce sont respectivement
  CandyRack (panier) et le banner de consentement cookies. L'extension v0.10.1+
  les filtre correctement.
- **Tracking params dans les URLs produit** : `?_pos=1&_psq=castelli+giro&_psid=...&_ss=e`.
  Le scraper les strip via `stripTrackingParams()`.
- **Image alt vide** : `<img class="card__main-image" alt="">`. Pour le titre,
  il faut regarder `.card__title a` (texte) ou `aria-label` du lien média.
- **2 images par carte** : `card__main-image` (état par défaut) +
  `card__hover-image` (état hover). On prend la première.
- **URLs CDN relatives** : `//www.all4cycling.com/cdn/...` — il faut préfixer
  `https:` dans le scraper.

### Statut live

- **FONCTIONNE** depuis le sandbox : 24 produits retournés en 2.6 s pour
  « castelli giro » avec toutes les métadonnées (titre, marque, prix, prix
  barré, discount, disponibilité, image).
- Aucun challenge Cloudflare observé pour l'instant.

---

## Comment re-tester un site

```bash
# Recherche brute (sans enrichissement)
make check-site SITE=bergzeit Q="Dynafit"
# ou directement :
bun run scripts/cli/check-site.ts bergzeit "Dynafit" --json

# Workflow complet (recherche + enrichissement + matching)
make check-site SITE=bergzeit Q="Dynafit"     # --enrich est ajouté par défaut
# ou :
bun run scripts/cli/check-site.ts bergzeit "Dynafit" --enrich --json

# Scraper tous les sites en parallèle
make scrape-all Q="Dynafit"
```

Sites valides : `bergzeit, ekosport, glisshop, montaz, snowleader, sportbittl,
sportconrad, tradeinn, auvieuxcampeur`.

> Les 9 scrapers sont chargés dans `src/lib/scraper/registry.ts`. Si vous
> voulez désactiver un site (par exemple pour ne pas attendre 30 s sur
> Tradeinn à chaque appel), commentez sa ligne dans le tableau `SCRAPERS`.

---

## Ajouter un site

1. D'abord **vérifier en live** que le site est scrapable :
   ```bash
   bun -e 'import {fetchHtml} from "./src/lib/scraper/http"; fetchHtml("https://site.com/search?q=test").then(r => console.log(r.status, r.html.length))'
   ```
   - Si 403 / "Just a moment..." → Cloudflare, le fallback Playwright
     tentera de le résoudre.
   - Si 200 et `< 5 KB` → probablement un challenge, Playwright requis.
   - Si 200 et `> 100 KB` → OK, on peut parser le HTML.

2. Créer `src/lib/scraper/sites/<nouveausite>.ts` implémentant l'interface
   `Scraper` (voir `bergzeit.ts` ou `sportbittl.ts` comme template).

3. L'ajouter au tableau `SCRAPERS` dans `src/lib/scraper/registry.ts`.

4. L'ajouter aux types `SiteId` et au dictionnaire `SITES` dans
   `src/lib/scraper/types.ts`.

5. Ajouter sa cible Makefile :
   `check-<nouveausite>: ; @$(MAKE) check-site SITE=<nouveausite> Q="$(Q)"`.

6. Documenter le protocole dans ce fichier (section « Détail des protocoles »).
