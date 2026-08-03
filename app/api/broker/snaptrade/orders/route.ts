// ─── GET /api/broker/snaptrade/orders ─────────────────────
// Returns order history across all SnapTrade-connected
// brokerage accounts for the authenticated user.
// Uses SnapTrade's activities endpoint, mapped to Vantage order format.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { snapTradeFetch } from '@/lib/snaptrade/auth';
import {
  resolveSnapTradeCredentials,
  SnapTradeAuthError,
} from '@/lib/snaptrade/client';
import {
  extractOrderSymbol,
  extractOrderName,
  mapOrderSide,
} from '@/lib/snaptrade/mapping';

interface SnapTradeActivity {
  id: string;
  account_id?: string;
  currency?: string;
  // Documented SnapTrade schema: universal_symbol.symbol (two levels)
  universal_symbol?: {
    symbol: string;
    description?: string;
    currency?: string;
  };
  // Legacy fallback: symbol.symbol
  symbol?: {
    symbol: string;
    description?: string;
    currency?: string;
  };
  type: string; // BUY, SELL, DIVIDEND, INTEREST, etc.
  trade_date: string;
  settlement_date?: string;
  // ⚠️ SnapTrade returns `units` (signed: +BUY/-SELL), NOT `quantity`
  units?: number;
  price?: number;
  // ⚠️ amount is signed (snaptrade convention)
  amount?: number;
  description?: string;
  fee?: number;
  option_details?: {
    option_type?: string;
    strike_price?: number;
    expiration_date?: string;
    underlying_symbol?: string;
  };
  institution?: string;
}

interface BrokerOrder {
  id: string;
  symbol: string;
  name: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop' | 'stop_limit';
  status: string;
  qty: number;
  filledQty: number;
  limitPrice?: number;
  stopPrice?: number;
  filledPrice?: number;
  totalValue?: number;
  timeInForce: string;
  assetType?: string;
  createdAt: string;
  updatedAt: string;
  bracketOrder?: unknown;
}

// Trade types from SnapTrade activities
const TRADE_TYPES = new Set(['BUY', 'SELL', 'SELL_SHORT', 'BUY_TO_COVER', 'DIVIDEND_REINVEST']);

// ─── Dev mode — realistic synthetic orders ─────────────────
const DEV_ORDERS: BrokerOrder[] = [
  {
    id: 'dev-order-001',
    symbol: 'AAPL',
    name: 'Apple Inc.',
    side: 'buy',
    type: 'market',
    status: 'filled',
    qty: 10,
    filledQty: 10,
    filledPrice: 188.45,
    totalValue: 1884.50,
    timeInForce: 'day',
    createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 3).toISOString(),
  },
  {
    id: 'dev-order-002',
    symbol: 'MSFT',
    name: 'Microsoft Corp.',
    side: 'buy',
    type: 'limit',
    status: 'filled',
    qty: 5,
    filledQty: 5,
    limitPrice: 420.00,
    filledPrice: 419.75,
    totalValue: 2098.75,
    timeInForce: 'gtc',
    createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 5).toISOString(),
  },
  {
    id: 'dev-order-003',
    symbol: 'NVDA',
    name: 'NVIDIA Corp.',
    side: 'sell',
    type: 'limit',
    status: 'cancelled',
    qty: 3,
    filledQty: 0,
    limitPrice: 128.00,
    stopPrice: 0,
    totalValue: 0,
    timeInForce: 'gtc',
    createdAt: new Date(Date.now() - 86400000 * 6).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 3).toISOString(),
  },
  {
    id: 'dev-order-004',
    symbol: 'SPY',
    name: 'SPDR S&P 500 ETF',
    side: 'sell',
    type: 'market',
    status: 'filled',
    qty: 2,
    filledQty: 2,
    filledPrice: 538.20,
    totalValue: 1076.40,
    timeInForce: 'day',
    createdAt: new Date(Date.now() - 86400000 * 7).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 7).toISOString(),
  },
];

// ─── Map SnapTrade activity → BrokerOrder ────────────────
// Uses shared extractOrderSymbol / mapOrderSide
// from lib/snaptrade/mapping.ts — single source of truth.
function mapActivityToOrder(
  activity: SnapTradeActivity,
  accountId: string,
): BrokerOrder | null {
  const symbol = extractOrderSymbol(activity as unknown as Record<string, unknown>);
  if (!symbol || !TRADE_TYPES.has(activity.type)) return null;

  const name = extractOrderName(activity as unknown as Record<string, unknown>) || symbol;
  const side = mapOrderSide(activity.type);
  // SnapTrade activities use `units` (signed: +BUY/-SELL), NOT `quantity`
  const qty = Math.abs(activity.units || 0);
  const price = activity.price || 0;
  // amount is signed (snaptrade convention); totalValue must be absolute
  const amount = activity.amount || qty * price;
  // Activities ARE completed trades — SnapTrade doesn't expose `status` here
  const status = 'filled';

  const uniqueId = activity.id
    ? `snaptrade-${accountId}-${activity.id}`
    : `snaptrade-${accountId}-${symbol}-${activity.trade_date}-${activity.type}`;

  return {
    id: uniqueId,
    symbol,
    name,
    side,
    // Activities don't carry order_type — always market since it's historical
    type: 'market' as const,
    status,
    qty,
    filledQty: qty,
    limitPrice: undefined,
    stopPrice: undefined,
    filledPrice: price,
    totalValue: Math.abs(amount || 0),
    timeInForce: 'day',
    assetType: 'stock',
    createdAt: activity.trade_date,
    updatedAt: activity.settlement_date || activity.trade_date,
  };
}

export async function GET(_req: NextRequest) {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;

  // ── Dev mode — return synthetic orders ──────────────────
  if (!process.env.SNAPTRADE_CLIENT_ID) {
    return NextResponse.json(DEV_ORDERS);
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
    const accounts = await snapTradeFetch<{ id: string }[]>(
      `/authorizations/${authorizationId}/accounts`,
      null,
      extraParams,
    );

    if (!Array.isArray(accounts) || accounts.length === 0) {
      return NextResponse.json([]);
    }

    // ── Step B: Fetch activities for each account ──────
    const allOrders: BrokerOrder[] = [];
    const seenIds = new Set<string>();

    for (const account of accounts) {
      try {
        const raw = await snapTradeFetch<{ data?: SnapTradeActivity[] } | SnapTradeActivity[]>(
          `/accounts/${account.id}/activities`,
          null,
          extraParams,
        );

        // SnapTrade wraps activities in { data: [...] } (paginated response)
        const activities = Array.isArray(raw) ? raw : (raw?.data ?? []);

        if (!Array.isArray(activities) || activities.length === 0) continue;

        for (const activity of activities) {
          const order = mapActivityToOrder(activity, account.id);
          if (order && !seenIds.has(order.id)) {
            seenIds.add(order.id);
            allOrders.push(order);
          }
        }
      } catch (err) {
        console.error(`[snaptrade/orders] Activities fetch failed for account ${account.id}:`,
          (err as Error).message);
      }
    }

    allOrders.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return NextResponse.json(allOrders);
  } catch (err) {
    const msg = (err as Error).message;
    const statusCode = msg.includes('401') ? 401 : msg.includes('403') ? 403 : 502;
    if (statusCode === 401 || statusCode === 403) {
      return NextResponse.json(
        { error: 'Broker connection expired. Please reconnect your broker.' },
        { status: statusCode },
      );
    }
    return NextResponse.json({ error: 'Failed to fetch orders.' }, { status: 502 });
  }
}
