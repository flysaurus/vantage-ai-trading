// ─── Finnhub gateway — ONE chokepoint for every Finnhub read ────────────────
//
// Problem it solves: the free tier is 60 req/min. Today every caller talks to
// Finnhub directly (lib/finnhub.ts has 9 importers) and each fans out freely —
// the position-sector resolver fires ~317 calls in a burst on one portfolio
// load, the InsightsTab calls /api/stock/fundamentals once PER HELD SYMBOL (349
// on the Fidelity SMA), and the sentiment rule would add one company-news call
// per symbol on top. Proven on prod: a raw burst of 120 → 59 ok, then EVERY
// call null (including MSFT/META/PGR). And because lib/finnhub.ts returns `null`
// on `!res.ok` with no memory, a throttled symbol stays null until the next sync
// happens to win the race — i.e. coverage silently drifts.
//
// Shape: cache → budget → live → memo.
//   * cache   : `finnhub_cache` (migration 081), keyed by logical key + status.
//   * budget  : two per-minute token buckets — cron 40/min, interactive 20/min
//               (sum = the 60/min ceiling). A miss with no budget is UNKNOWN,
//               never a fabricated 0.
//   * live    : the actual HTTP call. 429/5xx is the important case.
//   * memo    : 429/5xx → `rate_limited` with a SHORT ttl (minutes); a genuine
//               unknown symbol → `null_result` with a LONG ttl (days). The two
//               must not share a horizon: a throttle deserves a retry soon, an
//               unknown symbol should stop being asked about.
//
// Rollout modes (`FINNHUB_CACHE_ENABLED`):
//   ''  / 'off'  → passthrough (today's behaviour), no cache read or write.
//   'shadow'     → ALWAYS call live (behaviour identical) but populate the cache
//                  and log cache-vs-live divergence. This is the current stage.
//   'on'         → serve from cache; budget-gate the fan-out.
//
// The gateway owns the HTTP (not a wrapper around lib/finnhub.ts) precisely so
// it can SEE the 429 status — a value-only wrapper cannot memoize a throttle.

import type { FinnhubProfile, FinnhubNewsItem } from '@/lib/finnhub';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';
const CACHE_TABLE = 'finnhub_cache';

// ─── Modes ──────────────────────────────────────────────────────────────────

export type GatewayMode = 'off' | 'shadow' | 'on';

export function finnhubCacheMode(): GatewayMode {
  const raw = (process.env.FINNHUB_CACHE_ENABLED || '').trim().toLowerCase();
  if (raw === 'shadow') return 'shadow';
  if (raw === '1' || raw === 'true' || raw === 'on') return 'on';
  return 'off';
}

// ─── TTLs (seconds) ─────────────────────────────────────────────────────────
//
// profile 30d and quote 60s are approved as-is. earnings 12h and news 6h are
// PROVISIONAL starting defaults — revisit against real usage before tuning.

export const TTL = {
  profile: 30 * 24 * 3600,
  quote: 60,
  earnings: 12 * 3600,
  news: 6 * 3600,
} as const;

/** A genuinely unknown symbol (empty profile / no ticker): LONG ttl, days. */
export const NULL_RESULT_TTL = 7 * 24 * 3600;
/** A 429/5xx: SHORT ttl, minutes — retry soon, don't re-burn in the cooldown. */
export const RATE_LIMITED_TTL = 120;

/** Honour `Retry-After` when present, clamped to a sane minutes-scale window. */
export function rateLimitedTtl(retryAfterHeader: string | null | undefined): number {
  const n = Number(retryAfterHeader);
  if (Number.isFinite(n) && n > 0) return Math.min(600, Math.max(30, Math.round(n)));
  return RATE_LIMITED_TTL;
}

// ─── Budget (two per-minute buckets; sum == the 60/min ceiling) ─────────────

export type Lane = 'cron' | 'interactive';

const WINDOW_MS = 60_000;

function budgetCap(lane: Lane): number {
  const raw =
    lane === 'cron'
      ? process.env.FINNHUB_BUDGET_CRON_PER_MIN
      : process.env.FINNHUB_BUDGET_INTERACTIVE_PER_MIN;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : lane === 'cron' ? 40 : 20;
}

const hits: Record<Lane, number[]> = { cron: [], interactive: [] };

/** Consume one slot from `lane`'s per-minute bucket. False ⇒ no budget. */
export function takeBudget(lane: Lane, now: number = Date.now()): boolean {
  const cap = budgetCap(lane);
  if (cap <= 0) return true; // cap 0 = unlimited (escape hatch)
  const recent = hits[lane].filter((t) => now - t < WINDOW_MS);
  if (recent.length >= cap) {
    hits[lane] = recent;
    return false;
  }
  recent.push(now);
  hits[lane] = recent;
  return true;
}

/** Test seam: forget all consumed budget. */
export function __resetFinnhubBudget(): void {
  hits.cron = [];
  hits.interactive = [];
}

// ─── Cache ──────────────────────────────────────────────────────────────────

export type CacheStatus = 'ok' | 'null_result' | 'rate_limited';

export interface FinnhubCacheRow {
  key: string;
  payload: unknown;
  status: CacheStatus;
  fetched_at: string;
  ttl_seconds: number;
}

/**
 * Minimal structural Supabase surface the gateway needs. Kept loose on purpose:
 * it must be satisfied by a real SupabaseClient AND by a bare test double, and a
 * missing table (migration not yet applied) must degrade to a plain miss rather
 * than throwing.
 */
export interface CacheClient {
  from(table: string): any;
}

async function readCache(supabase: CacheClient | null, key: string): Promise<FinnhubCacheRow | null> {
  if (!supabase) return null;
  try {
    const { data } = await (supabase
      .from(CACHE_TABLE)
      .select('key,payload,status,fetched_at,ttl_seconds')
      .eq('key', key)
      .maybeSingle() as Promise<{ data: FinnhubCacheRow | null; error: unknown }>);
    return data || null;
  } catch {
    return null; // table missing / transport error → treat as a miss
  }
}

async function writeCache(
  supabase: CacheClient | null,
  row: { key: string; payload: unknown; status: CacheStatus; ttl_seconds: number },
): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from(CACHE_TABLE).upsert(
      { ...row, fetched_at: new Date().toISOString() },
      { onConflict: 'key' },
    );
  } catch {
    /* cache is best-effort — never fail a read because the write failed */
  }
}

function ageSeconds(row: FinnhubCacheRow, now: number): number {
  const t = Date.parse(row.fetched_at);
  return Number.isFinite(t) ? (now - t) / 1000 : Infinity;
}

function isFresh(row: FinnhubCacheRow, now: number): boolean {
  return ageSeconds(row, now) < Math.max(0, row.ttl_seconds);
}

// ─── HTTP ───────────────────────────────────────────────────────────────────

export interface HttpResult {
  status: number;
  ok: boolean;
  data: unknown;
  retryAfter?: string | null;
}

export function finnhubToken(): string | null {
  return process.env.FINNHUB_IO_API_KEY || process.env.FINNHUB_API_KEY || null;
}

async function finnhubGet(path: string, params: Record<string, string>): Promise<HttpResult> {
  const token = finnhubToken();
  if (!token) return { status: 0, ok: false, data: null };
  const qs = new URLSearchParams({ ...params, token }).toString();
  try {
    const res = await fetch(`${FINNHUB_BASE}${path}?${qs}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return { status: res.status, ok: false, data: null, retryAfter: res.headers.get('retry-after') };
    }
    return { status: res.status, ok: true, data: await res.json() };
  } catch {
    return { status: 0, ok: false, data: null };
  }
}

// ─── Core ───────────────────────────────────────────────────────────────────

export interface CachedFinnhubCall<T> {
  supabase: CacheClient | null;
  /** Logical, namespaced key, e.g. 'profile2:AAPL'. */
  key: string;
  /** TTL for a successful (`ok`) result. */
  ttlSeconds: number;
  path: string;
  params: Record<string, string>;
  /** Raw JSON → typed value; return null for a genuine unknown symbol. */
  map: (data: unknown) => T | null;
  lane?: Lane;
  /** Test seam — defaults to the real HTTP call. */
  fetchFn?: (path: string, params: Record<string, string>) => Promise<HttpResult>;
}

function shadowLog(key: string, liveStatus: CacheStatus | string, cached: FinnhubCacheRow | null, mode: GatewayMode) {
  if (mode !== 'shadow') return;
  const now = Date.now();
  const cachedLabel = !cached ? 'miss' : isFresh(cached, now) ? cached.status : `${cached.status}(stale)`;
  const diverged = !cached || (isFresh(cached, now) && cached.status !== liveStatus);
  console.log(
    `[finnhub-shadow] ${key} cache=${cachedLabel} live=${liveStatus}${diverged ? ' DIVERGE' : ''}`,
  );
}

/**
 * Cache-aware Finnhub read.
 *
 * off     → straight to live (no cache read/write) — the pre-gateway behaviour.
 * shadow  → always live, but populate the cache and log divergence.
 * on      → serve fresh cache; a fresh `null_result`/`rate_limited` is honoured
 *           without a call; otherwise budget-gate, then call live.
 *
 * A miss with no budget (or a failure) returns null — UNKNOWN, never a fake 0.
 */
export async function cachedFinnhub<T>(call: CachedFinnhubCall<T>): Promise<T | null> {
  const mode = finnhubCacheMode();
  const doFetch = call.fetchFn ?? finnhubGet;

  if (mode === 'off') {
    const r = await doFetch(call.path, call.params);
    return r.ok ? call.map(r.data) : null;
  }

  const now = Date.now();
  const cached = await readCache(call.supabase, call.key);
  const freshOk = cached?.status === 'ok' && isFresh(cached, now);

  if (mode === 'on') {
    if (freshOk) return cached!.payload as T;
    if (cached?.status === 'null_result' && isFresh(cached, now)) return null;
    if (cached?.status === 'rate_limited' && isFresh(cached, now)) {
      // Inside the cooldown: never re-burn. Last good value (stale) beats unknown.
      return cached.payload == null ? null : (cached.payload as T);
    }

    const lane = call.lane ?? 'interactive';
    if (!takeBudget(lane, now)) {
      console.warn(`[finnhub-gateway] budget exhausted (${lane}) for ${call.key} — unknown`);
      return freshOk ? (cached!.payload as T) : null;
    }
  }

  const res = await doFetch(call.path, call.params);

  // ── Throttle / server error → memoize SHORT and retry soon. ──
  if (res.status === 429 || res.status >= 500) {
    const ttl = rateLimitedTtl(res.retryAfter);
    // Keep the last good value (if any) so a later read can fall back to it.
    await writeCache(call.supabase, {
      key: call.key,
      payload: cached?.status === 'ok' ? cached.payload : null,
      status: 'rate_limited',
      ttl_seconds: ttl,
    });
    shadowLog(call.key, 'rate_limited', cached, mode);
    return cached?.status === 'ok' ? (cached.payload as T) : null;
  }

  // ── Other 4xx (auth/bad request): do NOT memoize as an unknown symbol. ──
  if (!res.ok) {
    shadowLog(call.key, `http_${res.status}`, cached, mode);
    return null;
  }

  const value = call.map(res.data);
  const status: CacheStatus = value == null ? 'null_result' : 'ok';
  const ttl = value == null ? NULL_RESULT_TTL : call.ttlSeconds;

  shadowLog(call.key, status, cached, mode);
  await writeCache(call.supabase, { key: call.key, payload: value, status, ttl_seconds: ttl });
  return value;
}

// ─── Typed wrappers ─────────────────────────────────────────────────────────

function mapProfile(data: any): FinnhubProfile | null {
  if (!data || !data.ticker) return null;
  return {
    ticker: data.ticker,
    name: data.name || '',
    finnhubIndustry: data.finnhubIndustry || '',
    marketCapitalization: data.marketCapitalization != null ? data.marketCapitalization * 1e6 : null,
    exchange: data.exchange || '',
    logo: data.logo || '',
    country: data.country || '',
    currency: data.currency || '',
    ipo: data.ipo || '',
    phone: data.phone || '',
    weburl: data.weburl || '',
    shareOutstanding: data.shareOutstanding != null ? data.shareOutstanding * 1e6 : null,
  };
}

/** Company profile (industry string feeds sector resolution) — cached. */
export function cachedCompanyProfile(
  supabase: CacheClient | null,
  symbol: string,
  lane: Lane = 'interactive',
): Promise<FinnhubProfile | null> {
  const upper = symbol.trim().toUpperCase();
  return cachedFinnhub<FinnhubProfile>({
    supabase,
    lane,
    key: `profile2:${upper}`,
    ttlSeconds: TTL.profile,
    path: '/stock/profile2',
    params: { symbol: upper },
    map: mapProfile,
  });
}

function mapQuote(data: any): { price: number; change: number; changePct: number } | null {
  const c = Number(data?.c);
  if (!data || !Number.isFinite(c) || c <= 0) return null; // 0 = unknown symbol
  return {
    price: c,
    change: Number(data.d ?? 0) || 0,
    changePct: Number(data.dp ?? 0) || 0,
  };
}

/** Real-time quote — cached (60s). */
export function cachedQuote(
  supabase: CacheClient | null,
  symbol: string,
  lane: Lane = 'interactive',
): Promise<{ price: number; change: number; changePct: number } | null> {
  const upper = symbol.trim().toUpperCase();
  return cachedFinnhub({
    supabase,
    lane,
    key: `quote:${upper}`,
    ttlSeconds: TTL.quote,
    path: '/quote',
    params: { symbol: upper },
    map: mapQuote,
  });
}

function mapNews(data: any): FinnhubNewsItem[] {
  if (!Array.isArray(data)) return [];
  return data.slice(0, 10) as FinnhubNewsItem[];
}

/** Company news — cached (6h, provisional). */
export function cachedCompanyNews(
  supabase: CacheClient | null,
  symbol: string,
  fromDate?: string,
  toDate?: string,
  lane: Lane = 'interactive',
): Promise<FinnhubNewsItem[] | null> {
  const upper = symbol.trim().toUpperCase();
  const to = toDate || new Date().toISOString().slice(0, 10);
  const from = fromDate || new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  return cachedFinnhub<FinnhubNewsItem[]>({
    supabase,
    lane,
    key: `news:${upper}:${from}:${to}`,
    ttlSeconds: TTL.news,
    path: '/company-news',
    params: { symbol: upper, from, to },
    map: mapNews,
  });
}

function mapEarningsCalendar(data: any): any[] | null {
  const list = data?.earningsCalendar;
  return Array.isArray(list) ? list : null;
}

/** Earnings calendar for a date window — cached (12h, provisional). */
export function cachedEarningsCalendar(
  supabase: CacheClient | null,
  from: string,
  to: string,
  lane: Lane = 'cron',
): Promise<any[] | null> {
  return cachedFinnhub<any[]>({
    supabase,
    lane,
    key: `earnings:${from}:${to}`,
    ttlSeconds: TTL.earnings,
    path: '/calendar/earnings',
    params: { from, to },
    map: mapEarningsCalendar,
  });
}
