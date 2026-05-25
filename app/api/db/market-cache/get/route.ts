import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { createServerClient } = await import('@/lib/supabase');
    const supabase = createServerClient();
    const symbol = req.nextUrl.searchParams.get('symbol');
    if (!symbol?.trim()) return NextResponse.json({ error: 'symbol required' }, { status: 400 });
    const { data, error } = await (supabase as any).from('market_cache')
      .select('symbol, data, cached_at, expires_at').eq('symbol', symbol.trim().toUpperCase()).maybeSingle();
    if (error) return NextResponse.json({ error: 'Failed to fetch cache', detail: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Not cached' }, { status: 404 });
    // Check expiry
    if (new Date(data.expires_at) < new Date()) return NextResponse.json({ error: 'Cache expired', cachedAt: data.cached_at, expiresAt: data.expires_at }, { status: 410 });
    return NextResponse.json({ symbol: data.symbol, data: data.data, cachedAt: data.cached_at, expiresAt: data.expires_at });
  } catch (err: any) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
