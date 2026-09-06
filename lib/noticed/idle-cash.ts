// lib/noticed/idle-cash.ts
//
// Idle-cash detection for the AI Noticed rules engine.
//
// Single source of truth for the dollar-based idle-cash trigger:
//   availableCash (settled cash − open reservations) > $500 for 3+ consecutive
//   trading days → "INVEST_CASH" proactive suggestion.
//
// Reuses the shared `availableCash` + `sumOpenReservedAmount` helpers (cash −
// open reservations) and the shared `deriveTradingCapability` /
// `isReadOnlyCapability` check — never reimplements either.

import { availableCash, sumOpenReservedAmount } from '@/lib/available-cash';
import { deriveTradingCapability, isReadOnlyCapability } from '@/lib/broker/trading-capability';
import { parseAccountScope, applyAccountScopeFilter } from '@/lib/account-scope';

export const IDLE_CASH_THRESHOLD = 500; // dollars of available cash
export const IDLE_CASH_MIN_DAYS = 3;     // consecutive trading days

const OPEN_DB_STATUSES = ['open', 'pending', 'submitted', 'partially_filled'];

// ── Date helpers (America/New_York = US market time) ──────────────────

function etDateKey(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Step back one calendar day, skipping weekends (trading-day aware). */
function previousTradingDay(d: Date): Date {
  const prev = new Date(d);
  prev.setUTCDate(prev.getUTCDate() - 1);
  while (prev.getUTCDay() === 0 || prev.getUTCDay() === 6) {
    prev.setUTCDate(prev.getUTCDate() - 1);
  }
  return prev;
}

// ── Open-order reservations ────────────────────────────────────────────

/** SUM(requested_amount WHERE open) via the shared `sumOpenReservedAmount`. */
export async function computeOpenReservedAmount(
  supabase: any,
  userId: string,
  accountId: string,
): Promise<number> {
  try {
    const scope = parseAccountScope(accountId);
    let query = supabase
      .from('orders')
      .select('status, side, requested_amount, requested_qty, order_unit, notional, qty, filled_price, filled_qty')
      .eq('user_id', userId)
      .in('status', OPEN_DB_STATUSES);
    if (scope) query = applyAccountScopeFilter(query, scope);
    const { data: openOrders } = await query;
    if (!openOrders || openOrders.length === 0) return 0;
    return sumOpenReservedAmount(
      (openOrders as any[]).map((o) => ({
        side: o.side,
        status: o.status,
        requestedAmount: o.requested_amount,
        requestedQty: o.requested_qty,
        orderUnit: o.order_unit,
        notional: o.notional,
        qty: o.qty,
        fillPrice: o.filled_price,
        limitPrice: null,
        filledQty: o.filled_qty,
        filledPrice: o.filled_price,
      })),
    );
  } catch (err: any) {
    console.warn('[idle-cash] open-order fetch failed:', err?.message || err);
    return 0;
  }
}

// ── Daily snapshot recording ───────────────────────────────────────────

/** Upsert today's available-cash snapshot (idempotent by user_id + account_id + date). */
export async function recordCashSnapshot(
  supabase: any,
  userId: string,
  accountId: string,
  availableCashAmount: number,
): Promise<void> {
  const date = etDateKey(new Date());
  try {
    await supabase.from('daily_cash_snapshots').upsert(
      {
        user_id: userId,
        account_id: accountId,
        date,
        available_cash: Math.max(0, Number(availableCashAmount) || 0),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,account_id,date' },
    );
  } catch (err: any) {
    console.warn('[idle-cash] snapshot write failed:', err?.message || err);
  }
}

// ── Consecutive trading-day streak ─────────────────────────────────────

/**
 * Count consecutive TRADING days (ending at the most recent snapshot) where
 * availableCash stayed above `threshold`. A missing snapshot or a below-
 * threshold day breaks the streak.
 */
export async function computeIdleCashStreak(
  supabase: any,
  userId: string,
  accountId: string,
  threshold: number = IDLE_CASH_THRESHOLD,
): Promise<number> {
  try {
    const { data } = await supabase
      .from('daily_cash_snapshots')
      .select('date, available_cash')
      .eq('user_id', userId)
      .eq('account_id', accountId)
      .order('date', { ascending: false })
      .limit(120);
    if (!data || data.length === 0) return 0;

    const byDate = new Map<string, number>(
      (data as any[]).map((r) => [r.date, Number(r.available_cash)]),
    );

    let cursor = new Date(`${data[0].date}T00:00:00Z`);
    let streak = 0;
    for (let i = 0; i < 120; i++) {
      const key = cursor.toISOString().slice(0, 10);
      const val = byDate.get(key);
      if (val === undefined) break; // missing trading day → streak broken
      if (val <= threshold) break;  // cash dropped → streak broken
      streak++;
      cursor = previousTradingDay(cursor);
    }
    return streak;
  } catch (err: any) {
    console.warn('[idle-cash] streak fetch failed:', err?.message || err);
    return 0;
  }
}

// ── Read-only detection ────────────────────────────────────────────────

/** Demo accounts are 'full'; a live broker is read-only iff trading disabled. */
export async function isReadOnlyAccount(
  supabase: any,
  userId: string,
  accountId: string,
): Promise<boolean> {
  try {
    const scope = parseAccountScope(accountId);
    if (scope?.isDemo) return false;

    const { data: conn } = await supabase
      .from('broker_connections')
      .select('trading_enabled')
      .eq('user_id', userId)
      .eq('id', scope?.connectionId ?? '')
      .maybeSingle();
    const tradingEnabled = conn?.trading_enabled !== false; // default true
    return isReadOnlyCapability(
      deriveTradingCapability({ isDemo: false, tradingEnabled }),
    );
  } catch (err: any) {
    console.warn('[idle-cash] capability fetch failed:', err?.message || err);
    return false;
  }
}

// ── Combined resolver (used by the pipeline) ───────────────────────────

export interface IdleCashResolution {
  availableCash: number;
  idleCashStreak: number;
  isReadOnly: boolean;
}

/** Compute available cash, record today's snapshot, and derive the streak. */
export async function resolveIdleCash(
  supabase: any,
  userId: string,
  accountId: string,
  settledCash: number,
): Promise<IdleCashResolution> {
  const reserved = await computeOpenReservedAmount(supabase, userId, accountId);
  const avail = availableCash({ cash: settledCash }, reserved);
  await recordCashSnapshot(supabase, userId, accountId, avail);
  const streak = await computeIdleCashStreak(supabase, userId, accountId);
  const readOnly = await isReadOnlyAccount(supabase, userId, accountId);
  return { availableCash: avail, idleCashStreak: streak, isReadOnly: readOnly };
}
