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
    const targetUserId = searchParams.get('userId') || authUserId;
    const unreadOnly = searchParams.get('unreadOnly') === 'true';
    if (targetUserId !== authUserId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    let q = (supabase as any).from('recent_notifications')
      .select('id, title, message, type, is_read, created_at')
      .eq('user_id', targetUserId).order('created_at', { ascending: false }).limit(100);
    if (unreadOnly) q = q.eq('is_read', false);
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: 'Failed to fetch notifications', detail: error.message }, { status: 500 });
    return NextResponse.json({
      notifications: (data || []).map((n: any) => ({
        id: n.id, title: n.title, message: n.message, type: n.type, isRead: n.is_read, createdAt: n.created_at,
      })),
    });
  } catch (err: any) {
    if (err?.name === 'AuthError') return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
