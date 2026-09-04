// POST /api/strategies/tax-harvest/execute
// Executes tax-loss harvesting: sells losing positions and
// optionally buys replacement securities.
// Rewired from the legacy direct-Alpaca path (getBrokerContext + makeAlpacaRequest)
// to resolveSnapTradeCredentials + SnapTradeBroker.placeOrder — the same engine
// as /api/broker/execute-trade, the DCA scheduler, and the rebalance execute route.
//
// ═══════════════════════════════════════════════════════════════
// REAL MONEY: each harvest is a live SELL (+ optional replacement BUY). The
// client only calls this after the user confirms on the setup page. There is
// no trade-gate/idempotency here (batch UI flow), so the endpoint resolves the
// SOLE connected brokerage and rejects ambiguity.
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
import {
  placeTaxHarvestLeg,
  computeReplacementShares,
} from '@/lib/broker/tax-harvest-executor';

export const maxDuration = 55;

interface HarvestItem {
  symbol: string;
  qty: number;
  costBasis: number;
  currentPrice: number;
  loss: number;
  lossPct: number;
  estTaxSavings: number;
}

interface ReplacementItem {
  symbol: string;
  name: string;
  price: number;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const userId = authUser!.id;

  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

    const { harvests, replacements, taxYear, connectionId } = body;
    if (!harvests || !Array.isArray(harvests) || harvests.length === 0) {
      return NextResponse.json({ error: 'No harvests provided' }, { status: 400 });
    }

    const supabase = createServerClient();

    // Validate harvests (symbol + positive qty).
    for (const h of harvests as HarvestItem[]) {
      if (!h.symbol || !h.qty || h.qty <= 0) {
        return NextResponse.json({ error: `Invalid harvest: ${JSON.stringify(h)}` }, { status: 400 });
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

    const orderIds: string[] = [];
    const errors: string[] = [];
    let ordersPlaced = 0;
    let totalLossHarvested = 0;

    // Process each harvest (SELL loser + optional replacement BUY).
    for (const h of harvests as HarvestItem[]) {
      const replacement: ReplacementItem | undefined = replacements?.[h.symbol];

      // Compute replacement BUY shares (live price with estimated fallback).
      let buySymbol: string | null = null;
      let buyShares = 0;
      if (replacement) {
        let replPrice = replacement.price;
        try {
          const { getPrice } = await import('@/lib/market-data');
          const livePrice = await getPrice(replacement.symbol);
          if (livePrice) replPrice = livePrice;
        } catch { /* use estimated price */ }
        buyShares = computeReplacementShares(h.loss, replPrice);
        buySymbol = replacement.symbol;
      }

      const outcome = await placeTaxHarvestLeg(broker, supabase as any, {
        userId,
        brokerConnectionId,
        leg: { sellSymbol: h.symbol, sellShares: h.qty, buySymbol, buyShares },
      });

      if (outcome.sell.success && outcome.sell.orderId) {
        orderIds.push(outcome.sell.orderId);
        ordersPlaced++;
        totalLossHarvested += h.loss;
      } else if (outcome.sell.error) {
        errors.push(`${h.symbol} sell failed: ${outcome.sell.error}`);
      }

      if (outcome.buy) {
        if (outcome.buy.success && outcome.buy.orderId) {
          orderIds.push(outcome.buy.orderId);
          ordersPlaced++;
        } else if (outcome.buy.error) {
          errors.push(`${replacement?.symbol} buy failed: ${outcome.buy.error}`);
        }
      }
    }

    // Record in strategies table (best-effort).
    try {
      await (supabase as any).from('strategies').insert({
        user_id: userId,
        type: 'tax_harvest',
        symbol: null,
        config: {
          harvests: harvests.map((h: HarvestItem) => ({
            symbol: h.symbol,
            qty: h.qty,
            loss: h.loss,
            lossPct: h.lossPct,
          })),
          replacements: replacements || {},
          estimatedSavings: totalLossHarvested * 0.20,
          taxYear: taxYear || new Date().getFullYear(),
          orderIds,
          executedAt: new Date().toISOString(),
        },
        is_active: false,
      });
    } catch (e: any) {
      console.error('[tax-harvest/execute] Record save failed:', e.message);
    }

    // Surface total failure so the client shows an error toast (not "✓ done").
    if (ordersPlaced === 0 && errors.length > 0) {
      return NextResponse.json(
        { error: `Harvest failed: ${errors.join('; ')}` },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: ordersPlaced > 0,
      ordersPlaced,
      orderIds,
      totalLossHarvested: Math.round(totalLossHarvested * 100) / 100,
      estimatedSavings: Math.round(totalLossHarvested * 0.20 * 100) / 100,
      partial: errors.length > 0,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err: any) {
    console.error('[tax-harvest/execute] Error:', err.message);
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 });
  }
}
