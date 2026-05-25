import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId: authUserId } = await requireAuth(req);
    const supabase = createServerClient();
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Missing request body' }, { status: 400 });
    const { userId, notificationIds } = body as { userId?: string; notificationIds?: string[] };
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });
    if (!notificationIds || !notificationIds.length) return NextResponse.json({ error: 'notificationIds required' }, { status: 400 });
    if (userId !== authUserId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const { error } = await (supabase as any).from('recent_notifications')
      .update({ is_read: true, updated_at: new Date().toISOString() }).in('id', notificationIds).eq('user_id', userId);
    if (error) return NextResponse.json({ error: 'Failed to mark read', detail: error.message }, { status: 500 });
    return NextResponse.json({ success: true, markedCount: notificationIds.length });
  } catch (err: any) {
    if (err?.name === 'AuthError') return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
