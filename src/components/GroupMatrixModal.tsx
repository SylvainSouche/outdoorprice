// Group matrix editor modal — lets the user toggle which shops belong to
// which groups, create new custom groups, and delete custom groups.
//
// Extracted from src/app/page.tsx (P1.1 refactor). Pure presentational
// component — takes {groups, onGroupsChange, onClose} props, manages only
// its own local "new group name/icon" input state.
"use client";

import { useState } from "react";
import { Layers, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SITES, type SiteId, type ShopGroup } from "@/lib/scraper/types";
import { ALL_SITE_IDS } from "@/lib/scraper/groups";
import { useLang } from "@/lib/i18n";

export function GroupMatrixModal({
  groups,
  onGroupsChange,
  onClose,
}: {
  groups: ShopGroup[];
  onGroupsChange: (next: ShopGroup[]) => void;
  onClose: () => void;
}) {
  const { t } = useLang();
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupIcon, setNewGroupIcon] = useState("");

  // Groupes éditables = tous sauf "all" (qui est implicite)
  const editableGroups = groups.filter((g) => g.id !== "all");

  // Helper : vérifie si un site est dans un groupe
  const isSiteInGroup = (siteId: SiteId, group: ShopGroup): boolean => {
    return group.sites.includes(siteId);
  };

  // Toggle : ajoute ou retire un site d'un groupe
  const toggleSiteInGroup = (siteId: SiteId, groupId: string) => {
    const next = groups.map((g) => {
      if (g.id !== groupId) return g;
      const sites = new Set(g.sites);
      if (sites.has(siteId)) sites.delete(siteId);
      else sites.add(siteId);
      return { ...g, sites: Array.from(sites) };
    });
    onGroupsChange(next);
  };

  // Crée un nouveau groupe custom
  const addCustomGroup = () => {
    const name = newGroupName.trim();
    if (!name) return;
    const id = `custom-${Date.now().toString(36)}`;
    const newGroup: ShopGroup = {
      id,
      name,
      icon: newGroupIcon.trim() || undefined,
      description: "Groupe personnalisé",
      accent: "bg-stone-100 text-stone-800 border-stone-300",
      sites: [],
      builtin: false,
    };
    onGroupsChange([...groups, newGroup]);
    setNewGroupName("");
    setNewGroupIcon("");
  };

  // Supprime un groupe custom (uniquement les custom — pas les builtin)
  const removeGroup = (groupId: string) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group || group.builtin) return;
    if (!confirm(`Supprimer le groupe « ${group.name} » ?`)) return;
    onGroupsChange(groups.filter((g) => g.id !== groupId));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-2xl max-w-5xl w-full max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-stone-200">
          <Layers className="h-5 w-5 text-stone-700" />
          <h2 className="text-base font-semibold text-stone-900">{t('groups.manage')}</h2>
          <span className="text-xs text-stone-500">
            Vue matricielle : cochez les boutiques appartenant à chaque groupe
          </span>
          <button
            onClick={onClose}
            className="ml-auto text-stone-500 hover:text-stone-700"
            title={t("groups.close")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Matrix */}
        <div className="overflow-auto flex-1 p-5">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b-2 border-stone-300">
                <th className="text-left px-2 py-2 text-xs font-semibold text-stone-700 sticky left-0 bg-white">
                  Boutique
                </th>
                {editableGroups.map((g) => (
                  <th key={g.id} className="px-2 py-2 text-center min-w-[100px]">
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-base">{g.icon ?? "•"}</span>
                      <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${g.accent ?? ""}`}>
                        {g.name}
                      </span>
                      <span className="text-[10px] text-stone-500">
                        {g.sites.length} site{g.sites.length !== 1 ? "s" : ""}
                      </span>
                      {!g.builtin && (
                        <button
                          onClick={() => removeGroup(g.id)}
                          className="text-[10px] text-rose-500 hover:text-rose-700 mt-0.5"
                          title="Supprimer ce groupe"
                        >
                          supprimer
                        </button>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ALL_SITE_IDS.map((siteId, idx) => {
                const meta = SITES[siteId];
                return (
                  <tr key={siteId} className={idx % 2 === 0 ? "bg-stone-50" : "bg-white"}>
                    <td className={`px-2 py-1.5 text-xs sticky left-0 ${idx % 2 === 0 ? "bg-stone-50" : "bg-white"}`}>
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] ${meta.accent}`}>
                        {meta.name}
                      </span>
                      <span className="text-[10px] text-stone-400 ml-1">{meta.country}</span>
                    </td>
                    {editableGroups.map((g) => {
                      const checked = isSiteInGroup(siteId, g);
                      return (
                        <td key={g.id} className="px-2 py-1.5 text-center">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSiteInGroup(siteId, g.id)}
                            className="h-4 w-4 cursor-pointer accent-stone-700"
                            title={`${checked ? "Retirer" : "Ajouter"} ${meta.name} ${checked ? "de" : "à"} ${g.name}`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer : créer un nouveau groupe */}
        <div className="border-t border-stone-200 px-5 py-3 bg-stone-50 flex items-center gap-2">
          <span className="text-xs text-stone-600 font-medium">+ Nouveau groupe :</span>
          <input
            type="text"
            placeholder="Nom (ex: Triathlon)"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            className="px-2 py-1 text-xs border border-stone-300 rounded w-40"
            onKeyDown={(e) => { if (e.key === "Enter") addCustomGroup(); }}
          />
          <input
            type="text"
            placeholder="Emoji"
            value={newGroupIcon}
            onChange={(e) => setNewGroupIcon(e.target.value)}
            className="px-2 py-1 text-xs border border-stone-300 rounded w-16 text-center"
            maxLength={4}
          />
          <Button
            size="sm"
            onClick={addCustomGroup}
            disabled={!newGroupName.trim()}
            className="h-7 text-xs"
          >
            Créer
          </Button>
          <span className="ml-auto text-[11px] text-stone-500">
            Une boutique peut appartenir à plusieurs groupes (ex: Decathlon dans Outdoor + Cycling)
          </span>
        </div>
      </div>
    </div>
  );
}
