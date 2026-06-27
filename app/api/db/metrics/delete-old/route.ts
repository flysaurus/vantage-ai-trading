// ─── POST /api/db/metrics/delete-old ─────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const authUserId = authUser!.id;
    const supabase = createServerClient();
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Missing request body' }, { status: 400 });

    const { userId, keepDays } = body as { userId?: string; keepDays?: number };
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });
    if (!keepDays || keepDays < 1) return NextResponse.json({ error: 'keepDays must be >= 1' }, { status: 400 });
    if (userId !== authUserId) return NextResponse.json({ error: 'Cannot delete other users metrics' }, { status: 403 });

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - keepDays);

    const { count, error } = await (supabase as any)
      .from('metrics')
      .delete({ count: 'exact' })
      .eq('user_id', userId)
      .lt('recorded_at', cutoff.toISOString());

    if (error) return NextResponse.json({ error: 'Failed to delete old metrics', detail: error.message }, { status: 500 });

    return NextResponse.json({ deletedCount: count || 0 });
  } catch (err: any) {
    if (err?.name === 'AuthError') return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
