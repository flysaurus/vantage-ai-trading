// ─── POST /api/db/chat-history/update ──────────────────────────
// Updates message content or metadata. Rare use case (usually
// immutable, but allows edits for corrections).
// Requires: Authorization header with valid Bearer token.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId: authUserId } = await requireAuth(req);
    const supabase = createServerClient();

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Missing request body' }, { status: 400 });
    }

    const { messageId, content, metadata } = body as {
      messageId?: string;
      content?: string;
      metadata?: Record<string, unknown>;
    };

    if (!messageId) {
      return NextResponse.json({ error: 'messageId required' }, { status: 400 });
    }

    // Verify ownership
    const { data: existing } = await (supabase as any)
      .from('chat_history')
      .select('user_id')
      .eq('id', messageId)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }
    if (existing.user_id !== authUserId) {
      return NextResponse.json({ error: 'Cannot update other users messages' }, { status: 403 });
    }

    // Build update
    const updates: Record<string, unknown> = {};
    if (content !== undefined) updates.content = content;
    if (metadata !== undefined) updates.metadata = metadata;
    updates.updated_at = new Date().toISOString();

    if (Object.keys(updates).length <= 1) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const { data, error } = await (supabase as any)
      .from('chat_history')
      .update(updates)
      .eq('id', messageId)
      .select('id, content, updated_at')
      .single();

    if (error) {
      console.error('[chat-history/update] Update failed:', error.message);
      return NextResponse.json({ error: 'Failed to update message', detail: error.message }, { status: 500 });
    }

    return NextResponse.json({
      id: data.id,
      content: data.content,
      updatedAt: data.updated_at,
    });
  } catch (err: any) {
    if (err?.name === 'AuthError') {
      return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    }
    console.error('[chat-history/update] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error', detail: err?.message }, { status: 500 });
  }
}
