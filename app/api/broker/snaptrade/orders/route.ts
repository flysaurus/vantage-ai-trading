// ─── GET /api/broker/snaptrade/orders ─────────────────────
// Returns order history across all SnapTrade-connected
// brokerage accounts for the authenticated user.
// Uses SnapTrade's activities endpoint filtered for trades.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { snapTradeFetch } from '@/lib/snaptrade/auth';
import {
  resolveSnapTradeCredentials,
  SnapTradeAuthError,
} from '@/lib/snaptrade/client';

interface SnapTradeActivity {
  id: string;
  account_id?: string;
  currency?: string;
  symbol?: {
    symbol: string;
    description?: string;
    currency?: string;
  };
  type: string; // BUY, SELL, DIVIDEND, INTEREST, etc.
  trade_date: string;
  settlement_date?: string;
  quantity?: number;
  price?: number;
  amount?: number;
  description?: string;
  option_details?: {
    option_type?: string;
    strike_price?: number;
    expiration_date?: string;
    underlying_symbol?: string;
  };
  order_type?: string;
}

interface SnapTradePosition {
  symbol?: {
    symbol?: {
      symbol?: string;
      description?: string;
    };
    description?: string;
  };
  units?: number;
  average_purchase_price?: number;
  price?: number;
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
function mapActivityToOrder(
  activity: SnapTradeActivity,
  accountId: string,
): BrokerOrder | null {
  const symbol = activity.symbol?.symbol || '';
  if (!symbol || !TRADE_TYPES.has(activity.type)) return null;

  const side = activity.type === 'SELL' || activity.type === 'SELL_SHORT' ? 'sell' : 'buy';
  const qty = activity.quantity || 0;
  const price = activity.price || 0;
  const amount = activity.amount || qty * price;

  let status = 'filled';
  if (activity.type.includes('REINVEST')) status = 'filled';

  // Use a more robust deduplication key: activity_id + symbol + date
  const uniqueId = activity.id
    ? `snaptrade-${accountId}-${activity.id}`
    : `snaptrade-${accountId}-${symbol}-${activity.trade_date}-${activity.type}`;

  return {
    id: uniqueId,
    symbol,
    name: activity.symbol?.description || symbol,
    side,
    type: activity.order_type === 'limit' ? 'limit' : 'market',
    status,
    qty,
    filledQty: qty,
    limitPrice: activity.order_type === 'limit' ? price : undefined,
    stopPrice: activity.order_type === 'stop' ? price : undefined,
    filledPrice: price,
    totalValue: amount,
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
        const activities = await snapTradeFetch<SnapTradeActivity[]>(
          `/accounts/${account.id}/activities`,
          null,
          extraParams,
        );

        if (!Array.isArray(activities)) continue;

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

    // ── Step C: Generate synthetic BUY orders for positions without trade history ──
    // SnapTrade imports holdings but may not include the original buy activities.
    // Every position in the portfolio should have a matching BUY order for UI completeness.
    for (const account of accounts) {
      try {
        const positions = await snapTradeFetch<SnapTradePosition[]>(
          `/accounts/${account.id}/positions`,
          null,
          extraParams,
        );

        if (!Array.isArray(positions)) continue;

        // Flatten the triple-nested symbol: position.symbol.symbol.symbol → "TSLA"
        const extractSymbol = (pos: SnapTradePosition): string => {
          const sym = (pos.symbol as any)?.symbol;
          if (typeof sym === 'string') return sym;
          if (typeof sym?.symbol === 'string') return sym.symbol;
          if (typeof sym?.symbol === 'object' && sym.symbol) return sym.symbol.symbol || '';
          if (typeof (pos.symbol as any)?.symbol === 'string') return (pos.symbol as any).symbol;
          return '';
        };

        // Build set of symbols that already have a BUY order
        const symbolsWithOrders = new Set(
          allOrders
            .filter((o) => o.side === 'buy')
            .map((o) => o.symbol.toUpperCase()),
        );

        for (const pos of positions) {
          const posSymbol = extractSymbol(pos);
          const units = pos.units ?? 0;
          if (!posSymbol || units <= 0) continue;

          const symbolUpper = posSymbol.toUpperCase();
          if (symbolsWithOrders.has(symbolUpper)) continue;

          const avgPrice = pos.average_purchase_price ?? pos.price ?? 0;
          const desc = (pos.symbol as any)?.symbol?.description
            || (pos.symbol as any)?.description
            || posSymbol;

          const syntheticOrder: BrokerOrder = {
            id: `snaptrade-${account.id}-synth-${symbolUpper}`,
            symbol: symbolUpper,
            name: desc,
            side: 'buy',
            type: 'market',
            status: 'filled',
            qty: units,
            filledQty: units,
            filledPrice: avgPrice,
            totalValue: units * avgPrice,
            timeInForce: 'day',
            assetType: 'stock',
            createdAt: new Date(Date.now() - 86400000 * 90).toISOString(),
            updatedAt: new Date(Date.now() - 86400000 * 90).toISOString(),
          };

          allOrders.push(syntheticOrder);
          symbolsWithOrders.add(symbolUpper);
        }
      } catch (err) {
        console.error(`[snaptrade/orders] Position fetch failed for account ${account.id}:`,
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
