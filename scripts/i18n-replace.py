#!/usr/bin/env python3
"""
Bulk-replace hardcoded French strings in page.tsx with t() calls.
"""
import re
from pathlib import Path

PAGE = Path("/home/z/my-project/src/app/page.tsx")
content = PAGE.read_text()

count = 0

def replace(old, new):
    global content, count
    if old in content:
        content = content.replace(old, new)
        count += 1

# --- Simple text replacements (JSX text between tags: >text<) ---
text_replacements = [
    (">Comparateur cross-site · matching produits<", ">{t('header.subtitle')}<"),
    (">Suggestions :<", ">{t('search.suggestions')}<"),
    (">Univers :<", ">{t('groups.universe')}<"),
    (">Filtres<", ">{t('sidebar.filters')}<"),
    (">Effacer<", ">{t('sidebar.clear')}<"),
    (">Tri<", ">{t('sidebar.sort')}<"),
    (">Affichage<", ">{t('sidebar.display')}<"),
    (">Promos uniquement<", ">{t('sidebar.promosOnly')}<"),
    (">En stock uniquement<", ">{t('sidebar.inStockOnly')}<"),
    (">Fourchette de prix<", ">{t('sidebar.priceRange')}<"),
    (">Autres<", ">{t('sidebar.other')}<"),
    (">Tout<", ">{t('sidebar.all')}<"),
    (">Aucun<", ">{t('sidebar.none')}<"),
    (">Promos<", ">{t('balloon.promos')}<"),
    (">En stock<", ">{t('balloon.inStock')}<"),
    (">Requête<", ">{t('summary.query')}<"),
    (">Produits matchés<", ">{t('summary.matched')}<"),
    (">Sites répondants<", ">{t('summary.sitesResponding')}<"),
    (">Phases<", ">{t('summary.phases')}<"),
    (">Durée totale<", ">{t('summary.duration')}<"),
    (">Moins cher<", ">{t('summary.cheapest')}<"),
    (">Promo<", ">{t('product.promo')}<"),
    (">Voir l'offre<", ">{t('product.viewOffer')}<"),
    (">Logs<", ">{t('logs.title')}<"),
    (">Niveau :<", ">{t('logs.level')}<"),
    (">Errors<", ">{t('logs.errors')}<"),
    (">Warnings<", ">{t('logs.warnings')}<"),
    (">Messages<", ">{t('logs.messages')}<"),
    (">Vider<", ">{t('logs.clear')}<"),
    (">Plus de sites<", ">{t('sidebar.sortSiteCount')}<"),
    (">Prix croissant<", ">{t('sidebar.sortPriceAsc')}<"),
    (">Prix décroissant<", ">{t('sidebar.sortPriceDesc')}<"),
    (">Économie max<", ">{t('sidebar.sortSavings')}<"),
    (">Mieux notés<", ">{t('sidebar.sortRating')}<"),
    (">Gérer les groupes<", ">{t('groups.manage')}<"),
    (">0 résultat<", ">{t('results.empty')}<"),
]
for old, new in text_replacements:
    replace(old, new)

# --- Attribute replacements ---
attr_replacements = [
    ('placeholder="Rechercher un produit (ex. Dynafit Speed Radical)"',
     'placeholder={t("search.placeholder")}'),
    ('aria-label="Recherche produit"',
     'aria-label={t("search.aria")}'),
    ('placeholder="min €"',
     'placeholder={t("sidebar.priceMin")}'),
    ('placeholder="max €"',
     'placeholder={t("sidebar.priceMax")}'),
    ('aria-label="Prix minimum"',
     'aria-label={t("sidebar.priceMinAria")}'),
    ('aria-label="Prix maximum"',
     'aria-label={t("sidebar.priceMaxAria")}'),
    ('placeholder="Filtrer les boutiques…"',
     'placeholder={t("sidebar.shopFilter")}'),
    ('aria-label="Filtrer les boutiques"',
     'aria-label={t("sidebar.shopFilterAria")}'),
    ('title="Marques"', 'title={t("filter.brands")}'),
    ('title="Sports"', 'title={t("filter.sports")}'),
    ('title="Catégories"', 'title={t("filter.categories")}'),
    ('title="Sous-catégories"', 'title={t("filter.subcategories")}'),
    ('title="Gamme"', 'title={t("filter.range")}'),
    ('title="Genre"', 'title={t("filter.gender")}'),
    ('title="Couleurs"', 'title={t("filter.colors")}'),
    ('title="Tailles"', 'title={t("filter.sizes")}'),
    ('title="Gérer les groupes (matrix view)"',
     'title={t("groups.manageTitle")}'),
    ('title="Vider le buffer de logs"',
     'title={t("logs.clearTitle")}'),
    ('placeholder="Filtrer par site (ex: bergzeit)"',
     'placeholder={t("logs.filterPlaceholder")}'),
    ('aria-label="Effacer le filtre"',
     'aria-label={t("liveFilter.clear")}'),
]
for old, new in attr_replacements:
    replace(old, new)

# --- Special multi-line / template replacements ---
replace(
    "Aucun produit ne correspond aux filtres actuels.",
    "{t('results.noMatch')}"
)
replace(
    "Aucun produit trouvé pour cette sélection.",
    "{t('results.noProducts')}"
)
replace(
    "Comparateur de prix outdoor avec matching",
    "{t('empty.title')}"
)
replace(
    "Quelques idées de recherche",
    "{t('empty.suggestions')}"
)
replace(
    "Workflow en cours : recherche \u2192 enrichissement pages produits \u2192 matching cross-site \u2192 filtres dynamiques",
    "{t('empty.workflow')}"
)
replace(
    "Aucun log pour le moment. Lance une recherche pour voir les statuts par site.",
    "{t('logs.empty')}"
)
replace(
    "\u25bc cliquer pour r\u00e9duire",
    "\u25bc {t('logs.expand')}"
)
replace(
    "\u25b2 cliquer pour \u00e9tendre",
    "\u25b2 {t('logs.collapse')}"
)

# Handle the live filter placeholder (has apostrophe)
replace(
    'placeholder="Filtrer les r\u00e9sultats affich\u00e9s (texte exact, n\'importe quel champ)\u2026"',
    'placeholder={t("liveFilter.placeholder")}'
)
replace(
    'aria-label="Filtrer les r\u00e9sultats affich\u00e9s"',
    'aria-label={t("liveFilter.aria")}'
)

# Handle "title=Fermer"
replace('title="Fermer"', 'title={t("groups.close")}')

PAGE.write_text(content)
print(f"Replaced {count} strings (+ special cases)")
