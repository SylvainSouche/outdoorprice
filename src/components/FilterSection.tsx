"use client";
import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

export function FilterSection({
  title,
  icon,
  options,
  active,
  onToggle,
}: {
  title: string;
  icon?: ReactNode;
  options: { value: string; count: number }[];
  active: Set<string>;
  onToggle: (value: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  if (options.length === 0) return null;
  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between py-1 text-xs text-stone-500 hover:text-stone-900"
      >
        <span className="flex items-center gap-1.5">
          {icon}
          {title}
          {active.size > 0 && (
            <span className="rounded-full bg-stone-200 px-1.5 text-[10px] font-medium text-stone-600">
              {active.size}
            </span>
          )}
        </span>
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {expanded && (
        <div className="mt-1 space-y-0.5 max-h-44 overflow-y-auto pr-1">
          {options.slice(0, 30).map((opt) => (
            <label key={opt.value} className="flex cursor-pointer items-center gap-2 py-0.5 text-xs">
              <input
                type="checkbox"
                checked={active.has(opt.value)}
                onChange={() => onToggle(opt.value)}
                className="h-3 w-3 accent-stone-900"
              />
              <span className="flex-1 truncate text-stone-700">{opt.value}</span>
              <span className="text-stone-400 tabular-nums">{opt.count}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
