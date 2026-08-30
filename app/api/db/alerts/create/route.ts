// ─── POST /api/db/alerts/create ───────────────────────────────
// Creates a price alert for the authenticated user.
// Requires: Authorization header with valid Bearer token.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';
import { accountScopeColumns } from '@/lib/account-scope';

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

    const { userId, symbol, alertType, targetValue, notificationChannels, accountId } = body as {
      userId?: string;
      symbol?: string;
      alertType?: string;
      targetValue?: number;
      notificationChannels?: string[];
      accountId?: string;
    };

    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });
    if (!symbol || !symbol.trim()) return NextResponse.json({ error: 'symbol required' }, { status: 400 });
    if (!alertType) return NextResponse.json({ error: 'alertType required' }, { status: 400 });
    if (targetValue === undefined || targetValue === null) return NextResponse.json({ error: 'targetValue required' }, { status: 400 });
    if (targetValue <= 0) return NextResponse.json({ error: 'targetValue must be positive' }, { status: 400 });
    if (!['price_above', 'price_below', 'percent_change'].includes(alertType)) {
      return NextResponse.json({ error: 'alertType must be price_above, price_below, or percent_change' }, { status: 400 });
    }

    if (userId !== authUserId) {
      return NextResponse.json({ error: 'Cannot create alerts for other users' }, { status: 403 });
    }

    const channels = notificationChannels?.length ? notificationChannels : ['in_app'];
    const scopeCols = accountScopeColumns(accountId);

    // Production DB uses 'type' and 'threshold' column names
    const insertPayload: Record<string, any> = {
      user_id: userId,
      symbol: symbol.trim().toUpperCase(),
      type: alertType,
      threshold: targetValue,
      is_active: true,
      connection_id: scopeCols.connection_id,
      is_demo: scopeCols.is_demo,
    };
    if (channels.length > 1) {
      insertPayload.notification_channels = channels;
    }

    const { data, error } = await (supabase as any)
      .from('alerts')
      .insert(insertPayload)
      .select('id, symbol, type, threshold, is_active, notification_channels, triggered_at, created_at')
      .single();

    if (error) {
      console.error('[alerts/create] Insert failed:', error.message);
      return NextResponse.json({ error: 'Failed to create alert', detail: error.message }, { status: 500 });
    }

    return NextResponse.json({
      id: data.id,
      symbol: data.symbol,
      alertType: data.type,
      targetValue: data.threshold,
      isActive: data.is_active,
      notificationChannels: data.notification_channels || ['in_app'],
      triggeredAt: data.triggered_at,
      createdAt: data.created_at,
    });
  } catch (err: any) {
    if (err?.name === 'AuthError') {
      return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    }
    console.error('[alerts/create] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error', detail: err?.message }, { status: 500 });
  }
}
