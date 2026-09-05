// ─── Read-Only Account Tools (Phase 2a) ──────────────────────
// Tool definitions + executor for grounding the AI advisor with REAL account
// data on demand. Every tool here is READ-ONLY (no mutation, no side effects) —
// safe to expose on all intents. A spurious call just returns data; nothing
// executes. Money actions live behind the plan-then-confirm gate, NOT here.
// ──────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk';
import { getInvestorStyleTargets } from '@/lib/investor-style-targets';
import { computeRebalancePlan, formatRebalancePlanAnswer } from '@/lib/ai/account-actions';
import type { PortfolioSnapshot, RebalancePlan } from '@/lib/ai/account-actions';
import { parseAccountScope, applyAccountScopeFilter } from '@/lib/account-scope';

export interface ReadonlyToolContext {
  supabase: any;               // service-role client (server-side only)
  userId: string | null;
  portfolioSnapshot: PortfolioSnapshot | null;
  investorStyle: string;
  /** Canonical account id ('demo' | 'snaptrade:<conn_id>') the user is acting on. */
  accountId?: string | null;
  /** True when the active account is a read-only live broker connection — order
   *  placement is unavailable, so proposals must show a download-only disclosure. */
  readOnly?: boolean;
  /** Set by executeReadonlyTool when getRebalancePlan computes a plan, so the
   *  caller can attach a downloadable export payload to the model's prose
   *  summary of that plan (the model narrates, but never emits markers). */
  capturedRebalancePlan?: RebalancePlan | null;
}

const STYLE_KEYS = ['buffett', 'lynch', 'livermore', 'munger', 'soros'];

function normalizeStyleKey(s?: unknown): string | null {
  const v = String(s ?? '').trim().toLowerCase();
  return STYLE_KEYS.includes(v) ? v : null;
}

function obj(props: Record<string, any> = {}): Anthropic.Tool['input_schema'] {
  return { type: 'object', properties: props, required: [] };
}

export const READONLY_TOOLS: Anthropic.Tool[] = [
  {
    name: 'getPortfolio',
    description:
      "Fetch the user's current live portfolio: equity, cash, and every position (symbol, quantity, price, market value). Use this to answer 'what do I own', 'what's my portfolio worth', 'what are my holdings' with real data instead of guessing or relying on training data.",
    input_schema: obj(),
  },
  {
    name: 'getStyleTargets',
    description:
      "Get the target allocation (per-symbol percentages) for an investor style. Valid styles: buffett, lynch, livermore, munger, soros. Omit `style` to use the user's current style.",
    input_schema: obj({ style: { type: 'string', description: 'Style key (optional).' } }),
  },
  {
    name: 'getRebalancePlan',
    description:
      "Compute a rebalance plan (buy/sell dollar deltas per position) from the user's current holdings to a style's target allocation. Read-only — returns a proposal, never executes. Omit `style` to use the user's current style.",
    input_schema: obj({ style: { type: 'string', description: 'Target style key (optional).' } }),
  },
  {
    name: 'listDcaSchedules',
    description:
      "List the user's active dollar-cost-averaging (DCA) schedules: symbol, config (amount/frequency), next run. Use this to answer 'what are my DCA schedules', 'what am I auto-investing in'.",
    input_schema: obj(),
  },
  {
    name: 'listBaskets',
    description:
      "List the user's baskets (thematic portfolios). Use this to answer 'what baskets do I have'.",
    input_schema: obj(),
  },
  {
    name: 'listAlerts',
    description:
      "List the user's price alerts: symbol, type (above/below/percent), threshold, active state. Use this to answer 'what alerts do I have'.",
    input_schema: obj(),
  },
  {
    name: 'listWatchlist',
    description:
      "List the user's watchlist symbols. Use this to answer 'what's on my watchlist'.",
    input_schema: obj(),
  },
  {
    name: 'listOrders',
    description:
      "List the user's recent orders (symbol, side, quantity, status, price). Use this to answer 'what have I bought/sold', 'recent trades', 'any pending orders'.",
    input_schema: obj({ limit: { type: 'number', description: 'Max orders (default 20).' } }),
  },
];

export async function executeReadonlyTool(
  name: string,
  input: any,
  ctx: ReadonlyToolContext,
): Promise<string> {
  const { supabase, userId, portfolioSnapshot, investorStyle, accountId } = ctx;
  const isAuthed = !!userId && userId !== 'anonymous';
  // Account segregation: scope strategy/schedule reads to the active account.
  // Demo → is_demo=true; live → the specific connection; unspecified → live only.
  const acctScope = parseAccountScope(accountId);

  try {
    switch (name) {
      case 'getPortfolio': {
        if (!portfolioSnapshot) {
          return JSON.stringify({ error: 'No portfolio loaded — connect your broker or refresh.', positions: [], equity: 0, cash: 0 });
        }
        return JSON.stringify({
          equity: portfolioSnapshot.equity,
          cash: portfolioSnapshot.cash,
          positionCount: portfolioSnapshot.positions.length,
          positions: portfolioSnapshot.positions.map((p) => ({
            symbol: p.symbol,
            name: p.name || p.symbol,
            qty: p.qty,
            price: p.price,
            marketValue: p.marketValue,
          })),
        });
      }

      case 'getStyleTargets': {
        const style = normalizeStyleKey(input?.style) || investorStyle || 'lynch';
        const { targets, styleName, description } = getInvestorStyleTargets(style);
        return JSON.stringify({ style, styleName, description, targets });
      }

      case 'getRebalancePlan': {
        const style = normalizeStyleKey(input?.style) || investorStyle || 'lynch';
        const plan = computeRebalancePlan(portfolioSnapshot, style);
        // Expose the structured plan to the caller (chat route) so it can attach
        // a downloadable .xlsx payload — the model only summarizes the JSON in
        // prose and emits no markers, so the marker-gated exporter never fires.
        if (ctx) ctx.capturedRebalancePlan = plan;
        return JSON.stringify({ ...plan, summary: formatRebalancePlanAnswer(plan, { readOnly: ctx?.readOnly }) });
      }

      case 'listDcaSchedules': {
        if (!isAuthed) return JSON.stringify({ schedules: [], note: 'No authenticated user.' });
        let dcaQuery = (supabase as any)
          .from('strategies')
          .select('id, symbol, config, is_active, next_run_at, last_run_at, created_at, connection_id, is_demo')
          .eq('user_id', userId)
          .eq('type', 'dca');
        dcaQuery = acctScope ? applyAccountScopeFilter(dcaQuery, acctScope) : dcaQuery.eq('is_demo', false);
        const { data, error } = await dcaQuery.order('created_at', { ascending: false });
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({
          schedules: (data || []).map((s: any) => ({
            id: s.id, symbol: s.symbol, config: s.config,
            isActive: s.is_active, nextRunAt: s.next_run_at, lastRunAt: s.last_run_at,
            isDemo: !!s.is_demo, connectionId: s.connection_id ?? null,
          })),
        });
      }

      case 'listBaskets': {
        if (!isAuthed) return JSON.stringify({ baskets: [], note: 'No authenticated user.' });
        const { data, error } = await (supabase as any)
          .from('baskets')
          .select('id, name, status, is_active, created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(25);
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({
          baskets: (data || []).map((b: any) => ({
            id: b.id, name: b.name, status: b.status, isActive: b.is_active, createdAt: b.created_at,
          })),
        });
      }

      case 'listAlerts': {
        if (!isAuthed) return JSON.stringify({ alerts: [], note: 'No authenticated user.' });
        let alertsQuery = (supabase as any)
          .from('alerts')
          .select('id, symbol, type, threshold, is_active, triggered_at, created_at')
          .eq('user_id', userId);
        alertsQuery = acctScope ? applyAccountScopeFilter(alertsQuery, acctScope) : alertsQuery.eq('is_demo', false);
        const { data, error } = await alertsQuery.order('created_at', { ascending: false }).limit(50);
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({
          alerts: (data || []).map((a: any) => ({
            id: a.id, symbol: a.symbol, type: a.type, threshold: a.threshold,
            isActive: a.is_active, triggeredAt: a.triggered_at, createdAt: a.created_at,
          })),
        });
      }

      case 'listWatchlist': {
        if (!isAuthed) return JSON.stringify({ watchlists: [], note: 'No authenticated user.' });
        let wlQuery = (supabase as any)
          .from('watchlists')
          .select('id, name, stocks, updated_at')
          .eq('user_id', userId);
        wlQuery = acctScope ? applyAccountScopeFilter(wlQuery, acctScope) : wlQuery.eq('is_demo', false);
        const { data, error } = await wlQuery.order('updated_at', { ascending: false }).limit(10);
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({
          watchlists: (data || []).map((w: any) => ({
            id: w.id, name: w.name,
            stocks: Array.isArray(w.stocks) ? w.stocks.map((s: any) => s?.symbol || s) : w.stocks,
            updatedAt: w.updated_at,
          })),
        });
      }

      case 'listOrders': {
        if (!isAuthed) return JSON.stringify({ orders: [], note: 'No authenticated user.' });
        const limit = Math.min(Math.max(Number(input?.limit) || 20, 1), 50);
        let ordersQuery = (supabase as any)
          .from('orders')
          .select('id, symbol, company_name, side, qty, filled_qty, status, filled_price, notional, filled_at, created_at, source')
          .eq('user_id', userId);
        // Account segregation: scope order reads to the active account.
        ordersQuery = acctScope ? applyAccountScopeFilter(ordersQuery, acctScope) : ordersQuery.eq('is_demo', false);
        const { data, error } = await ordersQuery.order('created_at', { ascending: false }).limit(limit);
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({
          orders: (data || []).map((o: any) => ({
            id: o.id, symbol: o.symbol, name: o.company_name ?? null, side: o.side,
            qty: o.qty != null ? Number(o.qty) : null,
            filledQty: o.filled_qty != null ? Number(o.filled_qty) : null,
            status: o.status,
            filledPrice: o.filled_price != null ? Number(o.filled_price) : null,
            notional: o.notional != null ? Number(o.notional) : null,
            filledAt: o.filled_at ?? null, createdAt: o.created_at, source: o.source,
          })),
        });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (e: any) {
    return JSON.stringify({ error: e?.message || 'Tool execution failed' });
  }
}
