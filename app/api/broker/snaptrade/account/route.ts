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
} from '@/lib/snaptrade/client';
import { computeAccountSummary, type PositionInput } from '@/lib/broker/account-summary';
import { extractPositionTicker, extractPositionName } from '@/lib/snaptrade/mapping';

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

export async function GET(_req: NextRequest) {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;

  if (!process.env.SNAPTRADE_CLIENT_ID) {
    return NextResponse.json(DEV_ACCOUNT);
  }

  // ── Resolve credentials ────────────────────────────────
  let snaptradeUserId: string;
  let snaptradeUserSecret: string;
  let authorizationId: string;
  try {
    const creds = await resolveSnapTradeCredentials(authUser.id);
    snaptradeUserId = creds.snaptradeUserId;
    snaptradeUserSecret = creds.snaptradeUserSecret;
    authorizationId = creds.connectionId;
  } catch (err) {
    if (err instanceof SnapTradeAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: 'Failed to load brokerage credentials.' },
      { status: 502 },
    );
  }

  const ep = { userId: snaptradeUserId, userSecret: snaptradeUserSecret };

  try {
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
      return NextResponse.json({
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
      });
    }

    // ── Step B: Aggregate across all accounts ────────────
    let totalCash = 0;
    let totalBuyingPower: number | null = 0;
    let totalEquityFromSnap = 0;
    let latestSync: string | null = null;
    let anyHoldingsUnavailable = false;
    let accountStatus: 'open' | 'closed' | 'archived' | null = null;
    const allPositions: PositionInput[] = [];

    for (const acct of accounts) {
      totalEquityFromSnap += Number(acct.balance?.total?.amount || 0);

      // Connection metadata — live, per-account
      const sync = acct.sync_status?.holdings?.last_successful_sync;
      if (sync && (!latestSync || sync > latestSync)) latestSync = sync;
      if (acct.sync_status?.holdings?.holdings_unavailable) anyHoldingsUnavailable = true;

      const s = (acct.status || '').toLowerCase();
      if (s === 'closed' || s === 'archived') {
        accountStatus = s as 'closed' | 'archived';
      } else if (!accountStatus && s === 'open') {
        accountStatus = 'open';
      }

      try {
        const balances = await snapTradeFetch<Array<{
          currency?: { code?: string };
          cash?: number;
          buying_power?: number;
        }>>(`/accounts/${acct.id}/balances`, null, ep);
        if (Array.isArray(balances)) {
          for (const b of balances) {
            totalCash += Number(b.cash || 0);
            totalBuyingPower! += Number(b.buying_power || 0);
          }
        }
      } catch { /* partial failure OK */ }

      try {
        const rawPositions = await snapTradeFetch<unknown>(
          `/accounts/${acct.id}/positions`, null, ep,
        );
        allPositions.push(...normalisePositions(rawPositions));
      } catch { /* partial failure OK */ }
    }

    // ── Step C: Compute using SHARED function ──────────
    const summary = computeAccountSummary(totalCash, totalBuyingPower ?? 0, allPositions);

    // Prefer SnapTrade's own total, fall back to computed
    const finalEquity = totalEquityFromSnap > 0 ? totalEquityFromSnap : summary.totalValue;

    return NextResponse.json({
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
        quantity: p.units,
        price: p.price,
        costBasis: p.units > 0 && p.costBasisPerUnit ? p.units * p.costBasisPerUnit : null,
        marketValue: p.units * p.price,
        openPnl: p.openPnl,
        dayChange: 0,
        dayChangePct: 0,
        portfolioPercent: 0,
        assetType: 'stock' as const,
        currency: 'USD',
      })),
      orders: [], // orders come from the dedicated /orders endpoint
    });
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
    .map((p) => {
      const symbol = extractPositionTicker(p);
      const name = extractPositionName(p) || symbol;
      const units = Number((p as any).units || (p as any).fractional_units || 0);
      const price = Number((p as any).price || 0);
      const costBasisPerUnit = Number((p as any).average_purchase_price || 0);
      const openPnl = Number((p as any).open_pnl || 0);

      return { symbol, name, units, price, costBasisPerUnit, openPnl };
    });
}

function extractArray(raw: unknown): unknown[] {
  if (raw && typeof raw === 'object' && 'results' in (raw as Record<string, unknown>)) {
    const arr = (raw as { results: unknown[] }).results;
    return Array.isArray(arr) ? arr : [];
  }
  return Array.isArray(raw) ? raw : [];
}
