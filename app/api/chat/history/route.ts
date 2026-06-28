/**
 * GET  /api/chat/history — Load last 20 messages for the current user
 * DELETE /api/chat/history — Clear all chat history for the current user
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { getOptionalUserId } from '@/lib/auth/get-server-user';

/** GET: Load last 20 messages, ordered ASC by created_at */
export async function GET(req: NextRequest) {
  try {
    const userId = await getOptionalUserId();
    if (userId === 'anonymous') {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const supabase = createServerClient();

    const { data, error } = await (supabase as any)
      .from('chat_messages')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('[chat/history] GET error:', error);
      return NextResponse.json({ messages: [] });
    }

    // Reverse to get ASC order (oldest first) for display
    const messages = (data || []).reverse();

    return NextResponse.json({ messages });
  } catch (err: any) {
    console.error('[chat/history] GET error:', err?.message || err);
    return NextResponse.json({ messages: [] });
  }
}

/** DELETE: Clear all chat history for current user */
export async function DELETE(req: NextRequest) {
  try {
    const userId = await getOptionalUserId();
    if (userId === 'anonymous') {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const supabase = createServerClient();
    const { error } = await (supabase as any)
      .from('chat_messages')
      .delete()
      .eq('user_id', userId);

    if (error) {
      console.error('[chat/history] DELETE error:', error);
      return NextResponse.json({ deleted: false, error: error.message });
    }

    console.log('[chat/history] Deleted all messages for user:', userId);
    return NextResponse.json({ deleted: true });
  } catch (err: any) {
    console.error('[chat/history] DELETE error:', err?.message || err);
    return NextResponse.json({ deleted: true });
  }
}
