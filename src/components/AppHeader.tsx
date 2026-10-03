// AppHeader — sticky top bar with:
//   - Logo + version
//   - Search input + submit button
//   - Language switcher (FR/EN/ES/DE)
//   - Suggestion chips (shown after first search)
//   - Group selector pills (Outdoor / Cycling / All + custom groups)
//
// Reads ALL state from useSearchState() context — no props.
// The only local state is the GroupMatrixModal visibility (via context).
"use client";

import { Search, Loader2, Mountain } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useLang, LANG_LABELS, type Lang } from "@/lib/i18n";
import { SUGGESTIONS } from "@/config";
import { VERSION } from "@/lib/version";
import { useSearchState } from "@/lib/search-state";
import { GroupMatrixModal } from "@/components/GroupMatrixModal";

export function AppHeader() {
  const {
    query, setQuery, submittedQuery, isFetching,
    onSubmit, handleSuggestion,
    groups, activeGroupId, selectGroup,
    showGroupEditor, setShowGroupEditor, persistGroups,
  } = useSearchState();
  const { t, lang, setLang } = useLang();

  return (
    <header className="sticky top-0 z-30 border-b border-stone-200 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/70">
      {/* Row 1: logo + search + language */}
      <div className="mx-auto max-w-7xl px-4 py-3 flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="grid place-items-center h-9 w-9 rounded-lg bg-stone-900 text-white">
            <Mountain className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <div className="font-semibold tracking-tight">
              OutdoorPrice
              <span className="ml-1.5 font-mono text-[10px] font-normal text-stone-400 align-middle">v{VERSION}</span>
            </div>
            <div className="text-[11px] text-stone-500 -mt-0.5">
              Comparateur cross-site · matching produits
            </div>
          </div>
        </div>
        <form onSubmit={onSubmit} className="ml-auto flex items-center gap-2 flex-1 max-w-xl">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("search.placeholder")}
              className="pl-9 bg-white"
              aria-label={t("search.aria")}
            />
          </div>
          <Button type="submit" disabled={query.trim().length < 2 || isFetching}>
            {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            <span className="hidden sm:inline ml-1">{t("search.compare")}</span>
          </Button>
        </form>
        {/* Language switcher */}
        <div className="flex items-center gap-0.5 shrink-0">
          {(["fr", "en", "es", "de"] as Lang[]).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={`px-1.5 py-1 text-[11px] font-semibold rounded transition-colors ${
                lang === l
                  ? "bg-stone-900 text-white"
                  : "text-stone-500 hover:text-stone-900 hover:bg-stone-100"
              }`}
              aria-label={l.toUpperCase()}
            >
              {LANG_LABELS[l]}
            </button>
          ))}
        </div>
      </div>

      {/* Suggestion chips */}
      {submittedQuery && (
        <div className="mx-auto max-w-7xl px-4 pb-3 -mt-1 flex flex-wrap gap-2 items-center text-xs">
          <span className="text-stone-500">{t('search.suggestions')}</span>
          {SUGGESTIONS.slice(0, 6).map((s) => (
            <button
              key={s}
              onClick={() => handleSuggestion(s)}
              className="px-2 py-1 rounded-full bg-stone-100 hover:bg-stone-200 transition border border-stone-200 text-stone-700"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Row 2: group selector */}
      <div className="border-b border-stone-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-2 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] uppercase tracking-wide text-stone-500 mr-1">
            Univers :
          </span>
          {groups.map((g) => {
            const isActive = g.id === activeGroupId;
            return (
              <button
                key={g.id}
                onClick={() => selectGroup(g.id)}
                className={`px-2.5 py-1 rounded-full text-xs border transition flex items-center gap-1.5 ${
                  isActive
                    ? "bg-stone-900 text-white border-stone-900"
                    : `bg-white text-stone-700 border-stone-200 hover:border-stone-400 ${g.accent ?? ""}`
                }`}
                title={g.description ?? g.name}
              >
                {g.icon && <span className="text-[13px]">{g.icon}</span>}
                <span className="font-medium">{g.name}</span>
                <span className={`text-[10px] ${isActive ? "opacity-70" : "opacity-60"}`}>
                  ({g.sites.length})
                </span>
              </button>
            );
          })}
          <button
            onClick={() => setShowGroupEditor(true)}
            className="ml-auto px-2 py-1 rounded-full text-[11px] text-stone-600 hover:bg-stone-100 transition border border-stone-200"
            title={t("groups.manageTitle")}
          >
            Gérer les groupes
          </button>
        </div>
        {showGroupEditor && (
          <GroupMatrixModal
            groups={groups}
            onGroupsChange={persistGroups}
            onClose={() => setShowGroupEditor(false)}
          />
        )}
      </div>
    </header>
  );
}
