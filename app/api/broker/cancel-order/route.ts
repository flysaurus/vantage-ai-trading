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
  SnapTradeAmbiguousError,
} from '@/lib/snaptrade/client';
import { SnapTradeBroker } from '@/lib/broker/snaptrade-broker';
import { notifyOrderEvent } from '@/lib/order-emails';
import { notifyOrderNotification } from '@/lib/order-notifications';
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

  let body: { orderId?: string; connectionId?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid request body' },
      { status: 400 },
    );
  }

  const orderId = typeof body?.orderId === 'string' ? body.orderId.trim() : '';
  const requestedConnectionId = typeof body?.connectionId === 'string' ? body.connectionId : null;
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
    const creds = await resolveSnapTradeCredentials(authUser!.id, requestedConnectionId);
    snaptradeUserId = creds.snaptradeUserId;
    snaptradeUserSecret = creds.snaptradeUserSecret;
    connectionId = creds.connectionId;
    brokerSlug = creds.brokerSlug;
    tradingEnabled = creds.tradingEnabled;
  } catch (err) {
    if (err instanceof SnapTradeAuthError) {
      return NextResponse.json(
        { success: false, error: err.message },
        { status: err.status },
      );
    }
    if (err instanceof SnapTradeAmbiguousError) {
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
  let dbSymbol: string | null = null;
  let dbSide: string | null = null;
  let dbQty: number | null = null;
  let dbOrderUnit: 'dollars' | 'shares' | null = null;
  let dbRequestedAmount: number | null = null;
  let dbRequestedQty: number | null = null;
  let brokerageOrderId: string = orderId;

  if (UUID_RE.test(orderId)) {
    try {
      const { data } = await supabase
        .from('orders')
        .select('id, brokerage_order_id, status, symbol, side, qty, requested_amount, requested_qty, order_unit')
        .or(`id.eq.${orderId},brokerage_order_id.eq.${orderId}`)
        .eq('user_id', authUser!.id)
        .limit(1)
        .maybeSingle();

      if (data) {
        dbOrderId = data.id;
        brokerageOrderId = data.brokerage_order_id || orderId;
        dbSymbol = data.symbol || null;
        dbSide = data.side || null;
        dbQty = typeof data.qty === 'number' ? data.qty : null;
        dbOrderUnit = data.order_unit === 'dollars' || data.order_unit === 'shares' ? data.order_unit : null;
        dbRequestedAmount = typeof data.requested_amount === 'number' ? data.requested_amount : null;
        dbRequestedQty = typeof data.requested_qty === 'number' ? data.requested_qty : null;
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

  const result = await broker.cancelOrderSafe(brokerageOrderId);
  const now = new Date().toISOString();

  // ── Success: normal cancel ───────────────────────────────
  if (result.success) {
    let dbUpdated = false;
    if (dbOrderId) {
      const { error: updErr } = await supabase
        .from('orders')
        .update({ status: 'cancelled', cancelled_at: now, updated_at: now, cancel_reason: 'user_cancelled' })
        .eq('id', dbOrderId);
      dbUpdated = !updErr;
      if (updErr) {
        console.error('[cancel-order] DB update failed:', updErr.message);
      }
    }

    if (dbSymbol) {
      await notifyOrderEvent(
        supabase,
        authUser!.id,
        {
          kind: 'cancelled',
          brokerName: formatBrokerName(brokerSlug),
          symbol: dbSymbol,
          side: dbSide === 'sell' ? 'SELL' : 'BUY',
          orderId: brokerageOrderId,
          isLive: true,
          cancelReason: 'user_cancelled',
          orderUnit: dbOrderUnit,
          requestedAmount: dbRequestedAmount,
          requestedQty: dbRequestedQty,
        },
        authUser!.email,
      );

      await notifyOrderNotification(
        supabase,
        authUser!.id,
        {
          kind: 'cancelled',
          brokerName: formatBrokerName(brokerSlug),
          symbol: dbSymbol,
          side: dbSide === 'sell' ? 'SELL' : 'BUY',
          orderId: brokerageOrderId,
          isLive: true,
          cancelReason: 'user_cancelled',
          orderUnit: dbOrderUnit,
          requestedAmount: dbRequestedAmount,
          requestedQty: dbRequestedQty,
        },
      );
    }

    return NextResponse.json({
      success: true,
      status: 'cancelled',
      orderId: brokerageOrderId,
      cancelledAt: now,
      dbUpdated,
      cancelReason: 'user_cancelled',
      message: result.message || `Order ${brokerageOrderId} cancelled.`,
    });
  }

  // ── Cancel race / failure: reconcile this ONE order's real state ──
  const reconciled = result.reconciledOrder;
  if (reconciled) {
    const dbStatus = mapBrokerStatusToDb(reconciled.status);
    const alreadyFilled = reconciled.status === 'FILLED';

    let dbUpdated = false;
    if (dbOrderId) {
      const patch: Record<string, unknown> = {
        status: dbStatus,
        updated_at: now,
      };
      if (alreadyFilled) {
        patch.filled_qty = reconciled.filledShares ?? reconciled.shares ?? 0;
        patch.filled_price = reconciled.fillPrice ?? null;
        patch.filled_at = reconciled.filledAt ?? now;
        patch.cancel_reason = 'already_filled';
      } else if (reconciled.status === 'CANCELLED') {
        patch.cancelled_at = now;
        patch.cancel_reason = 'external';
      }
      const { error: updErr } = await supabase
        .from('orders')
        .update(patch)
        .eq('id', dbOrderId);
      dbUpdated = !updErr;
      if (updErr) {
        console.error('[cancel-order] reconcile DB update failed:', updErr.message);
      }
    }

    // Fill notification when the "cancel" actually turned out to be a fill.
    if (alreadyFilled && dbSymbol) {
      const shares = reconciled.filledShares ?? reconciled.shares ?? dbQty ?? 0;
      const fillPrice = reconciled.fillPrice ?? 0;
      await notifyOrderEvent(
        supabase,
        authUser!.id,
        {
          kind: 'cancel_rejected_filled',
          brokerName: formatBrokerName(brokerSlug),
          symbol: dbSymbol,
          side: dbSide === 'sell' ? 'SELL' : 'BUY',
          fillQty: shares,
          fillPrice,
          fillTotal: shares * fillPrice,
          orderId: brokerageOrderId,
          isLive: true,
          orderUnit: dbOrderUnit,
          requestedAmount: dbRequestedAmount,
          requestedQty: dbRequestedQty,
        },
        authUser!.email,
      );

      await notifyOrderNotification(
        supabase,
        authUser!.id,
        {
          kind: 'cancel_rejected_filled',
          brokerName: formatBrokerName(brokerSlug),
          symbol: dbSymbol,
          side: dbSide === 'sell' ? 'SELL' : 'BUY',
          fillQty: shares,
          fillPrice,
          fillTotal: shares * fillPrice,
          orderId: brokerageOrderId,
          isLive: true,
          orderUnit: dbOrderUnit,
          requestedAmount: dbRequestedAmount,
          requestedQty: dbRequestedQty,
        },
      );
    }

    return NextResponse.json({
      success: false,
      alreadyFilled,
      reconciled: true,
      status: dbStatus,
      fillPrice: alreadyFilled ? (reconciled.fillPrice ?? undefined) : undefined,
      filledQty: alreadyFilled
        ? (reconciled.filledShares ?? reconciled.shares ?? undefined)
        : undefined,
      filledAt: alreadyFilled ? (reconciled.filledAt ?? undefined) : undefined,
      orderId: brokerageOrderId,
      dbUpdated,
      message:
        result.message ||
        (alreadyFilled
          ? 'This order had already filled — showing the real result.'
          : `Order is already ${dbStatus}.`),
    });
  }

  // Generic failure with no reconciliation data available.
  return NextResponse.json(
    { success: false, error: result.message || 'Cancel failed at broker.' },
    { status: 502 },
  );
}

function mapBrokerStatusToDb(status: string): string {
  switch (status.toUpperCase()) {
    case 'FILLED': return 'filled';
    case 'CANCELLED': return 'cancelled';
    case 'REJECTED': return 'rejected';
    case 'PARTIALLY_FILLED': return 'partially_filled';
    case 'OPEN':
    case 'SUBMITTED':
    default: return 'open';
  }
}
