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
} from '@/lib/snaptrade/client';
import { SnapTradeBroker } from '@/lib/broker/snaptrade-broker';
import type { OrderStatus } from '@/lib/broker/types';

const IN_FLIGHT = ['submitted', 'open', 'partially_filled'] as const;

// Stale-order guard: an in-flight order older than this that has dropped
// out of SnapTrade's recentOrders is dead (expired/rejected at the broker)
// and must not linger as "open" forever. 2 days is conservative:
//   - market+day orders resolve same-day (fill or expire at close)
//   - a genuinely-live GTC order stays in recentOrders, so it never hits
//     the "not found" branch at all — it reconciles normally
// Only orders BOTH missing from recentOrders AND older than this threshold
// are auto-cancelled; recent+missing is treated as transient lag and skipped.
const STALE_AFTER_MS = 2 * 24 * 60 * 60 * 1000; // 2 days

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

function formatBrokerName(slug: string | null): string {
  if (!slug) return 'Unknown';
  return slug
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

interface InFlightOrder {
  id: string;
  brokerage_order_id: string | null;
  status: string;
  created_at: string;
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
    .select('id, user_id, brokerage_order_id, status, created_at')
    .in('status', [...IN_FLIGHT])
    .not('brokerage_order_id', 'is', null);

  if (error) {
    console.error('[sync-orders] Failed to load in-flight orders:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const byUser = new Map<string, InFlightOrder[]>();
  for (const r of rows || []) {
    const list = byUser.get(r.user_id) || [];
    list.push({
      id: r.id,
      brokerage_order_id: r.brokerage_order_id,
      status: r.status,
      created_at: r.created_at,
    });
    byUser.set(r.user_id, list);
  }

  if (byUser.size === 0) {
    return NextResponse.json({
      users: 0,
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

  for (const [userId, orders] of byUser) {
    let broker: SnapTradeBroker;
    try {
      const creds = await resolveSnapTradeCredentials(userId);
      broker = new SnapTradeBroker({
        userId: creds.snaptradeUserId,
        userSecret: creds.snaptradeUserSecret,
        connectionId: creds.connectionId,
        brokerSlug: creds.brokerSlug,
        brokerName: formatBrokerName(creds.brokerSlug),
        // getOrders() works read-only regardless of tradingEnabled; passing
        // true here only affects place/cancel, which this cron never calls.
        tradingEnabled: true,
      });
    } catch (err) {
      errors++;
      console.warn(
        `[sync-orders] Skip user ${userId}: ${
          err instanceof SnapTradeAuthError
            ? 'no connected SnapTrade brokerage'
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
      if (!o.brokerage_order_id) {
        skipped++;
        continue;
      }

      const live = liveById.get(o.brokerage_order_id);
      if (!live) {
        // Broker no longer returns this order. Two cases:
        //  1. Recent + missing → transient lag (just placed, not yet visible).
        //     Skip and retry next run.
        //  2. Old + missing → dropped/expired/rejected at the broker. Auto-cancel
        //     so it can't linger as "open" forever (stale-state guard).
        const createdAt = new Date(o.created_at).getTime();
        const ageMs = Date.now() - createdAt;
        if (Number.isFinite(createdAt) && ageMs > STALE_AFTER_MS) {
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
            staleCancelled++;
            console.log(
              `[sync-orders] Stale-cancel: ${o.brokerage_order_id.slice(0, 8)} open ${Math.round(ageMs / 3600000)}h → cancelled`,
            );
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
      if (live.status === 'CANCELLED') {
        patch.cancelled_at = live.cancelledAt ?? now;
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
        transitions++;
        console.log(
          `[sync-orders] ${o.brokerage_order_id.slice(0, 8)}: ${o.status} → ${newStatus}`,
        );
      }
    }
  }

  return NextResponse.json({
    users: byUser.size,
    orders: rows?.length || 0,
    transitions,
    staleCancelled,
    skipped,
    errors,
  });
}
