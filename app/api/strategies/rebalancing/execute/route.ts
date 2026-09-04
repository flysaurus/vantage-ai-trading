// ─── POST /api/strategies/rebalancing/execute ───────────────
// Executes rebalancing trades via SnapTrade (the connected live broker).
// Rewired from the legacy direct-Alpaca path (getBrokerContext + makeAlpacaRequest)
// to resolveSnapTradeCredentials + SnapTradeBroker.placeOrder — the same engine
// as /api/broker/execute-trade and the DCA scheduler.
//
// ═══════════════════════════════════════════════════════════════
// REAL MONEY: each trade in `trades` is a live market order. The client only
// calls this after the user confirms the rebalance on the setup page. There is
// no trade-gate/idempotency here (no chat messageId for a batch UI flow), so
// the endpoint resolves the SOLE connected brokerage and rejects ambiguity.
// ═══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';
import {
  resolveSnapTradeCredentials,
  SnapTradeAuthError,
  SnapTradeAmbiguousError,
} from '@/lib/snaptrade/client';
import { SnapTradeBroker } from '@/lib/broker/snaptrade-broker';
import { formatBrokerName } from '@/lib/broker-name';
import { placeRebalanceTrade, type RebalanceTrade } from '@/lib/broker/rebalance-executor';

interface TradePayload {
  symbol: string;
  action: 'buy' | 'sell';
  shares: number;
  estimatedValue: number;
}

export const maxDuration = 55;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const userId = authUser!.id;

  try {
    const supabase = createServerClient();
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Missing request body' }, { status: 400 });
    }

    const { trades, targetAllocations, alertOnDrift, driftThreshold, connectionId } = body as {
      trades: TradePayload[];
      targetAllocations: Record<string, number>;
      alertOnDrift?: boolean;
      driftThreshold?: number;
      connectionId?: string | null;
    };

    if (!trades || !Array.isArray(trades) || trades.length === 0) {
      return NextResponse.json({ error: 'No trades to execute' }, { status: 400 });
    }

    // Validate each trade (symbol + action + positive share count).
    for (const t of trades) {
      if (!t.symbol || !['buy', 'sell'].includes(t.action) || !t.shares || t.shares <= 0) {
        return NextResponse.json({ error: `Invalid trade: ${JSON.stringify(t)}` }, { status: 400 });
      }
    }

    // ── Resolve the connected SnapTrade brokerage ──
    // connectionId is optional: the UI flow currently omits it, so we resolve
    // the SOLE connected brokerage. Ambiguity (multiple brokers) is rejected —
    // we never guess which account to move real money in.
    let snaptradeUserId: string;
    let snaptradeUserSecret: string;
    let snaptradeConnectionId: string;
    let brokerConnectionId: string;
    let brokerSlug: string;
    let tradingEnabled: boolean;

    try {
      const creds = await resolveSnapTradeCredentials(userId, connectionId ?? null);
      snaptradeUserId = creds.snaptradeUserId;
      snaptradeUserSecret = creds.snaptradeUserSecret;
      snaptradeConnectionId = creds.connectionId;
      brokerConnectionId = creds.brokerConnectionId;
      brokerSlug = creds.brokerSlug;
      tradingEnabled = creds.tradingEnabled;
    } catch (err) {
      if (err instanceof SnapTradeAuthError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      if (err instanceof SnapTradeAmbiguousError) {
        return NextResponse.json(
          { error: 'Multiple brokerages connected — connect exactly one to execute rebalances.' },
          { status: 400 },
        );
      }
      return NextResponse.json(
        { error: 'Failed to load brokerage credentials.' },
        { status: 502 },
      );
    }

    // ── Read-only broker: reject before ANY order is placed ──
    if (!tradingEnabled) {
      return NextResponse.json(
        { error: `${formatBrokerName(brokerSlug)} is read-only — re-authorize with trading access to place orders.` },
        { status: 403 },
      );
    }

    const broker = new SnapTradeBroker({
      userId: snaptradeUserId,
      userSecret: snaptradeUserSecret,
      connectionId: snaptradeConnectionId,
      brokerSlug,
      brokerName: formatBrokerName(brokerSlug),
      tradingEnabled,
    });

    const orderIds: string[] = [];
    const errors: string[] = [];

    for (const trade of trades as RebalanceTrade[]) {
      const outcome = await placeRebalanceTrade(broker, supabase as any, {
        userId,
        brokerConnectionId,
        trade,
      });
      if (outcome.success && outcome.orderId) {
        orderIds.push(outcome.orderId);
      } else if (outcome.error) {
        errors.push(outcome.error);
      }
    }

    // Save rebalancing record to strategies table (best-effort).
    try {
      await (supabase as any).from('strategies').insert({
        user_id: userId,
        type: 'rebalance',
        symbol: null,
        config: {
          trades: trades.map((t) => ({
            symbol: t.symbol,
            action: t.action,
            shares: t.shares,
            estimatedValue: t.estimatedValue,
          })),
          targetAllocations,
          alertOnDrift: alertOnDrift ?? false,
          driftThreshold: driftThreshold ?? 5,
        },
        is_active: false,
      });
    } catch (dbErr: any) {
      console.error('[rebalance] Failed to save record:', dbErr.message);
    }

    // Surface total failure so the client doesn't show a success toast.
    if (orderIds.length === 0 && errors.length > 0) {
      return NextResponse.json(
        { error: `Rebalance failed: ${errors.join('; ')}` },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      ordersPlaced: orderIds.length,
      orderIds,
      partial: errors.length > 0,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err: any) {
    return NextResponse.json({ error: 'Internal server error', detail: err?.message }, { status: 500 });
  }
}
