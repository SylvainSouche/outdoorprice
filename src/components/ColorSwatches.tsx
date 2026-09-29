"use client";
import { COLOR_HEX } from "@/config";

function canonColor(c: string): string {
  return c.toLowerCase().trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_]/g, "_");
}

export function ColorSwatches({ colors }: { colors: string[] }) {
  if (!colors || colors.length === 0) return null;
  const unique = [...new Set(colors.map(canonColor))];
  return (
    <div className="flex flex-wrap gap-1">
      {unique.slice(0, 6).map((c) => {
        const hex = COLOR_HEX[c] || "#d4d4d4";
        return (
          <span
            key={c}
            className="inline-block h-3 w-3 rounded-full border border-stone-300"
            style={{ backgroundColor: hex }}
            title={c}
          />
        );
      })}
      {unique.length > 6 && (
        <span className="text-[10px] text-stone-500">+{unique.length - 6}</span>
      )}
    </div>
  );
}
