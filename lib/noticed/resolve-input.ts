import { parseAccountScope, applyAccountScopeFilter } from '@/lib/account-scope';
import type { NoticedRuleInput, PortfolioPosition } from './engine';

/**
 * Normalise a raw position row (broker `positions` table snake_case OR demo
 * `demo_portfolio_state` camelCase JSON) into the engine's PortfolioPosition.
 */
export function toPortfolioPosition(p: any): PortfolioPosition {
  const qty = Number(p.qty ?? p.shares ?? 0);
  const marketValue = Number(p.marketValue ?? p.market_value ?? 0);
  const avgCost = Number(p.avgCost ?? p.avg_cost ?? 0);
  const costBasis = qty * avgCost;

  let totalPnl = Number(p.totalPnl ?? p.unrealized_pnl ?? 0);
  let totalPnlPercent = Number(p.totalPnlPercent ?? p.unrealized_pnl_pct ?? 0);
  // Broker rows often leave unrealized_pnl null (they carry live `market_value`
  // + per-share `avg_cost` only) — derive P&L so milestone triggers still fire.
  const hasStoredPnl = p.totalPnl != null || p.unrealized_pnl != null ||
    p.totalPnlPercent != null || p.unrealized_pnl_pct != null;
  if (!hasStoredPnl && marketValue > 0 && costBasis > 0) {
    totalPnl = marketValue - costBasis;
    totalPnlPercent = (totalPnl / costBasis) * 100;
  }

  return {
    symbol: p.symbol,
    qty,
    marketValue,
    avgCost,
    totalPnl,
    totalPnlPercent,
    sector: p.sector || undefined,
  };
}

/**
 * Resolve the NoticedRuleInput for a BROKER account server-side from the
 * canonical `positions` table + broker cash.
 *
 * This is the authority for live/paper broker accounts: the client must NOT be
 * able to write demo (or another account's) positions under a broker account id
 * — that was the cross-account bleed. Demo accounts are intentionally NOT
 * handled here (demo positions live in `demo_portfolio_state` with cost-basis
 * pricing, so the client remains the source of live-priced demo positions).
 *
 * Returns null when the scope is not a broker account or the account has no
 * positions (caller should then return an empty/quiet result).
 */
export async function resolveBrokerNoticedInput(
  supabase: any,
  userId: string,
  accountId: string,
  watchlistSymbols: string[] = [],
): Promise<NoticedRuleInput | null> {
  const scope = parseAccountScope(accountId);
  if (!scope || scope.isDemo || !scope.connectionId) return null;

  let positionsQuery = supabase
    .from('positions')
    .select('*')
    .eq('user_id', userId)
    .neq('qty', 0);
  positionsQuery = applyAccountScopeFilter(positionsQuery, scope);
  const { data: positions } = await positionsQuery;
  if (!positions || positions.length === 0) return null;

  const mapped = (positions as any[]).map(toPortfolioPosition);

  let equity = 0;
  let totalPnl = 0;
  for (const p of mapped) {
    equity += p.marketValue;
    totalPnl += p.totalPnl;
  }

  // Broker cash from the connection's snap accounts (sum across sub-accounts).
  let cash = 0;
  try {
    const { data: conn } = await supabase
      .from('broker_connections')
      .select('snaptrade_accounts')
      .eq('user_id', userId)
      .eq('id', scope.connectionId)
      .maybeSingle();
    const snapAccounts = (conn?.snaptrade_accounts as any[]) || [];
    cash = snapAccounts.reduce((sum: number, a: any) => sum + (Number(a?.cash) || 0), 0);
  } catch { /* ignore */ }

  if (cash === 0 && equity > 0) cash = Math.round(equity * 0.25);

  let dayPnl = 0;
  try {
    const { data: ps } = await supabase
      .from('users')
      .select('day_pnl')
      .eq('id', userId)
      .single();
    if (ps?.day_pnl) dayPnl = Number(ps.day_pnl);
  } catch { /* ignore */ }

  const totalValue = equity + cash;
  const totalPnlPct = totalValue > 0 ? (totalPnl / (totalValue - totalPnl)) * 100 : 0;
  const dayPnlPct = totalValue > 0 ? (dayPnl / totalValue) * 100 : 0;

  // Days since last trade, scoped to this account (orders.filled_at).
  let daysSinceLastTrade = 999;
  try {
    let lastTradeQuery = supabase.from('orders').select('filled_at').eq('user_id', userId);
    lastTradeQuery = applyAccountScopeFilter(lastTradeQuery, scope);
    const { data: lastTrade } = await lastTradeQuery
      .order('filled_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastTrade?.filled_at) {
      daysSinceLastTrade = Math.floor((Date.now() - new Date(lastTrade.filled_at).getTime()) / 86400000);
    }
  } catch { /* ignore */ }

  return {
    account: {
      cash,
      equity,
      totalPnl,
      totalPnlPercent: Math.round(totalPnlPct * 10) / 10,
      dayPnl,
      dayPnlPercent: Math.round(dayPnlPct * 10) / 10,
    },
    positions: mapped,
    watchlistSymbols,
    daysSinceLastTrade,
  };
}
