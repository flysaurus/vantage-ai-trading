/**
 * GET /api/baskets — fetch active baskets with refresh schedule
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

function getNextRefreshDate(from: Date): Date {
  // Bi-weekly on Mondays — find the next Monday that's in an even week of the year
  const next = new Date(from);
  next.setHours(0, 0, 0, 0);

  // Get to next Monday
  const daysUntilMonday = (8 - next.getDay()) % 7 || 7;
  next.setDate(next.getDate() + daysUntilMonday);

  // Ensure it's an even week number (bi-weekly from week 1)
  const getWeekNumber = (d: Date): number => {
    const start = new Date(d.getFullYear(), 0, 1);
    const days = Math.floor((d.getTime() - start.getTime()) / 86400000);
    return Math.ceil((days + start.getDay() + 1) / 7);
  };
  if (getWeekNumber(next) % 2 !== 0) {
    next.setDate(next.getDate() + 7); // skip to next even week
  }

  return next;
}

export async function GET(req: NextRequest) {
  try {
    const userId = await getUserIdFromSession(req);
    if (userId === 'anonymous') {
      const nextRefresh = getNextRefreshDate(new Date());
      return NextResponse.json({
        baskets: [],
        nextRefresh: nextRefresh.toISOString(),
        lastUpdated: null,
        changelog: null,
      });
    }

    const supabase = createServerClient();

    // Fetch system-generated active baskets (user_id = 'system')
    const { data, error } = await (supabase as any)
      .from('baskets')
      .select('*, basket_positions(*)')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Baskets fetch error:', error);
      return NextResponse.json({ baskets: [], error: error.message }, { status: 500 });
    }

    // Also fetch user-created active baskets
    const { data: userBaskets } = await (supabase as any)
      .from('baskets')
      .select('*, basket_positions(*)')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false });

    const allBaskets = [...(data || []), ...(userBaskets || [])];

    const nextRefresh = getNextRefreshDate(new Date());
    const mostRecent = data?.[0];

    return NextResponse.json({
      baskets: allBaskets,
      nextRefresh: nextRefresh.toISOString(),
      lastUpdated: mostRecent?.created_at || null,
      changelog: mostRecent?.changelog || null,
    });
  } catch (err: any) {
    console.error('Baskets API error:', err.message);
    return NextResponse.json({ baskets: [], error: 'Internal error' }, { status: 500 });
  }
}
