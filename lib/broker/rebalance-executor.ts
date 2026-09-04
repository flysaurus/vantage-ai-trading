// ─── Rebalance order execution (SnapTrade) ────────────────────
// Pure/deterministic pieces of the rebalance execute flow, extracted from
// `app/api/strategies/rebalancing/execute/route.ts` so the order-request
// mapping + persist row + per-leg outcome can be unit-tested without the
// Next.js request/response layer.
//
// ⚠️ REAL MONEY: these build real market orders (BUY/SELL). Do not call
// outside the rebalance execute route (which gates on auth + tradingEnabled).
// ──────────────────────────────────────────────────────────────

import type { OrderRequest, OrderResult } from '@/lib/broker/types';

export interface RebalanceTrade {
  symbol: string;
  action: 'buy' | 'sell';
  shares: number;
  estimatedValue: number;
}

export interface RebalanceLegOutcome {
  symbol: string;
  success: boolean;
  orderId: string | null;
  error: string | null;
  persisted: boolean;
}

/** Pre-broker sentinel order ids — placeOrder() returned these WITHOUT an HTTP
 *  call to SnapTrade (validation failures). Never persist them to `orders`. */
export const PHANTOM_ORDER_IDS: ReadonlySet<string> = new Set([
  'readonly',
  'no-account',
  'bad-symbol',
  'no-qty',
  'unknown',
]);

/** Map a rebalance trade → a SnapTrade order request (market, day, shares). */
export function buildRebalanceOrderRequest(
  trade: RebalanceTrade,
  clientOrderId: string,
): OrderRequest {
  return {
    symbol: trade.symbol.toUpperCase(),
    side: trade.action === 'buy' ? 'BUY' : 'SELL',
    type: 'market',
    shares: trade.shares,
    timeInForce: 'day',
    clientOrderId,
  };
}

/** Build the `orders` insert row for a share-based leg. `source` tags the
 *  order's origin (rebalance / tax_harvest) for downstream attribution. */
export function buildRebalanceInsertRow(params: {
  orderId: string;
  userId: string;
  brokerConnectionId: string;
  trade: RebalanceTrade;
  result: OrderResult;
  now: string;
  source?: string;
}): Record<string, unknown> {
  const { orderId, userId, brokerConnectionId, trade, result, now, source = 'rebalance' } = params;
  const symbol = trade.symbol.toUpperCase();
  const requestedAmount =
    result.fillPrice && result.fillPrice > 0
      ? Number((trade.shares * result.fillPrice).toFixed(2))
      : null;
  return {
    id: orderId,
    user_id: userId,
    connection_id: brokerConnectionId,
    symbol,
    qty: trade.shares,
    order_unit: 'shares',
    requested_amount: requestedAmount,
    requested_qty: trade.shares,
    filled_qty: result.status === 'FILLED' ? (result.filledShares || trade.shares) : 0,
    side: trade.action,
    order_type: 'market',
    status: (result.status || 'OPEN').toLowerCase(),
    filled_price: result.fillPrice || null,
    filled_at: result.filledAt || (result.status === 'FILLED' ? now : null),
    time_in_force: 'day',
    is_demo: false,
    brokerage_order_id: result.orderId || null,
    source,
    created_at: now,
  };
}

/**
 * Place ONE rebalance leg and persist it. Returns a structured outcome; never
 * throws (broker/network + persist failures are captured). A phantom
 * (pre-broker) result is returned without persisting.
 */
export async function placeRebalanceTrade(
  broker: { placeOrder: (req: OrderRequest) => Promise<OrderResult> },
  supabase: { from: (table: string) => any },
  params: { userId: string; brokerConnectionId: string; trade: RebalanceTrade },
  source: string = 'rebalance',
): Promise<RebalanceLegOutcome> {
  const { userId, brokerConnectionId, trade } = params;
  const symbol = trade.symbol.toUpperCase();
  const vantageOrderId = crypto.randomUUID();
  const orderReq = buildRebalanceOrderRequest(trade, vantageOrderId);

  let result: OrderResult;
  try {
    result = await broker.placeOrder(orderReq);
  } catch (e: any) {
    return {
      symbol,
      success: false,
      orderId: null,
      error: `${symbol}: ${e?.message || 'order placement failed'}`,
      persisted: false,
    };
  }

  const error = result.success ? null : result.message || 'rejected by broker';

  let persisted = false;
  const isPhantom = PHANTOM_ORDER_IDS.has(result.orderId || '');
  if (!isPhantom) {
    try {
      const row = buildRebalanceInsertRow({
        orderId: vantageOrderId,
        userId,
        brokerConnectionId,
        trade,
        result,
        now: new Date().toISOString(),
        source,
      });
      await supabase.from('orders').insert(row).select('id').single();
      persisted = true;
    } catch (persistErr: any) {
      // Non-fatal — the broker order is already live; the sync cron reconciles.
      console.error('[rebalance] ⚠️ order persist failed:', persistErr?.message);
    }
  }

  return {
    symbol,
    success: result.success,
    orderId: result.success ? result.orderId : null,
    error,
    persisted,
  };
}
