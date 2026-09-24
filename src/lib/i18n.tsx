"use client";
import { createContext, useContext, useState, ReactNode } from "react";

// ===========================================================================
// i18n — lightweight translation system (no external dependency).
// --------------------------------------------------------------------------
// Languages: EN, FR, ES, DE. Stored in localStorage. Default: FR.
// Usage:
//   const { t, lang, setLang } = useLang();
//   <button>{t("search.compare")}</button>
// ===========================================================================

export type Lang = "fr" | "en" | "es" | "de";

const STORAGE_KEY = "outdoorprice:lang:v1";

// All UI strings. Keys are dot-notation. Missing keys fall back to FR, then to
// the key itself.
const TRANSLATIONS: Record<Lang, Record<string, string>> = {
  fr: {
    // Header
    "header.subtitle": "Comparateur cross-site · matching produits",
    "header.tagline": "11 sites agrégés + matching cross-site par EAN/marque/similarité",
    "header.disclaimer": "Données indicatives — vérifiez toujours le prix final sur le site marchand.",

    // Search bar
    "search.placeholder": "Rechercher un produit (ex. Dynafit Speed Radical)",
    "search.aria": "Recherche produit",
    "search.compare": "Comparer",
    "search.suggestions": "Suggestions :",

    // Groups
    "groups.universe": "Univers :",
    "groups.manage": "Gérer les groupes",
    "groups.manageTitle": "Gérer les groupes (matrix view)",
    "groups.empty": "Groupe « {name} » vide.",
    "groups.emptyHint": "Ce groupe ne contient actuellement aucune boutique. Ajoutez des boutiques via les plugins correspondants, ou créez un groupe personnalisé avec les boutiques existantes en cliquant sur « + Groupe ».",
    "groups.custom": "Groupe personnalisé",
    "groups.deleteConfirm": "Supprimer le groupe « {name} » ?",
    "groups.matrixTitle": "Gérer les groupes",
    "groups.matrixDesc": "Vue matricielle : cochez les boutiques appartenant à chaque groupe",
    "groups.shop": "Boutique",
    "groups.delete": "supprimer",
    "groups.deleteTitle": "Supprimer ce groupe",
    "groups.newGroup": "+ Nouveau groupe :",
    "groups.namePlaceholder": "Nom (ex: Triathlon)",
    "groups.emojiPlaceholder": "Emoji",
    "groups.create": "Créer",
    "groups.hint": "Une boutique peut appartenir à plusieurs groupes (ex: Decathlon dans Outdoor + Cycling)",

    // Sidebar
    "sidebar.filters": "Filtres",
    "sidebar.clear": "Effacer",
    "sidebar.sort": "Tri",
    "sidebar.sortSiteCount": "Plus de sites",
    "sidebar.sortPriceAsc": "Prix croissant",
    "sidebar.sortPriceDesc": "Prix décroissant",
    "sidebar.sortSavings": "Économie max",
    "sidebar.sortRating": "Mieux notés",
    "sidebar.display": "Affichage",
    "sidebar.promosOnly": "Promos uniquement",
    "sidebar.inStockOnly": "En stock uniquement",
    "sidebar.priceRange": "Fourchette de prix",
    "sidebar.priceMin": "min €",
    "sidebar.priceMax": "max €",
    "sidebar.priceMinAria": "Prix minimum",
    "sidebar.priceMaxAria": "Prix maximum",
    "sidebar.minSites": "Sites proposant le produit : min {n}",
    "sidebar.exportCsv": "Exporter CSV ({n} produits)",
    "sidebar.exportCategorized": "Debug CSV catégorisé ({n} produits)",
    "sidebar.exportCategorizedTitle": "Une ligne par produit, avec toutes les métadonnées de classification (sport, catégorie, sous-cat, gamme, genre, EAN, score de match, raison du match). Visible seulement en mode dev-debug.",
    "sidebar.sites": "Sites ({selected}/{total})",
    "sidebar.shopFilter": "Filtrer les boutiques…",
    "sidebar.shopFilterAria": "Filtrer les boutiques",
    "sidebar.other": "Autres",
    "sidebar.all": "Tout",
    "sidebar.none": "Aucun",

    // Filter sections
    "filter.brands": "Marques",
    "filter.sports": "Sports",
    "filter.categories": "Catégories",
    "filter.subcategories": "Sous-catégories",
    "filter.range": "Gamme",
    "filter.gender": "Genre",
    "filter.colors": "Couleurs",
    "filter.sizes": "Tailles",

    // Filter balloons
    "balloon.promos": "Promos",
    "balloon.inStock": "En stock",
    "balloon.minPrice": "Min {n}€",
    "balloon.maxPrice": "Max {n}€",
    "balloon.minSites": "Min {n} sites",
    "balloon.remove": "Retirer le filtre \"{label}\"",

    // Live filter
    "liveFilter.placeholder": "Filtrer les résultats affichés (texte exact, n'importe quel champ)…",
    "liveFilter.aria": "Filtrer les résultats affichés",
    "liveFilter.clear": "Effacer le filtre",

    // Summary
    "summary.query": "Requête",
    "summary.matched": "Produits matchés",
    "summary.sitesResponding": "Sites répondants",
    "summary.phases": "Phases",
    "summary.search": "Recherche",
    "summary.enrich": "Enrichissement pages produits",
    "summary.match": "Matching cross-site",
    "summary.duration": "Durée totale",
    "summary.cheapest": "Moins cher",

    // Results
    "results.noProducts": "Aucun produit trouvé pour cette sélection.",
    "results.empty": "0 résultat",
    "results.blocked": "— bloqué par Cloudflare (IP data-center non acceptée). Ce site fonctionne depuis une IP résidentielle.",
    "results.makaira": "— API Makaira répond 500 depuis le data-center.",
    "results.antibot": "— challenge anti-bot non résolu, même via Playwright.",
    "results.tip": "Astuce : dé-sélectionne les sites en erreur dans la sidebar et relance la recherche. Les sites fonctionnels (Bergzeit, Sport Bittl, Ekosport, Montaz, Snowleader, Glisshop) renvoient des produits en quelques secondes.",
    "results.noMatch": "Aucun produit ne correspond aux filtres actuels.",

    // Product card
    "product.promo": "Promo",
    "product.sites": "{n} site{s}",
    "product.offers": "{n} offre{s}",
    "product.ean": "EAN: {ean}",
    "product.from": "dès",
    "product.saveUpTo": "économisez jusqu'à {amount}",
    "product.viewOffer": "Voir l'offre",
    "product.matchCriteria": "Critères de matching",
    "product.coloris": "{n} coloris",
    "product.outOfStock": "· Rupture",
    "product.inStock": "· En stock",

    // Empty state
    "empty.title": "Comparateur de prix outdoor avec matching",
    "empty.desc": "Recherchez en parallèle sur 9 boutiques outdoor. Pour chaque produit, le moteur récupère la page produit, en extrait les métadonnées (marque, catégorie, couleur, taille, poids, EAN…), puis regroupe les offres cross-site en une seule entrée. Les filtres se construisent dynamiquement à partir des métadonnées extraites.",
    "empty.suggestions": "Quelques idées de recherche",
    "empty.workflow": "Workflow en cours : recherche → enrichissement pages produits → matching cross-site → filtres dynamiques",

    // Logs
    "logs.title": "Logs",
    "logs.expand": "▼ cliquer pour réduire",
    "logs.collapse": "▲ cliquer pour étendre",
    "logs.level": "Niveau :",
    "logs.errors": "Errors",
    "logs.warnings": "Warnings",
    "logs.messages": "Messages",
    "logs.filterPlaceholder": "Filtrer par site (ex: bergzeit)",
    "logs.count": "{shown} / {total} logs affichés",
    "logs.clear": "Vider",
    "logs.clearTitle": "Vider le buffer de logs",
    "logs.empty": "Aucun log pour le moment. Lance une recherche pour voir les statuts par site.",

    // Language switcher
    "lang.label": "Langue",
  },

  en: {
    "header.subtitle": "Cross-site comparator · product matching",
    "header.tagline": "11 aggregated sites + cross-site matching by EAN/brand/similarity",
    "header.disclaimer": "Indicative data — always verify the final price on the merchant's site.",

    "search.placeholder": "Search for a product (e.g. Dynafit Speed Radical)",
    "search.aria": "Product search",
    "search.compare": "Compare",
    "search.suggestions": "Suggestions:",

    "groups.universe": "Universe:",
    "groups.manage": "Manage groups",
    "groups.manageTitle": "Manage groups (matrix view)",
    "groups.empty": "Group \"{name}\" is empty.",
    "groups.emptyHint": "This group currently contains no shops. Add shops via their plugins, or create a custom group with existing shops by clicking \"+ New group\".",
    "groups.custom": "Custom group",
    "groups.deleteConfirm": "Delete group \"{name}\"?",
    "groups.matrixTitle": "Manage groups",
    "groups.matrixDesc": "Matrix view: check the shops belonging to each group",
    "groups.shop": "Shop",
    "groups.delete": "delete",
    "groups.deleteTitle": "Delete this group",
    "groups.newGroup": "+ New group:",
    "groups.namePlaceholder": "Name (e.g. Triathlon)",
    "groups.emojiPlaceholder": "Emoji",
    "groups.create": "Create",
    "groups.hint": "A shop can belong to multiple groups (e.g. Decathlon in Outdoor + Cycling)",

    "sidebar.filters": "Filters",
    "sidebar.clear": "Clear",
    "sidebar.sort": "Sort",
    "sidebar.sortSiteCount": "Most sites",
    "sidebar.sortPriceAsc": "Price ascending",
    "sidebar.sortPriceDesc": "Price descending",
    "sidebar.sortSavings": "Max savings",
    "sidebar.sortRating": "Top rated",
    "sidebar.display": "Display",
    "sidebar.promosOnly": "On sale only",
    "sidebar.inStockOnly": "In stock only",
    "sidebar.priceRange": "Price range",
    "sidebar.priceMin": "min €",
    "sidebar.priceMax": "max €",
    "sidebar.priceMinAria": "Minimum price",
    "sidebar.priceMaxAria": "Maximum price",
    "sidebar.minSites": "Shops offering product: min {n}",
    "sidebar.exportCsv": "Export CSV ({n} products)",
    "sidebar.exportCategorized": "Debug categorized CSV ({n} products)",
    "sidebar.exportCategorizedTitle": "One row per product, with all classification metadata (sport, category, sub-cat, range, gender, EAN, match score, match reason). Only visible in dev-debug mode.",
    "sidebar.sites": "Sites ({selected}/{total})",
    "sidebar.shopFilter": "Filter shops…",
    "sidebar.shopFilterAria": "Filter shops",
    "sidebar.other": "Other",
    "sidebar.all": "All",
    "sidebar.none": "None",

    "filter.brands": "Brands",
    "filter.sports": "Sports",
    "filter.categories": "Categories",
    "filter.subcategories": "Sub-categories",
    "filter.range": "Range",
    "filter.gender": "Gender",
    "filter.colors": "Colors",
    "filter.sizes": "Sizes",

    "balloon.promos": "On sale",
    "balloon.inStock": "In stock",
    "balloon.minPrice": "Min {n}€",
    "balloon.maxPrice": "Max {n}€",
    "balloon.minSites": "Min {n} sites",
    "balloon.remove": "Remove filter \"{label}\"",

    "liveFilter.placeholder": "Filter displayed results (exact text, any field)…",
    "liveFilter.aria": "Filter displayed results",
    "liveFilter.clear": "Clear filter",

    "summary.query": "Query",
    "summary.matched": "Matched products",
    "summary.sitesResponding": "Responding sites",
    "summary.phases": "Phases",
    "summary.search": "Search",
    "summary.enrich": "Product page enrichment",
    "summary.match": "Cross-site matching",
    "summary.duration": "Total duration",
    "summary.cheapest": "Cheapest",

    "results.noProducts": "No products found for this selection.",
    "results.empty": "0 results",
    "results.blocked": "— blocked by Cloudflare (data-center IP not accepted). This site works from a residential IP.",
    "results.makaira": "— Makaira API returns 500 from data-center.",
    "results.antibot": "— anti-bot challenge not resolved, even with Playwright.",
    "results.tip": "Tip: deselect errored sites in the sidebar and re-run the search. Functional sites (Bergzeit, Sport Bittl, Ekosport, Montaz, Snowleader, Glisshop) return products in a few seconds.",
    "results.noMatch": "No product matches the current filters.",

    "product.promo": "Sale",
    "product.sites": "{n} site{s}",
    "product.offers": "{n} offer{s}",
    "product.ean": "EAN: {ean}",
    "product.from": "from",
    "product.saveUpTo": "save up to {amount}",
    "product.viewOffer": "View offer",
    "product.matchCriteria": "Matching criteria",
    "product.coloris": "{n} colors",
    "product.outOfStock": "· Out of stock",
    "product.inStock": "· In stock",

    "empty.title": "Outdoor price comparator with matching",
    "empty.desc": "Search in parallel across 9 outdoor shops. For each product, the engine fetches the product page, extracts metadata (brand, category, color, size, weight, EAN…), then groups cross-site offers into a single entry. Filters are built dynamically from the extracted metadata.",
    "empty.suggestions": "Some search ideas",
    "empty.workflow": "Workflow: search → product page enrichment → cross-site matching → dynamic filters",

    "logs.title": "Logs",
    "logs.expand": "▼ click to collapse",
    "logs.collapse": "▲ click to expand",
    "logs.level": "Level:",
    "logs.errors": "Errors",
    "logs.warnings": "Warnings",
    "logs.messages": "Messages",
    "logs.filterPlaceholder": "Filter by site (e.g. bergzeit)",
    "logs.count": "{shown} / {total} logs shown",
    "logs.clear": "Clear",
    "logs.clearTitle": "Clear log buffer",
    "logs.empty": "No logs yet. Run a search to see per-site statuses.",

    "lang.label": "Language",
  },

  es: {
    "header.subtitle": "Comparador multi-sitio · matching de productos",
    "header.tagline": "11 sitios agregados + matching por EAN/marca/similitud",
    "header.disclaimer": "Datos indicativos — verifica siempre el precio final en el sitio del comerciante.",

    "search.placeholder": "Buscar un producto (ej. Dynafit Speed Radical)",
    "search.aria": "Búsqueda de producto",
    "search.compare": "Comparar",
    "search.suggestions": "Sugerencias:",

    "groups.universe": "Universo:",
    "groups.manage": "Gestionar grupos",
    "groups.manageTitle": "Gestionar grupos (vista matriz)",
    "groups.empty": "Grupo «{name}» vacío.",
    "groups.emptyHint": "Este grupo no contiene actualmente ninguna tienda. Añade tiendas con sus plugins, o crea un grupo personalizado con las tiendas existentes haciendo clic en «+ Nuevo grupo».",
    "groups.custom": "Grupo personalizado",
    "groups.deleteConfirm": "¿Eliminar el grupo «{name}»?",
    "groups.matrixTitle": "Gestionar grupos",
    "groups.matrixDesc": "Vista matricial: marca las tiendas de cada grupo",
    "groups.shop": "Tienda",
    "groups.delete": "eliminar",
    "groups.deleteTitle": "Eliminar este grupo",
    "groups.newGroup": "+ Nuevo grupo:",
    "groups.namePlaceholder": "Nombre (ej: Triatlón)",
    "groups.emojiPlaceholder": "Emoji",
    "groups.create": "Crear",
    "groups.hint": "Una tienda puede pertenecer a varios grupos (ej: Decathlon en Outdoor + Cycling)",

    "sidebar.filters": "Filtros",
    "sidebar.clear": "Borrar",
    "sidebar.sort": "Ordenar",
    "sidebar.sortSiteCount": "Más sitios",
    "sidebar.sortPriceAsc": "Precio ascendente",
    "sidebar.sortPriceDesc": "Precio descendente",
    "sidebar.sortSavings": "Max ahorro",
    "sidebar.sortRating": "Mejor valorados",
    "sidebar.display": "Vista",
    "sidebar.promosOnly": "Solo ofertas",
    "sidebar.inStockOnly": "Solo en stock",
    "sidebar.priceRange": "Rango de precio",
    "sidebar.priceMin": "min €",
    "sidebar.priceMax": "max €",
    "sidebar.priceMinAria": "Precio mínimo",
    "sidebar.priceMaxAria": "Precio máximo",
    "sidebar.minSites": "Tiendas con producto: mín {n}",
    "sidebar.exportCsv": "Exportar CSV ({n} productos)",
    "sidebar.exportCategorized": "Debug CSV categorizado ({n} productos)",
    "sidebar.exportCategorizedTitle": "Una fila por producto, con todos los metadatos de clasificación. Solo visible en modo dev-debug.",
    "sidebar.sites": "Sitios ({selected}/{total})",
    "sidebar.shopFilter": "Filtrar tiendas…",
    "sidebar.shopFilterAria": "Filtrar tiendas",
    "sidebar.other": "Otros",
    "sidebar.all": "Todos",
    "sidebar.none": "Ninguno",

    "filter.brands": "Marcas",
    "filter.sports": "Deportes",
    "filter.categories": "Categorías",
    "filter.subcategories": "Subcategorías",
    "filter.range": "Gama",
    "filter.gender": "Género",
    "filter.colors": "Colores",
    "filter.sizes": "Tallas",

    "balloon.promos": "Ofertas",
    "balloon.inStock": "En stock",
    "balloon.minPrice": "Mín {n}€",
    "balloon.maxPrice": "Máx {n}€",
    "balloon.minSites": "Mín {n} sitios",
    "balloon.remove": "Quitar filtro \"{label}\"",

    "liveFilter.placeholder": "Filtrar resultados mostrados (texto exacto, cualquier campo)…",
    "liveFilter.aria": "Filtrar resultados mostrados",
    "liveFilter.clear": "Borrar filtro",

    "summary.query": "Consulta",
    "summary.matched": "Productos matchados",
    "summary.sitesResponding": "Sitios respondiendo",
    "summary.phases": "Fases",
    "summary.search": "Búsqueda",
    "summary.enrich": "Enriquecimiento de páginas",
    "summary.match": "Matching cross-site",
    "summary.duration": "Duración total",
    "summary.cheapest": "Más barato",

    "results.noProducts": "Ningún producto encontrado para esta selección.",
    "results.empty": "0 resultados",
    "results.blocked": "— bloqueado por Cloudflare (IP data-center no aceptada). Funciona desde una IP residencial.",
    "results.makaira": "— API Makaira responde 500 desde el data-center.",
    "results.antibot": "— challenge anti-bot no resuelto, incluso con Playwright.",
    "results.tip": "Consejo: deselecciona los sitios con error y vuelve a buscar. Los sitios funcionales devuelven productos en segundos.",
    "results.noMatch": "Ningún producto coincide con los filtros actuales.",

    "product.promo": "Oferta",
    "product.sites": "{n} sitio{s}",
    "product.offers": "{n} oferta{s}",
    "product.ean": "EAN: {ean}",
    "product.from": "desde",
    "product.saveUpTo": "ahorra hasta {amount}",
    "product.viewOffer": "Ver oferta",
    "product.matchCriteria": "Criterios de matching",
    "product.coloris": "{n} colores",
    "product.outOfStock": "· Agotado",
    "product.inStock": "· En stock",

    "empty.title": "Comparador de precios outdoor con matching",
    "empty.desc": "Busca en paralelo en 9 tiendas outdoor. Para cada producto, el motor obtiene la página, extrae metadatos (marca, categoría, color, talla, peso, EAN…), luego agrupa ofertas cross-site en una sola entrada. Los filtros se construyen dinámicamente.",
    "empty.suggestions": "Algunas ideas de búsqueda",
    "empty.workflow": "Workflow: búsqueda → enriquecimiento → matching → filtros dinámicos",

    "logs.title": "Logs",
    "logs.expand": "▼ clic para contraer",
    "logs.collapse": "▲ clic para expandir",
    "logs.level": "Nivel:",
    "logs.errors": "Errores",
    "logs.warnings": "Avisos",
    "logs.messages": "Mensajes",
    "logs.filterPlaceholder": "Filtrar por sitio (ej: bergzeit)",
    "logs.count": "{shown} / {total} logs mostrados",
    "logs.clear": "Vaciar",
    "logs.clearTitle": "Vaciar buffer de logs",
    "logs.empty": "Sin logs todavía. Lanza una búsqueda para ver estados por sitio.",

    "lang.label": "Idioma",
  },

  de: {
    "header.subtitle": "Cross-Site-Vergleich · Produkt-Matching",
    "header.tagline": "11 aggregierte Shops + Cross-Site-Matching nach EAN/Marke/Ähnlichkeit",
    "header.disclaimer": "Richtwerte — überprüfen Sie immer den Endpreis auf der Händlerseite.",

    "search.placeholder": "Produkt suchen (z.B. Dynafit Speed Radical)",
    "search.aria": "Produktsuche",
    "search.compare": "Vergleichen",
    "search.suggestions": "Vorschläge:",

    "groups.universe": "Bereich:",
    "groups.manage": "Gruppen verwalten",
    "groups.manageTitle": "Gruppen verwalten (Matrix-Ansicht)",
    "groups.empty": "Gruppe «{name}» ist leer.",
    "groups.emptyHint": "Diese Gruppe enthält derzeit keine Shops. Fügen Sie Shops über die entsprechenden Plugins hinzu oder erstellen Sie eine benutzerdefinierte Gruppe mit den vorhandenen Shops, indem Sie auf «+ Neue Gruppe» klicken.",
    "groups.custom": "Benutzerdefinierte Gruppe",
    "groups.deleteConfirm": "Gruppe «{name}» löschen?",
    "groups.matrixTitle": "Gruppen verwalten",
    "groups.matrixDesc": "Matrix-Ansicht: aktivieren Sie die Shops jeder Gruppe",
    "groups.shop": "Shop",
    "groups.delete": "löschen",
    "groups.deleteTitle": "Diese Gruppe löschen",
    "groups.newGroup": "+ Neue Gruppe:",
    "groups.namePlaceholder": "Name (z.B. Triathlon)",
    "groups.emojiPlaceholder": "Emoji",
    "groups.create": "Erstellen",
    "groups.hint": "Ein Shop kann zu mehreren Gruppen gehören (z.B. Decathlon in Outdoor + Cycling)",

    "sidebar.filters": "Filter",
    "sidebar.clear": "Löschen",
    "sidebar.sort": "Sortierung",
    "sidebar.sortSiteCount": "Meiste Shops",
    "sidebar.sortPriceAsc": "Preis aufsteigend",
    "sidebar.sortPriceDesc": "Preis absteigend",
    "sidebar.sortSavings": "Max. Ersparnis",
    "sidebar.sortRating": "Top bewertet",
    "sidebar.display": "Ansicht",
    "sidebar.promosOnly": "Nur Angebote",
    "sidebar.inStockOnly": "Nur auf Lager",
    "sidebar.priceRange": "Preisbereich",
    "sidebar.priceMin": "min €",
    "sidebar.priceMax": "max €",
    "sidebar.priceMinAria": "Mindestpreis",
    "sidebar.priceMaxAria": "Höchstpreis",
    "sidebar.minSites": "Shops mit Produkt: min {n}",
    "sidebar.exportCsv": "CSV exportieren ({n} Produkte)",
    "sidebar.exportCategorized": "Debug kategorisierte CSV ({n} Produkte)",
    "sidebar.exportCategorizedTitle": "Eine Zeile pro Produkt mit allen Klassifizierungs-Metadaten. Nur im dev-debug-Modus sichtbar.",
    "sidebar.sites": "Shops ({selected}/{total})",
    "sidebar.shopFilter": "Shops filtern…",
    "sidebar.shopFilterAria": "Shops filtern",
    "sidebar.other": "Andere",
    "sidebar.all": "Alle",
    "sidebar.none": "Keine",

    "filter.brands": "Marken",
    "filter.sports": "Sportarten",
    "filter.categories": "Kategorien",
    "filter.subcategories": "Unterkategorien",
    "filter.range": "Klasse",
    "filter.gender": "Geschlecht",
    "filter.colors": "Farben",
    "filter.sizes": "Größen",

    "balloon.promos": "Angebote",
    "balloon.inStock": "Auf Lager",
    "balloon.minPrice": "Min {n}€",
    "balloon.maxPrice": "Max {n}€",
    "balloon.minSites": "Min {n} Shops",
    "balloon.remove": "Filter \"{label}\" entfernen",

    "liveFilter.placeholder": "Angezeigte Ergebnisse filtern (Exakter Text, jedes Feld)…",
    "liveFilter.aria": "Angezeigte Ergebnisse filtern",
    "liveFilter.clear": "Filter löschen",

    "summary.query": "Anfrage",
    "summary.matched": "Gematchte Produkte",
    "summary.sitesResponding": "Antwortende Shops",
    "summary.phases": "Phasen",
    "summary.search": "Suche",
    "summary.enrich": "Produktseiten-Anreicherung",
    "summary.match": "Cross-Site-Matching",
    "summary.duration": "Gesamtdauer",
    "summary.cheapest": "Günstigster",

    "results.noProducts": "Keine Produkte für diese Auswahl gefunden.",
    "results.empty": "0 Ergebnisse",
    "results.blocked": "— durch Cloudflare blockiert (Data-Center-IP nicht akzeptiert). Funktioniert von einer privaten IP.",
    "results.makaira": "— Makaira API antwortet 500 vom Data-Center.",
    "results.antibot": "— Anti-Bot-Challenge ungelöst, auch mit Playwright.",
    "results.tip": "Tipp: deaktivieren Sie fehlerhafte Shops in der Seitenleiste und suchen Sie erneut. Funktionierende Shops liefern Produkte in Sekunden.",
    "results.noMatch": "Kein Produkt passt zu den aktuellen Filtern.",

    "product.promo": "Angebot",
    "product.sites": "{n} Shop{s}",
    "product.offers": "{n} Angebot{e}",
    "product.ean": "EAN: {ean}",
    "product.from": "ab",
    "product.saveUpTo": "sparen Sie bis zu {amount}",
    "product.viewOffer": "Angebot ansehen",
    "product.matchCriteria": "Matching-Kriterien",
    "product.coloris": "{n} Farben",
    "product.outOfStock": "· Ausverkauft",
    "product.inStock": "· Auf Lager",

    "empty.title": "Outdoor-Preisvergleich mit Matching",
    "empty.desc": "Parallel auf 9 Outdoor-Shops suchen. Für jedes Produkt lädt der Motor die Produktseite, extrahiert Metadaten (Marke, Kategorie, Farbe, Größe, Gewicht, EAN…), und gruppiert Cross-Site-Angebote zu einem Eintrag. Filter werden dynamisch aus den Metadaten erstellt.",
    "empty.suggestions": "Einige Suchideen",
    "empty.workflow": "Workflow: Suche → Anreicherung → Cross-Site-Matching → dynamische Filter",

    "logs.title": "Logs",
    "logs.expand": "▼ klicken zum Einklappen",
    "logs.collapse": "▲ klicken zum Ausklappen",
    "logs.level": "Stufe:",
    "logs.errors": "Fehler",
    "logs.warnings": "Warnungen",
    "logs.messages": "Meldungen",
    "logs.filterPlaceholder": "Nach Shop filtern (z.B. bergzeit)",
    "logs.count": "{shown} / {total} Logs angezeigt",
    "logs.clear": "Leeren",
    "logs.clearTitle": "Log-Puffer leeren",
    "logs.empty": "Noch keine Logs. Starten Sie eine Suche, um Shop-Status zu sehen.",

    "lang.label": "Sprache",
  },
};

interface LangContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const LangContext = createContext<LangContextValue>({
  lang: "fr",
  setLang: () => {},
  t: (key) => key,
});

export function LangProvider({ children }: { children: ReactNode }) {
  // Lazy init from localStorage — avoids set-state-in-effect ESLint warning.
  const [lang, setLangState] = useState<Lang>(() => {
    if (typeof window === "undefined") return "fr";
    const stored = localStorage.getItem(STORAGE_KEY) as Lang | null;
    return stored && ["fr", "en", "es", "de"].includes(stored) ? stored : "fr";
  });

  const setLang = (l: Lang) => {
    setLangState(l);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, l);
    }
  };

  const t = (key: string, params?: Record<string, string | number>): string => {
    const dict = TRANSLATIONS[lang] ?? TRANSLATIONS.fr;
    let str = dict[key] ?? TRANSLATIONS.fr[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        str = str.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
      }
    }
    // Handle simple pluralization: {n} word{s} → "1 word" or "2 words"
    // Pattern: {n} word{s} where {s} expands to "s" if n > 1, "" if n === 1
    str = str.replace(/\{(\w+)\}(\w+)\{(\w+)\}/g, (_, countKey, singular, plural) => {
      const count = params?.[countKey];
      const n = typeof count === "number" ? count : 1;
      return `${n} ${n !== 1 ? plural : singular}`;
    });
    return str;
  };

  return (
    <LangContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang() {
  return useContext(LangContext);
}

export const LANG_LABELS: Record<Lang, string> = {
  fr: "FR",
  en: "EN",
  es: "ES",
  de: "DE",
};

export const LANG_FLAGS: Record<Lang, string> = {
  fr: "🇫🇷",
  en: "🇬🇧",
  es: "🇪🇸",
  de: "🇩🇪",
};
