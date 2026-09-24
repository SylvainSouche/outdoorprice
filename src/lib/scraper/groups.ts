// Groupes de boutiques : prédéfinis (outdoor, cycling, IT) + persistance
// localStorage pour les groupes utilisateur.
//
// Depuis le refactor drop-in (v0.12+), les appartenances aux groupes sont
// déclarées DANS chaque fichier scraper via `site.groups: ["cycling"]`.
// Ce fichier ne fait que :
//   - déclarer les MÉTADONNÉES des groupes builtin (nom, icône, accent)
//   - dériver les listes de sites depuis SCRAPERS (plus de liste en dur)
//
// Cas d'usage :
//   - L'utilisateur sélectionne « Outdoor » → toutes les boutiques avec
//     `groups: ["outdoor"]` sont chargées
//   - Il bascule sur « Cycling » → toutes les boutiques avec `groups: ["cycling"]`
//   - Il peut créer un groupe « Triathlon » custom avec 3 boutiques dont 1
//     aussi dans « Outdoor » (chevauchement autorisé)
import { SITES, type SiteId, type ShopGroup } from "./types";

/** Tous les SiteId actuellement inscrits dans le registry. */
export const ALL_SITE_IDS = Object.keys(SITES) as SiteId[];

/** Métadonnées des groupes builtin (SANS les sites — ils sont dérivés). */
const BUILTIN_GROUP_META: Omit<ShopGroup, "sites">[] = [
  {
    id: "all",
    name: "Toutes",
    description: "Toutes les boutiques installées",
    icon: "*",
    accent: "bg-stone-200 text-stone-800 border-stone-300",
    builtin: true,
  },
  {
    id: "outdoor",
    name: "Outdoor",
    description: "Randonnée, ski, alpinisme, trail",
    icon: "⛰",
    accent: "bg-lime-100 text-lime-800 border-lime-300",
    builtin: true,
  },
  {
    id: "cycling",
    name: "Cycling",
    description: "Cyclisme route, VTT, gravel",
    icon: "🚴",
    accent: "bg-blue-100 text-blue-800 border-blue-300",
    builtin: true,
  },
  {
    id: "it",
    name: "IT",
    description: "Informatique, électronique, hardware",
    icon: "💻",
    accent: "bg-purple-100 text-purple-800 border-purple-300",
    builtin: true,
  },
];

/** Construit les groupes builtin en dérivant les listes de sites depuis
 *  `site.groups` déclaré dans chaque fichier scraper. */
function buildBuiltinGroups(): ShopGroup[] {
  return BUILTIN_GROUP_META.map((meta) => {
    if (meta.id === "all") {
      return { ...meta, sites: ALL_SITE_IDS };
    }
    // Pour les autres groupes, collecter les sites qui déclarent ce groupe
    const sites = ALL_SITE_IDS.filter((id) => SITES[id]?.groups?.includes(meta.id));
    return {
      ...meta,
      sites,
      description: `${meta.description} (${sites.length} boutique${sites.length > 1 ? "s" : ""})`,
    };
  });
}

/** Groupes prédéfinis (builtin=true, non éditables). */
export const DEFAULT_GROUPS: ShopGroup[] = buildBuiltinGroups();

/** Clé localStorage pour les groupes utilisateur (custom). */
export const CUSTOM_GROUPS_STORAGE_KEY = "outdoorprice:custom-groups:v1";

/** Charge les groupes utilisateur depuis localStorage (côté client uniquement).
 *  En cas d'erreur de parsing, retourne []. */
export function loadCustomGroups(): ShopGroup[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_GROUPS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((g: unknown): g is ShopGroup => {
        if (!g || typeof g !== "object") return false;
        const obj = g as Record<string, unknown>;
        return typeof obj.id === "string" && typeof obj.name === "string"
          && Array.isArray(obj.sites);
      })
      .map((g) => ({
        ...g,
        builtin: false,
        sites: g.sites.filter((s: SiteId) => ALL_SITE_IDS.includes(s)),
      }));
  } catch {
    return [];
  }
}

/** Sauvegarde les groupes utilisateur dans localStorage. */
export function saveCustomGroups(groups: ShopGroup[]): void {
  if (typeof window === "undefined") return;
  const custom = groups.filter((g) => !g.builtin);
  window.localStorage.setItem(CUSTOM_GROUPS_STORAGE_KEY, JSON.stringify(custom));
}

/** Retourne la liste complète des groupes : prédéfinis + custom. */
export function getAllGroups(): ShopGroup[] {
  return [...DEFAULT_GROUPS, ...loadCustomGroups()];
}

/** Trouve un groupe par id. Cherche d'abord dans les prédéfinis, puis custom. */
export function findGroup(groups: ShopGroup[], id: string): ShopGroup | undefined {
  return groups.find((g) => g.id === id);
}

/** Renvoie les SiteId d'un groupe, ou ALL_SITE_IDS si groupe « all » ou introuvable. */
export function getSitesForGroup(groups: ShopGroup[], groupId: string): SiteId[] {
  if (groupId === "all") return ALL_SITE_IDS;
  const group = findGroup(groups, groupId);
  if (!group) return ALL_SITE_IDS;
  return group.sites.filter((s) => ALL_SITE_IDS.includes(s));
}

/** Valide une liste de SiteId et ne renvoie que ceux qui sont connus. */
export function sanitizeSiteIds(sites: unknown): SiteId[] {
  if (!Array.isArray(sites)) return [];
  return sites.filter((s): s is SiteId =>
    typeof s === "string" && (ALL_SITE_IDS as string[]).includes(s)
  );
}
