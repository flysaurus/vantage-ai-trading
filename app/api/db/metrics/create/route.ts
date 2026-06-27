// ─── POST /api/db/metrics/create ──────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const authUserId = authUser!.id;
    const supabase = createServerClient();
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Missing request body' }, { status: 400 });

    const { userId, totalValue, totalGain, totalReturn, portfolioYield, avgPe, concentrationRisk } = body as Record<string, any>;
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });
    if (totalValue === undefined) return NextResponse.json({ error: 'totalValue required' }, { status: 400 });
    if (totalGain === undefined) return NextResponse.json({ error: 'totalGain required' }, { status: 400 });
    if (totalReturn === undefined) return NextResponse.json({ error: 'totalReturn required' }, { status: 400 });
    if (userId !== authUserId) return NextResponse.json({ error: 'Cannot create metrics for other users' }, { status: 403 });

    const { data, error } = await (supabase as any)
      .from('metrics').insert({
        user_id: userId, total_value: totalValue, total_gain: totalGain,
        total_return: totalReturn, portfolio_yield: portfolioYield || 0,
        avg_pe: avgPe || null, concentration_risk: concentrationRisk || 0,
      }).select('id, total_value, total_gain, total_return, recorded_at').single();

    if (error) return NextResponse.json({ error: 'Failed to record metrics', detail: error.message }, { status: 500 });

    return NextResponse.json({ id: data.id, totalValue: data.total_value, totalGain: data.total_gain, totalReturn: data.total_return, recordedAt: data.recorded_at });
  } catch (err: any) {
    if (err?.name === 'AuthError') return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
