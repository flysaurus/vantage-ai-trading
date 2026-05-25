// ─── GET /api/db/metrics/get-latest?userId=<id> ───────────────
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId: authUserId } = await requireAuth(req);
    const supabase = createServerClient();
    const targetUserId = req.nextUrl.searchParams.get('userId') || authUserId;
    if (targetUserId !== authUserId) return NextResponse.json({ error: 'Cannot fetch other users metrics' }, { status: 403 });

    const { data, error } = await (supabase as any)
      .from('metrics')
      .select('id, total_value, total_gain, total_return, portfolio_yield, avg_pe, concentration_risk, recorded_at')
      .eq('user_id', targetUserId)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return NextResponse.json({ error: 'Failed to fetch metrics', detail: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'No metrics found' }, { status: 404 });

    return NextResponse.json({
      id: data.id, totalValue: data.total_value, totalGain: data.total_gain,
      totalReturn: data.total_return, portfolioYield: data.portfolio_yield,
      avgPe: data.avg_pe, concentrationRisk: data.concentration_risk,
      recordedAt: data.recorded_at,
    });
  } catch (err: any) {
    if (err?.name === 'AuthError') return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
