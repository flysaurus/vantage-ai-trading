// ─── POST /api/chat/history/save ──────────────────────────
// Fire-and-forget chat history persistence (JWT Bearer auth).

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const userId = authUser!.id;

  try {
    const body = await req.json();
    const { userMessage, assistantMessage, mode } = body;

    if (!userMessage || !assistantMessage) {
      return NextResponse.json({ success: true });
    }

    const supabase = createServerClient();
    const now = new Date().toISOString();

    console.log('History save called', { hasUserMessage: !!userMessage, hasAssistantMessage: !!assistantMessage, userId });

    const { error: err1 } = await (supabase as any)
      .from('chat_messages')
      .insert({
        user_id: userId,
        message_type: 'user_message',
        role: 'user',
        content: userMessage,
        investor_style: null,
        created_at: now,
      });
    if (err1) console.error('Chat history insert error:', err1);

    const { error: err2 } = await (supabase as any)
      .from('chat_messages')
      .insert({
        user_id: userId,
        message_type: 'ai_response',
        role: 'assistant',
        content: assistantMessage,
        investor_style: null,
        created_at: now,
      });
    if (err2) console.error('Chat history insert error:', err2);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[chat/history/save] Error:', err?.message || err);
    return NextResponse.json({ success: false });
  }
}
