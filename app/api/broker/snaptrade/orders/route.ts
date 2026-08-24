// ─── GET /api/broker/snaptrade/orders ─────────────────────
// Fetches orders from SnapTrade's recentOrders endpoint via
// SnapTradeBroker.getOrders(). Returns BOTH open and filled
// orders with correct status (was previously activities-only,
// hardcoded to 'filled').
//
// Phase 6: Open→filled lifecycle tracking.
// Client polls this every 30s — orders transition automatically.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import {
  resolveSnapTradeCredentials,
  SnapTradeAuthError,
  SnapTradeAmbiguousError,
} from '@/lib/snaptrade/client';
import { SnapTradeBroker } from '@/lib/broker/snaptrade-broker';
import { formatBrokerName } from '@/lib/broker-name';

// ─── Dev mode — realistic orders with mixed status ─────────
const DEV_ORDERS = [
  {
    id: 'dev-order-001', symbol: 'AAPL', name: 'Apple Inc.',
    side: 'buy' as const, type: 'market' as const, status: 'filled' as const,
    qty: 10, filledQty: 10, filledPrice: 188.45, totalValue: 1884.50,
    timeInForce: 'day', createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 3).toISOString(),
  },
  {
    id: 'dev-order-002', symbol: 'MSFT', name: 'Microsoft Corp.',
    side: 'buy' as const, type: 'limit' as const, status: 'filled' as const,
    qty: 5, filledQty: 5, limitPrice: 420.00, filledPrice: 419.75, totalValue: 2098.75,
    timeInForce: 'gtc', createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 5).toISOString(),
  },
  {
    id: 'dev-order-003', symbol: 'NVDA', name: 'NVIDIA Corp.',
    side: 'sell' as const, type: 'limit' as const, status: 'cancelled' as const,
    qty: 3, filledQty: 0, limitPrice: 128.00, totalValue: 0,
    timeInForce: 'gtc', createdAt: new Date(Date.now() - 86400000 * 6).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 3).toISOString(),
  },
  {
    id: 'dev-order-005', symbol: 'SPY', name: 'SPDR S&P 500 ETF',
    side: 'buy' as const, type: 'market' as const, status: 'open' as const,
    qty: 2, filledQty: 0, totalValue: 0,
    timeInForce: 'day', createdAt: new Date(Date.now() - 3600000).toISOString(),
    updatedAt: new Date(Date.now() - 3600000).toISOString(),
  },
];

/**
 * Map SnapTradeBroker's BrokerOrder (lib/broker/types.ts format) →
 * the format expected by the client adapter (types/broker.ts format).
 *
 * SnapTradeBroker returns: { shares, submittedPrice, fillPrice, totalCost, submittedAt, filledAt }
 * Client adapter expects:   { qty, filledQty, filledPrice, totalValue, timeInForce, createdAt, updatedAt }
 */
function mapToClientFormat(raw: {
  id: string; symbol: string; side: string; type: string;
  status: string; shares: number;
  submittedPrice: number; limitPrice?: number; stopPrice?: number;
  fillPrice?: number; totalCost: number;
  submittedAt: string; filledAt?: string; cancelledAt?: string;
}) {
  const statusLower = raw.status.toLowerCase();
  const isFilled = statusLower === 'filled';
  return {
    id: raw.id,
    symbol: raw.symbol,
    name: raw.symbol, // name not available from SnapTradeBroker format
    side: raw.side.toLowerCase() as 'buy' | 'sell',
    type: raw.type,
    status: statusLower,
    qty: raw.shares || 0,
    filledQty: isFilled ? (raw.shares || 0) : 0,
    limitPrice: raw.limitPrice,
    stopPrice: raw.stopPrice,
    filledPrice: raw.fillPrice,
    totalValue: raw.totalCost || 0,
    timeInForce: 'day',
    createdAt: raw.submittedAt,
    updatedAt: raw.filledAt || raw.submittedAt,
  };
}

export async function GET(req: NextRequest) {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;

  // ── Dev mode — return synthetic orders ──────────────────
  if (!process.env.SNAPTRADE_CLIENT_ID) {
    return NextResponse.json(DEV_ORDERS);
  }

  // ── Resolve credentials ──────────────────────────────
  const connectionId = req.nextUrl.searchParams.get('connectionId');
  let snaptradeUserId: string;
  let snaptradeUserSecret: string;
  let authorizationId: string;
  let brokerSlug: string;
  try {
    const creds = await resolveSnapTradeCredentials(authUser.id, connectionId);
    snaptradeUserId = creds.snaptradeUserId;
    snaptradeUserSecret = creds.snaptradeUserSecret;
    authorizationId = creds.connectionId;
    brokerSlug = creds.brokerSlug;
  } catch (err) {
    if (err instanceof SnapTradeAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof SnapTradeAmbiguousError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'Failed to load brokerage credentials.' }, { status: 502 });
  }

  try {
    const broker = new SnapTradeBroker({
      userId: snaptradeUserId,
      userSecret: snaptradeUserSecret,
      connectionId: authorizationId,
      brokerSlug,
      brokerName: formatBrokerName(brokerSlug),
      tradingEnabled: true, // orders always visible even if read-only
    });

    const rawOrders = await broker.getOrders();

    // Map from SnapTradeBroker format → client adapter format
    const mapped = rawOrders.map(mapToClientFormat);

    return NextResponse.json(mapped);
  } catch (err) {
    const msg = (err as Error).message;
    console.error('[snaptrade/orders] Error:', msg);
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
