// ShopIcon — square shop logo rendered from the bundled favicon assets.
//
// Assets live in `public/shops/<siteId>.png` (64×64, fetched from each
// shop's own website — favicon / logo). The Electron packaging script
// copies `public/` into the standalone build, so icons work offline too.
//
// Fallback chain:
//   1. bundled asset `/shops/<siteId>.png`
//   2. remote Google S2 favicon (if the asset failed to load — e.g. newer
//      shops added without bundling an icon)
//   3. letter avatar (first letter of the shop name, accent-colored)
//
// Pure presentational component — reads only SITES metadata.
"use client";

import { useState } from "react";
import { SITES, type SiteId } from "@/lib/scraper/types";

function hostOf(siteId: SiteId): string | null {
  const base = SITES[siteId]?.baseUrl;
  if (!base) return null;
  try {
    return new URL(base).hostname;
  } catch {
    return null;
  }
}

export function ShopIcon({
  siteId,
  size = 64,
  className = "",
}: {
  siteId: SiteId;
  /** rendered size in px (assets are 64×64; smaller sizes downscale cleanly) */
  size?: number;
  className?: string;
}) {
  const meta = SITES[siteId];
  const name = meta?.name ?? siteId;
  // 0 = bundled asset, 1 = remote favicon, 2 = letter avatar
  const [stage, setStage] = useState(0);

  if (stage >= 2 || !meta) {
    // Letter avatar fallback — first letter of the shop name
    const accent = meta?.accent ?? "bg-stone-100 text-stone-700 border-stone-200";
    return (
      <div
        className={`grid shrink-0 place-items-center rounded-md border ${accent} ${className}`}
        style={{ width: size, height: size }}
        role="img"
        aria-label={name}
      >
        <span className="font-bold leading-none" style={{ fontSize: Math.round(size * 0.42) }}>
          {name.charAt(0).toUpperCase()}
        </span>
      </div>
    );
  }

  const src =
    stage === 0
      ? `/shops/${siteId}.png`
      : (() => {
          const host = hostOf(siteId);
          return host
            ? `https://www.google.com/s2/favicons?domain=${host}&sz=${Math.max(size, 64)}`
            : "";
        })();

  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      draggable={false}
      onError={() => setStage((s) => s + 1)}
      className={`shrink-0 rounded-md object-contain ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
