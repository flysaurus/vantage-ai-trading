// ─── POST /api/cron/sync-orders ─────────────────────────────
// Server-side order-lifecycle sync: polls SnapTrade recentOrders for
// every in-flight order (submitted/open/partially_filled) and persists
// status transitions (→ filled | cancelled | rejected) back to the
// canonical `orders` table with real broker details (fill price/qty/time,
// cancellation time).
//
// This is the PRIMARY fill/cancel detection mechanism. SnapTrade
// webhooks only emit connection-lifecycle events (CONNECTION_BROKEN,
// NEW_ACCOUNT_AVAILABLE, etc.) — NOT order-execution events — so polling
// is the only reliable path for order status.
//
// Also catches orders cancelled directly on the broker's own site/app
// (e.g. Alpaca dashboard) — no action in Vantage required. The broker
// returns status 'canceled' on the next poll and we persist it.
//
// Auth: Bearer CRON_SECRET / GH_CRON_SECRET / QSTASH_CRON_SECRET.
// Schedule: 21:15 UTC weekdays (Vercel Hobby caps cron at 1 run/day).
// For near-real-time sync, register a QStash schedule (minute-level cron)
// pointing at this same route with `Authorization: Bearer <QSTASH_CRON_SECRET>`.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  resolveSnapTradeCredentials,
  SnapTradeAuthError,
  SnapTradeAmbiguousError,
} from '@/lib/snaptrade/client';
import { SnapTradeBroker } from '@/lib/broker/snaptrade-broker';
import { notifyOrderEvent, type BasketOrderEvent } from '@/lib/order-emails';
import { notifyOrderNotification, notifyBasketNotification } from '@/lib/order-notifications';
import { formatBrokerName } from '@/lib/broker-name';
import { consumeLotsForSell, createLotForBuy } from '@/lib/fifo-ledger';
import type { OrderStatus } from '@/lib/broker/types';

const IN_FLIGHT = ['submitted', 'open', 'partially_filled'] as const;

// Stale-order guard: an in-flight order that has dropped out of SnapTrade's
// recentOrders and has been missing across this many TRADING DAYS is dead
// (expired/rejected at the broker) and must not linger as "open" forever.
//
// We count trading days (Mon–Fri), NOT wall-clock days. A weekend-placed order
// legitimately sits "submitted" for ~2.5 wall-clock days before Monday's open,
// but has passed 0 trading sessions — it must never be auto-cancelled before
// its first fillable session. (This exact bug produced false 'stale_guard'
// cancels on 2026-08-31 that the broker then filled.)
//
// Only orders BOTH missing from recentOrders AND missing across ≥2 trading
// days are auto-cancelled; recent+missing is treated as transient lag.
const STALE_AFTER_TRADING_DAYS = 2;

// Count elapsed trading days (Mon–Fri) strictly between two timestamps.
// A weekend-placed order has 0 elapsed trading days until Monday, so it is
// never cancelled before its first fillable session.
function tradingDaysBetween(fromMs: number, toMs: number): number {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return 0;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const start = new Date(fromMs);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(toMs);
  end.setUTCHours(0, 0, 0, 0);
  let count = 0;
  for (let t = start.getTime() + DAY_MS; t < end.getTime(); t += DAY_MS) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

const ALLOWED_SECRETS = [
  process.env.CRON_SECRET || '',
  process.env.GH_CRON_SECRET || '',
  process.env.QSTASH_CRON_SECRET || '',
].filter(Boolean);

function validateAuth(req: NextRequest): boolean {
  const authHeader =
    req.headers.get('authorization') || req.headers.get('Authorization') || '';
  return ALLOWED_SECRETS.some((secret) => authHeader === `Bearer ${secret}`);
}

interface InFlightOrder {
  id: string;
  connection_id: string | null;
  brokerage_order_id: string | null;
  status: string;
  created_at: string;
  symbol?: string | null;
  side?: string | null;
  qty?: number | null;
  requested_amount?: number | null;
  requested_qty?: number | null;
  order_unit?: 'dollars' | 'shares' | null;
  basket_id?: string | null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!validateAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // 1. Load all in-flight orders, grouped by user
  const { data: rows, error } = await supabase
    .from('orders')
    .select('id, user_id, connection_id, brokerage_order_id, status, created_at, symbol, side, qty, requested_amount, requested_qty, order_unit, basket_id')
    .in('status', [...IN_FLIGHT]);

  if (error) {
    console.error('[sync-orders] Failed to load in-flight orders:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Group in-flight orders by (user, connection) so each broker connection is
  // polled against its OWN SnapTrade authorization — never a sibling broker's.
  // A null connection_id (pre-052 legacy rows) groups under '' and resolves via
  // the single-connection path (throws 409 if the user has 2+ brokers).
  const groups = new Map<string, { userId: string; connectionId: string | null; orders: InFlightOrder[] }>();
  for (const r of rows || []) {
    const connectionId: string | null = r.connection_id ?? null;
    const key = `${r.user_id}|${connectionId ?? ''}`;
    let group = groups.get(key);
    if (!group) {
      group = { userId: r.user_id, connectionId, orders: [] };
      groups.set(key, group);
    }
    group.orders.push({
      id: r.id,
      connection_id: connectionId,
      brokerage_order_id: r.brokerage_order_id,
      status: r.status,
      created_at: r.created_at,
      symbol: r.symbol ?? null,
      side: r.side ?? null,
      qty: typeof r.qty === 'number' ? r.qty : null,
      requested_amount: typeof r.requested_amount === 'number' ? r.requested_amount : null,
      requested_qty: typeof r.requested_qty === 'number' ? r.requested_qty : null,
      order_unit: r.order_unit === 'dollars' || r.order_unit === 'shares' ? r.order_unit : null,
      basket_id: r.basket_id ?? null,
    });
  }

  if (groups.size === 0) {
    return NextResponse.json({
      connections: 0,
      orders: 0,
      transitions: 0,
      skipped: 0,
      errors: 0,
      message: 'No in-flight orders to sync.',
    });
  }

  let transitions = 0;
  let skipped = 0;
  let staleCancelled = 0;
  let errors = 0;

  // Basket-fill grouping (Issue C): collect basket legs that transitioned to a
  // fill status this run so we can emit ONE consolidated basket-level
  // notification instead of N per-leg bells. Keyed by basket_id; stores the
  // owning user + broker name for the post-loop grouped emission.
  const basketFillBatches = new Map<string, { userId: string; brokerName: string; connectionId: string | null }>();

  for (const group of groups.values()) {
    const userId = group.userId;
    const orders = group.orders;
    let broker: SnapTradeBroker;
    let brokerName = 'Unknown';
    try {
      const creds = await resolveSnapTradeCredentials(userId, group.connectionId);
      brokerName = formatBrokerName(creds.brokerSlug);
      broker = new SnapTradeBroker({
        userId: creds.snaptradeUserId,
        userSecret: creds.snaptradeUserSecret,
        connectionId: creds.connectionId,
        brokerSlug: creds.brokerSlug,
        brokerName,
        // getOrders() works read-only regardless of tradingEnabled; passing
        // true here only affects place/cancel, which this cron never calls.
        tradingEnabled: true,
      });
    } catch (err) {
      errors++;
      console.warn(
        `[sync-orders] Skip ${group.connectionId ? `connection ${group.connectionId}` : 'legacy (no connection_id)'} for user ${userId}: ${
          err instanceof SnapTradeAuthError
            ? 'no connected SnapTrade brokerage'
            : err instanceof SnapTradeAmbiguousError
              ? 'multiple brokers — order predates account tagging (052)'
              : err instanceof Error
                ? err.message
                : String(err)
        }`,
      );
      continue;
    }

    let liveOrders;
    try {
      liveOrders = await broker.getOrders();
    } catch (err) {
      errors++;
      console.error(
        `[sync-orders] getOrders failed for ${userId}:`,
        err instanceof Error ? err.message : err,
      );
      continue;
    }

    const liveById = new Map(liveOrders.map((o) => [o.id, o]));

    for (const o of orders) {
      // A NULL brokerage_order_id can never be matched against the broker's
      // recentOrders — it's an un-linkable row (e.g. a manual/recovery write).
      // Route it through the stale-guard below so it can't linger "open"
      // invisibly: recent → transient lag (skipped), old → auto-cancelled.
      const live = o.brokerage_order_id ? liveById.get(o.brokerage_order_id) : undefined;
      if (!live || !o.brokerage_order_id) {
        const brokerOrderId = o.brokerage_order_id || o.id;
        // Broker no longer returns this order. Two cases:
        //  1. Recent + missing → transient lag (just placed, not yet visible).
        //     Skip and retry next run.
        //  2. Old + missing → dropped/expired/rejected at the broker. Auto-cancel
        //     so it can't linger as "open" forever (stale-state guard).
        const createdAt = new Date(o.created_at).getTime();
        const tradingDays = tradingDaysBetween(createdAt, Date.now());
        if (Number.isFinite(createdAt) && tradingDays >= STALE_AFTER_TRADING_DAYS) {
          const now = new Date().toISOString();
          const { error: staleErr } = await supabase
            .from('orders')
            .update({ status: 'cancelled', cancelled_at: now, updated_at: now })
            .eq('id', o.id);
          if (staleErr) {
            errors++;
            console.error(
              `[sync-orders] Stale-cancel failed for ${o.id}:`,
              staleErr.message,
            );
          } else {
            // Best-effort reason (migration 057) — never block the status flip.
            await supabase
              .from('orders')
              .update({ cancel_reason: 'stale_guard' })
              .eq('id', o.id)
              .then((r) => {
                if (r.error) console.warn('[sync-orders] cancel_reason write skipped:', r.error.message);
              });
            staleCancelled++;
            console.log(
              `[sync-orders] Stale-cancel: ${brokerOrderId.slice(0, 8)} open ${tradingDays} trading-days → cancelled`,
            );

            // Honest stale-guard email: we could no longer confirm status with
            // the broker — do NOT phrase it as if the broker explicitly said so.
            await notifyOrderEvent(supabase, userId, {
              kind: 'cancelled',
              brokerName,
              symbol: o.symbol || 'Unknown',
              side: o.side?.toUpperCase() === 'SELL' ? 'SELL' : 'BUY',
              orderId: brokerOrderId,
              isLive: true,
              cancelReason: 'stale_guard',
              orderUnit: o.order_unit ?? null,
              requestedAmount: o.requested_amount ?? null,
              requestedQty: o.requested_qty ?? null,
            });

            await notifyOrderNotification(supabase, userId, {
              kind: 'cancelled',
              brokerName,
              symbol: o.symbol || 'Unknown',
              side: o.side?.toUpperCase() === 'SELL' ? 'SELL' : 'BUY',
              orderId: brokerOrderId,
              isLive: true,
              connectionId: o.connection_id ?? null,
              cancelReason: 'stale_guard',
              orderUnit: o.order_unit ?? null,
              requestedAmount: o.requested_amount ?? null,
              requestedQty: o.requested_qty ?? null,
            });
          }
        } else {
          skipped++;
        }
        continue;
      }

      const newStatus = live.status.toLowerCase();
      if (newStatus === o.status) continue; // no change

      const now = new Date().toISOString();
      const patch: Record<string, unknown> = {
        status: newStatus,
        updated_at: now,
      };

      if (live.status === 'FILLED' || live.status === 'PARTIALLY_FILLED') {
        patch.filled_qty = live.filledShares ?? live.shares ?? 0;
        patch.filled_price = live.fillPrice ?? null;
        patch.filled_at = live.filledAt ?? now;
      }
      let cancelReason: string | null = null;
      if (live.status === 'CANCELLED') {
        patch.cancelled_at = live.cancelledAt ?? now;
        cancelReason = 'external';
      }

      const { error: updErr } = await supabase
        .from('orders')
        .update(patch)
        .eq('id', o.id);

      if (updErr) {
        errors++;
        console.error(
          `[sync-orders] Update failed for order ${o.id}:`,
          updErr.message,
        );
      } else {
        // Best-effort reason (migration 057) — never block the status flip.
        if (cancelReason) {
          await supabase
            .from('orders')
            .update({ cancel_reason: cancelReason })
            .eq('id', o.id)
            .then((r) => {
              if (r.error) console.warn('[sync-orders] cancel_reason write skipped:', r.error.message);
            });
        }
        transitions++;
        console.log(
          `[sync-orders] ${o.brokerage_order_id.slice(0, 8)}: ${o.status} → ${newStatus}`,
        );

        // Order email: filled / partially-filled / cancelled transition
        // (incl. external cancels). `live` carries the authoritative broker-side
        // details; `o` carries the four-field requested model from the DB.
        const requested = {
          orderUnit: o.order_unit ?? null,
          requestedAmount: o.requested_amount ?? null,
          requestedQty: o.requested_qty ?? null,
        };
        if (live.status === 'FILLED') {
          const fillShares = live.filledShares ?? live.shares ?? 0;
          const fillPrice = live.fillPrice ?? 0;
          const totalCost = live.totalCost || (fillPrice * fillShares);

          // ── Lot ledger (unconditional, Phase 7) ──
          // Update the FIFO ledger BEFORE any notification so a bell/email
          // failure can never leave the ledger stale. Best-effort only:
          // a shortfall (external buy predating lot tracking) degrades
          // gracefully and is logged, never thrown.
          try {
            if (live.side === 'SELL') {
              const res = await consumeLotsForSell(
                supabase, userId, o.connection_id ?? null, live.symbol, fillShares,
              );
              if (res.shortfall > 0) {
                console.warn(
                  `[sync-orders] FIFO shortfall on ${live.symbol}: ` +
                    `${res.shortfall} of ${fillShares} shares unmatched to lots`,
                );
              }
            } else {
              await createLotForBuy(supabase, {
                userId,
                accountId: o.connection_id ?? null,
                ticker: live.symbol,
                qty: fillShares,
                priceAtFill: fillPrice,
                filledAt: live.filledAt ?? now,
                source: 'vantage',
                basketId: o.basket_id ?? null,
                orderId: o.id,
                originTag: o.basket_id ? 'basket_buy' : 'standalone_buy',
              });
            }
          } catch (err) {
            // Never block the status transition or notifications on ledger failure.
            console.error(
              '[sync-orders] Lot-ledger update failed:',
              err instanceof Error ? err.message : err,
            );
          }

          await notifyOrderEvent(supabase, userId, {
            kind: 'filled',
            brokerName,
            symbol: live.symbol,
            side: live.side,
            fillQty: fillShares,
            fillPrice,
            fillTotal: totalCost,
            orderId: o.brokerage_order_id,
            isLive: true,
            ...requested,
          });

          if (o.basket_id) {
            basketFillBatches.set(o.basket_id, { userId, brokerName, connectionId: o.connection_id ?? null });
          } else {
            await notifyOrderNotification(supabase, userId, {
              kind: 'filled',
              brokerName,
              symbol: live.symbol,
              side: live.side,
              fillQty: fillShares,
              fillPrice,
              fillTotal: totalCost,
              orderId: o.brokerage_order_id,
              isLive: true,
              connectionId: o.connection_id ?? null,
              ...requested,
            });
          }
        } else if (live.status === 'PARTIALLY_FILLED') {
          const fillShares = live.filledShares ?? live.shares ?? 0;
          const fillPrice = live.fillPrice ?? 0;
          const totalCost = live.totalCost || (fillPrice * fillShares);
          const remainingQty = Math.max(0, Number(o.requested_qty ?? o.qty ?? 0) - Number(fillShares));
          await notifyOrderEvent(supabase, userId, {
            kind: 'partially_filled',
            brokerName,
            symbol: live.symbol,
            side: live.side,
            fillQty: fillShares,
            fillPrice,
            fillTotal: totalCost,
            remainingQty,
            orderId: o.brokerage_order_id,
            isLive: true,
            ...requested,
          });

          if (o.basket_id) {
            basketFillBatches.set(o.basket_id, { userId, brokerName, connectionId: o.connection_id ?? null });
          } else {
            await notifyOrderNotification(supabase, userId, {
              kind: 'partially_filled',
              brokerName,
              symbol: live.symbol,
              side: live.side,
              fillQty: fillShares,
              fillPrice,
              fillTotal: totalCost,
              remainingQty,
              orderId: o.brokerage_order_id,
              isLive: true,
              connectionId: o.connection_id ?? null,
              ...requested,
            });
          }
        } else if (live.status === 'CANCELLED') {
          await notifyOrderEvent(supabase, userId, {
            kind: 'cancelled',
            brokerName,
            symbol: live.symbol,
            side: live.side,
            orderId: o.brokerage_order_id,
            isLive: true,
            cancelReason: 'external',
            ...requested,
          });

          await notifyOrderNotification(supabase, userId, {
            kind: 'cancelled',
            brokerName,
            symbol: live.symbol,
            side: live.side,
            orderId: o.brokerage_order_id,
            isLive: true,
            connectionId: o.connection_id ?? null,
            cancelReason: 'external',
            ...requested,
          });
        } else if (live.status === 'REJECTED') {
          // Rejections surfaced on a poll were previously persisted
          // (status='rejected') but never notified — the user got no email
          // and no bell. Mirror the CANCELLED branch so the broker's
          // rejection is surfaced honestly. (BrokerOrder carries no rejection
          // reason; both email + bell fall back to a generic message.)
          await notifyOrderEvent(supabase, userId, {
            kind: 'rejected',
            brokerName,
            symbol: live.symbol,
            side: live.side,
            orderId: o.brokerage_order_id,
            isLive: true,
            ...requested,
          });

          await notifyOrderNotification(supabase, userId, {
            kind: 'rejected',
            brokerName,
            symbol: live.symbol,
            side: live.side,
            orderId: o.brokerage_order_id,
            isLive: true,
            connectionId: o.connection_id ?? null,
            ...requested,
          });
        }
      }
    }
  }

  // ── Emit consolidated basket-fill notifications (Issue C) ──
  // For every basket whose legs filled this run, query the basket's FULL leg
  // set + metadata to derive the basket-level status, then fire ONE grouped
  // notification (interim "Partially Filled" → final "Basket Filled").
  if (basketFillBatches.size > 0) {
    const basketIds = Array.from(basketFillBatches.keys());
    const { data: basketLegs } = await supabase
      .from('orders')
      .select('basket_id, symbol, side, status, filled_qty, filled_price, requested_amount, requested_qty, order_unit')
      .in('basket_id', basketIds);
    const { data: basketMetaRows } = await supabase
      .from('user_baskets')
      .select('id, name, icon')
      .in('id', basketIds);

    const metaById = new Map<string, { name?: string | null; icon?: string | null }>(
      (basketMetaRows || []).map((b) => [b.id, b]),
    );
    const legsByBasket = new Map<string, any[]>();
    for (const l of basketLegs || []) {
      const bid = l.basket_id;
      if (!legsByBasket.has(bid)) legsByBasket.set(bid, []);
      legsByBasket.get(bid)!.push(l);
    }

    for (const [basketId, info] of basketFillBatches) {
      const legs = legsByBasket.get(basketId) || [];
      // Legs with any fill progress (fully-filled or partially-filled).
      const fillLegs = legs.filter((l) => l.status === 'filled' || l.status === 'partially_filled');
      if (fillLegs.length === 0) continue;
      const meta = metaById.get(basketId);
      const allFilled = legs.every((l) => l.status === 'filled');
      const event: BasketOrderEvent['event'] = allFilled ? 'filled' : 'partially_filled';

      const positions = fillLegs.map((l) => ({
        symbol: (l.symbol || '').toUpperCase(),
        side: ((l.side || 'buy').toUpperCase() === 'SELL' ? 'SELL' : 'BUY') as 'BUY' | 'SELL',
        orderUnit: l.order_unit === 'dollars' || l.order_unit === 'shares' ? l.order_unit : null,
        requestedAmount: typeof l.requested_amount === 'number' ? l.requested_amount : null,
        requestedQty: typeof l.requested_qty === 'number' ? l.requested_qty : null,
        status: l.status,
        fillQty: Number(l.filled_qty || 0),
        fillPrice: l.filled_price != null ? Number(l.filled_price) : 0,
        fillTotal: Number(l.filled_qty || 0) * (l.filled_price != null ? Number(l.filled_price) : 0),
      }));

      await notifyBasketNotification(supabase, info.userId, {
        brokerName: info.brokerName,
        basketName: meta?.name || 'Basket',
        basketEmoji: meta?.icon || undefined,
        event,
        positions,
        isLive: true,
        connectionId: info.connectionId,
      });
    }
  }

  return NextResponse.json({
    users: new Set([...groups.values()].map((g) => g.userId)).size,
    connections: groups.size,
    orders: rows?.length || 0,
    transitions,
    staleCancelled,
    skipped,
    errors,
  });
}
