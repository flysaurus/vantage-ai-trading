// ─── POST /api/ai/cache/clear ─────────────────────────────
// Clears AI cache for the authenticated user (JWT Bearer auth).

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  let userId: string;
  try {
    ({ userId } = await requireAuth(req));
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createServerClient();

    await Promise.all([
      (supabase as any).from('daily_briefs').delete().eq('user_id', userId),
      (supabase as any).from('weekly_snapshots').delete().eq('user_id', userId),
    ]);

    return NextResponse.json({ cleared: true });
  } catch (error: any) {
    console.error('Cache clear error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
