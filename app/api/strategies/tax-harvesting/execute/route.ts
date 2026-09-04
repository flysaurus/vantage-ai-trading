// ─── POST /api/strategies/tax-harvesting/execute ────────────
// Executes tax-loss harvesting: sells losing positions and
// optionally buys partner ETFs.
// Rewired from the legacy direct-Alpaca path (getBrokerContext + makeAlpacaRequest)
// to resolveSnapTradeCredentials + SnapTradeBroker.placeOrder.
//
// ═══════════════════════════════════════════════════════════════
// REAL MONEY: each trade is a live SELL (+ optional replacement BUY). Resolves
// the SOLE connected brokerage and rejects ambiguity. (This legacy variant is
// superseded by /api/strategies/tax-harvest/execute but kept working.)
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
import { placeTaxHarvestLeg } from '@/lib/broker/tax-harvest-executor';

interface HarvestTrade {
  sellSymbol: string;
  sellShares: number;
  sellValue: number;
  buySymbol: string | null;
  buyName: string | null;
  estimatedValue: number;
  lossRealized: number;
}

export const maxDuration = 55;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const userId = authUser!.id;

  try {
    const supabase = createServerClient();
    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.trades) || body.trades.length === 0) {
      return NextResponse.json({ error: 'No trades to execute' }, { status: 400 });
    }

    const { trades, connectionId } = body as { trades: HarvestTrade[]; connectionId?: string | null };

    // Validate
    for (const t of trades) {
      if (!t.sellSymbol || !t.sellShares || t.sellShares <= 0) {
        return NextResponse.json({ error: `Invalid trade: ${JSON.stringify(t)}` }, { status: 400 });
      }
    }

    // ── Resolve the connected SnapTrade brokerage ──
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
          { error: 'Multiple brokerages connected — connect exactly one to harvest losses.' },
          { status: 400 },
        );
      }
      return NextResponse.json({ error: 'Failed to load brokerage credentials.' }, { status: 502 });
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

    const ordersPlaced: string[] = [];
    const errors: string[] = [];
    let totalLossHarvested = 0;

    for (const trade of trades) {
      // Compute replacement BUY shares (fractional, floored to 2 decimals).
      let buySymbol: string | null = null;
      let buyShares = 0;
      if (trade.buySymbol) {
        const buyAmount = trade.sellValue || trade.estimatedValue;
        const { getPrice } = await import('@/lib/market-data');
        const buyPrice = (await getPrice(trade.buySymbol)) || 0;
        if (buyPrice > 0) {
          buyShares = Math.floor((buyAmount / buyPrice) * 100) / 100;
          if (buyShares > 0) buySymbol = trade.buySymbol;
        } else {
          errors.push(`BUY ${trade.buySymbol}: Could not fetch price`);
        }
      }

      const outcome = await placeTaxHarvestLeg(broker, supabase as any, {
        userId,
        brokerConnectionId,
        leg: { sellSymbol: trade.sellSymbol, sellShares: trade.sellShares, buySymbol, buyShares },
      });

      if (outcome.sell.success && outcome.sell.orderId) {
        ordersPlaced.push(`SELL:${outcome.sell.orderId}`);
        totalLossHarvested += trade.lossRealized;
      } else if (outcome.sell.error) {
        errors.push(`SELL ${trade.sellSymbol}: ${outcome.sell.error}`);
      }

      if (outcome.buy) {
        if (outcome.buy.success && outcome.buy.orderId) {
          ordersPlaced.push(`BUY:${outcome.buy.orderId}`);
        } else if (outcome.buy.error) {
          errors.push(`BUY ${trade.buySymbol}: ${outcome.buy.error}`);
        }
      }
    }

    // Save record to strategies table (best-effort).
    try {
      await (supabase as any).from('strategies').insert({
        user_id: userId,
        type: 'tax-harvest',
        symbol: null,
        config: {
          trades: trades.map(t => ({
            sellSymbol: t.sellSymbol,
            sellShares: t.sellShares,
            buySymbol: t.buySymbol,
            lossRealized: t.lossRealized,
          })),
        },
        is_active: false,
      });
    } catch (dbErr: any) {
      console.error('[tax-harvesting] Failed to save record:', dbErr.message);
    }

    if (ordersPlaced.length === 0 && errors.length > 0) {
      return NextResponse.json(
        { error: `Harvest failed: ${errors.join('; ')}` },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: ordersPlaced.length > 0,
      ordersPlaced: ordersPlaced.length,
      orderIds: ordersPlaced,
      totalLossHarvested: Math.round(totalLossHarvested * 100) / 100,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err: any) {
    return NextResponse.json({ error: 'Internal server error', detail: err?.message }, { status: 500 });
  }
}
