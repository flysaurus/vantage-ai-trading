import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    await requireAuth(req); // any authenticated user can update cache
    const supabase = createServerClient();
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Missing request body' }, { status: 400 });
    const { symbol, data: cacheData } = body as { symbol?: string; data?: any };
    if (!symbol?.trim()) return NextResponse.json({ error: 'symbol required' }, { status: 400 });
    if (!cacheData) return NextResponse.json({ error: 'data required' }, { status: 400 });
    const symbolUpper = symbol.trim().toUpperCase();
    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    // Upsert: use ON CONFLICT via insert with id = symbol (primary key)
    const { data: row, error } = await (supabase as any).from('market_cache')
      .upsert({ symbol: symbolUpper, data: cacheData, cached_at: new Date().toISOString(), expires_at: expiresAt }, { onConflict: 'symbol' })
      .select('symbol, cached_at, expires_at').single();
    if (error) return NextResponse.json({ error: 'Failed to upsert cache', detail: error.message }, { status: 500 });
    return NextResponse.json({ symbol: row.symbol, cachedAt: row.cached_at, expiresAt: row.expires_at });
  } catch (err: any) {
    if (err?.name === 'AuthError') return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
