// ═══════════════════════════════════════════════════════════════
// GET /api/strategies/tax-harvest/lots
//   ?connectionId=<uuid>   (raw SnapTrade connection id, no prefix)
//   &demo=1                (demo account — falls back to the local ledger)
//   &fresh=1               (bypass the cache after a trade)
// ═══════════════════════════════════════════════════════════════
//
// The ONE account-scoped lot feed for the whole app.
//
// Primary source: real broker ACTIVITIES, FIFO-replayed into genuine lots
// (real trade date, real price, real quantity) by
// lib/tax-harvest/lot-reconstruction.ts. This is what replaced the synthetic
// `position_lots` backfill (one averaged row per currently-held position),
// which is why holding-period, the YTD baseline and Position Detail used to
// disagree with the wash-sale checker — and why positions held longer than
// the broker's activity window were silently mis-dated.
//
// Fallback chain (kept deliberately, and reported in `source`, so the UI can
// label degraded data instead of pretending it is real):
//     activities  →  position_lots  →  buy orders  →  none
//
// Positions whose shares predate the activity window are NOT given a guessed
// purchase date — they come back under `unknownStartByTicker` with the
// approved "Unknown start — acquired before <date> on file" label, and every
// consumer is required to surface that.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { snapTradeFetch } from '@/lib/snaptrade/auth';
import {
  resolveSnapTradeCredentials,
  SnapTradeAuthError,
  SnapTradeAmbiguousError,
} from '@/lib/snaptrade/client';
import { extractPositionTicker } from '@/lib/snaptrade/mapping';
import {
  fetchActivitiesForAuthorization,
  activitiesWindow,
  type SnapTradeAccountRef,
  type AccountActivitiesResult,
} from '@/lib/snaptrade/activities';
import {
  reconstructLotsFromActivities,
  type ActivityRecord,
  type ReconstructedLot,
  type UnknownStartInfo,
} from '@/lib/tax-harvest/lot-reconstruction';
import { loadPurchaseLots } from '@/lib/tax-harvest/purchase-dates';
import { createServerClient } from '@/lib/supabase';
import { parseAccountScope } from '@/lib/account-scope';
import { createTtlCache } from '@/lib/ttl-cache';

export interface TaxHarvestLotsResponse {
  /** Where the lots actually came from. */
  source: 'activities' | 'lots' | 'orders' | 'none';
  accountScoped: boolean;
  lotsByTicker: Record<string, ReconstructedLot[]>;
  /** Positions whose shares predate the activity window — MUST be disclosed. */
  unknownStartByTicker: Record<string, UnknownStartInfo>;
  unknownStartCount: number;
  lotCount: number;
  activityCount: number;
  windowStartDate: string | null;
  windowEndDate: string | null;
  positionQtyByTicker: Record<string, number>;
  accounts: Array<{ id: string; name: string | null; activities: number; truncated: boolean }>;
  /** Present when we fell back from activities (degraded, not silent). */
  fallbackReason?: string;
  /**
   * Ledger-fallback disclosure (Part B §6, item 6): which scope the local
   * ledger was read at ('account' | 'connection' | 'unavailable'). Absent on
   * the activities path.
   */
  lotsScope?: 'account' | 'connection' | 'unavailable';
  /** Legacy connection lots excluded from a scoped ledger read; disclosed, never blended. */
  unattributedLots?: number;
}

const CACHE_TTL_MS = 5 * 60_000;
const lotsCache = createTtlCache<TaxHarvestLotsResponse>(CACHE_TTL_MS);

/** Cash-sweep rows (SPAXX core) are not positions — their value is in cash. */
function positionQtyByTicker(raw: unknown): Record<string, number> {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? ((raw as any).data ?? (raw as any).results ?? [])
      : [];
  const out: Record<string, number> = {};
  if (!Array.isArray(list)) return out;

  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const p = row as Record<string, unknown>;
    if (p.cash_equivalent === true) continue;
    const symbol = extractPositionTicker(p);
    const units = Number((p as any).units ?? (p as any).fractional_units ?? 0);
    if (!symbol || !Number.isFinite(units) || units <= 0) continue;
    const key = symbol.toUpperCase();
    out[key] = (out[key] ?? 0) + units;
  }
  return out;
}

/** The honest degraded path: the local lot ledger, then raw buy orders. */
async function loadFallbackLots(
  userId: string,
  connectionId: string | null,
  isDemo: boolean,
  reason: string | undefined,
  activityCount = 0,
  snapAccountId: string | null = null,
): Promise<TaxHarvestLotsResponse> {
  const supabase = createServerClient();
  const { lotsByTicker, source, scope, unattributedLots } = await loadPurchaseLots(supabase, {
    userId,
    connectionId,
    isDemo,
    snapAccountId,
  });
  const lotCount = Object.values(lotsByTicker).reduce((n, lots) => n + lots.length, 0);

  return {
    source: source === 'none' ? 'none' : source,
    accountScoped: Boolean(connectionId) || isDemo,
    // The local ledger rows already match the canonical lot shape.
    lotsByTicker: lotsByTicker as any,
    unknownStartByTicker: {},
    unknownStartCount: 0,
    lotCount,
    activityCount,
    windowStartDate: null,
    windowEndDate: null,
    positionQtyByTicker: {},
    accounts: [],
    lotsScope: scope,
    unattributedLots,
    ...(reason ? { fallbackReason: reason } : {}),
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const userId = authUser!.id;

  const { searchParams } = new URL(req.url);
  const connectionId = searchParams.get('connectionId') || null;
  const isDemo = searchParams.get('demo') === '1';
  const fresh = searchParams.get('fresh') === '1';
  // The active sub-account, forwarded to the ledger fallback so a shared login
  // is never read connection-wide. Accepts the canonical `accountId=` form or
  // a bare `snapAccountId=`. Absent ⇒ unchanged behaviour.
  const snapAccountId =
    parseAccountScope(searchParams.get('accountId'))?.snapAccountId ??
    searchParams.get('snapAccountId') ??
    null;

  if (!connectionId && !isDemo) {
    return NextResponse.json({ error: 'connectionId required' }, { status: 400 });
  }

  // Demo accounts have no broker activities at all — go straight to the ledger.
  if (isDemo || !process.env.SNAPTRADE_CLIENT_ID) {
    return NextResponse.json(
      await loadFallbackLots(userId, connectionId, isDemo, 'demo account', 0, snapAccountId),
    );
  }

  try {
    const creds = await resolveSnapTradeCredentials(userId, connectionId);
    const ep = { userId: creds.snaptradeUserId, userSecret: creds.snaptradeUserSecret };
    const authorizationId = creds.connectionId;
    const cacheKey = `${userId}:${authorizationId}`;

    const payload = await lotsCache.getOrFetch(
      cacheKey,
      async (): Promise<TaxHarvestLotsResponse> => {
        const accountsRaw = await snapTradeFetch<unknown>(
          `/authorizations/${authorizationId}/accounts`,
          null,
          ep,
        );
        const accounts: SnapTradeAccountRef[] = (Array.isArray(accountsRaw) ? accountsRaw : [])
          .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
          .map((a) => ({ id: String((a as any).id), name: ((a as any).name as string) ?? null }))
          .filter((a) => a.id);

        if (accounts.length === 0) {
          return loadFallbackLots(userId, connectionId, false, 'no brokerage accounts on connection', 0, snapAccountId);
        }

        // Live share counts per symbol drive the unknown-start reconciliation.
        const [qtyResults, activityResults] = await Promise.all([
          Promise.allSettled(
            accounts.map(async (acct) => {
              const raw = await snapTradeFetch<unknown>(`/accounts/${acct.id}/positions`, null, ep);
              return positionQtyByTicker(raw);
            }),
          ),
          fetchActivitiesForAuthorization(userId, authorizationId, ep, accounts, { fresh }),
        ]);

        const qtyByTicker: Record<string, number> = {};
        for (const r of qtyResults) {
          if (r.status !== 'fulfilled') continue;
          for (const [sym, qty] of Object.entries(r.value)) {
            qtyByTicker[sym] = (qtyByTicker[sym] ?? 0) + qty;
          }
        }

        const records: ActivityRecord[] = [];
        for (const acct of activityResults as AccountActivitiesResult[]) {
          records.push(...acct.records);
        }

        if (records.length === 0) {
          return loadFallbackLots(
            userId,
            connectionId,
            false,
            'broker returned no activity history',
            0,
            snapAccountId,
          );
        }

        const { lotsByTicker, unknownStartByTicker, activityCount } =
          reconstructLotsFromActivities(records, { positionQtyByTicker: qtyByTicker });
        const window = activitiesWindow(activityResults);

        const lotCount = Object.values(lotsByTicker).reduce((n, lots) => n + lots.length, 0);

        return {
          source: 'activities',
          accountScoped: true,
          lotsByTicker,
          unknownStartByTicker,
          unknownStartCount: Object.keys(unknownStartByTicker).length,
          lotCount,
          activityCount,
          windowStartDate: window.start,
          windowEndDate: window.end,
          positionQtyByTicker: qtyByTicker,
          accounts: (activityResults as AccountActivitiesResult[]).map((a) => ({
            id: a.accountId,
            name: a.accountName,
            activities: a.records.length,
            truncated: a.truncated,
          })),
        };
      },
      { fresh },
    );

    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';

    if (err instanceof SnapTradeAuthError || err instanceof SnapTradeAmbiguousError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    console.error('[tax-harvest/lots] activities failed, falling back to ledger:', message);
    // Never fail the page over a broker hiccup — degrade and SAY so.
    const fallback = await loadFallbackLots(userId, connectionId, false, message, 0, snapAccountId);
    return NextResponse.json(fallback);
  }
}
