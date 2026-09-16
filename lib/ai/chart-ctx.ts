// ─── Chart context (server) ──────────────────────────────────────
// Assembles the ChartCtx the chart registry resolves against, from the SAME
// portfolio payload the chat route already receives. No extra provider work is
// done here beyond resolving which broker connection to read for the waterfall.
//
// `holdingsUnavailable` mirrors the canonical portfolio contract: when the
// client sends no portfolio at all, every derived chart key resolves to null
// (the marker is stripped and the prose stands) rather than charting zeros.

import type { PortfolioSnapshot } from './account-actions';
import type { ChartCtx, ChartPosition } from './chart-registry';

export interface ChartCtxInput {
  portfolioSnapshot: PortfolioSnapshot | null;
  /** Raw `body.portfolio.positions` — carries `sector`, which the snapshot type omits. */
  rawPositions?: any[] | null;
  isDemo?: boolean;
  /** Active account id from the client (used only to pick the right connection). */
  accountId?: string | null;
  userId?: string | null;
  investorStyle?: string | null;
  riskTolerance?: string | null;
  supabase?: any;
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Σ unrealised P&L ÷ Σ cost basis, over positions that have a cost basis. */
function deriveTotalPnlPercent(positions: ChartPosition[]): number {
  let pnl = 0;
  let cost = 0;
  for (const p of positions) {
    const qty = p.qty ?? 0;
    const avgCost = p.avgCost ?? 0;
    if (avgCost <= 0 || qty <= 0) continue;
    const basis = qty * avgCost;
    cost += basis;
    pnl += typeof p.unrealizedPnl === 'number' ? p.unrealizedPnl : (p.marketValue || 0) - basis;
  }
  if (cost <= 0) return 0;
  return (pnl / cost) * 100;
}

/**
 * Which broker connection should the activity/waterfall keys read?
 * - the connection row id, or the SnapTrade account id inside `snaptrade_accounts`
 * - the user's single connection
 * Ambiguous (multiple connections, no match) → null → waterfall falls back to prose.
 *
 * Returns the `broker_connections.id` — the id `resolveSnapTradeCredentials()`
 * matches on (`c.id === connectionId`). Returning the `snaptrade_connection_id`
 * here looks equivalent but is not: it is the SnapTrade-internal authorization
 * id, so passing it back throws SnapTradeAuthError and the chart dies silently.
 *
 * The app's account key is `snaptrade:<broker_connections.id>`, so the prefix is
 * stripped for matching — otherwise a two-connection user never matches and the
 * key resolves to null as "ambiguous".
 */
function bareAccountId(accountId: string | null | undefined): string {
  return String(accountId || '').replace(/^[a-z_]+:/i, '');
}

async function resolveSnapTradeConnectionId(
  supabase: any,
  userId: string,
  accountId: string | null | undefined,
): Promise<string | null> {
  if (!supabase || !userId || !accountId) return null;
  try {
    const target = bareAccountId(accountId);
    const { data } = await supabase
      .from('broker_connections')
      .select('id, snaptrade_connection_id, snaptrade_accounts')
      .eq('user_id', userId);
    const rows = ((data || []) as any[]).filter((r) => !!r?.snaptrade_connection_id);
    if (rows.length === 0) return null;

    const match = rows.find(
      (r) =>
        String(r.id) === target ||
        (Array.isArray(r.snaptrade_accounts) &&
          r.snaptrade_accounts.some(
            (a: any) => String(a?.id) === target || String(a?.id) === String(accountId),
          )),
    );
    if (match) return String(match.id);
    if (rows.length === 1) return String(rows[0].id);
    return null;
  } catch {
    return null;
  }
}

export async function buildChartCtx(input: ChartCtxInput): Promise<ChartCtx> {
  const snapshot = input.portfolioSnapshot;
  const rawBySymbol = new Map<string, any>();
  for (const p of input.rawPositions || []) {
    const sym = String(p?.symbol || '').toUpperCase().trim();
    if (sym) rawBySymbol.set(sym, p);
  }

  const positions: ChartPosition[] = (snapshot?.positions || []).map((p) => {
    const symbol = String(p.symbol || '').toUpperCase().trim();
    const raw = rawBySymbol.get(symbol);
    return {
      symbol,
      name: p.name,
      qty: num(p.qty),
      price: num(p.price),
      marketValue: num(p.marketValue),
      avgCost: typeof p.avgCost === 'number' && p.avgCost > 0 ? p.avgCost : undefined,
      unrealizedPnl: typeof p.unrealizedPnl === 'number' ? p.unrealizedPnl : undefined,
      sector: typeof raw?.sector === 'string' ? raw.sector : null,
    };
  });

  // Cash is a measurement, not a default: absent/non-numeric ⇒ unknown (null),
  // never 0. `cashKnown` rides along so cash-derived percentages can go unknown.
  const cashKnown = typeof snapshot?.cash === 'number' && Number.isFinite(snapshot.cash);
  const cash = cashKnown ? Math.max(0, num(snapshot?.cash)) : null;
  const invested = positions.reduce((s, p) => s + (p.marketValue || 0), 0);
  const equity = num(snapshot?.equity) > 0 ? num(snapshot?.equity) : invested + (cash ?? 0);

  const connectionId =
    input.isDemo || !input.userId
      ? null
      : await resolveSnapTradeConnectionId(input.supabase, input.userId, input.accountId);

  return {
    positions,
    cash,
    cashKnown,
    equity,
    totalPnl: positions.reduce((s, p) => s + (typeof p.unrealizedPnl === 'number' ? p.unrealizedPnl : 0), 0),
    totalPnlPercent: deriveTotalPnlPercent(positions),
    riskTolerance: input.riskTolerance ?? null,
    investorStyle: input.investorStyle ?? null,
    holdingsUnavailable: !snapshot,
    accountId: input.accountId ?? null,
    userId: input.userId ?? null,
    connectionId,
    supabase: input.supabase ?? null,
  };
}
