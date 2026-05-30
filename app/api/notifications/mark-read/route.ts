// POST /api/notifications/mark-read — mark notification(s) as read

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';

export async function POST(req: NextRequest): Promise<NextResponse> {
  let userId: string;
  try {
    const auth = await requireAuth(req);
    userId = auth.userId;
  } catch (err: any) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createServerClient();
    const body = await req.json().catch(() => ({}));
    const { notificationId, all } = body;

    if (all) {
      const { error } = await (supabase as any)
        .from('recent_notifications')
        .update({ is_read: true })
        .eq('user_id', userId)
        .eq('is_read', false);

      if (error) throw error;
    } else if (notificationId) {
      const { error } = await (supabase as any)
        .from('recent_notifications')
        .update({ is_read: true })
        .eq('id', notificationId)
        .eq('user_id', userId);

      if (error) throw error;
    } else {
      return NextResponse.json({ error: 'Missing notificationId or all' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[notifications/mark-read] Error:', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
