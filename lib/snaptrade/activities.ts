// ═══════════════════════════════════════════════════════════════
// lib/snaptrade/activities.ts — Broker ACTIVITIES (transaction) feed
// ═══════════════════════════════════════════════════════════════
//
// Why this exists: SnapTrade's per-position `tax_lots` array is empty for
// every position on both of our live brokerages, and the paid Tax Lots
// add-on does not cover Alpaca at all. The ACTIVITIES endpoint, by
// contrast, returns the real per-transaction history for free:
//
//   • Fidelity   → ~2 years (2024-09-03 →), day granularity
//   • Alpaca     → since account inception (2026-04-27 →), second granularity
//
// That is enough to reconstruct genuine lots (real trade_date, real price,
// real quantity) with FIFO — see lib/tax-harvest/lot-reconstruction.ts.
//
// Endpoint contract (verified against the live API):
//   GET /accounts/{accountId}/activities
//     → { data: [...], pagination: { offset, limit, total } }
//   Supports `startDate` / `endDate` / `offset` / `limit`. Reverse
//   chronological by `trade_date`. 1000 rows per page.
//
// Server-only: touches SnapTrade over the network. Never import from a
// client component.

import { snapTradeFetch } from '@/lib/snaptrade/auth';
import {
  extractPositionTicker,
  extractOrderSymbol,
} from '@/lib/snaptrade/mapping';
import type { ActivityRecord } from '@/lib/tax-harvest/lot-reconstruction';
import { createTtlCache } from '@/lib/ttl-cache';

/** Rows per SnapTrade page (the documented/live maximum). */
export const ACTIVITIES_PAGE_LIMIT = 1000;
/** Hard stop on pagination so a misbehaving `pagination.total` can't loop forever. */
const MAX_PAGES = 25;

export interface SnapTradeAccountRef {
  id: string;
  name?: string | null;
}

export interface ActivitiesWindow {
  /** Earliest activity date on file, ISO — the retention boundary. */
  start: string | null;
  /** Latest activity date on file, ISO. */
  end: string | null;
}

export interface AccountActivitiesResult {
  accountId: string;
  accountName: string | null;
  records: ActivityRecord[];
  /** `pagination.total` reported by SnapTrade, when present. */
  reportedTotal: number | null;
  /** True when we stopped before exhausting the feed (page cap hit). */
  truncated: boolean;
}

/** SnapTrade per-user credentials, passed as signed query params. */
export interface Credentials extends Record<string, string> {
  userId: string;
  userSecret: string;
}

// Activities move only when the broker syncs (daily for Fidelity, so even 30
// minutes is generous) — a 10-minute TTL keeps the page snappy without
// letting a fresh trade go unseen for long.
const ACTIVITIES_CACHE_TTL_MS = 10 * 60_000;
const activitiesCache = createTtlCache<AccountActivitiesResult[]>(ACTIVITIES_CACHE_TTL_MS);

/** Extract the array of rows from either `{ data: [...] }` or a bare array. */
function extractActivityRows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    const maybe = (raw as any).data ?? (raw as any).activities ?? (raw as any).results;
    if (Array.isArray(maybe)) return maybe;
  }
  return [];
}

/** `pagination.total` when reported, else null. */
function extractReportedTotal(raw: unknown): number | null {
  if (raw && typeof raw === 'object') {
    const total = Number((raw as any).pagination?.total);
    if (Number.isFinite(total)) return total;
  }
  return null;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Normalise ONE raw activity row into the shape the reconstruction engine
 * consumes. Returns null for rows with no resolvable symbol or date.
 */
export function normalizeActivityRow(raw: unknown): ActivityRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;

  const symbol =
    extractOrderSymbol(row) ||
    extractPositionTicker(row) ||
    (typeof row.symbol === 'string' ? row.symbol : '') ||
    '';
  const tradeDate =
    (typeof row.trade_date === 'string' && row.trade_date) ||
    (typeof row.settlement_date === 'string' && row.settlement_date) ||
    '';
  // A row without a symbol still matters: it bounds the history window, which
  // is what decides whether a held position is "unknown start". Only rows that
  // carry units AND no symbol are dropped — those can't be attributed to a
  // ticker and would otherwise pollute the lots map.
  const units = Math.abs(num(row.units ?? row.quantity));
  if (!tradeDate || (!symbol && units > 0)) return null;

  return {
    id: row.id == null ? null : String(row.id),
    symbol: String(symbol).toUpperCase(),
    type: String(row.type ?? '').toUpperCase(),
    units,
    price: Math.abs(num(row.price)),
    trade_date: tradeDate,
    amount: row.amount == null ? null : num(row.amount),
    description: row.description == null ? null : String(row.description),
    fee: row.fee == null ? null : num(row.fee),
  };
}

/**
 * Fetch the FULL activity history for one brokerage account, paginating
 * until exhausted. Never throws on an individual page — a partial history
 * is still useful (the reconstruction will flag the gap honestly), so a
 * failure mid-pagination returns what we have with `truncated: true`.
 */
export async function fetchAccountActivities(
  accountId: string,
  ep: Credentials,
  opts: { startDate?: string; endDate?: string } = {},
): Promise<AccountActivitiesResult> {
  const records: ActivityRecord[] = [];
  let offset = 0;
  let reportedTotal: number | null = null;
  let truncated = false;

  const params: Record<string, string> = {
    limit: String(ACTIVITIES_PAGE_LIMIT),
  };
  // SnapTrade requires bounded ranges for some brokers — pass the widest
  // range we can when the caller knows the account's inception.
  if (opts.startDate) params.startDate = opts.startDate;
  if (opts.endDate) params.endDate = opts.endDate;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    let raw: unknown;
    try {
      raw = await snapTradeFetch<unknown>(
        `/accounts/${accountId}/activities`,
        null,
        { ...params, offset: String(offset), ...ep },
      );
    } catch (err) {
      // A partial history is still useful — but it IS a gap, so say so and
      // let the reconstruction flag anything it can't account for.
      truncated = true;
      console.error(
        `[snaptrade/activities] page ${page} failed for ${accountId}:`,
        err instanceof Error ? err.message : 'Unknown',
      );
      break;
    }

    const rows = extractActivityRows(raw);
    if (reportedTotal === null) reportedTotal = extractReportedTotal(raw);
    if (rows.length === 0) break;

    for (const row of rows) {
      const rec = normalizeActivityRow(row);
      if (rec) records.push(rec);
    }

    offset += rows.length;

    // SnapTrade returns the feed newest-first and honours limit/offset, but a
    // page can come back shorter than the requested limit while more rows
    // remain. Paginating on "short page == done" silently truncated the
    // history and made real lots look like pre-window shares, so keep going
    // until the feed's own total is reached.
    if (reportedTotal !== null) {
      if (offset >= reportedTotal) break;
    } else if (rows.length < ACTIVITIES_PAGE_LIMIT) {
      break;
    }
    if (page === MAX_PAGES - 1) truncated = true;
  }

  return {
    accountId,
    accountName: null,
    records,
    reportedTotal,
    truncated,
  };
}

/** Distinct-ticker-agnostic date window across one or more accounts. */
export function activitiesWindow(
  results: Array<{ records: ActivityRecord[] }>,
): ActivitiesWindow {
  let start: string | null = null;
  let end: string | null = null;
  for (const r of results) {
    for (const rec of r.records) {
      const t = new Date(rec.trade_date).getTime();
      if (!Number.isFinite(t)) continue;
      if (start === null || t < new Date(start).getTime()) start = new Date(t).toISOString();
      if (end === null || t > new Date(end).getTime()) end = new Date(t).toISOString();
    }
  }
  return { start, end };
}

/**
 * The full activity history for EVERY account under one SnapTrade
 * authorization, cached per `userId:authorizationId`.
 *
 * Accounts are fetched in parallel; one account failing does not sink the
 * others. An empty result is cached too (cheap, and prevents hammering a
 * broker that genuinely has no history).
 */
export async function fetchActivitiesForAuthorization(
  userId: string,
  authorizationId: string,
  ep: Credentials,
  accounts: SnapTradeAccountRef[],
  opts: { fresh?: boolean; startDate?: string; endDate?: string } = {},
): Promise<AccountActivitiesResult[]> {
  const cacheKey = `${userId}:${authorizationId}`;
  const list = (accounts || []).filter((a) => a && a.id);
  if (list.length === 0) return [];

  return activitiesCache.getOrFetch(
    cacheKey,
    async () => {
      const settled = await Promise.allSettled(
        list.map(async (acct) => {
          const res = await fetchAccountActivities(acct.id, ep, {
            startDate: opts.startDate,
            endDate: opts.endDate,
          });
          return { ...res, accountName: acct.name ?? null };
        }),
      );
      const out: AccountActivitiesResult[] = [];
      for (const s of settled) {
        if (s.status === 'fulfilled') out.push(s.value);
        else console.error('[snaptrade/activities] account fetch failed:', s.reason?.message);
      }
      return out;
    },
    { fresh: opts.fresh },
  );
}
