// ─── P&L / cash-flow waterfall (chat chart resolver) ─────────────
// Builds an additive bridge from the account's real activity history:
//
//   [start] → contributions → realised gains → dividends/income → fees → withdrawals → [current value]
//
// HONESTY RULE (mirrors the tax-lot reconstruction this is built on):
// SnapTrade's activity feed does not always cover the account's full history.
// When the window does not reach the account's inception we DO NOT synthesise a
// starting balance — the start step carries `delta: null` and an explicit
// "unknown start" label (`unknownStartLabel`), and any realised-gain figure
// computed from an incomplete FIFO replay is flagged `partial`.
//
// Only real typed activity rows are used (BUY / SELL / DIVIDEND / FEE /
// WITHDRAWAL / contribution rows), every field read straight off the record.
// No row → no step. No history at all → the resolver returns null and the
// chart marker falls back to prose.

import { snapTradeFetch } from '@/lib/snaptrade/auth';
import {
  resolveSnapTradeCredentials,
  SnapTradeAuthError,
  SnapTradeAmbiguousError,
} from '@/lib/snaptrade/client';
import {
  fetchActivitiesForAuthorization,
  activitiesWindow,
  type SnapTradeAccountRef,
  type AccountActivitiesResult,
} from '@/lib/snaptrade/activities';
import { unknownStartLabel, type ActivityRecord } from '@/lib/tax-harvest/lot-reconstruction';

export interface WaterfallStep {
  label: string;
  /** `null` only for an unknown start step — never a guessed number. */
  delta: number | null;
  kind: 'start' | 'contrib' | 'gain' | 'income' | 'fee' | 'withdraw' | 'end';
  /** True when the figure only covers the part of history on file. */
  partial?: boolean;
}

export interface PnlWaterfallResult {
  steps: WaterfallStep[];
  /** True when the activity window does not reach account inception. */
  unknownStart: boolean;
  /** Earliest / latest activity date on file (ISO), when known. */
  windowStart: string | null;
  windowEnd: string | null;
  /** Human-readable disclosure shown under the chart. */
  note: string;
}

const CONTRIBUTION_RE = /CONTRIBUTION|DEPOSIT|TRANSFER_IN/;
const WITHDRAWAL_RE = /WITHDRAWAL|TRANSFER_OUT/;
const INCOME_RE = /DIVIDEND|INTEREST|COUPON/;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function recordDate(rec: ActivityRecord): number {
  const t = new Date(rec.trade_date).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Cash value of a row: the reported `amount` when present, else units×price. */
function recordAmount(rec: ActivityRecord): number {
  if (typeof rec.amount === 'number' && Number.isFinite(rec.amount)) return Math.abs(rec.amount);
  return Math.abs((rec.units || 0) * (rec.price || 0));
}

/**
 * Realised gains from a FIFO replay of the on-file BUY/SELL rows.
 * `partial` is true when a sell could not be fully matched against buys on file
 * (unknown-start territory) — only the matched portion is counted.
 */
function realisedGains(records: ActivityRecord[]): { total: number; partial: boolean } {
  const sorted = [...records].sort((a, b) => recordDate(a) - recordDate(b));
  const queues = new Map<string, Array<{ qty: number; price: number }>>();
  let total = 0;
  let partial = false;

  for (const rec of sorted) {
    const type = (rec.type || '').toUpperCase();
    const ticker = (rec.symbol || '').toUpperCase();
    if (!ticker) continue;
    if (type === 'BUY') {
      const list = queues.get(ticker) || [];
      list.push({ qty: rec.units || 0, price: rec.price || 0 });
      queues.set(ticker, list);
      continue;
    }
    if (type !== 'SELL') continue;

    let remaining = rec.units || 0;
    let cost = 0;
    const list = queues.get(ticker) || [];
    while (remaining > 0 && list.length > 0) {
      const lot = list[0];
      const take = Math.min(lot.qty, remaining);
      cost += take * lot.price;
      lot.qty -= take;
      remaining -= take;
      if (lot.qty <= 1e-9) list.shift();
    }
    const proceeds = (rec.units || 0) * (rec.price || 0) - Math.abs(rec.fee || 0);
    if (remaining > 1e-9) {
      // Sold more than the on-file buys explain: count ONLY the matched part.
      partial = true;
      const matchedUnits = (rec.units || 0) - remaining;
      total += matchedUnits * (rec.price || 0) - cost;
    } else {
      total += proceeds - cost;
    }
  }

  return { total, partial };
}

/**
 * Pure builder — turns typed activity rows into the waterfall. Exported so the
 * shape + disclosure can be tested against a fixture without any network.
 * Returns null when there is no usable history (the marker then falls back to
 * prose).
 */
export function buildWaterfallFromRecords(
  records: ActivityRecord[],
  equity: number,
  window: { start: string | null; end: string | null },
): PnlWaterfallResult | null {
  if (!records || records.length === 0) return null;

  const unknownStart = true; // The feed is a window, never a guaranteed inception.

  let contributions = 0;
  let income = 0;
  let fees = 0;
  let withdrawals = 0;
  let incomeRecords = 0;

  for (const rec of records) {
    const type = (rec.type || '').toUpperCase();
    const amount = recordAmount(rec);
    const fee = Math.abs(rec.fee || 0);
    if (fee > 0) fees += fee;

    if (CONTRIBUTION_RE.test(type)) {
      contributions += typeof rec.amount === 'number' ? rec.amount : amount;
    } else if (WITHDRAWAL_RE.test(type)) {
      withdrawals += typeof rec.amount === 'number' ? Math.abs(rec.amount) : amount;
    } else if (INCOME_RE.test(type)) {
      income += amount;
      incomeRecords += 1;
    } else if (type === 'FEE' || type === 'TAX') {
      fees += amount;
    }
  }

  const gains = realisedGains(
    records.filter((r) => !INCOME_RE.test((r.type || '').toUpperCase())),
  );

  const steps: WaterfallStep[] = [
    { label: unknownStartLabel(window.start), delta: null, kind: 'start' },
  ];
  if (contributions > 0) {
    steps.push({ label: 'Contributions', delta: round2(contributions), kind: 'contrib' });
  }
  if (gains.total !== 0) {
    steps.push({
      label: gains.partial ? 'Realised gains (on-file trades)' : 'Realised gains',
      delta: round2(gains.total),
      kind: 'gain',
      partial: gains.partial || undefined,
    });
  }
  if (income > 0) {
    steps.push({ label: 'Dividends & interest', delta: round2(income), kind: 'income' });
  }
  if (fees > 0) {
    steps.push({ label: 'Fees & taxes', delta: -round2(fees), kind: 'fee' });
  }
  if (withdrawals > 0) {
    steps.push({ label: 'Withdrawals', delta: -round2(withdrawals), kind: 'withdraw' });
  }
  steps.push({ label: 'Current value', delta: round2(equity), kind: 'end' });

  const notes: string[] = [];
  notes.push(
    `Activity history on file starts ${
      window.start ? new Date(window.start).toISOString().slice(0, 10) : '— so the starting balance is unknown'
    }; the true starting balance is not shown because it is not in the history.`,
  );
  if (gains.partial) {
    notes.push('Realised gains cover only sells that could be matched against buys on file.');
  }
  if (incomeRecords > 0) {
    notes.push(`${incomeRecords} income record${incomeRecords === 1 ? '' : 's'} included.`);
  }
  notes.push('Bars are not proportional to a starting capital figure — the first bar is the unknown start.');

  return {
    steps,
    unknownStart,
    windowStart: window.start,
    windowEnd: window.end,
    note: notes.join(' '),
  };
}

/**
 * Resolve the broker connection that owns `accountId`, from `broker_connections`.
 *
 * Returns the **`broker_connections.id`** — that is the id
 * `resolveSnapTradeCredentials()` matches on (`c.id === connectionId`). The
 * `snaptrade_connection_id` column is the SnapTrade-internal authorization id and
 * must NOT be passed back in: doing so throws SnapTradeAuthError and the
 * waterfall silently collapses to null.
 *
 * The app's account key is `snaptrade:<broker_connections.id>`, so the prefix is
 * stripped before matching. `accountId` may also be a SnapTrade account id (as
 * stored inside `snaptrade_accounts`) — both shapes are matched.
 */
async function resolveConnectionId(
  supabase: any,
  userId: string,
  accountId: string,
): Promise<string | null> {
  if (!supabase) return null;
  try {
    const target = String(accountId || '').replace(/^[a-z_]+:/i, '');
    const { data } = await supabase
      .from('broker_connections')
      .select('id, snaptrade_connection_id, snaptrade_accounts')
      .eq('user_id', userId);
    const rows = ((data || []) as any[]).filter((r) => !!r?.snaptrade_connection_id);
    if (rows.length === 0) return null;
    const match = rows.find((r) => {
      if (String(r.id) === target) return true;
      const accts = Array.isArray(r.snaptrade_accounts) ? r.snaptrade_accounts : [];
      return accts.some((a: any) => String(a?.id ?? a?.account_id ?? '') === target);
    });
    const chosen = match || rows[0];
    return chosen?.id ? String(chosen.id) : null;
  } catch {
    return null;
  }
}

/**
 * Build the waterfall for `accountId`. `opts` carries the identifiers + equity
 * the chat route already holds; when `connectionId` is absent the connection is
 * looked up for the user. Returns null when there is no usable activity history
 * (no broker connection / demo account / empty feed / SnapTrade not configured)
 * — the caller strips the marker and lets the prose stand.
 */
export async function buildPnlWaterfall(
  accountId: string,
  opts: {
    userId?: string | null;
    connectionId?: string | null;
    equity?: number;
    supabase?: any;
  } = {},
): Promise<PnlWaterfallResult | null> {
  const userId = opts.userId || null;
  if (!userId) return null;
  if (!process.env.SNAPTRADE_CLIENT_ID) return null;

  let connectionId = opts.connectionId || null;
  if (!connectionId) connectionId = await resolveConnectionId(opts.supabase, userId, accountId);
  if (!connectionId) return null;

  let activityResults: AccountActivitiesResult[] = [];
  try {
    const creds = await resolveSnapTradeCredentials(userId, connectionId);
    const ep = { userId: creds.snaptradeUserId, userSecret: creds.snaptradeUserSecret };
    const authorizationId = creds.connectionId;

    const accountsRaw = await snapTradeFetch<unknown>(
      `/authorizations/${authorizationId}/accounts`,
      null,
      ep,
    );
    const accounts: SnapTradeAccountRef[] = (Array.isArray(accountsRaw) ? accountsRaw : [])
      .map((a: any) => ({ id: String(a?.id ?? ''), name: a?.name ?? null }))
      .filter((a) => a.id);
    if (accounts.length === 0) return null;

    activityResults = await fetchActivitiesForAuthorization(userId, authorizationId, ep, accounts);
  } catch (err) {
    if (err instanceof SnapTradeAuthError || err instanceof SnapTradeAmbiguousError) return null;
    console.error('[waterfall] activities fetch failed:', (err as any)?.message || err);
    return null;
  }

  const records = activityResults.flatMap((r) => r.records || []);
  const window = activitiesWindow(activityResults);
  return buildWaterfallFromRecords(records, opts.equity ?? 0, window);
}
