// GET /api/strategies/rebalancing/saved — load saved target allocations

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const userId = authUser!.id;

  try {
    const supabase = createServerClient();

    const { data, error } = await (supabase as any)
      .from('strategies')
      .select('id, config, created_at')
      .eq('user_id', userId)
      .eq('type', 'rebalance')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    if (!data) {
      return NextResponse.json({ saved: null });
    }

    return NextResponse.json({
      saved: {
        id: data.id,
        targetAllocations: data.config?.targetAllocations || [],
        driftThreshold: data.config?.driftThreshold || 5,
        alertEnabled: data.config?.alertEnabled || false,
        savedAt: data.config?.savedAt || data.created_at,
      },
    });
  } catch (err: any) {
    console.error('[rebalancing/saved] Error:', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
