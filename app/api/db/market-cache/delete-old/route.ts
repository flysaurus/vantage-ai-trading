import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { createServerClient } = await import('@/lib/supabase');
    const supabase = createServerClient();
    const body = await req.json().catch(() => { return {} });
    const hoursOld = body?.hoursOld || 24;
    const cutoff = new Date(Date.now() - hoursOld * 3600 * 1000).toISOString();
    const { count, error } = await (supabase as any).from('market_cache')
      .delete({ count: 'exact' }).lt('cached_at', cutoff);
    if (error) return NextResponse.json({ error: 'Failed to purge cache', detail: error.message }, { status: 500 });
    return NextResponse.json({ deletedCount: count || 0 });
  } catch (err: any) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
