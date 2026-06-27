// ─── POST /api/db/alerts/delete ───────────────────────────────
// Hard deletes an alert. Verifies ownership first.
// Requires: Authorization header with valid Bearer token.

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
    if (!body) {
      return NextResponse.json({ error: 'Missing request body' }, { status: 400 });
    }

    const { alertId } = body as { alertId?: string };
    if (!alertId) {
      return NextResponse.json({ error: 'alertId required' }, { status: 400 });
    }

    // Verify ownership
    const { data: existing } = await (supabase as any)
      .from('alerts')
      .select('id, user_id')
      .eq('id', alertId)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
    }
    if (existing.user_id !== authUserId) {
      return NextResponse.json({ error: 'Cannot delete other users alerts' }, { status: 403 });
    }

    const { error } = await (supabase as any)
      .from('alerts')
      .delete()
      .eq('id', alertId);

    if (error) {
      console.error('[alerts/delete] Delete failed:', error.message);
      return NextResponse.json({ error: 'Failed to delete alert', detail: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err?.name === 'AuthError') {
      return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    }
    console.error('[alerts/delete] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error', detail: err?.message }, { status: 500 });
  }
}
