// ProductList — right column with search results.
//
// Shows one of three states:
//   1. EmptyState (no search yet) — shows suggestions
//   2. LoadingState (search in progress) — skeleton cards
//   3. Results: ResultsSummary card + product grid (or "no match" card)
//
// Reads ALL state from useSearchState() context — no props.
"use client";

import { Globe } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useLang } from "@/lib/i18n";
import { useSearchState } from "@/lib/search-state";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { ResultsSummary } from "@/components/ResultsSummary";
import { MatchedProductCard } from "@/components/MatchedProductCard";

function formatPrice(p: number | null, currency: string): string {
  if (p === null || p === undefined || Number.isNaN(p)) return "—";
  if (currency === "EUR") {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(p);
  }
  return `${currency} ${p.toFixed(2)}`;
}

export function ProductList() {
  const {
    submittedQuery, isLoading, data, filtered,
    cheapestOverall, activeGroupId, computedGroupSites, groups,
    handleSuggestion,
  } = useSearchState();
  const { t } = useLang();

  return (
    <section className="space-y-4 min-w-0">
      {!submittedQuery && <EmptyState onSuggestion={handleSuggestion} />}

      {submittedQuery && isLoading && <LoadingState />}

      {submittedQuery && data && (
        <>
          <ResultsSummary
            query={data.query}
            totalProducts={data.totalProducts}
            sites={data.sites}
            durationMs={data.durationMs}
            phases={data.phases}
            cheapestOverall={cheapestOverall}
            activeGroupId={activeGroupId}
            computedGroupSites={computedGroupSites}
            groups={groups}
            formatPrice={formatPrice}
          />

          {filtered.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-stone-500">
                {t('results.noMatch')}
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {filtered.map((p) => (
                <MatchedProductCard key={p.id} product={p} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// Footer — kept here because it's part of the results column visually
export function AppFooter() {
  return (
    <footer className="mt-auto border-t border-stone-200 bg-white">
      <div className="mx-auto max-w-7xl px-4 py-4 text-xs text-stone-500 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <Globe className="h-3 w-3" />
          22 sites agrégés + matching cross-site par EAN/marque/similarité
        </span>
        <span>
          Données indicatives — vérifiez toujours le prix final sur le site marchand.
        </span>
      </div>
    </footer>
  );
}
