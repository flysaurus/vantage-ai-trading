// ─── GET /api/db/chat-history/get-single?id=<messageId> ────────
// Fetches a single chat message by ID.
// Requires: Authorization header with valid Bearer token.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const authUserId = authUser!.id;
    const supabase = createServerClient();

    const { searchParams } = req.nextUrl;
    const messageId = searchParams.get('id');
    if (!messageId) {
      return NextResponse.json({ error: 'id (messageId) required' }, { status: 400 });
    }

    const { data, error } = await (supabase as any)
      .from('chat_messages')
      .select('id, user_id, message_type, content, investor_style, related_stocks, metadata, created_at, updated_at')
      .eq('id', messageId)
      .maybeSingle();

    if (error) {
      console.error('[chat-history/get-single] Query failed:', error.message);
      return NextResponse.json({ error: 'Failed to fetch message', detail: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    // Security: only read your own messages
    if (data.user_id !== authUserId) {
      return NextResponse.json({ error: 'Cannot read other users messages' }, { status: 403 });
    }

    return NextResponse.json({
      id: data.id,
      userId: data.user_id,
      messageType: data.message_type,
      content: data.content,
      investorStyle: data.investor_style,
      relatedStocks: data.related_stocks || [],
      metadata: data.metadata || {},
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    });
  } catch (err: any) {
    if (err?.name === 'AuthError') {
      return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    }
    console.error('[chat-history/get-single] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error', detail: err?.message }, { status: 500 });
  }
}
