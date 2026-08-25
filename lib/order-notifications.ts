/**
 * Order Notification Bell (in-app)
 *
 * Writes order-lifecycle events to `public.recent_notifications`, which the
 * Header bell reads via /api/notifications/{unread,list,mark-read}. Mirrors the
 * email lifecycle in lib/order-emails.ts but produces compact one-liners
 * instead of HTML email bodies.
 *
 * Rules (locked product decisions):
 *   - OPT-IN/OUT via `users.order_notifications_enabled` (DEFAULT true).
 *     Unlike email (always-on), the bell is user-mutable (Em's Option B).
 *   - DEMO EXCLUSION: demo orders (is_demo = true → isLive = false) write
 *     NOTHING. Real-broker orders only.
 *   - GENERIC: every title/message is BUY/SELL agnostic.
 *   - ROUNDING: reused from order-emails (single source of truth).
 *
 * notifyOrderNotification() is the single entry point; it checks the demo guard
 * + preference, builds a compact title/message, then inserts. It never throws —
 * a bell write failure must not block the order flow.
 */

import {
  fmtShares,
  fmtDollars,
  authoritativeRequested,
  derivedRequested,
  type RequestedFields,
} from '@/lib/order-format';
import type { OrderEmailEvent, BasketOrderEvent } from '@/lib/order-emails';

const ACTION_URL = '/?tab=invest';

/** Compact requested label: "authoritative (derived)" — e.g. "$1,000.00 (≈3.27 shares est.)". */
function requestedLabel(f: RequestedFields): string {
  const auth = authoritativeRequested(f);
  const deriv = derivedRequested(f);
  return deriv ? `${auth} (${deriv})` : auth;
}

function sharesLabel(qty: number): string {
  const n = Number(qty);
  return `${fmtShares(n)} share${n === 1 ? '' : 's'}`;
}

/** Short, bell-appropriate cancellation reason (differs from the email prose). */
function cancelReasonShort(
  reason: 'user_cancelled' | 'broker' | 'external' | 'stale_guard',
  brokerName: string,
): string {
  switch (reason) {
    case 'user_cancelled':
      return 'Cancelled at your request in Vantage';
    case 'broker':
      return `Rejected or expired at ${brokerName}`;
    case 'external':
      return 'Cancelled outside Vantage (or expired)';
    case 'stale_guard':
      return `Status unconfirmed after 2 days — marked cancelled`;
  }
}

interface BellContent {
  type: string;
  title: string;
  message: string;
}

function buildContent(e: OrderEmailEvent): BellContent {
  const sym = e.symbol.toUpperCase();

  switch (e.kind) {
    case 'placed': {
      const bits = [requestedLabel(e)];
      if (e.type) bits.push(e.type.toUpperCase());
      bits.push(e.brokerName);
      return {
        type: 'order_placed',
        title: `📊 ${e.side} ${sym} — Order Submitted`,
        message: bits.join(' · '),
      };
    }

    case 'filled': {
      return {
        type: 'order_filled',
        title: `✅ ${e.side} ${sym} — Filled`,
        message: `${sharesLabel(e.fillQty)} @ ${fmtDollars(e.fillPrice)} · ${fmtDollars(e.fillTotal)}`,
      };
    }

    case 'partially_filled': {
      const remaining = Number(e.remainingQty || 0);
      const tail = remaining > 0 ? ` · ${sharesLabel(e.remainingQty)} open` : '';
      return {
        type: 'order_partially_filled',
        title: `⏳ ${e.side} ${sym} — Partially Filled`,
        message: `${sharesLabel(e.fillQty)} @ ${fmtDollars(e.fillPrice)} · ${fmtDollars(e.fillTotal)}${tail}`,
      };
    }

    case 'rejected': {
      return {
        type: 'order_rejected',
        title: `⚠️ ${e.side} ${sym} — Not Accepted`,
        message: e.reason?.trim() || 'No reason provided by the broker',
      };
    }

    case 'cancelled': {
      return {
        type: 'order_cancelled',
        title: `❌ ${e.side} ${sym} — Cancelled`,
        message: `${requestedLabel(e)} · ${cancelReasonShort(e.cancelReason, e.brokerName)}`,
      };
    }

    case 'cancel_rejected_filled': {
      return {
        type: 'order_filled',
        title: `✅ ${e.side} ${sym} — Filled (Cancel Unavailable)`,
        message: `${sharesLabel(e.fillQty)} @ ${fmtDollars(e.fillPrice)} · ${fmtDollars(e.fillTotal)}`,
      };
    }
  }
}

/**
 * Single entry point for order-lifecycle in-app bell notifications.
 *
 * Skips demo orders (isLive === false), honors the per-user preference
 * (default ON), then inserts a compact title/message into
 * recent_notifications. Never throws.
 */
export async function notifyOrderNotification(
  supabase: any,
  userId: string,
  event: OrderEmailEvent,
): Promise<void> {
  try {
    if (!event.isLive) return; // demo exclusion

    // Preference check — null/undefined → default ON.
    const { data: user } = await supabase
      .from('users')
      .select('order_notifications_enabled')
      .eq('id', userId)
      .maybeSingle();

    if (user && user.order_notifications_enabled === false) {
      return; // user muted order notifications
    }

    const { type, title, message } = buildContent(event);

    const { error } = await supabase.from('recent_notifications').insert({
      user_id: userId,
      type,
      title,
      message,
      action_url: ACTION_URL,
      is_read: false,
      created_at: new Date().toISOString(),
    });

    if (error) {
      console.error('[order-notification] Insert failed:', error.message);
    }
  } catch (err: any) {
    console.error('[order-notification] notifyOrderNotification failed:', err?.message);
  }
}

const BASKET_BELL_LABEL: Record<BasketOrderEvent['event'], string> = {
  placed: 'Basket Submitted',
  filled: 'Basket Filled',
  partially_filled: 'Basket Partially Filled',
  cancelled: 'Basket Cancelled',
};

/**
 * Basket bell notification — basket-level details FIRST, then one compact row
 * per individual leg (same style as a single-order "placed" notification).
 *
 * Skips demo, honors the per-user preference (default ON), then bulk-inserts
 * all rows in one write. Never throws.
 */
export async function notifyBasketNotification(
  supabase: any,
  userId: string,
  event: BasketOrderEvent,
): Promise<void> {
  try {
    if (!event.isLive) return; // demo exclusion

    const { data: user } = await supabase
      .from('users')
      .select('order_notifications_enabled')
      .eq('id', userId)
      .maybeSingle();

    if (user && user.order_notifications_enabled === false) return;

    const positions = event.positions || [];
    // For fill events the summary total reflects the ACTUAL filled notional
    // (qty × price), not the originally-requested dollar amount.
    const isFillEvent = event.event === 'filled' || event.event === 'partially_filled';
    const total = positions.reduce((sum, p) => {
      if (isFillEvent) {
        return sum + (p.fillTotal ?? (p.fillPrice ?? 0) * (p.fillQty ?? 0));
      }
      const unit =
        p.orderUnit === 'dollars' || p.orderUnit === 'shares'
          ? p.orderUnit
          : p.requestedAmount != null && p.requestedAmount > 0
            ? 'dollars'
            : 'shares';
      return unit === 'dollars' ? sum + (p.requestedAmount || 0) : sum;
    }, 0);

    const emoji = event.basketEmoji || '🧺';
    const name = event.basketName || 'Basket';
    const rows: Array<Record<string, unknown>> = [];

    // 1) Basket-level summary row (details first)
    rows.push({
      user_id: userId,
      type: `basket_${event.event}`,
      title: `📊 ${emoji} ${name} — ${BASKET_BELL_LABEL[event.event]}`,
      message: `${positions.length} stock${positions.length === 1 ? '' : 's'}${total > 0 ? ` · ${fmtDollars(total)}` : ''} · ${event.brokerName}`,
      action_url: ACTION_URL,
      is_read: false,
      created_at: new Date().toISOString(),
    });

    // 2) Individual leg rows — event-aware. "placed" → "Order Submitted";
    // "filled"/"partially_filled" → per-leg "Filled"/"Partially Filled" with
    // real fill qty/price/total; "cancelled" → "Cancelled".
    for (const p of positions) {
      const base = {
        brokerName: event.brokerName,
        symbol: p.symbol,
        side: p.side,
        orderId: '',
        isLive: event.isLive,
        orderUnit: p.orderUnit,
        requestedAmount: p.requestedAmount,
        requestedQty: p.requestedQty,
      };
      let leg: OrderEmailEvent;
      if (event.event === 'placed') {
        leg = { ...base, kind: 'placed', type: p.type || 'market' };
      } else if (event.event === 'cancelled') {
        leg = { ...base, kind: 'cancelled', cancelReason: 'external' };
      } else if (event.event === 'partially_filled' && p.status === 'partially_filled') {
        leg = {
          ...base,
          kind: 'partially_filled',
          fillQty: p.fillQty ?? 0,
          fillPrice: p.fillPrice ?? 0,
          fillTotal: p.fillTotal ?? (p.fillPrice ?? 0) * (p.fillQty ?? 0),
          remainingQty: p.remainingQty ?? 0,
        };
      } else {
        // 'filled' event, or a fully-filled leg inside a 'partially_filled' basket
        leg = {
          ...base,
          kind: 'filled',
          fillQty: p.fillQty ?? 0,
          fillPrice: p.fillPrice ?? 0,
          fillTotal: p.fillTotal ?? (p.fillPrice ?? 0) * (p.fillQty ?? 0),
        };
      }
      const { type, title, message } = buildContent(leg);
      rows.push({
        user_id: userId,
        type,
        title,
        message,
        action_url: ACTION_URL,
        is_read: false,
        created_at: new Date().toISOString(),
      });
    }

    const { error } = await supabase.from('recent_notifications').insert(rows);
    if (error) {
      console.error('[order-notification] Basket insert failed:', error.message);
    }
  } catch (err: any) {
    console.error('[order-notification] notifyBasketNotification failed:', err?.message);
  }
}
