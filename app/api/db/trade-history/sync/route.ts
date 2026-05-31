// ─── Trade History Sync Endpoint ─────────────────────────────
// Server-side sync: fetches filled orders from the connected broker
// and inserts them into the trade_history table with dedup.
// Uses per-user broker credentials via broker-service (Supabase Vault).

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth';
import { getBrokerContext, makeAlpacaRequest } from '@/lib/broker-service';

export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest): Promise<NextResponse> {
  // Auth check
  let userId: string;
  try {
    const auth = await requireAuth(_req);
    userId = auth.userId;
  } catch (err: any) {
    if (err?.name === 'AuthError') {
      return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { limit?: number } = {};
  try { body = await _req.json(); } catch { /* keep defaults */ }

  try {
    // Get broker credentials via broker-service
    const ctx = await getBrokerContext(userId);

    if (ctx.isDemo || !ctx.credentials || ctx.provider !== 'alpaca') {
      return NextResponse.json({
        synced: 0,
        message: ctx.isDemo
          ? 'Demo mode — connect a broker in Settings first'
          : 'Alpaca broker not connected',
      });
    }

    // Fetch filled orders from Alpaca (most recent first)
    const limit = body.limit || 100;
    let orders: Array<{
      id: string; symbol: string; side: string;
      filled_qty: string; filled_avg_price: string | null;
      filled_at: string | null; created_at: string;
      status: string;
    }>;

    try {
      orders = (await makeAlpacaRequest(
        `/v2/orders?status=closed&limit=${limit}&direction=desc`,
        ctx.credentials,
      )) as any[];
    } catch (err: any) {
      console.error('[trade-history/sync] Alpaca error:', err?.message);
      return NextResponse.json({ synced: 0, message: `Alpaca API error: ${err?.message}` });
    }

    // Only process filled orders
    const filled = orders.filter(o => o.status === 'filled' && o.filled_avg_price && o.filled_qty);

    if (filled.length === 0) {
      return NextResponse.json({ synced: 0, message: 'No filled orders from Alpaca' });
    }

    const supabase = createServerClient();
    let synced = 0;
    let skipped = 0;
    let errors = 0;

    for (const order of filled) {
      const alpacaOrderId = order.id;
      const qty = parseFloat(order.filled_qty);
      const price = parseFloat(order.filled_avg_price!);

      if (!qty || !price || isNaN(qty) || isNaN(price)) {
        skipped++;
        continue;
      }

      try {
        // Check for existing trade by alpaca_order_id
        const { data: existing } = await (supabase as any)
          .from('trade_history')
          .select('id')
          .eq('alpaca_order_id', alpacaOrderId)
          .maybeSingle();

        if (existing) {
          skipped++;
          continue;
        }

        // Insert new trade
        const { error: insertErr } = await (supabase as any)
          .from('trade_history')
          .insert({
            user_id: userId,
            alpaca_order_id: alpacaOrderId,
            symbol: order.symbol,
            side: order.side,
            action: order.side,
            type: 'market',
            qty,
            quantity: qty,
            filled_price: price,
            price,
            total_value: qty * price,
            status: 'filled',
            executed_at: order.filled_at || order.created_at,
            filled_at: order.filled_at || order.created_at,
          });

        if (insertErr) {
          console.warn('[trade-history/sync] Insert error for', order.symbol, order.id, insertErr);
          errors++;
        } else {
          synced++;
        }
      } catch (err) {
        console.warn('[trade-history/sync] Unexpected error for order', order.id, err);
        errors++;
      }
    }

    return NextResponse.json({
      synced,
      skipped,
      errors,
      total: filled.length,
      message: synced > 0
        ? `Synced ${synced} new trades${skipped > 0 ? ` (${skipped} already existed)` : ''}`
        : skipped > 0
          ? `All ${skipped} trades already synced`
          : 'No new trades to sync',
    });
  } catch (err: any) {
    console.error('[trade-history/sync] Fatal error:', err);
    return NextResponse.json({ synced: 0, error: err?.message || String(err) }, { status: 500 });
  }
}
