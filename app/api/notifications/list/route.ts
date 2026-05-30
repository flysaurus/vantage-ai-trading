// GET /api/notifications/list — last 20 notifications

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';

export const maxDuration = 15;

export async function GET(req: NextRequest): Promise<NextResponse> {
  let userId: string;
  try {
    const auth = await requireAuth(req);
    userId = auth.userId;
  } catch (err: any) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createServerClient();

    const { data, error } = await (supabase as any)
      .from('recent_notifications')
      .select('id, type, title, message, action_url, is_read, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw error;

    return NextResponse.json({ notifications: data || [] });
  } catch (err: any) {
    console.error('[notifications/list] Error:', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
