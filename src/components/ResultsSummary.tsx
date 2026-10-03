// Results summary card — shown at the top of the search results section.
// Displays: query, matched count, sites responding, phase timings, cheapest
// product, per-site status badges, and error messages when all sites fail.
//
// Extracted from src/app/page.tsx (P1.1 continuation) — pure presentational
// component, takes all data via props.
"use client";

import {
  Clock,
  TrendingDown,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SITES, type ShopGroup, type SiteId } from "@/lib/scraper/types";
import { useLang, type Lang } from "@/lib/i18n";

export interface SiteResult {
  id: SiteId;
  name: string;
  status: "ok" | "error" | "empty";
  count: number;
  error?: string;
}

export interface ResultsSummaryProps {
  query: string;
  totalProducts: number;
  sites: SiteResult[];
  durationMs: number;
  phases: { searchMs: number; enrichMs: number; matchMs: number };
  cheapestOverall: { minPrice: number; minCurrency: string; brand?: string; title: string } | null;
  activeGroupId: string;
  computedGroupSites: SiteId[];
  groups: ShopGroup[];
  formatPrice: (p: number | null, currency: string) => string;
}

export function ResultsSummary({
  query,
  totalProducts,
  sites,
  durationMs,
  phases,
  cheapestOverall,
  activeGroupId,
  computedGroupSites,
  groups,
  formatPrice,
}: ResultsSummaryProps) {
  const { t } = useLang();

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-stone-500">{t('summary.query')}</div>
            <div className="font-semibold truncate max-w-[220px]">&ldquo;{query}&rdquo;</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-stone-500">{t('summary.matched')}</div>
            <div className="font-semibold">{totalProducts}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-stone-500">{t('summary.sitesResponding')}</div>
            <div className="font-semibold">
              {sites.filter((s) => s.status === "ok").length} / {sites.length}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-stone-500">{t('summary.phases')}</div>
            <div className="text-xs font-medium text-stone-700">
              <span title="Recherche">🔎 {(phases.searchMs / 1000).toFixed(1)}s</span>
              {" · "}
              <span title="Enrichissement pages produits">📄 {(phases.enrichMs / 1000).toFixed(1)}s</span>
              {" · "}
              <span title="Matching cross-site">🔗 {(phases.matchMs / 1000).toFixed(2)}s</span>
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-stone-500">{t('summary.duration')}</div>
            <div className="font-semibold flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {(durationMs / 1000).toFixed(2)}s
            </div>
          </div>
          {cheapestOverall && (
            <div className="ml-auto">
              <div className="text-[11px] uppercase tracking-wide text-stone-500">{t('summary.cheapest')}</div>
              <div className="font-semibold text-emerald-700 flex items-center gap-1">
                <TrendingDown className="h-3 w-3" />
                {formatPrice(cheapestOverall.minPrice, cheapestOverall.minCurrency)}
                <span className="text-[11px] font-normal text-stone-500">
                  @ {cheapestOverall.brand ?? cheapestOverall.title.slice(0, 24)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Groupe vide : message informatif */}
        {activeGroupId !== "all" && computedGroupSites.length === 0 && (
          <div className="mt-3 flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <strong>Groupe « {groups.find((g) => g.id === activeGroupId)?.name} » vide.</strong>
              {" "}Ce groupe ne contient actuellement aucune boutique. Ajoutez des boutiques
              via les plugins correspondants, ou créez un groupe personnalisé avec les
              boutiques existantes en cliquant sur « + Groupe ».
            </div>
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {sites.map((s) => (
            <Badge
              key={s.id}
              variant="outline"
              className={`py-1.5 px-2.5 gap-1.5 ${SITES[s.id].accent} ${s.status === "ok" ? "" : "opacity-60"}`}
            >
              {s.status === "ok" && <CheckCircle2 className="h-3 w-3" />}
              {s.status === "error" && <XCircle className="h-3 w-3" />}
              {s.status === "empty" && <AlertTriangle className="h-3 w-3" />}
              <span className="font-medium">{s.name}</span>
              <span className="text-[10px] opacity-80">
                {s.count > 0 ? `(${s.count})` : s.status}
              </span>
              {s.status === "error" && s.error && (
                <span className="text-[10px] opacity-60 italic ml-1" title={s.error}>
                  {s.error.slice(0, 50)}
                </span>
              )}
            </Badge>
          ))}
        </div>

        {totalProducts === 0 && sites.some((s) => s.status !== "ok") && (
          <div className="mt-3 flex items-start gap-2 rounded-md bg-red-50 border border-red-200 p-3 text-xs text-red-900">
            <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <strong>{t('results.noProducts')}</strong>
              <div className="mt-1 space-y-0.5">
                {sites.filter((s) => s.status !== "ok").map((s) => (
                  <div key={s.id}>
                    <span className="font-medium">{s.name}</span> :{" "}
                    {s.status === "error" && s.error ? s.error : "0 résultat"}
                    {s.error?.includes("403") && (
                      <span className="text-red-700"> — bloqué par Cloudflare (IP data-center non acceptée). Ce site fonctionne depuis une IP résidentielle.</span>
                    )}
                    {s.status === "empty" && s.id === "sportconrad" && (
                      <span className="text-red-700"> — API Makaira répond 500 depuis le data-center.</span>
                    )}
                    {s.error?.includes("Failed to fetch") && (
                      <span className="text-red-700"> — challenge anti-bot non résolu, même via Playwright.</span>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-2 text-stone-600">
                Astuce : dé-sélectionne les sites en erreur dans la sidebar et relance la recherche.
                Les sites fonctionnels (Bergzeit, Sport Bittl, Ekosport, Montaz, Snowleader, Glisshop)
                renvoient des produits en quelques secondes.
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
