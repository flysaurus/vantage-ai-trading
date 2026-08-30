// GET /api/notifications/list — last 20 notifications

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';
import { parseAccountScope, applyAccountScopeFilter } from '@/lib/account-scope';

export const maxDuration = 15;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const userId = authUser!.id;

  try {
    const supabase = createServerClient();
    const accountId = req.nextUrl.searchParams.get('accountId') || null;
    const scope = parseAccountScope(accountId);

    let query = (supabase as any)
      .from('recent_notifications')
      .select('id, type, title, message, action_url, is_read, created_at')
      .eq('user_id', userId);
    query = scope ? applyAccountScopeFilter(query, scope) : query.eq('is_demo', false);
    query = query.order('created_at', { ascending: false }).limit(20);

    const { data, error } = await query;

    if (error) throw error;

    return NextResponse.json({ notifications: data || [] });
  } catch (err: any) {
    console.error('[notifications/list] Error:', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
