/**
 * POST /api/chat/history/save — Fire-and-forget chat history persistence
 *
 * Accepts user + assistant message pairs and persists both rows
 * to the chat_history table. Always returns 200 — errors are logged
 * but never propagated to the client (non-blocking save).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

async function getUserIdFromSession(req: NextRequest): Promise<string> {
  const sessionCookie = req.cookies.get('session')?.value || '';
  if (sessionCookie) {
    const hashBuffer = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(sessionCookie),
    );
    const sessionHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    try {
      const supabase = createServerClient();
      const { data } = await (supabase as any)
        .from('user_sessions')
        .select('user_id')
        .eq('session_token_hash', sessionHash)
        .maybeSingle();
      if (data?.user_id) return data.user_id;
    } catch {
      /* fall through */
    }
  }
  return 'anonymous';
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserIdFromSession(req);
    console.log('[chat/history/save] userId:', userId);
    if (userId === 'anonymous') {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 },
      );
    }

    const body = await req.json();
    const { userMessage, assistantMessage, mode } = body;

    if (!userMessage || !assistantMessage) {
      return NextResponse.json({ success: true });
    }

    const supabase = createServerClient();
    const now = new Date().toISOString();

    // Insert both rows — user message + assistant response
    console.log('[chat/history/save] Saving to chat_history:', {
      userId,
      userMessage: userMessage?.substring(0, 50),
      assistantMessage: assistantMessage?.substring(0, 50),
    });
    const { error: err1 } = await (supabase as any)
      .from('chat_history')
      .insert({
        user_id: userId,
        message_type: 'user_message',
        role: 'user',
        content: userMessage,
        investor_style: null,
        created_at: now,
      });
    if (err1) console.error('[chat/history/save] Insert user_message failed:', err1);

    const { error: err2 } = await (supabase as any)
      .from('chat_history')
      .insert({
        user_id: userId,
        message_type: 'ai_response',
        role: 'assistant',
        content: assistantMessage,
        investor_style: null,
        created_at: now,
      });
    if (err2) console.error('[chat/history/save] Insert ai_response failed:', err2);

    console.log('[chat/history/save] Insert complete. Errors:', { err1: !!err1, err2: !!err2 });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[chat/history/save] Error:', err?.message || err);
    // Always return 200 for fire-and-forget — errors are logged, not propagated
    return NextResponse.json({ success: false });
  }
}
