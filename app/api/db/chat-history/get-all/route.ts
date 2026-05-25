// ─── GET /api/db/chat-history/get-all?userId=xxx&limit=50&offset=0 ──
// Fetches paginated chat messages for a user, newest first.
// Requires: Authorization header with valid Bearer token.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId: authUserId } = await requireAuth(req);
    const supabase = createServerClient();

    const { searchParams } = req.nextUrl;
    const targetUserId = searchParams.get('userId') || authUserId;
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 200);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    // Security: only fetch your own messages
    if (targetUserId !== authUserId) {
      return NextResponse.json({ error: 'Cannot fetch other users messages' }, { status: 403 });
    }

    // Fetch total count
    const { count, error: countErr } = await (supabase as any)
      .from('chat_history')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', targetUserId);

    if (countErr) {
      console.error('[chat-history/get-all] Count failed:', countErr.message);
      return NextResponse.json({ error: 'Failed to fetch messages', detail: countErr.message }, { status: 500 });
    }

    // Fetch paginated messages (newest first)
    const { data, error } = await (supabase as any)
      .from('chat_history')
      .select('id, user_id, message_type, content, investor_style, related_stocks, metadata, created_at, updated_at')
      .eq('user_id', targetUserId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('[chat-history/get-all] Query failed:', error.message);
      return NextResponse.json({ error: 'Failed to fetch messages', detail: error.message }, { status: 500 });
    }

    const messages = (data || []).map((m: any) => ({
      id: m.id,
      userId: m.user_id,
      messageType: m.message_type,
      content: m.content,
      investorStyle: m.investor_style,
      relatedStocks: m.related_stocks || [],
      metadata: m.metadata || {},
      createdAt: m.created_at,
      updatedAt: m.updated_at,
    }));

    return NextResponse.json({ messages, total: count || 0 });
  } catch (err: any) {
    if (err?.name === 'AuthError') {
      return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    }
    console.error('[chat-history/get-all] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error', detail: err?.message }, { status: 500 });
  }
}
