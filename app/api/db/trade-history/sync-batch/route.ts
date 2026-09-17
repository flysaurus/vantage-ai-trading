/**
 * POST /api/db/trade-history/sync-batch — persist a whole batch of filled
 * broker orders in ONE request.
 *
 * Why this exists: the client used to POST each filled order to
 * /api/db/trade-history/create one at a time. Because the dedup set is
 * session-scoped, a fresh page load re-POSTed the entire filled book — measured
 * on prod: **35–36 sequential POSTs** on a single portfolio load, ~20s of
 * churn, each one a round trip plus a per-order account lookup. The server
 * no-oped them all (verified: zero new rows), so it was pure waste.
 *
 * Semantics are IDENTICAL to the single-order route on purpose:
 *   - same validation (userId must match the caller, symbol/action/quantity/price)
 *   - same match rule — `tradeMatchKey` = user + symbol + action + quantity +
 *     price, i.e. no execution timestamp (see the helper's note; the two paths
 *     must not disagree or the table grows duplicates again)
 *   - same account stamping from the same active-account context
 * The only difference is that the work is batched: one read of existing rows,
 * one account resolve, one insert.
 *
 * ⚠️ WRITE-CAPABLE: inserts into `trade_history` (and reads it for dedupe).
 * Account stamping stays behind `BROKER_ACCOUNT_ID_WRITES` (returns null when
 * off). Flagged in TOOLS.md.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';
import {
  TRADE_HISTORY_SELECT,
  toTradeRecord,
  toTradeInsert,
  planTradeHistoryBatch,
} from '@/lib/db/trade-history';
import { resolveBrokerAccountIdForWrite } from '@/lib/broker/account-id';

/** Cap per request — the client sends one broker's filled book, not a backfill. */
const MAX_ORDERS = 500;
/** Guard on the dedupe read (a user's rows for the symbols in this batch). */
const MAX_EXISTING_ROWS = 10_000;

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { authUser, authError } = await requireAuth();
    if (authError) return authError;
    const authUserId = authUser!.id;

    const supabase = createServerClient();
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Missing request body' }, { status: 400 });

    const { userId, connectionId, snapAccountId, isDemo, orders } = body as Record<string, any>;
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });
    if (!Array.isArray(orders)) return NextResponse.json({ error: 'orders array required' }, { status: 400 });
    if (userId !== authUserId) return NextResponse.json({ error: 'Cannot create trades for other users' }, { status: 403 });

    // An empty batch is a valid no-op (the caller may have nothing new to send).
    if (orders.length === 0) {
      return NextResponse.json({ inserted: 0, existing: 0, invalid: 0, duplicatesInBatch: 0, truncated: 0, trades: [] });
    }

    const truncated = Math.max(0, orders.length - MAX_ORDERS);
    if (truncated > 0) {
      console.warn(`[trade-history/sync-batch] ${orders.length} orders sent, processing ${MAX_ORDERS} (${truncated} truncated)`);
    }
    const batch = orders.slice(0, MAX_ORDERS) as any[];

    const symbols = Array.from(
      new Set(batch.map((o) => String(o?.symbol ?? '').trim().toUpperCase()).filter(Boolean)),
    );

    // One read of what the table already holds for these symbols. Only the
    // match-key columns are needed; the narrow select keeps the response small.
    let existingRows: any[] = [];
    if (symbols.length > 0) {
      const { data, error } = await (supabase as any)
        .from('trade_history')
        .select('symbol, action, quantity, price')
        .eq('user_id', userId)
        .in('symbol', symbols)
        .limit(MAX_EXISTING_ROWS);
      if (error) {
        console.error('[trade-history/sync-batch] dedupe read failed:', error.message);
        return NextResponse.json({ error: 'Failed to read existing trades', detail: error.message }, { status: 500 });
      }
      existingRows = data ?? [];
      if (existingRows.length >= MAX_EXISTING_ROWS) {
        // Unreachable today (the table holds ~4k rows for the whole user); if it
        // ever happens, say so rather than silently mis-deduping.
        console.warn(`[trade-history/sync-batch] dedupe read hit the ${MAX_EXISTING_ROWS}-row guard`);
      }
    }

    const plan = planTradeHistoryBatch(existingRows, batch);
    if (plan.invalid > 0) console.warn(`[trade-history/sync-batch] skipped ${plan.invalid} invalid order(s)`);

    if (plan.missing.length === 0) {
      return NextResponse.json({
        inserted: 0,
        existing: plan.existing,
        invalid: plan.invalid,
        duplicatesInBatch: plan.duplicatesInBatch,
        truncated,
        trades: [],
      });
    }

    // Same active-account context the read path uses — resolved ONCE for the
    // batch instead of once per order. Inert when the write flag is off.
    const accountId = await resolveBrokerAccountIdForWrite(supabase, {
      userId,
      connectionId: connectionId || null,
      snapAccountId: typeof snapAccountId === 'string' ? snapAccountId : null,
    });

    const rows = plan.missing.map((o) =>
      toTradeInsert(
        { symbol: o.symbol, action: o.action, quantity: o.quantity, price: o.price, executedAt: o.executedAt },
        { userId, connectionId: connectionId || null, isDemo, accountId },
      ),
    );

    const { data, error } = await (supabase as any)
      .from('trade_history')
      .insert(rows)
      .select(TRADE_HISTORY_SELECT);

    if (error) {
      console.error('[trade-history/sync-batch] insert failed:', error.message);
      return NextResponse.json({ error: 'Failed to create trades', detail: error.message }, { status: 500 });
    }

    const inserted = (data ?? []).map((r: any) => toTradeRecord(r));
    console.log(
      `[trade-history/sync-batch] inserted ${inserted.length}, existing ${plan.existing}, invalid ${plan.invalid}, duplicate-in-batch ${plan.duplicatesInBatch}`,
    );

    return NextResponse.json({
      inserted: inserted.length,
      existing: plan.existing,
      invalid: plan.invalid,
      duplicatesInBatch: plan.duplicatesInBatch,
      truncated,
      trades: inserted,
    });
  } catch (err: any) {
    if (err?.name === 'AuthError') return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    console.error('[trade-history/sync-batch] Error:', err?.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
