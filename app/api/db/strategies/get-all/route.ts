// ─── GET /api/db/strategies/get-all?userId=<id> ───────────────
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';
import { parseAccountScope, applyAccountScopeFilter } from '@/lib/account-scope';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const authUserId = authUser!.id;
    const supabase = createServerClient();
    const targetUserId = req.nextUrl.searchParams.get('userId') || authUserId;
    if (targetUserId !== authUserId) return NextResponse.json({ error: 'Cannot fetch other users strategies' }, { status: 403 });

    // Account segregation: omitted accountId → live-only (is_demo=false).
    const accountId = req.nextUrl.searchParams.get('accountId') || null;
    const scope = parseAccountScope(accountId);
    let query = (supabase as any)
      .from('strategies').select('id, user_id, name, description, investor_style, target_allocation, stocks, performance_notes, created_at, updated_at')
      .eq('user_id', targetUserId);
    query = scope ? applyAccountScopeFilter(query, scope) : query.eq('is_demo', false);
    query = query.order('created_at', { ascending: false });
    const { data, error } = await query;

    if (error) return NextResponse.json({ error: 'Failed to fetch strategies', detail: error.message }, { status: 500 });

    return NextResponse.json({
      strategies: (data || []).map((s: any) => ({ id: s.id, userId: s.user_id, name: s.name, description: s.description, investorStyle: s.investor_style, targetAllocation: s.target_allocation, stocks: s.stocks || [], performanceNotes: s.performance_notes, createdAt: s.created_at, updatedAt: s.updated_at })),
    });
  } catch (err: any) {
    if (err?.name === 'AuthError') return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
