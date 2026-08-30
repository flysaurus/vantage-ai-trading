// POST /api/notifications/mark-read — mark notification(s) as read

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';
import { parseAccountScope, applyAccountScopeFilter } from '@/lib/account-scope';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const userId = authUser!.id;

  try {
    const supabase = createServerClient();
    const body = await req.json().catch(() => ({}));
    const { notificationId, all, accountId } = body;
    const scope = parseAccountScope(accountId);

    if (all) {
      let query = (supabase as any)
        .from('recent_notifications')
        .update({ is_read: true })
        .eq('user_id', userId)
        .eq('is_read', false);
      query = scope ? applyAccountScopeFilter(query, scope) : query.eq('is_demo', false);
      const { error } = await query;

      if (error) throw error;
    } else if (notificationId) {
      let query = (supabase as any)
        .from('recent_notifications')
        .update({ is_read: true })
        .eq('id', notificationId)
        .eq('user_id', userId);
      query = scope ? applyAccountScopeFilter(query, scope) : query.eq('is_demo', false);
      const { error } = await query;

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
