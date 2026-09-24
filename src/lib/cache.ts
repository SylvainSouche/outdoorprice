// In-memory search result cache.
// Caches the full aggregateMatched response keyed by (query + sorted site list + group).
// TTL: 2 minutes (configurable via SCRAPE_CACHE_TTL_MS).
// Max entries: 50 (LRU eviction via Map insertion order).

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const MAX_ENTRIES = 50;
const DEFAULT_TTL = parseInt(process.env.SCRAPE_CACHE_TTL_MS || "120000", 10);

const cache = new Map<string, CacheEntry<unknown>>();

function buildKey(query: string, sites?: string[], group?: string): string {
  const siteKey = sites ? sites.slice().sort().join(",") : "all";
  const groupKey = group || "all";
  return `${query.toLowerCase().trim()}|${siteKey}|${groupKey}`;
}

export function getCached<T>(query: string, sites?: string[], group?: string): T | undefined {
  const key = buildKey(query, sites, group);
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry.data as T;
}

export function setCached<T>(query: string, data: T, sites?: string[], group?: string, ttlMs?: number): void {
  const key = buildKey(query, sites, group);
  const expiresAt = Date.now() + (ttlMs ?? DEFAULT_TTL);
  while (cache.size >= MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(key, { data, expiresAt });
}

export function clearCache(): void {
  cache.clear();
}

export function getCacheStats(): { size: number; maxEntries: number; ttlMs: number } {
  return { size: cache.size, maxEntries: MAX_ENTRIES, ttlMs: DEFAULT_TTL };
}
