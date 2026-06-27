// POST /api/strategies/rebalancing/save — save target allocations

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const userId = authUser!.id;

  try {
    const supabase = createServerClient();
    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.targetAllocations) || body.targetAllocations.length === 0) {
      return NextResponse.json({ error: 'Missing targetAllocations' }, { status: 400 });
    }

    const { targetAllocations, driftThreshold = 5, alertEnabled = false } = body;

    // Deactivate any existing rebalance strategy for this user
    await (supabase as any)
      .from('strategies')
      .update({ is_active: false })
      .eq('user_id', userId)
      .eq('type', 'rebalance');

    // Insert new active strategy
    const { data, error } = await (supabase as any)
      .from('strategies')
      .insert({
        user_id: userId,
        type: 'rebalance',
        symbol: null,
        config: {
          targetAllocations,
          driftThreshold,
          alertEnabled,
          alertChannels: ['in_app', 'email'],
          savedAt: new Date().toISOString(),
        },
        is_active: true,
        next_run_at: null,
      })
      .select('id')
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, id: data.id });
  } catch (err: any) {
    console.error('[rebalancing/save] Error:', err.message);
    return NextResponse.json({ error: err.message || 'Failed to save' }, { status: 500 });
  }
}
