// ─── GET /api/broker/snaptrade/account ────────────────────
// Returns canonical account summary for the authenticated user's
// SnapTrade-connected brokerage. Uses shared mapping functions
// from lib/snaptrade/mapping.ts and lib/broker/account-summary.ts.
//
// Canonical response includes per-connection metadata:
//   lastSynced, holdingsUnavailable, accountStatus
// These are read LIVE — never hardcoded by broker name.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { snapTradeFetch } from '@/lib/snaptrade/auth';
import {
  resolveSnapTradeCredentials,
  SnapTradeAuthError,
  SnapTradeAmbiguousError,
} from '@/lib/snaptrade/client';
import { computeAccountSummary, type PositionInput } from '@/lib/broker/account-summary';
import { extractPositionTicker, extractPositionName } from '@/lib/snaptrade/mapping';
import { fetchFinnhubQuotes, positionDayChange } from '@/lib/finnhub-quote';
import { createTtlCache } from '@/lib/ttl-cache';

// ─── Dev mode — synthetic data ────────────────────────────
const DEV_ACCOUNT = {
  totalValue: 101_779.14,
  cash: 12_345.67,
  buyingPower: 12_345.67,
  invested: 89_433.47,
  marketValue: 89_433.47,
  dayChange: 156.32,
  dayChangePct: 0.15,
  totalPnl: 12_345.67,
  totalPnlPct: 13.8,
  currency: 'USD',
  accountStatus: 'open' as const,
  lastSynced: new Date().toISOString(),
  holdingsUnavailable: false,
  positions: [],
  orders: [],
};

// Absorbs duplicate/rapid SnapTrade fetches (two data layers mounting at once,
// or a 30s poll racing a 60s poll). TTL is one poll interval; `fresh=1` bypasses
// after a trade/cancel so cash & positions reflect immediately.
const ACCOUNT_CACHE_TTL_MS = 30_000;
const accountCache = createTtlCache<any>(ACCOUNT_CACHE_TTL_MS);

export async function GET(req: NextRequest) {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;

  if (!process.env.SNAPTRADE_CLIENT_ID) {
    return NextResponse.json(DEV_ACCOUNT);
  }

  // ── Resolve credentials ────────────────────────────────
  const connectionId = req.nextUrl.searchParams.get('connectionId');
  let snaptradeUserId: string;
  let snaptradeUserSecret: string;
  let authorizationId: string;
  try {
    const creds = await resolveSnapTradeCredentials(authUser.id, connectionId);
    snaptradeUserId = creds.snaptradeUserId;
    snaptradeUserSecret = creds.snaptradeUserSecret;
    authorizationId = creds.connectionId;
  } catch (err) {
    if (err instanceof SnapTradeAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof SnapTradeAmbiguousError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: 'Failed to load brokerage credentials.' },
      { status: 502 },
    );
  }

  const ep = { userId: snaptradeUserId, userSecret: snaptradeUserSecret };
  const fresh = req.nextUrl.searchParams.get('fresh') === '1';
  const cacheKey = `${authUser.id}:${authorizationId}`;

  try {
    const payload = await accountCache.getOrFetch(cacheKey, async () => {
    // ── Step A: List accounts (with sync_status for per-connection capabilities) ──
    const accounts = await snapTradeFetch<Array<{
      id: string;
      name: string;
      number?: string;
      status?: string;
      balance?: { total?: { amount?: number; currency?: string } };
      sync_status?: {
        holdings?: {
          last_successful_sync?: string;
          holdings_unavailable?: boolean;
        };
      };
    }>>(`/authorizations/${authorizationId}/accounts`, null, ep);

    if (!Array.isArray(accounts) || accounts.length === 0) {
      return {
        totalValue: 0, cash: 0, buyingPower: null,
        invested: 0, marketValue: 0,
        dayChange: 0, dayChangePct: 0,
        totalPnl: 0, totalPnlPct: 0,
        currency: 'USD',
        accountStatus: null,
        lastSynced: null,
        holdingsUnavailable: false,
        positions: [],
        orders: [],
      };
    }

    // ── Step B: Aggregate across all accounts ────────────
    let totalCash = 0;
    let totalBuyingPower: number | null = 0;
    let totalEquityFromSnap = 0;
    let latestSync: string | null = null;
    let anyHoldingsUnavailable = false;
    let accountStatus: 'open' | 'closed' | 'archived' | null = null;
    const allPositions: PositionInput[] = [];

    // ── Metadata pass (no network) — cheap aggregation across accounts ──
    for (const acct of accounts) {
      totalEquityFromSnap += Number(acct.balance?.total?.amount || 0);

      const sync = acct.sync_status?.holdings?.last_successful_sync;
      if (sync && (!latestSync || sync > latestSync)) latestSync = sync;
      if (acct.sync_status?.holdings?.holdings_unavailable) anyHoldingsUnavailable = true;

      const s = (acct.status || '').toLowerCase();
      if (s === 'closed' || s === 'archived') {
        accountStatus = s as 'closed' | 'archived';
      } else if (!accountStatus && s === 'open') {
        accountStatus = 'open';
      }
    }

    // ── Data pass — balances + positions per account, ALL in flight at once ──
    // (removes the sequential per-account SnapTrade round-trips that made
    // multi-account portfolios load slowly).
    const perAccount = await Promise.allSettled(
      accounts.map(async (acct) => {
        const [balances, rawPositions] = await Promise.all([
          snapTradeFetch<Array<{
            currency?: { code?: string };
            cash?: number;
            buying_power?: number;
          }>>(`/accounts/${acct.id}/balances`, null, ep).catch(() => [] as any[]),
          snapTradeFetch<unknown>(`/accounts/${acct.id}/positions`, null, ep).catch(() => []),
        ]);
        return { balances, rawPositions };
      }),
    );

    for (const r of perAccount) {
      if (r.status !== 'fulfilled') continue;
      const { balances, rawPositions } = r.value;
      if (Array.isArray(balances)) {
        for (const b of balances) {
          totalCash += Number(b.cash || 0);
          totalBuyingPower! += Number(b.buying_power || 0);
        }
      }
      allPositions.push(...normalisePositions(rawPositions));
    }

    // ── Enrich "Today" P&L from Finnhub ───────────────────
    // SnapTrade positions expose open_pnl only (no day_gain/day_change), so
    // day change = units × (current − previousClose) comes from the same
    // Finnhub feed used by Market Overview + basket cards.
    const quoteMap = await fetchFinnhubQuotes(allPositions.map((p) => p.symbol));
    for (const pos of allPositions) {
      const { dayChange, dayChangePct } = positionDayChange(pos.units, quoteMap[pos.symbol]);
      pos.dayChange = dayChange;
      pos.dayChangePct = dayChangePct;
    }

    // ── Step C: Compute using SHARED function ──────────
    const summary = computeAccountSummary(totalCash, totalBuyingPower ?? 0, allPositions);

    // Prefer SnapTrade's own total, fall back to computed
    const finalEquity = totalEquityFromSnap > 0 ? totalEquityFromSnap : summary.totalValue;

      return {
        totalValue: finalEquity,
        cash: summary.cash,
        buyingPower: totalBuyingPower,
        invested: summary.invested,
        marketValue: summary.marketValue,
        dayChange: summary.dayChange,
        dayChangePct: summary.dayChangePct,
        totalPnl: summary.totalPnl,
        totalPnlPct: summary.totalPnlPct,
        currency: 'USD',
        accountStatus,
        lastSynced: latestSync,
        holdingsUnavailable: anyHoldingsUnavailable,
        positions: allPositions.map(p => ({
          symbol: p.symbol,
          name: p.name,
          units: p.units,
          price: p.price,
          marketValue: p.units * p.price,
          costBasis: p.units * (p.costBasisPerUnit || 0),
          openPnl: p.openPnl || 0,
          dayChange: p.dayChange || 0,
          dayChangePct: p.dayChangePct || 0,
          assetType: 'stock' as const,
          currency: 'USD',
        })),
        orders: [], // orders come from the dedicated /orders endpoint
      };
    }, { fresh });

    return NextResponse.json(payload);
  } catch (err) {
    const msg = (err as Error).message;
    const statusCode = msg.includes('401') ? 401 : msg.includes('403') ? 403 : 502;
    if (statusCode === 401 || statusCode === 403) {
      return NextResponse.json(
        { error: 'Broker connection expired. Please reconnect your broker.' },
        { status: statusCode },
      );
    }
    return NextResponse.json(
      { error: 'Failed to load account data.' },
      { status: 502 },
    );
  }
}

// ─── Position normaliser ───────────────────────────────────
// Uses shared extractPositionTicker / extractPositionName
// from lib/snaptrade/mapping.ts — no inline symbol-unwrapping.

function normalisePositions(raw: unknown): PositionInput[] {
  const list = extractArray(raw);
  if (!list.length) return [];

  return list
    .filter((p): p is Record<string, unknown> => p !== null && typeof p === 'object')
    // Drop cash-equivalent sweeps (SPAXX / money-market core positions) — their
    // value is already reflected in the cash balance, so counting them as a
    // position double-counts and inflates invested/marketValue.
    .filter((p) => (p as any).cash_equivalent !== true)
    .map((p) => {
      const symbol = extractPositionTicker(p);
      const name = extractPositionName(p) || symbol;
      const units = Number((p as any).units || (p as any).fractional_units || 0);
      const price = Number((p as any).price || 0);
      const costBasisPerUnit = Number((p as any).average_purchase_price || 0);
      const openPnl = Number((p as any).open_pnl || 0);
      const dayChange = Number((p as any).day_gain || (p as any).day_change || 0);
      const dayChangePct = Number((p as any).day_gain_percentage || (p as any).day_change_pct || 0);

      return { symbol, name, units, price, costBasisPerUnit, openPnl, dayChange, dayChangePct };
    });
}

function extractArray(raw: unknown): unknown[] {
  if (raw && typeof raw === 'object' && 'results' in (raw as Record<string, unknown>)) {
    const arr = (raw as { results: unknown[] }).results;
    return Array.isArray(arr) ? arr : [];
  }
  return Array.isArray(raw) ? raw : [];
}
