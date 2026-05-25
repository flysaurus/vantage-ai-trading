import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId: authUserId } = await requireAuth(req);
    const supabase = createServerClient();
    const targetUserId = req.nextUrl.searchParams.get('userId') || authUserId;
    if (targetUserId !== authUserId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const { data, error } = await (supabase as any).from('scanner_recommendations')
      .select('id, symbol, recommendation, reason, created_at')
      .eq('user_id', targetUserId).order('created_at', { ascending: false }).limit(200);
    if (error) return NextResponse.json({ error: 'Failed to fetch recommendations', detail: error.message }, { status: 500 });
    return NextResponse.json({
      recommendations: (data || []).map((r: any) => ({
        id: r.id, symbol: r.symbol, recommendation: r.recommendation, reason: r.reason, createdAt: r.created_at,
      })),
    });
  } catch (err: any) {
    if (err?.name === 'AuthError') return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
