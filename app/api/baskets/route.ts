/**
 * GET /api/baskets — fetch user's active baskets
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

async function getUserIdFromSession(req: NextRequest): Promise<string> {
  const sessionCookie = req.cookies.get('session')?.value || '';
  if (sessionCookie) {
    const hashBuffer = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(sessionCookie),
    );
    const sessionHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    try {
      const supabase = createServerClient();
      const { data } = await (supabase as any)
        .from('user_sessions')
        .select('user_id')
        .eq('session_token_hash', sessionHash)
        .maybeSingle();
      if (data?.user_id) return data.user_id;
    } catch {
      /* fall through */
    }
  }
  return 'anonymous';
}

export async function GET(req: NextRequest) {
  try {
    const userId = await getUserIdFromSession(req);
    if (userId === 'anonymous') {
      return NextResponse.json({ baskets: [] });
    }

    const statusParam = req.nextUrl.searchParams.get('status');
    const statusFilter = statusParam || 'active';

    const supabase = createServerClient();
    let query = (supabase as any)
      .from('baskets')
      .select('*, basket_positions(*)')
      .eq('user_id', userId)
      .eq('status', statusFilter)
      .order('created_at', { ascending: false });

    const { data, error } = await query;

    if (error) {
      console.error('Baskets fetch error:', error);
      return NextResponse.json({ baskets: [], error: error.message }, { status: 500 });
    }

    return NextResponse.json({ baskets: data || [] });
  } catch (err: any) {
    console.error('Baskets API error:', err.message);
    return NextResponse.json({ baskets: [], error: 'Internal error' }, { status: 500 });
  }
}
