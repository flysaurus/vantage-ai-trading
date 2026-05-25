import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId: authUserId } = await requireAuth(req);
    const supabase = createServerClient();
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Missing request body' }, { status: 400 });
    const { userId, title, message, type } = body as Record<string, any>;
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });
    if (!title?.trim()) return NextResponse.json({ error: 'title required' }, { status: 400 });
    if (userId !== authUserId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const notifType = type || 'info';
    if (!['alert', 'suggestion', 'info'].includes(notifType)) return NextResponse.json({ error: 'type must be alert, suggestion, or info' }, { status: 400 });
    const { data, error } = await (supabase as any).from('recent_notifications').insert({
      user_id: userId, title: title.trim(), message: message || null, type: notifType,
    }).select('id, title, type, is_read, created_at').single();
    if (error) return NextResponse.json({ error: 'Failed to create notification', detail: error.message }, { status: 500 });
    return NextResponse.json({ id: data.id, title: data.title, type: data.type, isRead: data.is_read, createdAt: data.created_at });
  } catch (err: any) {
    if (err?.name === 'AuthError') return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
