// ─── GET /api/strategies/dca/get-all ──────────────────────────
// Returns all active DCA schedules for the authenticated user.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const userId = authUser!.id;
    const supabase = createServerClient();

    const { data, error } = await (supabase as any)
      .from('strategies')
      .select('id, type, symbol, config, is_active, last_run_at, next_run_at, created_at')
      .eq('user_id', userId)
      .eq('type', 'dca')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[strategies/dca/get-all] Query failed:', error.message);
      return NextResponse.json({ error: 'Failed to load schedules', detail: error.message }, { status: 500 });
    }

    return NextResponse.json({
      schedules: (data || []).map((s: any) => ({
        id: s.id,
        type: s.type,
        symbol: s.symbol,
        config: s.config,
        isActive: s.is_active,
        lastRunAt: s.last_run_at,
        nextRunAt: s.next_run_at,
        createdAt: s.created_at,
      })),
    });
  } catch (err: any) {
    if (err?.name === 'AuthError') {
      return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    }
    console.error('[strategies/dca/get-all] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
