// ─── Deterministic Account Actions & Grounding Helpers ───────
// Gives the AI Advisor a grounded way to handle account actions (change investor
// style, compute a rebalance plan) instead of hallucinating. Pure/read-only
// helpers live here; DB mutations happen in the chat route (which owns userId +
// service-role supabase). Also exports the light-path grounding backstop.
// ──────────────────────────────────────────────────────────────

import { getStyleConfig } from '@/lib/investor-style-defaults';
import { getInvestorStyleTargets } from '@/lib/investor-style-targets';

const VALID_STYLES = ['buffett', 'lynch', 'livermore', 'soros', 'munger'];

export interface PortfolioSnapshot {
  equity: number;
  cash: number;
  positions: Array<{
    symbol: string;
    name?: string;
    qty: number;
    price: number;
    marketValue: number;
  }>;
}

export type AccountAction =
  | { type: 'change_style'; style: string }
  | { type: 'invalid_style'; requested: string }
  | { type: 'rebalance'; style: string | null }
  | { type: 'change_and_rebalance'; style: string };

/** Normalize a spoken style name ("Lynch", "warren buffett") → key ("lynch"). */
export function normalizeStyle(input: string): string | null {
  const s = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/\b(warren|peter|george|charlie|benjamin|stanley|philip|john|jim)\b\s*/g, '')
    .trim();
  return VALID_STYLES.includes(s) ? s : null;
}

/**
 * Detect a clear account-action command. Returns null for questions/hypotheticals
 * (which fall through to the model) — so "how would the app react if I change my
 * style to Lynch?" never mutates the profile.
 */
export function detectAccountAction(message: string): AccountAction | null {
  const m = message.trim();
  if (!m || m.length > 240) return null;

  const hypothetical = /\b(should|could|would|might|what if|how would|how do i|how to|how should|what happens if)\b/i.test(m);

  const styleMatch = /(?:please\s+)?(?:change|switch|set|move|update)\s+(?:my\s+)?(?:investment|investor|trading|investing)?\s*style\s+(?:to|into)\s+([a-z][a-z\s]{1,24})/i.exec(m);
  const rebalanceMatch = /\brebalance\b/i.test(m);

  const rawStyle = styleMatch ? styleMatch[1] : null;
  const style = rawStyle ? normalizeStyle(rawStyle) : null;

  // Rebalance target style: "rebalance ... to/into/as X"
  let rebStyle: string | null = null;
  if (rebalanceMatch) {
    const reb = /\brebalance\b.*?\b(?:to|into|as)\s+([a-z][a-z\s]{1,24})/i.exec(m);
    rebStyle = reb ? normalizeStyle(reb[1]) : null;
  }

  // Explicit "change style to <something>" but the target isn't a valid style.
  if (styleMatch && rawStyle && !style && !rebalanceMatch) {
    return { type: 'invalid_style', requested: rawStyle.trim() };
  }

  const hasChange = !!styleMatch && !!style;
  const hasRebalance = rebalanceMatch;

  if (hasChange && hasRebalance && !hypothetical) return { type: 'change_and_rebalance', style: style! };
  if (hasChange && !hypothetical) return { type: 'change_style', style: style! };
  if (hasRebalance) return { type: 'rebalance', style: rebStyle };
  return null;
}

export interface RebalanceLine {
  symbol: string;
  name: string;
  targetPercent: number;
  currentValue: number;
  targetValue: number;
  delta: number;
  action: 'buy' | 'sell' | 'hold';
}

export interface RebalancePlan {
  styleName: string;
  description: string;
  equity: number;
  cash: number;
  lines: RebalanceLine[];
  totalBuy: number;
  totalSell: number;
}

/** Compute proposed rebalance trades (dollar deltas) from holdings → style targets. */
export function computeRebalancePlan(portfolio: PortfolioSnapshot | null, style: string): RebalancePlan {
  const { targets, styleName, description } = getInvestorStyleTargets(style);
  const equity = portfolio?.equity ?? 0;
  const cash = portfolio?.cash ?? 0;
  const positions = portfolio?.positions ?? [];

  const lines: RebalanceLine[] = targets.map((t) => {
    const targetValue = equity * t.targetPercent / 100;
    let currentValue = 0;
    if (t.symbol === 'CASH') {
      currentValue = cash;
    } else {
      currentValue = positions
        .filter((p) => (p.symbol || '').toUpperCase() === t.symbol.toUpperCase())
        .reduce((s, p) => s + (p.marketValue || (p.price || 0) * (p.qty || 0) || 0), 0);
    }
    const delta = targetValue - currentValue;
    const action: 'buy' | 'sell' | 'hold' = Math.abs(delta) < 1 ? 'hold' : delta > 0 ? 'buy' : 'sell';
    return { symbol: t.symbol, name: t.name, targetPercent: t.targetPercent, currentValue, targetValue, delta, action };
  });

  // Individual positions not in any target bucket → sell to cash.
  const targetSymbols = new Set(targets.map((t) => t.symbol.toUpperCase()));
  const orphanSells: RebalanceLine[] = positions
    .filter((p) => p.symbol && !targetSymbols.has(p.symbol.toUpperCase()))
    .map((p) => {
      const marketValue = p.marketValue || (p.price || 0) * (p.qty || 0) || 0;
      return {
        symbol: p.symbol,
        name: p.name || p.symbol,
        targetPercent: 0,
        currentValue: marketValue,
        targetValue: 0,
        delta: -marketValue,
        action: 'sell' as const,
      };
    });

  const all = [...lines, ...orphanSells].filter((l) => l.action !== 'hold');
  const totalBuy = all.filter((l) => l.action === 'buy').reduce((s, l) => s + l.delta, 0);
  const totalSell = all.filter((l) => l.action === 'sell').reduce((s, l) => s + Math.abs(l.delta), 0);

  return { styleName, description, equity, cash, lines: all, totalBuy, totalSell };
}

const usd = (n: number) => '$' + Math.round(Math.abs(n)).toLocaleString('en-US');

/** Detect an explicit rebalance EXECUTION command ("execute the rebalance").
 *  Distinct from "rebalance" alone, which means "show me the plan". */
export function detectExecuteRebalance(message: string): boolean {
  const m = message.trim();
  if (!m || m.length > 240) return false;
  if (!/\brebalance\b/i.test(m)) return false;
  return /\b(?:execute|place|run|perform|proceed|go\s+ahead|fire|submit)\b/i.test(m);
}

export interface RebalanceLeg {
  symbol: string;
  side: 'BUY' | 'SELL';
  dollarAmount: number;
}

/** Convert a rebalance plan into executable order legs (excludes the CASH bucket). */
export function rebalancePlanToLegs(plan: RebalancePlan): RebalanceLeg[] {
  return plan.lines
    .filter((l) => l.symbol && l.symbol.toUpperCase() !== 'CASH')
    .filter((l) => Math.abs(l.delta) >= 1)
    .map((l) => ({
      symbol: l.symbol.toUpperCase(),
      side: l.action === 'buy' ? ('BUY' as const) : ('SELL' as const),
      dollarAmount: Math.round(Math.abs(l.delta) * 100) / 100,
    }));
}

/** Build a markdown table of the executable trades (buys then sells; CASH excluded). */
function buildRebalanceTable(
  plan: RebalancePlan,
  includeTarget: boolean,
): { table: string; totalBuy: number; totalSell: number; count: number } {
  const buys = plan.lines
    .filter((l) => l.action === 'buy' && l.symbol.toUpperCase() !== 'CASH')
    .sort((a, b) => b.delta - a.delta);
  const sells = plan.lines
    .filter((l) => l.action === 'sell' && l.symbol.toUpperCase() !== 'CASH')
    .sort((a, b) => a.delta - b.delta);
  const header = includeTarget
    ? '| Action | Symbol | Holding | Amount | Target |\n|:---|:---|:---|---:|---:|'
    : '| Action | Symbol | Holding | Amount |\n|:---|:---|:---|---:|';
  const row = (l: RebalanceLine, action: string) =>
    includeTarget
      ? `| ${action} | **${l.symbol}** | ${l.name} | ${usd(l.delta)} | ${l.targetPercent}% |`
      : `| ${action} | **${l.symbol}** | ${l.name} | ${usd(l.delta)} |`;
  const table = [
    header,
    ...buys.map((l) => row(l, 'Buy')),
    ...sells.map((l) => row(l, 'Sell')),
  ].join('\n');
  return {
    table,
    totalBuy: buys.reduce((s, l) => s + l.delta, 0),
    totalSell: sells.reduce((s, l) => s + Math.abs(l.delta), 0),
    count: buys.length + sells.length,
  };
}

/** Preview text shown when the user says "execute the rebalance" (pre-confirm). */
export function formatRebalanceExecutionPreview(plan: RebalancePlan): string {
  const { table, totalBuy, totalSell, count } = buildRebalanceTable(plan, false);
  return [
    `Ready to rebalance to **${plan.styleName}** — ${count} trade${count === 1 ? '' : 's'}:`,
    '',
    table,
    '',
    `**Total:** buy ${usd(totalBuy)} · sell ${usd(totalSell)}.`,
    '',
    `⚠️ Nothing has run yet. Reply "confirm" to place these trades, or "cancel" to abort.`,
  ].join('\n');
}

/** Human label for a style key ("Lynch (Growth)"). */
export function styleLabel(style: string): string {
  return getStyleConfig(style).label;
}

export function formatTargetsOnlyAnswer(style: string): string {
  const { targets, styleName, description } = getInvestorStyleTargets(style);
  const lines = targets.map((t) => `• **${t.symbol}** (${t.name}) — ${t.targetPercent}%`).join('\n');
  return [
    `The **${styleName}** target allocation (${description}):`,
    '',
    lines,
  ].join('\n');
}

export function formatStyleChangeAnswer(style: string, risk: string): string {
  const cfg = getStyleConfig(style);
  const { targets, description } = getInvestorStyleTargets(style);
  const targetLines = targets.map((t) => `• **${t.symbol}** ${t.targetPercent}%`).join('\n');
  return [
    `✅ Done — your investor style is now **${cfg.label}**.`,
    '',
    description,
    '',
    `Target allocation:`,
    targetLines,
    '',
    `Your risk tolerance is still **${risk}**.`,
    '',
    `This now drives every screen, score, and recommendation. Want me to rebalance your portfolio to these targets? Just say "rebalance my portfolio."`,
  ].join('\n');
}

export function formatInvalidStyleAnswer(requested: string): string {
  return `I can't set your style to "${requested}" — the available styles are Buffett (Value), Lynch (Growth), Livermore (Momentum), Munger (Dividend), and Soros (Macro). Try "change my style to Lynch".`;
}

export function formatRebalancePlanAnswer(plan: RebalancePlan): string {
  if (plan.lines.length === 0) {
    return `Your portfolio is already aligned with the **${plan.styleName}** targets — no rebalancing trades needed.`;
  }
  const { table, totalBuy, totalSell, count } = buildRebalanceTable(plan, true);
  const cashLine = plan.lines.find((l) => l.symbol.toUpperCase() === 'CASH');

  const parts: string[] = [
    `Here's the rebalance plan to **${plan.styleName}** — ${plan.description}`,
    '',
    `Portfolio value: ${usd(plan.equity)} · Cash: ${usd(plan.cash)}`,
    '',
    table,
  ];
  if (cashLine && Math.abs(cashLine.delta) >= 1) {
    const to = usd(cashLine.currentValue + cashLine.delta);
    const note = cashLine.delta < 0
      ? `Cash: ${usd(cashLine.currentValue)} → ${to} — the buys above are funded from cash.`
      : `Cash: ${usd(cashLine.currentValue)} → ${to} — the sells above raise cash to target.`;
    parts.push('', note);
  }
  parts.push(
    '',
    `**Summary:** ${count} trades — ${usd(totalBuy)} to buy · ${usd(totalSell)} to sell.`,
    '',
    `⚠️ I haven't executed anything — this is a proposal. Say "execute the rebalance" to place these trades.`,
  );
  return parts.join('\n');
}

/**
 * Light-path grounding backstop: detect a portfolio/account total claim that
 * deviates >5% from the actual equity. Returns a correction note, or null.
 */
export function detectPortfolioTotalMismatch(text: string, actualEquity: number): string | null {
  if (!text || !actualEquity || actualEquity <= 0) return null;
  const patterns = [
    /(?:your\s+)?portfolio\s+(?:is\s+|totals?|worth|value(?:d)?\s+at?|valued\s+at)\s+\$?([\d,]+(?:\.\d+)?)/i,
    /(?:your\s+)?(?:total\s+)?(?:portfolio|account)\s+value\s+(?:is|of)?\s*\$?([\d,]+(?:\.\d+)?)/i,
    /(?:your\s+)?account\s+(?:is|totals?|worth|value(?:d)?\s+at?|valued\s+at)\s+\$?([\d,]+(?:\.\d+)?)/i,
  ];
  for (const p of patterns) {
    const m = p.exec(text);
    if (m) {
      const claimed = parseFloat(m[1].replace(/,/g, ''));
      if (Number.isFinite(claimed) && claimed > 0) {
        const diffPct = Math.abs(claimed - actualEquity) / actualEquity;
        if (diffPct > 0.05) {
          return `\n\n---\n⚠️ *Correction: your portfolio total is ${usd(actualEquity)}, not ${usd(claimed)}.*`;
        }
      }
    }
  }
  return null;
}
