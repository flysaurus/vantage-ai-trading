// ─── POST /api/broker/cancel-order ───────────────────────────
// Server-side proxy: resolves SnapTrade credentials, creates a
// SnapTradeBroker, and calls cancelOrder() to cancel an in-flight
// order at the broker (SnapTrade POST /accounts/{accountId}/trading/cancel
// with { brokerage_order_id }).
//
// This is the counterpart to /api/broker/execute-trade. The OLD client
// BrokerAdapter (lib/broker/snaptrade.ts) exposes cancelOrder() as a
// read-only stub that throws READ_ONLY_ERROR, so the ONLY working cancel
// path is server-side (credentials never leave the server).
//
// On success, persists status='cancelled' + cancelled_at + updated_at to
// the canonical `orders` table so the Orders screen reflects the cancel
// immediately (no need to wait for the sync cron / 30s poll).
//
// Accepts either identifier from the UI:
//   - brokerage_order_id (broker order id — what a live order's `id` is)
//   - canonical DB order UUID (what a DB-only order's `id` is)
// Both are UUIDs; we resolve to the brokerage_order_id SnapTrade needs.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import {
  resolveSnapTradeCredentials,
  SnapTradeAuthError,
} from '@/lib/snaptrade/client';
import { SnapTradeBroker } from '@/lib/broker/snaptrade-broker';
import { createClient } from '@supabase/supabase-js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatBrokerName(slug: string | null): string {
  if (!slug) return 'Unknown';
  return slug
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export async function POST(req: NextRequest) {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;

  let body: { orderId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid request body' },
      { status: 400 },
    );
  }

  const orderId = typeof body?.orderId === 'string' ? body.orderId.trim() : '';
  if (!orderId) {
    return NextResponse.json(
      { success: false, error: 'Missing orderId' },
      { status: 400 },
    );
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // --- Resolve credentials + trading flag ---
  let snaptradeUserId: string;
  let snaptradeUserSecret: string;
  let connectionId: string;
  let brokerSlug: string;
  let tradingEnabled = false;

  try {
    const creds = await resolveSnapTradeCredentials(authUser!.id);
    snaptradeUserId = creds.snaptradeUserId;
    snaptradeUserSecret = creds.snaptradeUserSecret;
    connectionId = creds.connectionId;
    brokerSlug = creds.brokerSlug;

    const { data: conn } = await supabase
      .from('broker_connections')
      .select('trading_enabled')
      .eq('user_id', authUser!.id)
      .eq('connection_type', 'snaptrade')
      .eq('status', 'connected')
      .maybeSingle();

    tradingEnabled = conn?.trading_enabled === true;
  } catch (err) {
    if (err instanceof SnapTradeAuthError) {
      return NextResponse.json(
        { success: false, error: err.message },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { success: false, error: 'Failed to load brokerage credentials.' },
      { status: 502 },
    );
  }

  if (!tradingEnabled) {
    return NextResponse.json(
      { success: false, error: 'Trading is not enabled for this connection.' },
      { status: 403 },
    );
  }

  // --- Resolve canonical DB row + brokerage_order_id ---
  // The UI may pass either the broker order id or the DB UUID. Look up the
  // order by BOTH so we know (a) which brokerage_order_id to send to SnapTrade
  // and (b) which DB row to flip to 'cancelled' after a successful cancel.
  let dbOrderId: string | null = null;
  let brokerageOrderId: string = orderId;

  if (UUID_RE.test(orderId)) {
    try {
      const { data } = await supabase
        .from('orders')
        .select('id, brokerage_order_id, status')
        .or(`id.eq.${orderId},brokerage_order_id.eq.${orderId}`)
        .eq('user_id', authUser!.id)
        .limit(1)
        .maybeSingle();

      if (data) {
        dbOrderId = data.id;
        brokerageOrderId = data.brokerage_order_id || orderId;
      }
    } catch (err) {
      console.warn(
        '[cancel-order] DB lookup failed, treating orderId as broker order id:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  // --- Cancel at broker ---
  const broker = new SnapTradeBroker({
    userId: snaptradeUserId,
    userSecret: snaptradeUserSecret,
    connectionId,
    brokerSlug,
    brokerName: formatBrokerName(brokerSlug),
    tradingEnabled,
  });

  const result = await broker.cancelOrder(brokerageOrderId);

  if (!result.success) {
    console.error(
      `[cancel-order] Cancel failed for ${brokerageOrderId}:`,
      result.message,
    );
    return NextResponse.json(
      { success: false, error: result.message || 'Cancel failed at broker.' },
      { status: 502 },
    );
  }

  // --- Persist cancellation to canonical orders table ---
  const now = new Date().toISOString();
  let dbUpdated = false;
  if (dbOrderId) {
    const { error: updErr } = await supabase
      .from('orders')
      .update({ status: 'cancelled', cancelled_at: now, updated_at: now })
      .eq('id', dbOrderId);
    dbUpdated = !updErr;
    if (updErr) {
      console.error('[cancel-order] DB update failed:', updErr.message);
    }
  }

  return NextResponse.json({
    success: true,
    status: 'cancelled',
    orderId: brokerageOrderId,
    cancelledAt: now,
    dbUpdated,
    message: result.message || `Order ${brokerageOrderId} cancelled.`,
  });
}
