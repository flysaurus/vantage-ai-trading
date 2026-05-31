// ─── POST /api/strategies/rebalancing/execute ───────────────
// Executes rebalancing trades via broker-service (Supabase Vault).
// Requires a connected broker — returns 400 in demo mode.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';
import { getBrokerContext, makeAlpacaRequest } from '@/lib/broker-service';

interface TradePayload {
  symbol: string;
  action: 'buy' | 'sell';
  shares: number;
  estimatedValue: number;
}

export const maxDuration = 55;

export async function POST(req: NextRequest): Promise<NextResponse> {
  let userId: string;
  try {
    const auth = await requireAuth(req);
    userId = auth.userId;
  } catch (err: any) {
    return NextResponse.json({ error: 'Unauthorized', detail: err?.message }, { status: 401 });
  }

  try {
    const supabase = createServerClient();
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Missing request body' }, { status: 400 });
    }

    const { trades, targetAllocations, alertOnDrift, driftThreshold } = body as {
      trades: TradePayload[];
      targetAllocations: Record<string, number>;
      alertOnDrift?: boolean;
      driftThreshold?: number;
    };

    if (!trades || !Array.isArray(trades) || trades.length === 0) {
      return NextResponse.json({ error: 'No trades to execute' }, { status: 400 });
    }

    // Validate each trade
    for (const t of trades) {
      if (!t.symbol || !['buy', 'sell'].includes(t.action) || !t.shares || t.shares <= 0) {
        return NextResponse.json({ error: `Invalid trade: ${JSON.stringify(t)}` }, { status: 400 });
      }
    }

    // Get broker credentials via broker-service
    const ctx = await getBrokerContext(userId);
    if (ctx.isDemo || !ctx.credentials || ctx.provider !== 'alpaca') {
      return NextResponse.json(
        { error: ctx.isDemo ? 'Demo mode — connect a broker first' : 'Alpaca broker not connected' },
        { status: 400 }
      );
    }

    const creds = ctx.credentials;
    const ordersPlaced: string[] = [];
    const errors: string[] = [];

    for (const trade of trades) {
      try {
        const body: any = {
          symbol: trade.symbol.toUpperCase(),
          qty: trade.shares,
          side: trade.action,
          type: 'market',
          time_in_force: 'day',
        };

        try {
          const data: any = await makeAlpacaRequest('/v2/orders', creds, {
            method: 'POST',
            body: JSON.stringify(body),
          });
          ordersPlaced.push(data.id || trade.symbol);
        } catch (e: any) {
          errors.push(`${trade.symbol}: ${e.message}`);
        }
      } catch (e: any) {
        errors.push(`${trade.symbol}: ${e.message}`);
      }
    }

    // Save rebalancing record to strategies table
    try {
      await (supabase as any).from('strategies').insert({
        user_id: userId,
        type: 'rebalance',
        symbol: null,
        config: {
          trades: trades.map(t => ({ symbol: t.symbol, action: t.action, shares: t.shares, estimatedValue: t.estimatedValue })),
          targetAllocations,
          alertOnDrift: alertOnDrift ?? false,
          driftThreshold: driftThreshold ?? 5,
        },
        is_active: false,
      });
    } catch (dbErr: any) {
      console.error('[rebalance] Failed to save record:', dbErr.message);
    }

    return NextResponse.json({
      success: true,
      ordersPlaced: ordersPlaced.length,
      orderIds: ordersPlaced,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err: any) {
    return NextResponse.json({ error: 'Internal server error', detail: err?.message }, { status: 500 });
  }
}
