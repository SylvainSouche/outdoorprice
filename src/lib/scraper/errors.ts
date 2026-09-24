// Erreurs scraper typées — permettent à l'UI (LogsPanel) et au CLI
// d'afficher des messages stables et de compter les causes au lieu de
// parser du texte libre.
//
// Usage :
//   throw new ScraperError("alltricks", "blocked_cloudflare",
//     "le challenge Turnstile ne se dissipe pas — SCRAPE_HEADED=1 requis");
// Le message reste humain (français) ; `cause` porte la sémantique.

export type ScraperErrorCause =
  | "blocked_cloudflare" // challenge / Turnstile / 403 Cloudflare
  | "key_rejected" // clé API refusée (rotation, expiration)
  | "consent_banner" // bannière cookies/blocage UI non écartsable
  | "parse" // structure de page/JSON inattendue (sélecteurs cassés)
  | "network" // DNS, timeout, reset TLS, 5xx
  | "timeout"; // deadline interne dépassée

export class ScraperError extends Error {
  constructor(
    public readonly site: string,
    public readonly cause: ScraperErrorCause,
    message: string
  ) {
    super(`[${site}] ${message}`);
    this.name = "ScraperError";
  }
}
