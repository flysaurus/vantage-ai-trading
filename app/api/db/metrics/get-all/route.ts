// ─── GET /api/db/metrics/get-all?userId=&days=30 ──────────────
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
    const days = parseInt(searchParams.get('days') || '30', 10);
    if (targetUserId !== authUserId) return NextResponse.json({ error: 'Cannot fetch other users metrics' }, { status: 403 });

    const since = new Date();
    since.setDate(since.getDate() - days);

    const { data, error } = await (supabase as any)
      .from('metrics')
      .select('id, total_value, total_gain, total_return, portfolio_yield, avg_pe, concentration_risk, recorded_at')
      .eq('user_id', targetUserId)
      .gte('recorded_at', since.toISOString())
      .order('recorded_at', { ascending: false });

    if (error) return NextResponse.json({ error: 'Failed to fetch metrics', detail: error.message }, { status: 500 });

    return NextResponse.json({
      metrics: (data || []).map((m: any) => ({
        id: m.id, totalValue: m.total_value, totalGain: m.total_gain,
        totalReturn: m.total_return, portfolioYield: m.portfolio_yield,
        avgPe: m.avg_pe, concentrationRisk: m.concentration_risk,
        recordedAt: m.recorded_at,
      })),
    });
  } catch (err: any) {
    if (err?.name === 'AuthError') return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
