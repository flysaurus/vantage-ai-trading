/**
 * POST /api/strategies/rebalancing/session
 * Creates a new rebalance session from AI-suggested trades
 *
 * GET/DELETE /api/strategies/rebalancing/session?id=UUID
 *
 * GET: Returns stored rebalance session trades (validates user_id matches session)
 * DELETE: Cleanup after execution
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';

const { v4: uuidv4 } = require('uuid');

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireAuth(request);

    const body = await request.json();
    const { trades, source = 'ai_chat', expiresIn = 3600 } = body;

    if (!trades || !Array.isArray(trades) || trades.length === 0) {
      return NextResponse.json({ error: 'Trades array required' }, { status: 400 });
    }

    const sessionId = uuidv4();
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    const supabase = createServerClient();
    const { error: dbErr } = await (supabase as any)
      .from('rebalance_sessions')
      .insert({
        id: sessionId,
        user_id: userId,
        trades: JSON.stringify(trades),
        source,
        status: 'pending',
        created_at: new Date().toISOString(),
        expires_at: expiresAt,
      });

    if (dbErr) {
      console.error('[session API] POST insert error:', dbErr);
      return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
    }

    console.log('[session API] Session created:', sessionId, 'trades:', trades.length);
    return NextResponse.json({ sessionId });
  } catch (e) {
    console.error('[session API] POST error:', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireAuth(request);

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    console.log('[session API] GET called — sessionId:', id, 'userId:', userId);
    if (!id) {
      console.log('[session API] Missing session id');
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
      console.log('[session API] Session not found — dbErr:', dbErr, 'data:', data);
      return NextResponse.json({ error: 'Session not found or expired' }, { status: 404 });
    }

    console.log('[session API] Session found — trades:', data.trades?.length, 'summary:', data.summary?.slice(0, 50));
    return NextResponse.json({
      sessionId: data.id,
      trades: data.trades,
      summary: data.summary,
      source: data.source,
      createdAt: data.created_at,
    });
  } catch (e) {
    console.error('[session API] Error:', e);
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
