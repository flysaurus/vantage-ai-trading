// GET /api/notifications/unread — count of unread notifications

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';
import { parseAccountScope, applyAccountScopeFilter } from '@/lib/account-scope';

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
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);
    query = scope ? applyAccountScopeFilter(query, scope) : query.eq('is_demo', false);

    const { count, error } = await query;

    if (error) throw error;

    return NextResponse.json({ count: count || 0 });
  } catch (err: any) {
    console.error('[notifications/unread] Error:', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
