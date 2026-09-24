"use client";
import { Mountain, Search, Download, Layers } from "lucide-react";
import { SUGGESTIONS } from "@/config";
import { useLang } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n";

export function Header({
  query,
  setQuery,
  onSubmit,
  isFetching,
  submittedQuery,
  onSuggestion,
  lang,
  setLang,
}: {
  query: string;
  setQuery: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  isFetching: boolean;
  submittedQuery: string;
  onSuggestion: (s: string) => void;
  lang: Lang;
  setLang: (l: Lang) => void;
}) {
  const { t } = useLang();
  const langs: Lang[] = ["fr", "en", "es", "de"];
  const labels: Record<Lang, string> = { fr: "FR", en: "EN", es: "ES", de: "DE" };

  return (
    <header className="sticky top-0 z-30 border-b border-stone-200 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/70">
      <div className="mx-auto max-w-7xl px-4 py-3 flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="grid place-items-center h-9 w-9 rounded-lg bg-stone-900 text-white">
            <Mountain className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <div className="font-semibold tracking-tight">OutdoorPrice</div>
            <div className="text-[11px] text-stone-500 -mt-0.5">{t("header.subtitle")}</div>
          </div>
        </div>

        <form onSubmit={onSubmit} className="ml-auto flex items-center gap-2 flex-1 max-w-xl">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("search.placeholder")}
              className="w-full rounded-md border border-stone-200 bg-white pl-9 pr-3 py-1.5 text-sm focus:border-stone-400 focus:outline-none"
              aria-label={t("search.aria")}
            />
          </div>
          <button
            type="submit"
            disabled={query.trim().length < 2 || isFetching}
            className="rounded-md bg-stone-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
          >
            {isFetching ? "..." : t("search.compare")}
          </button>
        </form>

        {/* Language switcher */}
        <div className="flex items-center gap-0.5 shrink-0">
          {langs.map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={`px-1.5 py-1 text-[11px] font-semibold rounded transition-colors ${
                lang === l ? "bg-stone-900 text-white" : "text-stone-500 hover:text-stone-900 hover:bg-stone-100"
              }`}
            >
              {labels[l]}
            </button>
          ))}
        </div>
      </div>

      {/* Suggestions */}
      {submittedQuery && (
        <div className="mx-auto max-w-7xl px-4 pb-3 -mt-1 flex flex-wrap gap-2 items-center text-xs">
          <span className="text-stone-500">{t("search.suggestions")}</span>
          {SUGGESTIONS.slice(0, 6).map((s) => (
            <button
              key={s}
              onClick={() => onSuggestion(s)}
              className="rounded-full border border-stone-200 px-2 py-0.5 text-stone-600 hover:bg-stone-100"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </header>
  );
}
