// ─── GET /api/db/alerts/get-all?userId=<id>&isActive=true ─────
// Fetches alerts for a user, optionally filtered by active status.
// Requires: Authorization header with valid Bearer token.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId: authUserId } = await requireAuth(req);
    const supabase = createServerClient();

    const { searchParams } = req.nextUrl;
    const targetUserId = searchParams.get('userId') || authUserId;
    const isActiveParam = searchParams.get('isActive');

    if (targetUserId !== authUserId) {
      return NextResponse.json({ error: 'Cannot fetch other users alerts' }, { status: 403 });
    }

    let query = (supabase as any)
      .from('alerts')
      .select('id, user_id, symbol, alert_type, target_value, is_active, triggered_at, created_at, updated_at')
      .eq('user_id', targetUserId)
      .order('created_at', { ascending: false });

    // Optional: filter by active status
    if (isActiveParam === 'true') {
      query = query.eq('is_active', true);
    } else if (isActiveParam === 'false') {
      query = query.eq('is_active', false);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[alerts/get-all] Query failed:', error.message);
      return NextResponse.json({ error: 'Failed to fetch alerts', detail: error.message }, { status: 500 });
    }

    const alerts = (data || []).map((a: any) => ({
      id: a.id,
      userId: a.user_id,
      symbol: a.symbol,
      alertType: a.alert_type,
      targetValue: a.target_value,
      isActive: a.is_active,
      notificationChannels: a.notification_channels || ['in_app'],
      triggeredAt: a.triggered_at,
      createdAt: a.created_at,
      updatedAt: a.updated_at,
    }));

    return NextResponse.json({ alerts });
  } catch (err: any) {
    if (err?.name === 'AuthError') {
      return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    }
    console.error('[alerts/get-all] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error', detail: err?.message }, { status: 500 });
  }
}
