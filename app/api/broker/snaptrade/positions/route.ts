// ─── GET /api/broker/snaptrade/positions ──────────────────
// Returns aggregated positions across all SnapTrade-connected
// brokerage accounts for the authenticated user.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { snapTradeFetch } from '@/lib/snaptrade/auth';
import {
  resolveSnapTradeCredentials,
  SnapTradeAuthError,
} from '@/lib/snaptrade/client';

interface SnapTradeAccount {
  id: string;
  name: string;
}

interface SnapTradePosition {
  symbol: string;
  name?: string;
  quantity: number;
  price: number;
  market_value: number;
  cost_basis: number;
  day_change: number;
  day_change_pct: number;
  total_pnl: number;
  total_pnl_pct: number;
  asset_type?: string;
}

interface UnifiedPosition {
  instrument?: { kind?: string; symbol?: string; description?: string; currency?: string };
  symbol?: string;
  name?: string;
  description?: string;
  quantity: number;
  price: number;
  market_value?: number;
  cost_basis?: number;
  day_gain?: number;
  day_gain_percentage?: number;
  total_gain_percentage?: number;
  total_pnl?: number;
  total_pnl_pct?: number;
  day_change?: number;
  day_change_pct?: number;
  asset_type?: string;
}

// ─── Dev mode — synthetic portfolio ─────────────────────
const DEV_POSITIONS: SnapTradePosition[] = [
  { symbol: 'AAPL', name: 'Apple Inc.', quantity: 50, price: 192.58, market_value: 9629.00, cost_basis: 8750.00, day_change: 85.50, day_change_pct: 0.89, total_pnl: 879.00, total_pnl_pct: 10.05, asset_type: 'stock' },
  { symbol: 'MSFT', name: 'Microsoft Corp.', quantity: 30, price: 428.15, market_value: 12844.50, cost_basis: 11250.00, day_change: 42.90, day_change_pct: 0.33, total_pnl: 1594.50, total_pnl_pct: 14.17, asset_type: 'stock' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', quantity: 40, price: 121.44, market_value: 4857.60, cost_basis: 3800.00, day_change: -28.80, day_change_pct: -0.59, total_pnl: 1057.60, total_pnl_pct: 27.83, asset_type: 'stock' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', quantity: 25, price: 178.33, market_value: 4458.25, cost_basis: 4125.00, day_change: 18.75, day_change_pct: 0.42, total_pnl: 333.25, total_pnl_pct: 8.08, asset_type: 'stock' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', quantity: 35, price: 196.21, market_value: 6867.35, cost_basis: 6300.00, day_change: 52.50, day_change_pct: 0.77, total_pnl: 567.35, total_pnl_pct: 9.01, asset_type: 'stock' },
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF', quantity: 20, price: 535.78, market_value: 10715.60, cost_basis: 9450.00, day_change: -21.40, day_change_pct: -0.20, total_pnl: 1265.60, total_pnl_pct: 13.39, asset_type: 'etf' },
  { symbol: 'TSLA', name: 'Tesla Inc.', quantity: 15, price: 248.50, market_value: 3727.50, cost_basis: 3300.00, day_change: 18.75, day_change_pct: 0.50, total_pnl: 427.50, total_pnl_pct: 12.95, asset_type: 'stock' },
  { symbol: 'QQQ', name: 'Invesco QQQ Trust', quantity: 15, price: 478.62, market_value: 7179.30, cost_basis: 6300.00, day_change: 35.85, day_change_pct: 0.50, total_pnl: 879.30, total_pnl_pct: 13.96, asset_type: 'etf' },
];

function normalisePositions(raw: unknown): SnapTradePosition[] {
  if (raw && typeof raw === 'object' && 'results' in (raw as Record<string, unknown>)) {
    const list = (raw as { results: UnifiedPosition[] }).results;
    if (!Array.isArray(list)) return [];
    return list.map(normaliseOne);
  }
  if (Array.isArray(raw)) return raw.map(normaliseOne);
  return [];
}

function normaliseOne(p: UnifiedPosition): SnapTradePosition {
  const inst = p.instrument;
  const symbol = inst?.symbol || p.symbol || '';
  const name = inst?.description || p.name || p.description;
  const marketValue = p.market_value ?? 0;
  const costBasis = p.cost_basis ?? 0;
  const dayChange = p.day_gain ?? p.day_change ?? 0;
  const dayChangePct = p.day_gain_percentage ?? p.day_change_pct ?? 0;
  const totalPnl = p.total_pnl ?? (marketValue - costBasis);
  const totalPnlPct = p.total_pnl_pct ?? p.total_gain_percentage ?? (costBasis > 0 ? (totalPnl / costBasis) * 100 : 0);
  return {
    symbol,
    name: name || symbol,
    quantity: p.quantity || 0,
    price: p.price || 0,
    market_value: marketValue,
    cost_basis: costBasis,
    day_change: dayChange,
    day_change_pct: dayChangePct,
    total_pnl: totalPnl,
    total_pnl_pct: totalPnlPct,
    asset_type: inst?.kind || p.asset_type || 'stock',
  };
}

export async function GET(_req: NextRequest) {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;

  // ── Dev mode — return synthetic data ─────────────────
  if (!process.env.SNAPTRADE_CLIENT_ID) {
    return NextResponse.json(DEV_POSITIONS);
  }

  // ── Resolve credentials ──────────────────────────────
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

  const extraParams = { userId: snaptradeUserId, userSecret: snaptradeUserSecret };

  try {
    // ── Step A: List accounts for this authorization ──
    const accounts = await snapTradeFetch<SnapTradeAccount[]>(
      `/authorizations/${authorizationId}/accounts`,
      null,
      extraParams,
    );

    if (!Array.isArray(accounts) || accounts.length === 0) {
      return NextResponse.json([]);
    }

    // ── Step B: Fetch positions for each account ───────
    const allPositions: SnapTradePosition[] = [];

    for (const account of accounts) {
      try {
        const raw = await snapTradeFetch<unknown>(
          `/accounts/${account.id}/positions`,
          null,
          extraParams,
        );
        const normalised = normalisePositions(raw);
        if (normalised.length > 0) {
          allPositions.push(...normalised);
        }
      } catch (posErr) {
        console.error(`[snaptrade/positions] Fetch failed for account ${account.id}:`,
          (posErr as Error).message);
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
