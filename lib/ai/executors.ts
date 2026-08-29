// ─── Pending-Action Executors (direct, deterministic, never LLM) ────────────
// Runs the REAL side effect for a confirmed pending action. Called ONLY from
// the deterministic confirm step in app/api/chat/route.ts after the user has
// explicitly confirmed the preview.
//
// Execution replicates the exact logic of the corresponding API endpoints
// (watchlist add/remove, alert create/update/delete, DCA create/update/delete)
// but runs directly against the DB with the service-role client + the already-
// authenticated userId (no internal HTTP fetch / cookie forwarding needed).
//
// Safety: these functions are idempotent-guarded upstream (the pending-action
// row transitions pending→executed via a conditional UPDATE), and each write is
// scoped to userId with an ownership check. They re-validate inputs as a
// second-line safety net.
// ─────────────────────────────────────────────────────────────────────────────

import { calculateNextRun } from '@/lib/scheduler';
import { placeSingleTrade, placeBasketTrade } from '@/lib/ai/order-service';
import type { PendingAction } from '@/lib/ai/pending-actions';

export interface ExecResult {
  ok: boolean;
  message: string;
}

const VALID_FREQUENCIES = ['daily', 'weekly', 'biweekly', 'monthly'];
const VALID_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
const VALID_DATES = ['1', '15', 'last'];

// ── Watchlist helpers ────────────────────────────────────────────────────────

async function resolveWatchlist(
  supabase: any,
  userId: string,
  watchlistId?: string | null,
): Promise<{ id: string } | { error: string }> {
  if (watchlistId) {
    const { data } = await (supabase as any)
      .from('watchlists')
      .select('id, user_id')
      .eq('id', watchlistId)
      .maybeSingle();
    if (!data) return { error: 'Watchlist not found' };
    if (data.user_id !== userId) return { error: 'Cannot modify other users watchlists' };
    return { id: data.id };
  }
  // No id given → prefer the default watchlist, else the most-recent one.
  const { data: dflt } = await (supabase as any)
    .from('watchlists')
    .select('id')
    .eq('user_id', userId)
    .eq('is_default', true)
    .limit(1)
    .maybeSingle();
  if (dflt) return { id: dflt.id };
  const { data: first } = await (supabase as any)
    .from('watchlists')
    .select('id')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (first) return { id: first.id };
  return { error: 'No watchlist found — create one first' };
}

async function execWatchlistAdd(
  supabase: any,
  userId: string,
  payload: Record<string, unknown>,
): Promise<ExecResult> {
  const symbol = (payload.symbol as string || '').trim().toUpperCase();
  if (!symbol) return { ok: false, message: 'Missing symbol.' };
  const wl = await resolveWatchlist(supabase, userId, payload.watchlistId as string | undefined);
  if ('error' in wl) return { ok: false, message: wl.error };

  const { data: existing } = await (supabase as any)
    .from('watchlists').select('stocks').eq('id', wl.id).maybeSingle();
  const stocks: any[] = existing?.stocks || [];
  if (stocks.some((s) => s?.symbol?.toUpperCase() === symbol)) {
    return { ok: false, message: `${symbol} is already in this watchlist.` };
  }
  const updated = [...stocks, { symbol, addedAt: new Date().toISOString() }];
  const { error } = await (supabase as any)
    .from('watchlists')
    .update({ stocks: updated, updated_at: new Date().toISOString() })
    .eq('id', wl.id);
  if (error) return { ok: false, message: `Failed to add ${symbol}: ${error.message}` };
  return { ok: true, message: `✅ Added ${symbol} to your watchlist.` };
}

async function execWatchlistRemove(
  supabase: any,
  userId: string,
  payload: Record<string, unknown>,
): Promise<ExecResult> {
  const symbol = (payload.symbol as string || '').trim().toUpperCase();
  if (!symbol) return { ok: false, message: 'Missing symbol.' };
  const wl = await resolveWatchlist(supabase, userId, payload.watchlistId as string | undefined);
  if ('error' in wl) return { ok: false, message: wl.error };

  const { data: existing } = await (supabase as any)
    .from('watchlists').select('stocks').eq('id', wl.id).maybeSingle();
  const stocks: any[] = existing?.stocks || [];
  const updated = stocks.filter((s) => s?.symbol?.toUpperCase() !== symbol);
  const { error } = await (supabase as any)
    .from('watchlists')
    .update({ stocks: updated, updated_at: new Date().toISOString() })
    .eq('id', wl.id);
  if (error) return { ok: false, message: `Failed to remove ${symbol}: ${error.message}` };
  return { ok: true, message: `✅ Removed ${symbol} from your watchlist.` };
}

// ── Alert helpers ────────────────────────────────────────────────────────────

async function execAlertCreate(
  supabase: any,
  userId: string,
  payload: Record<string, unknown>,
): Promise<ExecResult> {
  const symbol = (payload.symbol as string || '').trim().toUpperCase();
  const alertType = payload.alertType as string;
  const targetValue = Number(payload.targetValue);
  const channels = (payload.notificationChannels as string[]) || ['in_app'];
  if (!symbol) return { ok: false, message: 'Missing symbol.' };
  if (!['price_above', 'price_below', 'percent_change'].includes(alertType)) {
    return { ok: false, message: `Invalid alert type: ${alertType}` };
  }
  if (!targetValue || targetValue <= 0) return { ok: false, message: 'Target value must be positive.' };

  const { error } = await (supabase as any).from('alerts').insert({
    user_id: userId,
    symbol,
    type: alertType,
    threshold: targetValue,
    is_active: true,
    notification_channels: channels,
  });
  if (error) return { ok: false, message: `Failed to create alert: ${error.message}` };
  return { ok: true, message: `✅ Alert created for ${symbol} (${alertType.replace(/_/g, ' ')} at ${targetValue}).` };
}

async function execAlertUpdate(
  supabase: any,
  userId: string,
  payload: Record<string, unknown>,
): Promise<ExecResult> {
  const alertId = payload.alertId as string;
  if (!alertId) return { ok: false, message: 'Missing alert id.' };
  const { data: existing } = await (supabase as any)
    .from('alerts').select('id, user_id').eq('id', alertId).maybeSingle();
  if (!existing) return { ok: false, message: 'Alert not found.' };
  if (existing.user_id !== userId) return { ok: false, message: 'Cannot update other users alerts.' };

  const updates: Record<string, unknown> = {};
  if (payload.isActive !== undefined) updates.is_active = !!payload.isActive;
  if (payload.targetValue !== undefined) {
    const tv = Number(payload.targetValue);
    if (tv <= 0) return { ok: false, message: 'Target value must be positive.' };
    updates.threshold = tv;
  }
  const { error } = await (supabase as any)
    .from('alerts').update(updates).eq('id', alertId);
  if (error) return { ok: false, message: `Failed to update alert: ${error.message}` };
  return { ok: true, message: '✅ Alert updated.' };
}

async function execAlertDelete(
  supabase: any,
  userId: string,
  payload: Record<string, unknown>,
): Promise<ExecResult> {
  const alertId = payload.alertId as string;
  if (!alertId) return { ok: false, message: 'Missing alert id.' };
  const { data: existing } = await (supabase as any)
    .from('alerts').select('id, user_id').eq('id', alertId).maybeSingle();
  if (!existing) return { ok: false, message: 'Alert not found.' };
  if (existing.user_id !== userId) return { ok: false, message: 'Cannot delete other users alerts.' };
  const { error } = await (supabase as any).from('alerts').delete().eq('id', alertId);
  if (error) return { ok: false, message: `Failed to delete alert: ${error.message}` };
  return { ok: true, message: '✅ Alert deleted.' };
}

// ── DCA helpers ──────────────────────────────────────────────────────────────

async function execDcaCreate(
  supabase: any,
  userId: string,
  payload: Record<string, unknown>,
): Promise<ExecResult> {
  const symbol = (payload.symbol as string || '').trim().toUpperCase();
  const amount = Number(payload.amount);
  const frequency = payload.frequency as string;
  const startDate = payload.startDate as string;
  if (!symbol) return { ok: false, message: 'Missing symbol.' };
  if (!amount || amount < 1) return { ok: false, message: 'Amount must be at least $1.' };
  if (!VALID_FREQUENCIES.includes(frequency)) return { ok: false, message: 'Invalid frequency.' };
  if (!startDate || isNaN(Date.parse(startDate))) return { ok: false, message: 'Valid start date required.' };

  const config: Record<string, any> = { amount, frequency, startDate, investBy: payload.investBy || 'amount' };
  if (payload.investBy === 'shares' && payload.quantity) config.quantity = Number(payload.quantity);
  if (payload.dayOfWeek && VALID_DAYS.includes(payload.dayOfWeek as string)) config.dayOfWeek = payload.dayOfWeek;
  if (payload.dayOfMonth && VALID_DATES.includes(payload.dayOfMonth as string)) config.dayOfMonth = payload.dayOfMonth;
  if (payload.endDate) config.endDate = payload.endDate;

  const { error } = await (supabase as any).from('strategies').insert({
    user_id: userId,
    type: 'dca',
    symbol,
    config,
    is_active: true,
    next_run_at: calculateNextRun(config as any).toISOString(),
  });
  if (error) return { ok: false, message: `Failed to create DCA: ${error.message}` };
  return { ok: true, message: `✅ DCA schedule created — ${symbol}, $${amount} ${frequency}.` };
}

async function execDcaUpdate(
  supabase: any,
  userId: string,
  payload: Record<string, unknown>,
): Promise<ExecResult> {
  const scheduleId = payload.scheduleId as string;
  if (!scheduleId) return { ok: false, message: 'Missing schedule id.' };
  const { data: existing } = await (supabase as any)
    .from('strategies').select('id, user_id, symbol, config').eq('id', scheduleId).eq('type', 'dca').maybeSingle();
  if (!existing) return { ok: false, message: 'Schedule not found.' };
  if (existing.user_id !== userId) return { ok: false, message: 'Cannot update other users schedules.' };

  // Partial merge: apply only the fields the user changed; carry over the rest
  // from the existing schedule. symbol is a top-level column, not in config.
  const oldConfig: Record<string, any> = existing.config || {};
  const symbol = payload.symbol !== undefined
    ? (payload.symbol as string).trim().toUpperCase()
    : (existing.symbol as string);

  const config: Record<string, any> = {
    amount: payload.amount !== undefined ? Number(payload.amount) : oldConfig.amount,
    frequency: payload.frequency !== undefined ? payload.frequency : oldConfig.frequency,
    startDate: payload.startDate !== undefined ? payload.startDate : oldConfig.startDate,
    investBy: payload.investBy !== undefined ? payload.investBy : (oldConfig.investBy || 'amount'),
  };
  const carry = (k: string, v: unknown, fromOld: unknown) => {
    if (v !== undefined) config[k] = k === 'quantity' ? Number(v) : v;
    else if (fromOld !== undefined) config[k] = fromOld;
  };
  carry('quantity', payload.quantity, oldConfig.quantity);
  carry('dayOfWeek', payload.dayOfWeek, oldConfig.dayOfWeek);
  carry('dayOfMonth', payload.dayOfMonth, oldConfig.dayOfMonth);
  carry('endDate', payload.endDate, oldConfig.endDate);

  if (!symbol) return { ok: false, message: 'Missing symbol.' };
  if (!config.amount || Number(config.amount) < 1) return { ok: false, message: 'Amount must be at least $1.' };
  if (!VALID_FREQUENCIES.includes(config.frequency)) return { ok: false, message: 'Invalid frequency.' };
  if (!config.startDate || isNaN(Date.parse(config.startDate))) return { ok: false, message: 'Valid start date required.' };

  const { error } = await (supabase as any)
    .from('strategies')
    .update({ symbol, config })
    .eq('id', scheduleId);
  if (error) return { ok: false, message: `Failed to update DCA: ${error.message}` };
  return { ok: true, message: '✅ DCA schedule updated.' };
}

async function execDcaDelete(
  supabase: any,
  userId: string,
  payload: Record<string, unknown>,
): Promise<ExecResult> {
  const scheduleId = payload.scheduleId as string;
  if (!scheduleId) return { ok: false, message: 'Missing schedule id.' };
  const { data: existing } = await (supabase as any)
    .from('strategies').select('id, user_id').eq('id', scheduleId).eq('type', 'dca').maybeSingle();
  if (!existing) return { ok: false, message: 'Schedule not found.' };
  if (existing.user_id !== userId) return { ok: false, message: 'Cannot cancel other users schedules.' };
  const { error } = await (supabase as any)
    .from('strategies').update({ is_active: false }).eq('id', scheduleId);
  if (error) return { ok: false, message: `Failed to cancel DCA: ${error.message}` };
  return { ok: true, message: '✅ DCA schedule cancelled.' };
}

// ── Real-order helpers (Tranche 2) ──────────────────────────────────────────

async function execBuyStock(
  supabase: any,
  userId: string,
  payload: Record<string, unknown>,
): Promise<ExecResult> {
  return placeSingleTrade({
    supabase,
    userId,
    symbol: (payload.symbol as string) || '',
    side: 'BUY',
    shares: payload.shares != null ? Number(payload.shares) : null,
    dollarAmount: payload.dollarAmount != null ? Number(payload.dollarAmount) : null,
    orderType: (payload.orderType as any) || 'market',
    limitPrice: payload.limitPrice != null ? Number(payload.limitPrice) : null,
  });
}

async function execSellStock(
  supabase: any,
  userId: string,
  payload: Record<string, unknown>,
): Promise<ExecResult> {
  return placeSingleTrade({
    supabase,
    userId,
    symbol: (payload.symbol as string) || '',
    side: 'SELL',
    shares: payload.shares != null ? Number(payload.shares) : null,
    dollarAmount: payload.dollarAmount != null ? Number(payload.dollarAmount) : null,
    orderType: (payload.orderType as any) || 'market',
    limitPrice: payload.limitPrice != null ? Number(payload.limitPrice) : null,
  });
}

async function execBasketExecute(
  supabase: any,
  userId: string,
  payload: Record<string, unknown>,
): Promise<ExecResult> {
  const stocks = (payload.stocks as any[]) || [];
  return placeBasketTrade({
    supabase,
    userId,
    basketName: (payload.basketName as string) || 'Basket',
    stocks: stocks.map((s: any) => ({
      symbol: String(s?.symbol || '').toUpperCase(),
      dollarAmount: Number(s?.dollarAmount) || 0,
    })),
  });
}

// ── Rebalance execution (Phase 4 — real multi-leg orders) ───────────────────
// Fires every stored leg as a real notional (dollar-amount) market order.
// Sells run first (to free cash/buying power), then buys. Each leg goes through
// placeSingleTrade → trade-gate + idempotency + broker + persist + notify, so a
// single leg's rejection never aborts the rest.
async function execRebalance(
  supabase: any,
  userId: string,
  payload: Record<string, unknown>,
): Promise<ExecResult> {
  const legs = Array.isArray(payload.legs) ? (payload.legs as any[]) : [];
  if (legs.length === 0) return { ok: false, message: 'No rebalance trades were stored.' };

  // Sells first (free up cash / buying power), then buys.
  const ordered = [...legs].sort((a, b) => {
    const rank = (s: any) => (s?.side === 'SELL' ? 0 : 1);
    return rank(a) - rank(b);
  });

  const out: string[] = [];
  let placed = 0;
  let failed = 0;
  for (const leg of ordered) {
    const symbol = String(leg?.symbol || '').toUpperCase();
    const side = leg?.side === 'SELL' ? 'SELL' : 'BUY';
    const dollarAmount = Number(leg?.dollarAmount) || 0;
    const sellShares = side === 'SELL' ? Number(leg?.shares) || 0 : 0;
    const hasQty = sellShares > 0;
    const hasAmount = dollarAmount >= 1;
    if (!symbol || (!hasQty && !hasAmount)) {
      failed++;
      out.push(`❌ Skipped an invalid leg (${symbol || 'missing symbol'}).`);
      continue;
    }
    const r = await placeSingleTrade({
      supabase,
      userId,
      symbol,
      side,
      // Sells liquidate the EXACT held quantity — a notional (dollar) sell gets
      // converted back to fractional shares by the broker, which can round to
      // slightly MORE than held → "insufficient qty available for order".
      shares: hasQty ? sellShares : null,
      dollarAmount: hasQty ? null : dollarAmount,
      orderType: 'market',
      // Rebalance legs are deterministic (style targets + broker positions),
      // not LLM-proposed — safe to skip the Finnhub symbol gate so real held
      // ETFs the broker recognizes (CPER, etc.) sell without being blocked.
      skipSymbolGate: true,
    });
    if (r.ok) {
      placed++;
      // r.message already carries its own leading ✅ (from placeSingleTrade) —
      // do NOT prefix again or the chat shows a doubled "✅ ✅ Bought X".
      out.push(r.message);
    } else {
      failed++;
      out.push(`❌ ${side === 'BUY' ? 'Buy' : 'Sell'} ${symbol} $${dollarAmount.toFixed(2)} — ${r.message}`);
    }
  }

  const head = `Rebalance executed: ${placed} of ${legs.length} trades placed${failed ? ` (${failed} failed)` : ''}.`;
  // Join with DOUBLE newlines — ReactMarkdown collapses single `\n` into one
  // paragraph (soft line break), which jammed every leg onto a single line.
  return { ok: placed > 0, message: [head, ...out].join('\n\n') };
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

export async function executePendingAction(
  supabase: any,
  action: PendingAction,
): Promise<ExecResult> {
  const userId = action.userId;
  const payload = action.payload || {};
  try {
    switch (action.actionType) {
      case 'watchlist_add': return execWatchlistAdd(supabase, userId, payload);
      case 'watchlist_remove': return execWatchlistRemove(supabase, userId, payload);
      case 'alert_create': return execAlertCreate(supabase, userId, payload);
      case 'alert_update': return execAlertUpdate(supabase, userId, payload);
      case 'alert_delete': return execAlertDelete(supabase, userId, payload);
      case 'dca_create': return execDcaCreate(supabase, userId, payload);
      case 'dca_update': return execDcaUpdate(supabase, userId, payload);
      case 'dca_delete': return execDcaDelete(supabase, userId, payload);
      case 'buy_stock': return execBuyStock(supabase, userId, payload);
      case 'sell_stock': return execSellStock(supabase, userId, payload);
      case 'basket_execute': return execBasketExecute(supabase, userId, payload);
      case 'rebalance_execute': return execRebalance(supabase, userId, payload);
      default:
        return { ok: false, message: `Unknown action type: ${action.actionType}` };
    }
  } catch (e: any) {
    console.error('[executors] executePendingAction threw:', e);
    return { ok: false, message: `Execution failed: ${e?.message || 'unknown error'}` };
  }
}
