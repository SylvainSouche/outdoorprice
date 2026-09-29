"use client";
import { useState } from "react";
import { Tag, ChevronDown, ChevronUp, ExternalLink, Star } from "lucide-react";
import type { MatchedProduct, ProductOffer } from "@/lib/scraper/types";
import { SITES } from "@/lib/scraper/types";
import { ColorSwatches } from "./ColorSwatches";
import { OfferRow } from "./OfferRow";

function formatPrice(p: number | null, currency: string): string {
  if (p === null || p === undefined || Number.isNaN(p)) return "—";
  if (currency === "EUR") {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(p);
  }
  return `${p} ${currency}`;
}

export function MatchedProductCard({ product }: { product: MatchedProduct }) {
  const [expanded, setExpanded] = useState(false);
  const offers = product.offers;
  const bestOffer = product.bestOffer || offers[0];
  const meta = SITES[bestOffer?.site as string];

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-3 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex gap-3">
        {/* Image */}
        <div className="relative shrink-0">
          {product.image ? (
            <img
              src={product.image}
              alt={product.title}
              className="h-20 w-20 rounded-md object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-md bg-stone-100 text-stone-400">
              <Tag className="h-8 w-8" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-stone-900 truncate" title={product.title}>
                {product.title}
              </h3>
              {product.brand && (
                <p className="text-xs text-stone-500">{product.brand}</p>
              )}
            </div>
            {product.metadata?.rating != null && (
              <div className="flex items-center gap-0.5 text-xs text-stone-500">
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                {product.metadata.rating.toFixed(1)}
              </div>
            )}
          </div>

          {/* Badges */}
          <div className="mt-1 flex flex-wrap gap-1">
            {product.sport && (
              <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-600">{product.sport}</span>
            )}
            {product.category && (
              <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-600">{product.category}</span>
            )}
            {product.range && (
              <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-600">{product.range}</span>
            )}
            {product.metadata?.gender && (
              <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-600">{product.metadata.gender}</span>
            )}
            <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-600">
              {product.siteCount} site{product.siteCount > 1 ? "s" : ""}
            </span>
            {offers.some((o) => (o.discount ?? 0) > 0) && (
              <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                Promo
              </span>
            )}
          </div>

          {/* Colors */}
          {product.metadata?.color && product.metadata.color.length > 0 && (
            <div className="mt-1.5">
              <ColorSwatches colors={product.metadata.color} />
            </div>
          )}

          {/* Price */}
          <div className="mt-2 flex items-end justify-between">
            <div>
              {product.minPrice != null && (
                <div className="text-lg font-bold text-stone-900">
                  {formatPrice(product.minPrice, product.minCurrency)}
                </div>
              )}
              {product.savings != null && product.savings > 0 && (
                <div className="text-xs text-green-600">
                  économisez jusqu'à {formatPrice(product.savings, product.minCurrency)}
                </div>
              )}
            </div>
            {bestOffer && bestOffer.url && (
              <a
                href={bestOffer.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md bg-stone-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-700"
              >
                Voir l'offre <ExternalLink className="ml-1 inline h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Offers toggle */}
      {offers.length > 1 && (
        <div className="mt-2 border-t border-stone-100 pt-2">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex w-full items-center justify-between text-xs text-stone-500 hover:text-stone-900"
          >
            <span>
              {offers.length} offre{offers.length > 1 ? "s" : ""} · {expanded ? "Masquer" : "Voir tout"}
            </span>
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {expanded && (
            <div className="mt-1 space-y-0.5">
              {offers.map((offer, i) => (
                <OfferRow key={`${offer.site}-${i}`} offer={offer} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Match criteria */}
      {product.matchReason && (
        <div className="mt-2 text-[10px] text-stone-400" title="Critères de matching">
          Match: {product.matchReason} (score: {product.matchScore?.toFixed(2) ?? "?"})
        </div>
      )}
    </div>
  );
}
