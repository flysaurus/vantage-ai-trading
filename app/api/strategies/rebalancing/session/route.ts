/**
 * GET/DELETE /api/strategies/rebalancing/session?id=UUID
 *
 * GET: Returns stored rebalance session trades (validates user_id matches session)
 * DELETE: Cleanup after execution
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireAuth(request);

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Session id required' }, { status: 400 });
    }

    const supabase = createServerClient();
    const { data, error: dbErr } = await (supabase as any)
      .from('rebalance_sessions')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (dbErr || !data) {
      return NextResponse.json({ error: 'Session not found or expired' }, { status: 404 });
    }

    return NextResponse.json({
      sessionId: data.id,
      trades: data.trades,
      summary: data.summary,
      source: data.source,
      createdAt: data.created_at,
    });
  } catch (e) {
    console.error('GET /api/strategies/rebalancing/session error:', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { userId } = await requireAuth(request);

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Session id required' }, { status: 400 });
    }

    const supabase = createServerClient();
    await (supabase as any)
      .from('rebalance_sessions')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('DELETE /api/strategies/rebalancing/session error:', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
