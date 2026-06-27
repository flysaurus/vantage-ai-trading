// ─── POST /api/db/chat-history/create ──────────────────────────
// Creates a new chat message in the chat_history table.
// Requires: Authorization header with valid Bearer token.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const authUserId = authUser!.id;
    const supabase = createServerClient();

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Missing request body' }, { status: 400 });
    }

    const { userId, messageType, content, investorStyle, relatedStocks, metadata } = body as {
      userId?: string;
      messageType?: string;
      content?: string;
      investorStyle?: string;
      relatedStocks?: string[];
      metadata?: Record<string, unknown>;
    };

    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });
    if (!messageType) return NextResponse.json({ error: 'messageType required ("user_message" or "ai_response")' }, { status: 400 });
    if (!content) return NextResponse.json({ error: 'content required' }, { status: 400 });
    if (!['user_message', 'ai_response'].includes(messageType)) {
      return NextResponse.json({ error: 'messageType must be "user_message" or "ai_response"' }, { status: 400 });
    }

    // Security: only create messages for yourself
    if (userId !== authUserId) {
      return NextResponse.json({ error: 'Cannot create messages for other users' }, { status: 403 });
    }

    console.log('[chat-history/create] Saving:', { userId, messageType, content: content?.substring(0, 50) });

    const { data, error } = await (supabase as any)
      .from('chat_history')
      .insert({
        user_id: userId,
        message_type: messageType,
        role: messageType === 'user_message' ? 'user' : 'assistant',
        content,
        investor_style: investorStyle || null,
        related_stocks: relatedStocks || [],
        metadata: metadata || {},
      })
      .select('id, user_id, message_type, content, created_at')
      .single();

    console.log('[chat-history/create] Insert result:', { success: !!data, error: error?.message });
    if (error) {
      console.error('[chat-history/create] Insert failed:', error.message);
      return NextResponse.json(
        { error: 'Failed to create message', detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      id: data.id,
      userId: data.user_id,
      messageType: data.message_type,
      content: data.content,
      createdAt: data.created_at,
    });
  } catch (err: any) {
    if (err?.name === 'AuthError') {
      return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    }
    console.error('[chat-history/create] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error', detail: err?.message }, { status: 500 });
  }
}
