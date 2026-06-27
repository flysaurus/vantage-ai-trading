// ─── GET /api/db/strategies/get-single?id=<strategyId> ────────
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const authUserId = authUser!.id;
    const supabase = createServerClient();
    const strategyId = req.nextUrl.searchParams.get('id');
    if (!strategyId) return NextResponse.json({ error: 'id (strategyId) required' }, { status: 400 });

    const { data, error } = await (supabase as any)
      .from('strategies').select('id, user_id, name, description, investor_style, target_allocation, stocks, performance_notes, created_at, updated_at')
      .eq('id', strategyId).maybeSingle();

    if (error) return NextResponse.json({ error: 'Failed to fetch strategy', detail: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Strategy not found' }, { status: 404 });
    if (data.user_id !== authUserId) return NextResponse.json({ error: 'Cannot read other users strategies' }, { status: 403 });

    return NextResponse.json({ id: data.id, userId: data.user_id, name: data.name, description: data.description, investorStyle: data.investor_style, targetAllocation: data.target_allocation, stocks: data.stocks || [], performanceNotes: data.performance_notes, createdAt: data.created_at, updatedAt: data.updated_at });
  } catch (err: any) {
    if (err?.name === 'AuthError') return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
