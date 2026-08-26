/**
 * POST /api/positions/sync — Upsert broker positions into Supabase positions table.
 * Called by the frontend after fetching live positions from the broker.
 * This keeps the AI routes (daily-brief, weekly-snapshot) supplied with current data.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { getOptionalUserId } from '@/lib/auth/get-server-user';
import {
  resolveBrokerConnection,
  SnapTradeAuthError,
  SnapTradeAmbiguousError,
} from '@/lib/snaptrade/client';

export async function POST(req: NextRequest) {
  try {
    const userId = await getOptionalUserId();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { positions, connectionId } = body;

    if (!Array.isArray(positions)) {
      return NextResponse.json({ error: 'positions array required' }, { status: 400 });
    }

    // Resolve the EXACT broker_connections row these positions belong to.
    // Enforces ownership; requires an explicit id when 2+ brokers are connected
    // (so broker B can never wipe broker A's rows and re-write them as its own).
    let resolvedConnectionId: string;
    try {
      const conn = await resolveBrokerConnection(
        userId,
        typeof connectionId === 'string' ? connectionId : null,
      );
      resolvedConnectionId = conn.id;
    } catch (err) {
      if (err instanceof SnapTradeAuthError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      if (err instanceof SnapTradeAmbiguousError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      return NextResponse.json({ error: 'Failed to resolve broker connection.' }, { status: 502 });
    }

    const supabase = createServerClient();

    // Build upsert rows: map BrokerPosition → positions table columns
    const rows = positions.map((p: any) => ({
      user_id: userId,
      connection_id: resolvedConnectionId,
      symbol: p.symbol,
      name: p.name ?? p.description ?? null,
      qty: p.shares ?? p.qty ?? 0,
      avg_cost: p.avgCost ?? p.avg_cost ?? 0,
      market_value: p.marketValue ?? p.market_value ?? 0,
      updated_at: new Date().toISOString(),
    }));

    if (rows.length > 0) {
      // Delete ONLY this connection's live positions, then insert fresh.
      await (supabase as any)
        .from('positions')
        .delete()
        .eq('user_id', userId)
        .eq('is_demo', false)
        .eq('connection_id', resolvedConnectionId);
      
      await (supabase as any)
        .from('positions')
        .insert(rows.map(r => ({ ...r, is_demo: false })));

      console.log(`[positions/sync] Synced ${rows.length} broker positions for user ${userId.slice(0, 8)} connection ${resolvedConnectionId.slice(0, 8)}`);
    }

    return NextResponse.json({ synced: rows.length });
  } catch (err: any) {
    console.error('[positions/sync] Error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
