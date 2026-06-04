/**
 * GET /api/baskets/positions — fetch user's basket positions (joined with basket info)
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
        .eq('session_hash', sessionHash)
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
      return NextResponse.json({ positions: [] });
    }

    const supabase = createServerClient();
    const { data, error } = await (supabase as any)
      .from('basket_positions')
      .select('*, baskets!inner(name, emoji)')
      .eq('user_id', userId)
      .neq('status', 'sold')
      .eq('baskets.status', 'active');

    if (error) {
      console.error('Basket positions fetch error:', error);
      return NextResponse.json({ positions: [], error: error.message }, { status: 500 });
    }

    // Flatten the nested baskets object into top-level fields
    const positions = (data || []).map((p: any) => ({
      ...p,
      basket_name: p.baskets?.name || null,
      emoji: p.baskets?.emoji || null,
      baskets: undefined,
    }));

    return NextResponse.json({ positions });
  } catch (err: any) {
    console.error('Basket positions API error:', err.message);
    return NextResponse.json({ positions: [], error: 'Internal error' }, { status: 500 });
  }
}
