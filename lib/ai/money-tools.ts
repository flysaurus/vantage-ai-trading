// ─── Money Tools (Phase 2b/2c) — PREVIEW-ONLY ───────────────────────────────
// Tool definitions + executor for the AI advisor's money-action surface. Every
// tool here is PREVIEW-ONLY: it validates the request, stores a short-lived
// `pending_action` ticket (see lib/ai/pending-actions.ts), and returns a
// human-readable preview. It NEVER executes the side effect itself.
//
// A separate DETERMINISTIC confirm step (app/api/chat/route.ts → executors.ts)
// looks up the ticket and runs the real endpoint after the user confirms.
//
// This is the core safety property of the plan-then-confirm gate: a spurious or
// hallucinated tool call only ever produces a harmless preview + confirm prompt,
// never a real order/mutation.
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk';
import { createPendingAction } from '@/lib/ai/pending-actions';
import { actionRequiresSymbolEcho } from '@/lib/ai/confirm';

export interface MoneyToolContext {
  supabase: any;               // service-role client (server-side only)
  userId: string | null;
  /** Canonical account id ('demo' | 'snaptrade:<conn_id>') the user is acting on. */
  accountId?: string | null;
}

const VALID_FREQUENCIES = ['daily', 'weekly', 'biweekly', 'monthly'];
const VALID_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
const VALID_DATES = ['1', '15', 'last'];
const VALID_ALERT_TYPES = ['price_above', 'price_below', 'percent_change'];

function obj(props: Record<string, any> = {}): Anthropic.Tool['input_schema'] {
  return { type: 'object', properties: props, required: [] };
}

const SYMBOL_SCHEMA = { type: 'string', description: 'Ticker symbol (e.g. AAPL). Resolve company names to a ticker first.' } as const;

export const MONEY_TOOLS: Anthropic.Tool[] = [
  {
    name: 'previewWatchlistAdd',
    description:
      "PREVIEW adding a ticker to the user's watchlist. Does NOT execute — returns a preview and stores a pending action the user must confirm. Resolve company names to a ticker first.",
    input_schema: obj({ symbol: SYMBOL_SCHEMA }),
  },
  {
    name: 'previewWatchlistRemove',
    description:
      "PREVIEW removing a ticker from the user's watchlist. Does NOT execute — requires confirm.",
    input_schema: obj({ symbol: SYMBOL_SCHEMA }),
  },
  {
    name: 'previewAlertCreate',
    description:
      "PREVIEW creating a price alert (price_above, price_below, or percent_change). Does NOT execute — requires confirm.",
    input_schema: obj({
      symbol: SYMBOL_SCHEMA,
      alertType: { type: 'string', description: 'price_above | price_below | percent_change' },
      targetValue: { type: 'number', description: 'Trigger threshold (price or percent, > 0).' },
    }),
  },
  {
    name: 'previewAlertUpdate',
    description:
      "PREVIEW toggling or changing an existing alert's threshold. Does NOT execute — requires confirm.",
    input_schema: obj({
      alertId: { type: 'string', description: 'Alert id (from listAlerts).' },
      isActive: { type: 'boolean', description: 'Optional: enable/disable.' },
      targetValue: { type: 'number', description: 'Optional: new threshold.' },
    }),
  },
  {
    name: 'previewAlertDelete',
    description: 'PREVIEW deleting an alert. Does NOT execute — requires confirm.',
    input_schema: obj({ alertId: { type: 'string', description: 'Alert id (from listAlerts).' } }),
  },
  {
    name: 'previewDcaCreate',
    description:
      "PREVIEW creating a dollar-cost-averaging (DCA) schedule. Does NOT execute — requires confirm. amount is the dollars invested per period.",
    input_schema: obj({
      symbol: SYMBOL_SCHEMA,
      amount: { type: 'number', description: 'Dollars per period (≥ $1).' },
      frequency: { type: 'string', description: 'daily | weekly | biweekly | monthly' },
      dayOfWeek: { type: 'string', description: 'For weekly/biweekly: mon..fri.' },
      dayOfMonth: { type: 'string', description: "For monthly: '1' | '15' | 'last'." },
      startDate: { type: 'string', description: 'Start date (YYYY-MM-DD).' },
      endDate: { type: 'string', description: 'End date (YYYY-MM-DD). Omit ONLY if the user explicitly chose "ongoing / no end date". Ask the user for a duration before omitting.' },
    }),
  },
  {
    name: 'previewDcaUpdate',
    description:
      "PREVIEW editing an existing DCA schedule (partial — only pass fields to change). Does NOT execute — requires confirm.",
    input_schema: obj({
      scheduleId: { type: 'string', description: 'Schedule id (from listDcaSchedules).' },
      symbol: { type: 'string', description: 'Optional new symbol.' },
      amount: { type: 'number', description: 'Optional new amount per period.' },
      frequency: { type: 'string', description: 'Optional new frequency.' },
      dayOfWeek: { type: 'string', description: 'Optional.' },
      dayOfMonth: { type: 'string', description: 'Optional.' },
      startDate: { type: 'string', description: 'Optional.' },
      endDate: { type: 'string', description: 'Optional.' },
    }),
  },
  {
    name: 'previewDcaDelete',
    description:
      "PREVIEW cancelling (deactivating) a DCA schedule. Does NOT execute — requires confirm.",
    input_schema: obj({ scheduleId: { type: 'string', description: 'Schedule id (from listDcaSchedules).' } }),
  },
  {
    name: 'previewBuyStock',
    description:
      "PREVIEW buying a stock/ETF with real money. Does NOT execute — returns a preview and stores a pending action the user MUST confirm. Resolve the company name to a ticker first.",
    input_schema: obj({
      symbol: SYMBOL_SCHEMA,
      dollarAmount: { type: 'number', description: 'Dollars to invest (≥ $1).' },
      shares: { type: 'number', description: 'Optional: exact share count (alternative to dollarAmount).' },
      orderType: { type: 'string', description: 'Optional: market (default) | limit | stop | stop_limit.' },
      limitPrice: { type: 'number', description: 'Optional: for limit/stop_limit orders.' },
    }),
  },
  {
    name: 'previewSellStock',
    description:
      "PREVIEW selling a position with real money. Does NOT execute — requires confirm. Resolve the company name to a ticker first.",
    input_schema: obj({
      symbol: SYMBOL_SCHEMA,
      shares: { type: 'number', description: 'Number of shares to sell.' },
      dollarAmount: { type: 'number', description: 'Optional: sell by dollar value instead.' },
      orderType: { type: 'string', description: 'Optional: market (default) | limit | stop | stop_limit.' },
      limitPrice: { type: 'number', description: 'Optional: for limit/stop_limit orders.' },
    }),
  },
  {
    name: 'previewExecuteBasket',
    description:
      "PREVIEW buying a basket of stocks/ETFs (one order per leg) with real money. Does NOT execute — requires confirm.",
    input_schema: obj({
      basketName: { type: 'string', description: 'Optional basket label.' },
      stocks: {
        type: 'array',
        description: 'Legs to buy: [{symbol, dollarAmount}]',
        items: {
          type: 'object',
          properties: {
            symbol: { type: 'string' },
            dollarAmount: { type: 'number' },
          },
          required: ['symbol', 'dollarAmount'],
        },
      },
    }),
  },
];

interface PreviewResult {
  preview: string;
  actionType: string;
  amountUsd: number | null;
  confirmToken: string | null;
  requiresSymbolEcho: boolean;
  confirmInstruction: string;
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

export async function executeMoneyTool(
  name: string,
  input: any,
  ctx: MoneyToolContext,
): Promise<string> {
  const { supabase, userId } = ctx;
  const isAuthed = !!userId && userId !== 'anonymous';

  const fail = (msg: string) => JSON.stringify({ error: msg });
  const ok = (r: PreviewResult) => JSON.stringify(r);

  const buildPreview = (
    actionType: string,
    payload: Record<string, unknown>,
    summary: string,
    amountUsd: number | null,
    confirmToken: string | null,
  ): PreviewResult => {
    const requiresSymbolEcho = actionRequiresSymbolEcho(actionType, amountUsd);
    return {
      preview: summary,
      actionType,
      amountUsd,
      confirmToken,
      requiresSymbolEcho,
      confirmInstruction: requiresSymbolEcho && confirmToken
        ? `Reply "confirm ${confirmToken}" to execute, or "cancel" to abort. Nothing has run yet — this is only a preview.`
        : 'Reply "confirm" to execute, or "cancel" to abort. Nothing has run yet — this is only a preview.',
    };
  };

  const storePending = async (
    actionType: string,
    payload: Record<string, unknown>,
    summary: string,
    amountUsd: number | null,
    confirmToken: string | null,
  ): Promise<string> => {
    if (!isAuthed) return fail('You need to be signed in to do that.');
    const action = await createPendingAction(supabase, userId as string, {
      actionType,
      payload,
      summary,
      amountUsd,
      confirmToken,
    });
    if (!action) return fail('Failed to stage this action for confirmation. Please try again.');
    return ok(buildPreview(actionType, payload, summary, amountUsd, confirmToken));
  };

  const cleanSymbol = (s: unknown): string | null => {
    const v = String(s ?? '').trim().toUpperCase();
    return v ? v : null;
  };

  try {
    switch (name) {
      case 'previewWatchlistAdd': {
        const symbol = cleanSymbol(input?.symbol);
        if (!symbol) return fail('A valid ticker symbol is required.');
        return storePending('watchlist_add', { symbol }, `Add ${symbol} to your watchlist.`, null, symbol);
      }

      case 'previewWatchlistRemove': {
        const symbol = cleanSymbol(input?.symbol);
        if (!symbol) return fail('A valid ticker symbol is required.');
        return storePending('watchlist_remove', { symbol }, `Remove ${symbol} from your watchlist.`, null, symbol);
      }

      case 'previewAlertCreate': {
        const symbol = cleanSymbol(input?.symbol);
        const alertType = String(input?.alertType ?? '').trim();
        const targetValue = Number(input?.targetValue);
        if (!symbol) return fail('A valid ticker symbol is required.');
        if (!VALID_ALERT_TYPES.includes(alertType)) return fail('alertType must be price_above, price_below, or percent_change.');
        if (!targetValue || targetValue <= 0) return fail('targetValue must be positive.');
        const label = alertType.replace(/_/g, ' ');
        const suffix = alertType === 'percent_change' ? '%' : '';
        return storePending(
          'alert_create',
          { symbol, alertType, targetValue, notificationChannels: ['in_app'] },
          `Create an alert for ${symbol} when price is ${label} ${targetValue}${suffix}.`,
          null,
          symbol,
        );
      }

      case 'previewAlertUpdate': {
        const alertId = String(input?.alertId ?? '').trim();
        if (!alertId) return fail('alertId is required (from listAlerts).');
        if (input?.isActive === undefined && input?.targetValue === undefined) {
          return fail('Provide isActive and/or targetValue to change.');
        }
        if (input?.targetValue !== undefined && Number(input.targetValue) <= 0) {
          return fail('targetValue must be positive.');
        }
        const payload: Record<string, unknown> = { alertId };
        if (input?.isActive !== undefined) payload.isActive = !!input.isActive;
        if (input?.targetValue !== undefined) payload.targetValue = Number(input.targetValue);
        return storePending('alert_update', payload, 'Update your alert.', null, null);
      }

      case 'previewAlertDelete': {
        const alertId = String(input?.alertId ?? '').trim();
        if (!alertId) return fail('alertId is required (from listAlerts).');
        return storePending('alert_delete', { alertId }, 'Delete this alert.', null, null);
      }

      case 'previewDcaCreate': {
        const symbol = cleanSymbol(input?.symbol);
        const amount = Number(input?.amount);
        const frequency = String(input?.frequency ?? '').trim();
        const startDate = input?.startDate || new Date().toISOString().slice(0, 10);
        if (!symbol) return fail('A valid ticker symbol is required.');
        if (!amount || amount < 1) return fail('amount must be at least $1.');
        if (!VALID_FREQUENCIES.includes(frequency)) return fail(`frequency must be one of: ${VALID_FREQUENCIES.join(', ')}.`);
        if (isNaN(Date.parse(startDate))) return fail('startDate must be a valid date (YYYY-MM-DD).');

        const payload: Record<string, unknown> = { symbol, amount, frequency, startDate };
        // Account scope: embed the acting account so the executor writes the
        // strategy row under the correct account (demo stays demo).
        if (ctx.accountId) payload.accountId = ctx.accountId;
        if (input?.dayOfWeek) {
          if (!VALID_DAYS.includes(input.dayOfWeek)) return fail('dayOfWeek must be mon..fri.');
          payload.dayOfWeek = input.dayOfWeek;
        }
        if (input?.dayOfMonth) {
          if (!VALID_DATES.includes(input.dayOfMonth)) return fail("dayOfMonth must be '1', '15', or 'last'.");
          payload.dayOfMonth = input.dayOfMonth;
        }
        if (input?.endDate) {
          if (isNaN(Date.parse(input.endDate))) return fail('endDate must be a valid date (YYYY-MM-DD).');
          payload.endDate = input.endDate;
        }

        const freqLabel = frequency === 'biweekly' ? 'every 2 weeks' : frequency;
        return storePending(
          'dca_create',
          payload,
          `Set up a DCA: invest ${fmtMoney(amount)} into ${symbol} ${freqLabel} starting ${startDate}.`,
          amount,
          symbol,
        );
      }

      case 'previewDcaUpdate': {
        const scheduleId = String(input?.scheduleId ?? '').trim();
        if (!scheduleId) return fail('scheduleId is required (from listDcaSchedules).');
        const payload: Record<string, unknown> = { scheduleId };
        if (input?.symbol !== undefined) {
          const s = cleanSymbol(input.symbol);
          if (!s) return fail('symbol must be a valid ticker.');
          payload.symbol = s;
        }
        if (input?.amount !== undefined) {
          if (Number(input.amount) < 1) return fail('amount must be at least $1.');
          payload.amount = Number(input.amount);
        }
        if (input?.frequency !== undefined) {
          if (!VALID_FREQUENCIES.includes(input.frequency)) return fail('Invalid frequency.');
          payload.frequency = input.frequency;
        }
        if (input?.dayOfWeek !== undefined) payload.dayOfWeek = input.dayOfWeek;
        if (input?.dayOfMonth !== undefined) payload.dayOfMonth = input.dayOfMonth;
        if (input?.startDate !== undefined) payload.startDate = input.startDate;
        if (input?.endDate !== undefined) payload.endDate = input.endDate;

        const amountUsd = payload.amount != null ? Number(payload.amount) : null;
        const confirmToken = (payload.symbol as string) || null;
        return storePending('dca_update', payload, 'Update your DCA schedule.', amountUsd, confirmToken);
      }

      case 'previewDcaDelete': {
        const scheduleId = String(input?.scheduleId ?? '').trim();
        if (!scheduleId) return fail('scheduleId is required (from listDcaSchedules).');
        return storePending('dca_delete', { scheduleId }, 'Cancel (deactivate) this DCA schedule.', null, null);
      }

      case 'previewBuyStock': {
        const symbol = cleanSymbol(input?.symbol);
        const dollarAmount = input?.dollarAmount != null ? Number(input.dollarAmount) : null;
        const shares = input?.shares != null ? Number(input.shares) : null;
        if (!symbol) return fail('A valid ticker symbol is required.');
        if ((dollarAmount == null || dollarAmount < 1) && (shares == null || shares <= 0)) {
          return fail('Provide a dollar amount (≥ $1) or a share count.');
        }
        if (dollarAmount != null && dollarAmount < 1) return fail('dollarAmount must be at least $1.');
        if (shares != null && shares <= 0) return fail('shares must be positive.');
        const payload: Record<string, unknown> = {
          symbol,
          side: 'BUY',
          orderType: input?.orderType || 'market',
        };
        if (dollarAmount != null) payload.dollarAmount = dollarAmount;
        if (shares != null) payload.shares = shares;
        if (input?.limitPrice != null) payload.limitPrice = Number(input.limitPrice);
        const summary = dollarAmount != null
          ? `Buy ${fmtMoney(dollarAmount)} of ${symbol}.`
          : `Buy ${shares} share${shares === 1 ? '' : 's'} of ${symbol}.`;
        return storePending('buy_stock', payload, summary, dollarAmount, symbol);
      }

      case 'previewSellStock': {
        const symbol = cleanSymbol(input?.symbol);
        const shares = input?.shares != null ? Number(input.shares) : null;
        const dollarAmount = input?.dollarAmount != null ? Number(input.dollarAmount) : null;
        if (!symbol) return fail('A valid ticker symbol is required.');
        if ((shares == null || shares <= 0) && (dollarAmount == null || dollarAmount <= 0)) {
          return fail('Provide a share count or dollar value to sell.');
        }
        if (shares != null && shares <= 0) return fail('shares must be positive.');
        const payload: Record<string, unknown> = {
          symbol,
          side: 'SELL',
          orderType: input?.orderType || 'market',
        };
        if (shares != null) payload.shares = shares;
        if (dollarAmount != null) payload.dollarAmount = dollarAmount;
        if (input?.limitPrice != null) payload.limitPrice = Number(input.limitPrice);
        const summary = shares != null
          ? `Sell ${shares} share${shares === 1 ? '' : 's'} of ${symbol}.`
          : `Sell ${fmtMoney(dollarAmount as number)} of ${symbol}.`;
        return storePending('sell_stock', payload, summary, null, symbol);
      }

      case 'previewExecuteBasket': {
        const stocksRaw = input?.stocks;
        if (!Array.isArray(stocksRaw) || stocksRaw.length === 0) {
          return fail('stocks must be a non-empty array of {symbol, dollarAmount}.');
        }
        const stocks = stocksRaw.map((s: any) => ({
          symbol: cleanSymbol(s?.symbol) || '',
          dollarAmount: Number(s?.dollarAmount) || 0,
        }));
        if (stocks.some((s: any) => !s.symbol)) return fail('Each basket leg needs a valid symbol.');
        if (stocks.some((s: any) => !s.dollarAmount || s.dollarAmount < 1)) {
          return fail('Each basket leg needs a dollar amount ≥ $1.');
        }
        const total = stocks.reduce((sum: number, s: any) => sum + s.dollarAmount, 0);
        const basketName = input?.basketName ? String(input.basketName).trim() : 'Basket';
        const payload: Record<string, unknown> = { basketName, stocks };
        const summary = `Buy a basket (${basketName}) — ${stocks.length} position${stocks.length === 1 ? '' : 's'}, ${fmtMoney(total)} total.`;
        return storePending('basket_execute', payload, summary, total, null);
      }

      default:
        return fail(`Unknown tool: ${name}`);
    }
  } catch (e: any) {
    console.error('[money-tools] executeMoneyTool threw:', e);
    return fail(e?.message || 'Tool execution failed');
  }
}
