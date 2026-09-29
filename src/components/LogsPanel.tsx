"use client";
import { useState } from "react";
import type { LogEntry } from "@/lib/logs";
import { X, AlertTriangle, XCircle, Info } from "lucide-react";

export function LogsPanel({ logs, onClear }: { logs: LogEntry[]; onClear: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [showErrors, setShowErrors] = useState(true);
  const [showWarnings, setShowWarnings] = useState(true);
  const [showMessages, setShowMessages] = useState(false);
  const [siteFilter, setSiteFilter] = useState("");

  if (logs.length === 0) return null;

  const filtered = logs.filter((l) => {
    if (l.level === "error" && !showErrors) return false;
    if (l.level === "warning" && !showWarnings) return false;
    if (l.level === "info" && !showMessages) return false;
    if (siteFilter && l.site && !l.site.toLowerCase().includes(siteFilter.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-stone-200 bg-white shadow-lg">
      <div
        className="flex items-center justify-between px-4 py-1.5 cursor-pointer hover:bg-stone-50"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-sm font-medium text-stone-800">
          Logs
          <span className="ml-2 text-xs text-stone-500">
            {logs.filter((l) => l.level === "error").length} err ·{" "}
            {logs.filter((l) => l.level === "warning").length} warn ·{" "}
            {logs.filter((l) => l.level === "info").length} info
          </span>
        </span>
        <span className="text-xs text-stone-400">
          {expanded ? "▲ click to collapse" : "▼ click to expand"}
        </span>
      </div>

      {expanded && (
        <div className="max-h-60 overflow-y-auto px-4 pb-2">
          <div className="flex items-center gap-2 py-1 text-xs">
            <span className="text-stone-500">Level:</span>
            <button
              onClick={() => setShowErrors(!showErrors)}
              className={`px-1.5 py-0.5 rounded ${showErrors ? "bg-red-100 text-red-700" : "bg-stone-100 text-stone-400"}`}
            >
              Errors ({logs.filter((l) => l.level === "error").length})
            </button>
            <button
              onClick={() => setShowWarnings(!showWarnings)}
              className={`px-1.5 py-0.5 rounded ${showWarnings ? "bg-amber-100 text-amber-700" : "bg-stone-100 text-stone-400"}`}
            >
              Warnings ({logs.filter((l) => l.level === "warning").length})
            </button>
            <button
              onClick={() => setShowMessages(!showMessages)}
              className={`px-1.5 py-0.5 rounded ${showMessages ? "bg-green-100 text-green-700" : "bg-stone-100 text-stone-400"}`}
            >
              Messages ({logs.filter((l) => l.level === "info").length})
            </button>
            <input
              type="text"
              value={siteFilter}
              onChange={(e) => setSiteFilter(e.target.value)}
              placeholder="Filter by site (e.g. bergzeit)"
              className="ml-auto w-40 rounded border border-stone-200 px-2 py-0.5 text-xs"
            />
            <button
              onClick={onClear}
              className="rounded bg-stone-100 px-2 py-0.5 text-xs text-stone-600 hover:bg-stone-200"
            >
              Clear
            </button>
          </div>
          <div className="space-y-0.5">
            {filtered.length === 0 ? (
              <p className="py-2 text-center text-xs text-stone-400">
                No logs match the current filter.
              </p>
            ) : (
              filtered.slice().reverse().map((log) => (
                <div
                  key={log.id}
                  className={`flex items-center gap-2 rounded px-2 py-1 text-xs font-mono ${
                    log.level === "error"
                      ? "bg-red-50 text-red-800"
                      : log.level === "warning"
                      ? "bg-amber-50 text-amber-800"
                      : "bg-stone-50 text-stone-600"
                  }`}
                >
                  <span className="text-stone-400">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                  {log.level === "error" && <XCircle className="h-3 w-3 shrink-0" />}
                  {log.level === "warning" && <AlertTriangle className="h-3 w-3 shrink-0" />}
                  {log.level === "info" && <Info className="h-3 w-3 shrink-0" />}
                  {log.site && (
                    <span className="font-semibold">[{log.site}]</span>
                  )}
                  <span className="truncate">{log.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
