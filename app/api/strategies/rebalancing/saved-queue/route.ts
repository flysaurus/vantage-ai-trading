// GET /api/strategies/rebalancing/saved-queue
// Loads a previously saved rebalancing order queue

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
      .select('config, created_at')
      .eq('user_id', userId)
      .eq('type', 'rebalance_queue')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      return NextResponse.json({ saved: null });
    }

    return NextResponse.json({
      saved: {
        orders: data.config.orders || [],
        summary: data.config.summary || {},
        savedAt: data.config.savedAt || data.created_at,
      },
    });
  } catch (err: any) {
    console.error('[saved-queue] Error:', err.message);
    return NextResponse.json({ saved: null });
  }
}
