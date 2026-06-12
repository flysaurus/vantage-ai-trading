/**
 * GET /api/baskets — fetch active baskets with refresh schedule
 *
 * Returns both system-generated baskets (is_active=true, stocks as JSONB)
 * and user-created baskets (status='active', basket_positions join).
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
  // Bi-weekly on Mondays — find next Monday in an even week
  const next = new Date(from);
  next.setHours(0, 0, 0, 0);

  const daysUntilMonday = (8 - next.getDay()) % 7 || 7;
  next.setDate(next.getDate() + daysUntilMonday);

  const getWeekNumber = (d: Date): number => {
    const start = new Date(d.getFullYear(), 0, 1);
    const days = Math.floor((d.getTime() - start.getTime()) / 86400000);
    return Math.ceil((days + start.getDay() + 1) / 7);
  };
  if (getWeekNumber(next) % 2 !== 0) {
    next.setDate(next.getDate() + 7);
  }

  return next;
}

export async function GET(req: NextRequest) {
  try {
    const userId = await getUserIdFromSession(req);
    const supabase = createServerClient();

    // Fetch system-generated active baskets (stocks stored as JSONB)
    const { data: systemBaskets, error: sysErr } = await (supabase as any)
      .from('baskets')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (sysErr) {
      console.error('System baskets fetch error:', sysErr);
    }

    // Parse JSONB stocks for system baskets
    const parsedSystem = (systemBaskets || []).map((b: any) => ({
      ...b,
      stocks: typeof b.stocks === 'string' ? JSON.parse(b.stocks || '[]') : (b.stocks || []),
      performance: typeof b.performance === 'string' ? JSON.parse(b.performance || '{}') : (b.performance || {}),
    }));

    // Fetch user-created active baskets (old schema with basket_positions join)
    let userBaskets: any[] = [];
    if (userId !== 'anonymous') {
      const { data: ub } = await (supabase as any)
        .from('baskets')
        .select('*, basket_positions(*)')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('created_at', { ascending: false });
      userBaskets = ub || [];
    }

    const allBaskets = [...parsedSystem, ...userBaskets];
    const nextRefresh = getNextRefreshDate(new Date());
    const mostRecent = systemBaskets?.[0];

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
