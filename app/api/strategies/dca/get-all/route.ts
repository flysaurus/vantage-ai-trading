// ─── GET /api/strategies/dca/get-all ──────────────────────────
// Returns all active DCA schedules for the authenticated user.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';
import { parseAccountScope, applyAccountScopeFilter } from '@/lib/account-scope';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const userId = authUser!.id;
    const supabase = createServerClient();

    // Account segregation: scope the list to the active account when supplied.
    const accountId = req.nextUrl.searchParams.get('accountId');
    const scope = accountId ? parseAccountScope(accountId) : null;

    let query = (supabase as any)
      .from('strategies')
      .select('id, type, symbol, config, is_active, last_run_at, next_run_at, created_at, connection_id, is_demo')
      .eq('user_id', userId)
      .eq('type', 'dca')
      .eq('is_active', true);
    if (scope) {
      query = applyAccountScopeFilter(query, scope);
    } else {
      // No account supplied → default to LIVE strategies only (never leak a
      // demo-scoped schedule into a live surface).
      query = query.eq('is_demo', false);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

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
        connectionId: s.connection_id ?? null,
        isDemo: !!s.is_demo,
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
