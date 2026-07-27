// ─── Marker Executions API ───────────────────────────────────
// Links [RECOMMEND:...] markers to order_history records so buy
// buttons show permanent "✓ Bought" state across sessions.
//
// POST /api/marker-executions — record an execution
// GET  /api/marker-executions — query executions for messages

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';

// ── POST: Record a marker execution ──────────────────────────
export async function POST(req: NextRequest) {
  const { authUser, authError } = await requireAuth(req);
  if (authError) return authError;

  try {
    const body = await req.json();
    const { message_id, symbol, side, executed_shares, executed_amount, order_id } = body;

    if (!message_id || !symbol || !side || executed_shares == null || executed_amount == null) {
      return NextResponse.json(
        { error: 'Missing required fields: message_id, symbol, side, executed_shares, executed_amount' },
        { status: 400 },
      );
    }

    const supabase = createServerClient();

    // Use `as any` — marker_executions table is not in generated TS types yet
    const { data, error } = await (supabase as any)
      .from('marker_executions')
      .upsert({
        user_id: authUser.id,
        message_id,
        symbol: symbol.toUpperCase(),
        side,
        executed_shares,
        executed_amount,
        order_id: order_id || null,
        executed_at: new Date().toISOString(),
      }, {
        onConflict: 'message_id,symbol',
        ignoreDuplicates: false,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[marker-executions] INSERT error:', error);
      return NextResponse.json({ error: 'Failed to record execution' }, { status: 500 });
    }

    return NextResponse.json({ success: true, id: data?.id });
  } catch (err: any) {
    console.error('[marker-executions] POST error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// ── GET: Query executions for specific messages ──────────────
// Query: ?message_ids=uuid1,uuid2,uuid3
// Returns: { executions: { "messageId:symbol": { shares, amount, side } } }
export async function GET(req: NextRequest) {
  const { authUser, authError } = await requireAuth(req);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(req.url);
    const idsParam = searchParams.get('message_ids');

    if (!idsParam) {
      return NextResponse.json({ executions: {} });
    }

    const messageIds = idsParam.split(',').map(s => s.trim()).filter(Boolean);
    if (messageIds.length === 0) {
      return NextResponse.json({ executions: {} });
    }

    const supabase = createServerClient();

    // Use `as any` — marker_executions table is not in generated TS types yet
    const { data, error } = await (supabase as any)
      .from('marker_executions')
      .select('message_id, symbol, side, executed_shares, executed_amount')
      .eq('user_id', authUser.id)
      .in('message_id', messageIds);

    if (error) {
      console.error('[marker-executions] SELECT error:', error);
      return NextResponse.json({ executions: {} }, { status: 200 }); // Fail open
    }

    const executions: Record<string, { shares: number; amount: number; side: string }> = {};
    for (const row of (data || [])) {
      const key = `${row.message_id}:${row.symbol}`;
      executions[key] = {
        shares: Number(row.executed_shares),
        amount: Number(row.executed_amount),
        side: row.side,
      };
    }

    return NextResponse.json({ executions });
  } catch (err: any) {
    console.error('[marker-executions] GET error:', err);
    return NextResponse.json({ executions: {} }, { status: 200 }); // Fail open
  }
}
