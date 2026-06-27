// ─── Market Cache Operations ─────────────────────────────────
const API_BASE = '/api/db/market-cache';

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string>) };
  return fetch(path, { ...init, headers, credentials: 'include' as RequestCredentials });
}

/** Upsert cached market data for a symbol (TTL: 24h) */
export async function cacheMarketData(symbol: string, data: Record<string, unknown>): Promise<{ symbol: string; cachedAt: string; expiresAt: string } | null> {
  const res = await apiFetch(`${API_BASE}/upsert`, { method: 'POST', body: JSON.stringify({ symbol, data }) });
  if (!res.ok) { console.warn('[marketCache] upsert failed:', res.status); return null; }
  return res.json();
}

/** Get cached market data for a symbol. Returns null if missing or expired (410). */
export async function getCachedMarketData(symbol: string): Promise<{ symbol: string; data: Record<string, unknown>; cachedAt: string; expiresAt: string } | null> {
  const res = await apiFetch(`${API_BASE}/get?symbol=${encodeURIComponent(symbol)}`);
  if (res.status === 404 || res.status === 410) return null;
  if (!res.ok) { console.warn('[marketCache] get failed:', res.status); return null; }
  return res.json();
}

/** Purge cache entries older than N hours (default 24) */
export async function purgeOldCache(hoursOld = 24): Promise<number> {
  const res = await apiFetch(`${API_BASE}/delete-old`, { method: 'POST', body: JSON.stringify({ hoursOld }) });
  if (!res.ok) return 0;
  return (await res.json()).deletedCount || 0;
}
