"use client";
import { type ReactNode } from "react";
import { X } from "lucide-react";

export function FilterBalloon({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-stone-200 px-2 py-0.5 text-xs text-stone-700">
      {label}
      <button onClick={onRemove} className="hover:text-stone-900" aria-label="Remove filter">
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
