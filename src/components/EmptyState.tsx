"use client";
import { useState } from "react";
import { Mountain } from "lucide-react";
import { SUGGESTIONS } from "@/config";
import { useLang } from "@/lib/i18n";

export function EmptyState({ onSuggestion }: { onSuggestion: (s: string) => void }) {
  const { t } = useLang();
  return (
    <div className="grid place-items-center py-16">
      <div className="max-w-2xl w-full rounded-lg border border-stone-200 bg-white p-8 shadow-sm">
        <div className="flex items-center gap-2">
          <Mountain className="h-5 w-5" />
          <h2 className="text-base font-semibold">{t("empty.title")}</h2>
        </div>
        <p className="mt-3 text-sm text-stone-600">{t("empty.desc")}</p>
        <div className="mt-4">
          <p className="text-xs font-medium text-stone-500">{t("empty.suggestions")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => onSuggestion(s)}
                className="rounded-full border border-stone-200 px-3 py-1 text-xs text-stone-600 hover:bg-stone-100"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
