// ─── GET /api/broker/snaptrade/positions ──────────────────
// Returns aggregated positions across all SnapTrade-connected
// brokerage accounts for the authenticated user.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { snapTradeFetch } from '@/lib/snaptrade/auth';
import {
  resolveSnapTradeCredentials,
  SnapTradeAuthError,
  SnapTradeAmbiguousError,
} from '@/lib/snaptrade/client';
import { extractPositionTicker, extractPositionName } from '@/lib/snaptrade/mapping';

export interface SnapTradePosition {
  symbol: string;
  name: string;
  units: number;
  price: number;
  marketValue: number;
  costBasis: number;
  openPnl: number;
  dayChange: number;
  dayChangePct: number;
  assetType: string;
  currency: string;
}

// ─── Dev mode — synthetic portfolio ────────────────────────
const DEV_POSITIONS: SnapTradePosition[] = [
  { symbol: 'AAPL', name: 'Apple Inc.', units: 50, price: 192.58, marketValue: 9629.00, costBasis: 8750.00, openPnl: 879.00, dayChange: 85.50, dayChangePct: 0.89, assetType: 'stock', currency: 'USD' },
  { symbol: 'MSFT', name: 'Microsoft Corp.', units: 30, price: 428.15, marketValue: 12844.50, costBasis: 11250.00, openPnl: 1594.50, dayChange: 42.90, dayChangePct: 0.33, assetType: 'stock', currency: 'USD' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', units: 40, price: 121.44, marketValue: 4857.60, costBasis: 3800.00, openPnl: 1057.60, dayChange: -28.80, dayChangePct: -0.59, assetType: 'stock', currency: 'USD' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', units: 25, price: 178.33, marketValue: 4458.25, costBasis: 4125.00, openPnl: 333.25, dayChange: 18.75, dayChangePct: 0.42, assetType: 'stock', currency: 'USD' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', units: 35, price: 196.21, marketValue: 6867.35, costBasis: 6300.00, openPnl: 567.35, dayChange: 52.50, dayChangePct: 0.77, assetType: 'stock', currency: 'USD' },
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF', units: 20, price: 535.78, marketValue: 10715.60, costBasis: 9450.00, openPnl: 1265.60, dayChange: -21.40, dayChangePct: -0.20, assetType: 'etf', currency: 'USD' },
  { symbol: 'TSLA', name: 'Tesla, Inc.', units: 15, price: 248.50, marketValue: 3727.50, costBasis: 3300.00, openPnl: 427.50, dayChange: 18.75, dayChangePct: 0.50, assetType: 'stock', currency: 'USD' },
  { symbol: 'QQQ', name: 'Invesco QQQ Trust', units: 15, price: 478.62, marketValue: 7179.30, costBasis: 6300.00, openPnl: 879.30, dayChange: 35.85, dayChangePct: 0.50, assetType: 'etf', currency: 'USD' },
];

export async function GET(req: NextRequest) {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;

  if (!process.env.SNAPTRADE_CLIENT_ID) {
    return NextResponse.json(DEV_POSITIONS);
  }

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
    return NextResponse.json({ error: 'Failed to load brokerage credentials.' }, { status: 502 });
  }

  const ep = { userId: snaptradeUserId, userSecret: snaptradeUserSecret };

  try {
    const accounts = await snapTradeFetch<Array<{ id: string; name: string }>>(
      `/authorizations/${authorizationId}/accounts`, null, ep,
    );

    if (!Array.isArray(accounts) || accounts.length === 0) {
      return NextResponse.json([]);
    }

    const allPositions: SnapTradePosition[] = [];

    // Fetch positions for every account in parallel (removes sequential
    // SnapTrade round-trips that made multi-account portfolios load slowly).
    const perAccount = await Promise.allSettled(
      accounts.map(async (acct) => {
        const raw = await snapTradeFetch<unknown>(
          `/accounts/${acct.id}/positions`, null, ep,
        );
        return flattenPositions(raw);
      }),
    );

    for (const r of perAccount) {
      if (r.status === 'fulfilled') {
        allPositions.push(...r.value);
      } else {
        console.error(`[snaptrade/positions] fetch failed:`, (r.reason as Error)?.message);
      }
    }

    return NextResponse.json(allPositions);
  } catch (err) {
    const msg = (err as Error).message;
    const statusCode = msg.includes('401') ? 401 : msg.includes('403') ? 403 : 502;
    if (statusCode === 401 || statusCode === 403) {
      return NextResponse.json(
        { error: 'Broker connection expired. Please reconnect your broker.' },
        { status: statusCode },
      );
    }
    return NextResponse.json({ error: 'Failed to load positions.' }, { status: 502 });
  }
}

// ─── Position normaliser — SnapTrade confirmed schema ─────
//
// SnapTrade position shape (from live data + documentation):
//   position.symbol.symbol.symbol   → "TSLA"     (3 levels)
//   position.symbol.symbol.description → "Tesla, Inc."
//   position.units                  → 10         (NOT "quantity")
//   position.price                  → 311.21
//   position.average_purchase_price → cost basis
//   position.open_pnl               → unrealized P&L
//
// Uses shared extractPositionTicker / extractPositionName
// from lib/snaptrade/mapping.ts — one source of truth.

function flattenPositions(raw: unknown): SnapTradePosition[] {
  const list = extractArray(raw);
  if (!list.length) return [];

  return list
    .filter((p): p is Record<string, unknown> => p !== null && typeof p === 'object')
    .map((p) => {
      const symbol = extractPositionTicker(p);
      const name = extractPositionName(p) || symbol;
      const units = Number((p as any).units || (p as any).fractional_units || (p as any).quantity || 0);
      const price = Number((p as any).price || 0);
      const costPerUnit = Number((p as any).average_purchase_price || (p as any).cost_basis || 0);
      const marketValue = units * price;
      const costBasis = units * costPerUnit;
      const openPnl = Number((p as any).open_pnl || 0) || (marketValue - costBasis);
      const dayChange = Number((p as any).day_gain || (p as any).day_change || 0);
      const dayChangePct = Number((p as any).day_gain_percentage || (p as any).day_change_pct || 0);

      return {
        symbol,
        name,
        units,
        price,
        marketValue,
        costBasis,
        openPnl,
        dayChange,
        dayChangePct,
        assetType: 'stock',
        currency: 'USD',
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
