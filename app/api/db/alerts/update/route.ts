// ─── POST /api/db/alerts/update ───────────────────────────────
// Updates an alert — toggle active status or change target value.
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

    const { alertId, isActive, targetValue } = body as {
      alertId?: string;
      isActive?: boolean;
      targetValue?: number;
    };

    if (!alertId) {
      return NextResponse.json({ error: 'alertId required' }, { status: 400 });
    }
    if (isActive === undefined && targetValue === undefined) {
      return NextResponse.json({ error: 'isActive or targetValue required' }, { status: 400 });
    }
    if (targetValue !== undefined && targetValue <= 0) {
      return NextResponse.json({ error: 'targetValue must be positive' }, { status: 400 });
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
      return NextResponse.json({ error: 'Cannot update other users alerts' }, { status: 403 });
    }

    // Build update — production DB has no updated_at column
    const updates: Record<string, unknown> = {};
    if (isActive !== undefined) updates.is_active = isActive;
    if (targetValue !== undefined) updates.threshold = targetValue;

    const { data, error } = await (supabase as any)
      .from('alerts')
      .update(updates)
      .eq('id', alertId)
      .select('id, type, threshold, is_active')
      .single();

    if (error) {
      console.error('[alerts/update] Update failed:', error.message);
      return NextResponse.json({ error: 'Failed to update alert', detail: error.message }, { status: 500 });
    }

    return NextResponse.json({
      id: data.id,
      alertType: data.type,
      targetValue: data.threshold,
      isActive: data.is_active,
    });
  } catch (err: any) {
    if (err?.name === 'AuthError') {
      return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    }
    console.error('[alerts/update] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error', detail: err?.message }, { status: 500 });
  }
}
