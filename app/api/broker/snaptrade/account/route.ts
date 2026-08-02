// ─── GET /api/broker/snaptrade/account ────────────────────
// Returns account summary for the authenticated user's
// SnapTrade-connected brokerage, using the shared
// computeAccountSummary function for BOTH SnapTrade and Demo paths.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { snapTradeFetch } from '@/lib/snaptrade/auth';
import {
  resolveSnapTradeCredentials,
  SnapTradeAuthError,
} from '@/lib/snaptrade/client';
import { computeAccountSummary, type PositionInput } from '@/lib/broker/account-summary';

// ─── Dev mode — realistic synthetic data ─────────────────
const DEV_ACCOUNT = {
  equity: 101_779.14,
  cash: 12_345.67,
  buying_power: 12_345.67,
  status: 'ACTIVE',
  currency: 'USD',
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
    return NextResponse.json({ error: 'Failed to load brokerage credentials.' }, { status: 502 });
  }

  const ep = { userId: snaptradeUserId, userSecret: snaptradeUserSecret };

  try {
    // ── Step A: List accounts (already has balance.total.amount) ──
    const accounts = await snapTradeFetch<Array<{
      id: string;
      name: string;
      number?: string;
      balance?: { total?: { amount?: number; currency?: string } };
    }>>(`/authorizations/${authorizationId}/accounts`, null, ep);

    if (!Array.isArray(accounts) || accounts.length === 0) {
      return NextResponse.json({
        equity: 0, cash: 0, buyingPower: 0,
        status: 'ACTIVE', currency: 'USD',
      });
    }

    // ── Step B: Fetch balances & positions for each account ──
    let totalCash = 0;
    let totalBuyingPower = 0;
    let totalEquityFromSnap = 0;
    const allPositions: PositionInput[] = [];

    for (const acct of accounts) {
      // Use pre-computed total from SnapTrade if available
      totalEquityFromSnap += Number(acct.balance?.total?.amount || 0);

      try {
        const balances = await snapTradeFetch<Array<{
          currency?: { code?: string };
          cash?: number;
          buying_power?: number;
        }>>(`/accounts/${acct.id}/balances`, null, ep);

        if (Array.isArray(balances)) {
          for (const b of balances) {
            totalCash += Number(b.cash || 0);
            totalBuyingPower += Number(b.buying_power || 0);
          }
        }
      } catch { /* partial failure OK */ }

      try {
        const rawPositions = await snapTradeFetch<unknown>(
          `/accounts/${acct.id}/positions`, null, ep,
        );
        const positions = normalisePositions(rawPositions);
        allPositions.push(...positions);
      } catch { /* partial failure OK */ }
    }

    // ── Step C: Compute using the SHARED function ───────
    const summary = computeAccountSummary(totalCash, totalBuyingPower, allPositions);

    // Prefer the broker-reported total (more accurate for complex accounts)
    // but fall back to computed if it's zero or missing
    const finalEquity = totalEquityFromSnap > 0 ? totalEquityFromSnap : summary.totalValue;

    return NextResponse.json({
      equity: finalEquity,
      cash: summary.cash,
      buyingPower: summary.buyingPower,
      invested: summary.invested,
      marketValue: summary.marketValue,
      dayChange: summary.dayChange,
      dayChangePct: summary.dayChangePct,
      totalPnl: summary.totalPnl,
      totalPnlPct: summary.totalPnlPct,
      status: 'ACTIVE',
      currency: 'USD',
      _debug: {
        equitySource: totalEquityFromSnap > 0 ? 'snaptrade_balance_total' : 'computed',
        snapEquity: totalEquityFromSnap,
        computedEquity: summary.totalValue,
        positionCount: allPositions.length,
      },
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

// ─── Position normaliser — handles SnapTrade's triple-nested symbol ───
// raw: position.symbol.symbol.symbol → "TSLA"
// raw: position.symbol.symbol.description → "Tesla, Inc."
// raw: position.units → 10 (NOT "quantity")
// raw: position.price → 311.21
// raw: position.average_purchase_price → cost basis per unit
// raw: position.open_pnl → unrealized P&L

function normalisePositions(raw: unknown): PositionInput[] {
  const list = extractArray(raw);
  if (!list.length) return [];

  return list
    .filter((p): p is Record<string, unknown> => p !== null && typeof p === 'object')
    .map((p) => {
      const sym = extractSymbol(p);
      const units = Number((p as any).units || (p as any).fractional_units || 0);
      const price = Number((p as any).price || 0);
      const costPerUnit = Number((p as any).average_purchase_price || 0);
      const openPnl = Number((p as any).open_pnl || 0);

      return {
        symbol: sym.symbol,
        name: sym.description || sym.symbol,
        units,
        price,
        costBasisPerUnit: costPerUnit,
        openPnl,
      };
    });
}

function extractArray(raw: unknown): unknown[] {
  if (raw && typeof raw === 'object' && 'results' in (raw as Record<string, unknown>)) {
    const arr = (raw as { results: unknown[] }).results;
    return Array.isArray(arr) ? arr : [];
  }
  return Array.isArray(raw) ? raw : [];
}

function extractSymbol(p: Record<string, unknown>): { symbol: string; description: string } {
  const s = (p as any).symbol;
  if (!s || typeof s !== 'object') {
    // flat format: position.symbol = "TSLA"
    return { symbol: String(s || ''), description: String((p as any).name || (p as any).description || '') };
  }

  // SnapTrade nested: position.symbol.symbol.symbol
  const inner = s.symbol;
  if (inner && typeof inner === 'object') {
    return {
      symbol: String(inner.symbol || ''),
      description: String(inner.description || s.description || ''),
    };
  }

  // position.symbol.symbol = "TSLA" (string)
  if (typeof s.symbol === 'string') {
    return {
      symbol: s.symbol,
      description: String(s.description || s.name || ''),
    };
  }

  return { symbol: '', description: '' };
}
