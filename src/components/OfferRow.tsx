"use client";
import { ExternalLink } from "lucide-react";
import type { ProductOffer } from "@/lib/scraper/types";
import { SITES } from "@/lib/scraper/types";

export function OfferRow({ offer }: { offer: ProductOffer }) {
  const meta = SITES[offer.site as string];
  return (
    <a
      href={offer.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-stone-100 transition-colors"
    >
      <span
        className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${meta?.accent || "bg-stone-100 text-stone-700 border-stone-200"}`}
      >
        {offer.siteName || offer.site}
      </span>
      <span className="font-semibold text-stone-900">
        {offer.price != null ? `${offer.price.toFixed(2)} €` : "—"}
      </span>
      {offer.originalPrice != null && offer.originalPrice > (offer.price ?? 0) && (
        <span className="text-stone-400 line-through text-[11px]">
          {offer.originalPrice.toFixed(2)} €
        </span>
      )}
      {offer.discount != null && offer.discount > 0 && (
        <span className="text-red-600 text-[11px] font-medium">-{offer.discount}%</span>
      )}
      {offer.availability === "out_of_stock" && (
        <span className="text-stone-400 text-[11px]">· Rupture</span>
      )}
      {offer.availability === "in_stock" && (
        <span className="text-green-600 text-[11px]">· En stock</span>
      )}
      <ExternalLink className="h-3 w-3 text-stone-400 ml-auto" />
    </a>
  );
}
