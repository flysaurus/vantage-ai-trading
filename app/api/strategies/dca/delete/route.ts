// ─── DELETE /api/strategies/dca/delete ────────────────────────
// Deactivates (cancels) a DCA schedule for the authenticated user.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  try {
    const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const userId = authUser!.id;
    const supabase = createServerClient();

    const scheduleId = req.nextUrl.searchParams.get('id');
    if (!scheduleId) {
      return NextResponse.json({ error: 'Schedule ID required' }, { status: 400 });
    }

    // Verify ownership
    const { data: existing } = await (supabase as any)
      .from('strategies')
      .select('id, user_id')
      .eq('id', scheduleId)
      .eq('type', 'dca')
      .single();

    if (!existing || existing.user_id !== userId) {
      return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
    }

    const { error } = await (supabase as any)
      .from('strategies')
      .update({ is_active: false })
      .eq('id', scheduleId);

    if (error) {
      console.error('[strategies/dca/delete] Failed:', error.message);
      return NextResponse.json({ error: 'Failed to cancel schedule', detail: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err?.name === 'AuthError') {
      return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    }
    console.error('[strategies/dca/delete] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
