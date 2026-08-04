/**
 * POST /api/positions/sync — Upsert broker positions into Supabase positions table.
 * Called by the frontend after fetching live positions from the broker.
 * This keeps the AI routes (daily-brief, weekly-snapshot) supplied with current data.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { getOptionalUserId } from '@/lib/auth/get-server-user';

export async function POST(req: NextRequest) {
  try {
    const userId = await getOptionalUserId();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { positions } = body;

    if (!Array.isArray(positions)) {
      return NextResponse.json({ error: 'positions array required' }, { status: 400 });
    }

    const supabase = createServerClient();

    // Build upsert rows: map BrokerPosition → positions table columns
    const rows = positions.map((p: any) => ({
      user_id: userId,
      symbol: p.symbol,
      qty: p.shares ?? p.qty ?? 0,
      avg_cost: p.avgCost ?? p.avg_cost ?? 0,
      market_value: p.marketValue ?? p.market_value ?? 0,
      updated_at: new Date().toISOString(),
    }));

    if (rows.length > 0) {
      // Delete old positions for this user, then insert new
      await (supabase as any)
        .from('positions')
        .delete()
        .eq('user_id', userId)
        .eq('is_demo', false);
      
      await (supabase as any)
        .from('positions')
        .insert(rows.map(r => ({ ...r, is_demo: false })));

      console.log(`[positions/sync] Synced ${rows.length} broker positions for user ${userId.slice(0, 8)}`);
    }

    return NextResponse.json({ synced: rows.length });
  } catch (err: any) {
    console.error('[positions/sync] Error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
