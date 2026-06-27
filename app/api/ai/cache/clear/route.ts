// ─── POST /api/ai/cache/clear ─────────────────────────────
// Clears AI cache for the authenticated user (JWT Bearer auth).

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const userId = authUser!.id;

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
