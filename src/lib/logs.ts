// Client-side log collector for OutdoorPrice.
// --------------------------------------------------------------------------
// Accumule les logs de recherche (info, warning, error) dans un buffer en
// mémoire, exposé via useLogs() pour l'affichage dans une zone dépliable.
//
// Usage :
//   import { logInfo, logWarn, logError, useLogs, clearLogs } from "@/lib/logs";
//   logInfo("bergzeit", "24 produits récupérés");
//   logWarn("ekosport", "Cloudflare 403 sur 6 pages produit, fallback Playwright");
//   logError("tradeinn", "API a répondu HTTP 403");
//
// L'UI écoute les changements via useLogs() et réaffiche la zone.
// --------------------------------------------------------------------------

export type LogLevel = "info" | "warning" | "error";

export interface LogEntry {
  id: number;
  timestamp: number;
  level: LogLevel;
  site?: string;
  message: string;
  /** Contexte optionnel (URL, statut HTTP, etc.) */
  context?: Record<string, unknown>;
}

const MAX_LOGS = 500;
let nextId = 1;
let buffer: LogEntry[] = [];
type Listener = (logs: LogEntry[]) => void;
const listeners = new Set<Listener>();

function emit() {
  const snapshot = buffer;
  for (const l of listeners) {
    try { l(snapshot); } catch { /* ignore */ }
  }
}

function add(level: LogLevel, site: string | undefined, message: string, context?: Record<string, unknown>) {
  const entry: LogEntry = {
    id: nextId++,
    timestamp: Date.now(),
    level,
    site,
    message,
    context,
  };
  buffer = [...buffer, entry].slice(-MAX_LOGS);
  emit();
}

export function logInfo(site: string | undefined, message: string, context?: Record<string, unknown>) {
  add("info", site, message, context);
}

export function logWarn(site: string | undefined, message: string, context?: Record<string, unknown>) {
  add("warning", site, message, context);
}

export function logError(site: string | undefined, message: string, context?: Record<string, unknown>) {
  add("error", site, message, context);
}

export function clearLogs() {
  buffer = [];
  emit();
}

/** Hook React-like : subscribe to log changes. Returns the current logs + a
 *  cleanup function. The caller is responsible for re-rendering on change. */
export function subscribeLogs(listener: Listener): () => void {
  listeners.add(listener);
  // Emit current state immediately
  try { listener(buffer); } catch { /* ignore */ }
  return () => { listeners.delete(listener); };
}

export function getLogs(): LogEntry[] {
  return buffer;
}

/** Parse les sites[] de la réponse API et logge les statuts par site.
 *  À appeler après chaque recherche.
 *  L'erreur peut contenir une catégorie ScraperError: "... [blocked]" etc. */
export function logSearchResults(sites: Array<{ id: string; name: string; status: string; count: number; error?: string }>) {
  for (const s of sites) {
    if (s.status === "ok" && s.count > 0) {
      logInfo(s.id, `${s.count} produits récupérés`);
    } else if (s.status === "ok" && s.count === 0) {
      logWarn(s.id, "0 produit (recherche vide)");
    } else if (s.status === "empty") {
      logWarn(s.id, "0 résultat (site vide ou bloqué)");
    } else if (s.status === "error" && s.error) {
      const err = s.error;
      // Extract category from ScraperError.toLogString() format: "message (HTTP NNN) [category]"
      const categoryMatch = err.match(/\[(\w+)\]$/);
      const category = categoryMatch ? categoryMatch[1] : "unknown";

      // Human-friendly messages based on category
      switch (category) {
        case "blocked":
          logError(s.id, `${err} — IP bloquée par anti-bot. Fonctionne depuis une IP résidentielle.`, { error: err });
          break;
        case "timeout":
          logError(s.id, `${err} — le site n'a pas répondu dans le délai imparti.`, { error: err });
          break;
        case "auth":
          logError(s.id, `${err} — clé API manquante ou expirée.`, { error: err });
          break;
        case "network":
          logError(s.id, `${err} — erreur réseau (DNS, connexion refusée).`, { error: err });
          break;
        case "parse":
          logError(s.id, `${err} — la structure du site a changé (sélecteur ou JSON).`, { error: err });
          break;
        case "empty":
          logWarn(s.id, `${err} — 0 résultat retourné.`, { error: err });
          break;
        default:
          logError(s.id, err, { error: err });
      }
    }
  }
}
