// ─── Deterministic Account Actions & Grounding Helpers ───────
// Gives the AI Advisor a grounded way to handle account actions (change investor
// style, compute a rebalance plan) instead of hallucinating. Pure/read-only
// helpers live here; DB mutations happen in the chat route (which owns userId +
// service-role supabase). Also exports the light-path grounding backstop.
// ──────────────────────────────────────────────────────────────

import { getStyleConfig, getAllStyleLabels } from '@/lib/investor-style-defaults';
import { getInvestorStyleTargets, resolveRebalanceTargets, type AssetClass } from '@/lib/investor-style-targets';
import { getRiskTolerancePrompt } from '@/lib/ai/userProfile';

const VALID_STYLES = ['buffett', 'lynch', 'livermore', 'soros', 'munger'];

export type RiskLevel = 'Aggressive' | 'Conservative' | 'Moderate';

export interface PortfolioSnapshot {
  equity: number;
  cash: number;
  positions: Array<{
    symbol: string;
    name?: string;
    qty: number;
    price: number;
    marketValue: number;
    // Enriched fields (optional, backward-compatible) — powers the
    // deterministic tax-loss-harvesting analysis.
    avgCost?: number;
    unrealizedPnl?: number;
    buyDate?: string;
    type?: string;
  }>;
}

export type AccountAction =
  | { type: 'change_style'; style: string }
  | { type: 'invalid_style'; requested: string }
  | { type: 'rebalance'; style: string | null }
  | { type: 'change_and_rebalance'; style: string }
  | { type: 'change_style_ask' }
  | { type: 'change_risk'; risk: RiskLevel };

/** Style descriptors → canonical key ("value" → buffett, "growth" → lynch, …). */
const STYLE_SYNONYMS: Record<string, string> = {
  value: 'buffett',
  'value investing': 'buffett',
  moat: 'buffett',
  growth: 'lynch',
  garp: 'lynch',
  momentum: 'livermore',
  dividend: 'munger',
  dividends: 'munger',
  quality: 'munger',
  macro: 'soros',
};

/** Normalize a spoken style name ("Lynch", "warren buffett", "value") → key ("lynch"). */
export function normalizeStyle(input: string): string | null {
  const s = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/\b(warren|peter|george|charlie|benjamin|stanley|philip|john|jim)\b\s*/g, '')
    .trim();
  if (VALID_STYLES.includes(s)) return s;
  if (STYLE_SYNONYMS[s]) return STYLE_SYNONYMS[s];
  return null;
}

/**
 * Raw parse of an account-action message. Shared by `detectAccountAction` (the
 * legacy combined API, kept for tests/back-compat) and the Phase-1 confirm-only
 * extractors (`extractRiskTarget` / `extractStyleTarget` / `extractRebalanceTarget`)
 * so there is exactly ONE source of regex + precedence truth.
 */
interface AccountActionParse {
  hypothetical: boolean;
  styleMatch: RegExpExecArray | null;
  makeForm: boolean;
  rebalanceMatch: boolean;
  rawStyle: string | null;
  style: string | null;
  riskLevel: RiskLevel | null;
  hasRiskChange: boolean;
  noOpRiskChange: boolean;
  rebStyle: string | null;
  styleChangeAskMatch: boolean;
  styleAfterMatch: RegExpExecArray | null;
}

function parseAccountAction(
  message: string,
  context?: { riskTolerance?: string; investorStyle?: string }
): AccountActionParse | null {
  const m = message.trim();
  if (!m || m.length > 240) return null;

  const hypothetical = /\b(should|could|would|might|what if|how would|how do i|how to|how should|what happens if)\b/i.test(m);

  const styleMatch = /(?:please\s+)?(?:change|switch|set|move|update)\s+(?:(?:my|the|it)\s+)?(?:(?:investment|investor|trading|investing)\s+)?(?:style\s+)?(?:to|into)\s+([a-z][a-z\s]{1,24})/i.exec(m);
  // "make/turn it aggressive" / "make my style X" — the "make … X" form (no "to").
  const makeStyleMatch = /(?:please\s+)?(?:make|turn)\s+(?:(?:my|the|it|me|this|that)\s+)(?:(investment|investor|trading|investing|style)\s+)?([a-z][a-z\s]{1,24})/i.exec(m);
  const rebalanceMatch = /\brebalance\b/i.test(m);

  // "make/turn it X" / "make me X" is idiomatic English and only denotes a
  // style/risk command when X is a recognized risk or style word, or an explicit
  // "style/investor/..." qualifier is present. Otherwise ("make it count",
  // "make it matter") it's an idiom → fall through to the model.
  const makeTarget = makeStyleMatch ? makeStyleMatch[2] : null;
  const makeQualifier = makeStyleMatch ? makeStyleMatch[1] : null;
  const makeForm = makeTarget != null && (
    !!makeQualifier ||
    detectRiskLevel(makeTarget) !== null ||
    normalizeStyle(makeTarget) !== null
  );

  // "change my style" / "make my style" with NO target → ask which (style picker).
  const styleChangeAskMatch = /(?:please\s+)?(?:change|switch|set|move|update|make|turn)\s+(?:(?:my|the|it|me)\s+)?(?:(?:investment|investor|trading|investing)\s+)?style\b(?!\s+(?:to|into)\s+[a-z])/i.test(m);

  // "switch/change/move … to a (more/less) X style" — style AFTER the target.
  // ("switch me to a more aggressive style"). Anchored to a change verb so it never
  // fires on "rebalance to X style" (that's a rebalance target, handled separately).
  const styleAfterMatch = /\b(?:change|switch|set|move|update|make|turn|adjust|become)\b[^.!?]{0,30}?\b(?:to|into)\s+(?:a\s+|an\s+|more\s+|less\s+)?([a-z][a-z\s]{0,20}?)\s*style\b/i.exec(m);
  const styleMentioned = /\bstyle\b/i.test(m);

  const rawStyle = styleMatch ? styleMatch[1] : (makeForm ? makeTarget : (styleAfterMatch ? styleAfterMatch[1] : null));
  const style = rawStyle ? normalizeStyle(rawStyle) : null;

  // Risk-tolerance change. A risk word ("aggressive") only maps to RISK when the
  // message explicitly mentions risk OR uses a "more/less" comparative OUTSIDE the
  // "change … to X" form. "change to more aggressive" is a STYLE request (X is a
  // style target), while "make me more aggressive" / "change my risk to X" stay risk.
  const hasChangeVerb = /\b(change|set|switch|make|turn|update|adjust|become)\b/i.test(m);
  const riskLevel = detectRiskLevel(m);
  const explicitRisk = /\b(risk|tolerance|risk\s+tolerance|risk\s+profile|risk\s+level|risk\s+appetite)\b/i.test(m);
  const comparativeRisk = /\b(more|less)\b/i.test(m);
  const hasRiskChange = hasChangeVerb && riskLevel != null && !rebalanceMatch && !style && !styleMentioned && (explicitRisk || (comparativeRisk && !styleMatch));

  // Context-aware: a comparative ("more/less") risk change that is a NO-OP — the
  // target risk equals the current risk — can't be about risk. Reinterpret it as
  // a STYLE request (falls through to the style picker). Explicit "risk" mentions
  // are NOT reinterpreted ("change my risk to aggressive" stays a risk answer).
  const noOpRiskChange = !explicitRisk && comparativeRisk && !!context?.riskTolerance && !!riskLevel
    && riskLevel.toLowerCase() === context.riskTolerance.toLowerCase();

  // Rebalance target style: "rebalance ... to/into/as X"
  let rebStyle: string | null = null;
  if (rebalanceMatch) {
    const reb = /\brebalance\b.*?\b(?:to|into|as)\s+([a-z][a-z\s]{1,24})/i.exec(m);
    rebStyle = reb ? normalizeStyle(reb[1]) : null;
  }

  return {
    hypothetical, styleMatch, makeForm, rebalanceMatch, rawStyle, style,
    riskLevel, hasRiskChange, noOpRiskChange, rebStyle, styleChangeAskMatch, styleAfterMatch,
  };
}

/** Phase-1 confirm-only extractor: canonical risk level if this is an unambiguous
 *  risk-tolerance COMMAND, else null. Pure — no side effects. */
export function extractRiskTarget(
  message: string,
  context?: { riskTolerance?: string; investorStyle?: string }
): RiskLevel | null {
  const p = parseAccountAction(message, context);
  if (!p) return null;
  if (p.hasRiskChange && !p.noOpRiskChange && !p.hypothetical) return p.riskLevel;
  return null;
}

export type StyleExtraction =
  | { type: 'change_style'; style: string }
  | { type: 'invalid_style'; requested: string }
  | { type: 'change_style_ask' }
  | null;

/** Phase-1 confirm-only extractor: canonical style target (or an invalid-style /
 *  ask marker) if this is an unambiguous style COMMAND, else null. Pure. */
export function extractStyleTarget(
  message: string,
  context?: { riskTolerance?: string; investorStyle?: string }
): StyleExtraction {
  const p = parseAccountAction(message, context);
  if (!p) return null;
  if ((p.styleMatch || p.makeForm || p.styleAfterMatch) && p.rawStyle && !p.style && !p.rebalanceMatch) {
    return { type: 'invalid_style', requested: p.rawStyle.trim() };
  }
  const hasChange = (!!p.styleMatch || !!p.makeForm || !!p.styleAfterMatch) && !!p.style;
  if (hasChange && !p.hypothetical) return { type: 'change_style', style: p.style! };
  if (p.styleChangeAskMatch && !p.hypothetical) return { type: 'change_style_ask' };
  return null;
}

/** Phase-1 confirm-only extractor: whether a rebalance is requested and its
 *  optional target style. Pure — no side effects. */
export function extractRebalanceTarget(
  message: string,
  context?: { riskTolerance?: string; investorStyle?: string }
): { rebalance: boolean; rebStyle: string | null } {
  const p = parseAccountAction(message, context);
  if (!p) return { rebalance: false, rebStyle: null };
  return { rebalance: p.rebalanceMatch, rebStyle: p.rebStyle };
}

/**
 * Detect a clear account-action command. Returns null for questions/hypotheticals
 * (which fall through to the model) — so "how would the app react if I change my
 * style to Lynch?" never mutates the profile.
 *
 * Legacy combined API — kept for back-compat with existing tests. New call sites
 * should use the confirm-only extractors (`extractRiskTarget`, `extractStyleTarget`,
 * `extractRebalanceTarget`) keyed off the classifier's category.
 */
export function detectAccountAction(
  message: string,
  context?: { riskTolerance?: string; investorStyle?: string }
): AccountAction | null {
  const p = parseAccountAction(message, context);
  if (!p) return null;

  if (p.hasRiskChange && !p.noOpRiskChange && !p.hypothetical) return { type: 'change_risk', risk: p.riskLevel! };

  // Explicit "change style to <something>" but target isn't a valid style →
  // ask with buttons (invalid_style is rendered with the style picker).
  if ((p.styleMatch || p.makeForm || p.styleAfterMatch) && p.rawStyle && !p.style && !p.rebalanceMatch) {
    return { type: 'invalid_style', requested: p.rawStyle.trim() };
  }

  const hasChange = (!!p.styleMatch || !!p.makeForm || !!p.styleAfterMatch) && !!p.style;
  const hasRebalance = p.rebalanceMatch;

  if (hasChange && hasRebalance && !p.hypothetical) return { type: 'change_and_rebalance', style: p.style! };
  if (hasChange && !p.hypothetical) return { type: 'change_style', style: p.style! };
  if (hasRebalance && !p.hypothetical) return { type: 'rebalance', style: p.rebStyle };
  if (p.styleChangeAskMatch && !p.hypothetical) return { type: 'change_style_ask' };
  return null;
}

/** Map a risk-level word/phrase → canonical risk tolerance, or null. */
export function detectRiskLevel(m: string): RiskLevel | null {
  const match = /\b(aggressive|conservative|moderate|balanced|high[\s-]?risk|low[\s-]?risk|risk[\s-]?averse|risk[\s-]?taking|risky|cautious|safe)\b/i.exec(m);
  if (!match) return null;
  const w = match[1].toLowerCase().replace(/[\s-]+/g, ' ');
  if (/\b(aggressive|risky|risk taking|high risk)\b/.test(w)) return 'Aggressive';
  if (/\b(conservative|risk averse|cautious|safe|low risk)\b/.test(w)) return 'Conservative';
  if (/\b(moderate|balanced)\b/.test(w)) return 'Moderate';
  return null;
}

export interface RebalanceLine {
  symbol: string;
  name: string;
  targetPercent: number;
  currentValue: number;
  targetValue: number;
  delta: number;
  qty: number;
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
  /** True when the plan is a cash-only (buy-only, no sells) deployment. */
  cashOnly?: boolean;
  /** Custom dollar amount to deploy (buy-only) when a fixed budget was requested. */
  customAmount?: number;
  /** Asset class the plan targets: ETFs, individual stocks, or a 50/50 mix. */
  assetClass?: AssetClass;
}

/** Compute proposed rebalance trades (dollar deltas) from holdings → style targets. */
export function computeRebalancePlan(
  portfolio: PortfolioSnapshot | null,
  style: string,
  opts?: { cashOnly?: boolean; customAmount?: number; assetClass?: AssetClass },
): RebalancePlan {
  const { styleName, description } = getInvestorStyleTargets(style);
  const targets = resolveRebalanceTargets(style, opts?.assetClass);
  const equity = portfolio?.equity ?? 0;
  const cash = portfolio?.cash ?? 0;
  const positions = portfolio?.positions ?? [];

  // Buy-only budget mode (cash-only OR custom amount): deploy a fixed budget
  // across the target ETFs by their style weight. No sells, existing positions
  // untouched. The style's CASH bucket is the portion that stays in cash.
  const budget = opts?.customAmount != null ? opts.customAmount : opts?.cashOnly ? cash : null;
  if (budget != null) {
    const lines: RebalanceLine[] = targets
      .filter((t) => t.symbol.toUpperCase() !== 'CASH')
      .map((t) => {
        const targetValue = budget * t.targetPercent / 100;
        const action: 'buy' | 'hold' = targetValue >= 1 ? 'buy' : 'hold';
        return {
          symbol: t.symbol,
          name: t.name,
          targetPercent: t.targetPercent,
          currentValue: 0,
          targetValue,
          delta: targetValue,
          qty: 0,
          action,
        };
      })
      .filter((l) => l.action === 'buy');
    const totalBuy = lines.reduce((s, l) => s + l.delta, 0);
    return {
      styleName,
      description,
      equity,
      cash,
      lines,
      totalBuy,
      totalSell: 0,
      cashOnly: opts?.cashOnly ?? false,
      customAmount: opts?.customAmount,
      assetClass: opts?.assetClass,
    };
  }

  const lines: RebalanceLine[] = targets.map((t) => {
    const targetValue = equity * t.targetPercent / 100;
    let currentValue = 0;
    let qty = 0;
    if (t.symbol === 'CASH') {
      currentValue = cash;
    } else {
      const held = positions.filter((p) => (p.symbol || '').toUpperCase() === t.symbol.toUpperCase());
      currentValue = held.reduce((s, p) => s + (p.marketValue || (p.price || 0) * (p.qty || 0) || 0), 0);
      qty = held.reduce((s, p) => s + (p.qty || 0), 0);
    }
    const delta = targetValue - currentValue;
    const action: 'buy' | 'sell' | 'hold' = Math.abs(delta) < 1 ? 'hold' : delta > 0 ? 'buy' : 'sell';
    return { symbol: t.symbol, name: t.name, targetPercent: t.targetPercent, currentValue, targetValue, delta, qty, action };
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
        qty: p.qty || 0,
        action: 'sell' as const,
      };
    });

  const all = [...lines, ...orphanSells].filter((l) => l.action !== 'hold');
  const totalBuy = all.filter((l) => l.action === 'buy').reduce((s, l) => s + l.delta, 0);
  const totalSell = all.filter((l) => l.action === 'sell').reduce((s, l) => s + Math.abs(l.delta), 0);

  return { styleName, description, equity, cash, lines: all, totalBuy, totalSell, assetClass: opts?.assetClass };
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

// Bare approval/execution phrases that, in the context of a just-shown rebalance
// plan, mean "stage the rebalance execution preview". Users rarely repeat the
// word "rebalance" — they say "go ahead" / "do it" / "yes, execute now" — and
// `detectExecuteRebalance` (which requires the literal word) misses those.
const REBALANCE_FOLLOWUP_RE =
  /\b(?:go\s+ahead|do\s+it|do\s+that|run\s+it|make\s+it\s+so|place\s+(?:the\s+)?trades?|execute|proceed|approve|approved|confirm|confirmed|fire|submit|yes|yeah|yep|let'?s\s+go|lets\s+go)\b/i;

/**
 * Detect a follow-up approval to a rebalance plan the assistant just showed.
 * Only fires when the immediately-preceding assistant message is a rebalance
 * plan or preview ("Here's the rebalance plan…" / "Ready to rebalance…"), so a
 * bare "yes"/"go ahead" can't be misread in any other conversation.
 */
export function detectRebalanceFollowUp(
  messages: Array<{ role: string; content: string }>,
): boolean {
  if (!Array.isArray(messages) || messages.length === 0) return false;
  const last = (messages[messages.length - 1]?.content ?? '').trim();
  if (!last || last.length > 240) return false;
  if (!REBALANCE_FOLLOWUP_RE.test(last)) return false;
  const prevAssistant = [...messages]
    .reverse()
    .find((m) => m.role === 'assistant' || m.role === 'ai')?.content ?? '';
  return /rebalance\s+plan\s+to|ready\s+to\s+rebalance/i.test(prevAssistant);
}

/** Detect a "cash only" rebalance request — deploy available cash, no sells. */
export function detectCashOnlyRebalance(message: string): boolean {
  const m = message.trim();
  if (!m || m.length > 240) return false;
  if (!/\brebalance\b/i.test(m)) return false;
  return /\b(?:cash\s*[- ]?only|available\s+cash|only\s+cash|with\s+(?:my\s+)?cash|just\s+(?:the\s+)?cash)\b/i.test(m);
}

/**
 * True when the current turn is a cash-only rebalance context: either the user
 * literally said "cash only", or the assistant just showed a cash-only plan
 * (so a bare "execute the rebalance" carries the cash-only mode forward).
 */
export function isCashOnlyRebalanceContext(
  messages: Array<{ role: string; content: string }>,
): boolean {
  if (!Array.isArray(messages) || messages.length === 0) return false;
  const last = (messages[messages.length - 1]?.content ?? '').trim();
  if (detectCashOnlyRebalance(last)) return true;
  const prevAssistant = [...messages]
    .reverse()
    .find((m) => m.role === 'assistant' || m.role === 'ai')?.content ?? '';
  return /cash[- ]?only/i.test(prevAssistant);
}

/** Parse a dollar amount ("$5,000", "5000", "$5k", "5k", "$1.2m") → number, else null. */
export function parseCustomRebalanceAmount(message: string): number | null {
  const m = message.replace(/,/g, '');
  const match =
    m.match(/\$\s?(\d+(?:\.\d+)?)\s?([kKmM]?)/) ||
    m.match(/(\d+(?:\.\d+)?)\s?([kKmM])\b/);
  if (!match) return null;
  const n = parseFloat(match[1]);
  if (!isFinite(n) || n <= 0) return null;
  const suffix = (match[2] || '').toLowerCase();
  if (suffix === 'k') return Math.round(n * 1000);
  if (suffix === 'm') return Math.round(n * 1_000_000);
  return n;
}

/** Detect a "rebalance with $X" custom-amount request; returns the amount or null. */
export function detectCustomAmountRebalance(message: string): number | null {
  const m = message.trim();
  if (!m || m.length > 240) return null;
  if (!/\brebalance\b/i.test(m)) return null;
  return parseCustomRebalanceAmount(m);
}

/** Detect "rebalance with my full portfolio" (explicit full rebalance). */
export function detectFullPortfolioRebalance(message: string): boolean {
  const m = message.trim();
  if (!m || m.length > 240) return false;
  if (!/\brebalance\b/i.test(m)) return false;
  return /\b(?:full|entire|whole)\s+(?:portfolio|account|balance)\b|\ball\s+(?:of\s+)?(?:my\s+)?(?:portfolio|account)\b/i.test(m);
}

export interface ScopedRebalanceMode {
  cashOnly: boolean;
  customAmount: number | null;
  assetClass: AssetClass | null;
}

/**
 * Resolve the rebalance scope for the current turn: cash-only, a custom dollar
 * amount, or full portfolio — plus the asset class (ETFs / stocks / mix). Checks
 * the literal message first, then carries the mode forward from the prior
 * assistant plan/prompt text (so "execute the rebalance" after a scoped plan
 * re-uses the same scope).
 */
export function detectScopedRebalanceMode(
  messages: Array<{ role: string; content: string }>,
): ScopedRebalanceMode {
  const empty: ScopedRebalanceMode = { cashOnly: false, customAmount: null, assetClass: null };
  if (!Array.isArray(messages) || messages.length === 0) return empty;
  const last = (messages[messages.length - 1]?.content ?? '').trim();

  const lastAsset = detectAssetClass(last);

  if (detectCashOnlyRebalance(last)) return { cashOnly: true, customAmount: null, assetClass: lastAsset };
  const amt = detectCustomAmountRebalance(last);
  if (amt != null) return { cashOnly: false, customAmount: amt, assetClass: lastAsset };
  if (detectFullPortfolioRebalance(last)) return { ...empty, assetClass: lastAsset };

  const prevAssistant = [...messages]
    .reverse()
    .find((m) => m.role === 'assistant' || m.role === 'ai')?.content ?? '';
  const carry: ScopedRebalanceMode = { cashOnly: false, customAmount: null, assetClass: null };
  if (/cash[- ]?only/i.test(prevAssistant)) carry.cashOnly = true;
  if (/custom\s*(?:rebalance|amount)/i.test(prevAssistant)) {
    const prevAmt = parseCustomRebalanceAmount(prevAssistant);
    if (prevAmt != null) carry.customAmount = prevAmt;
  }
  carry.assetClass = detectAssetClass(last) || detectAssetClass(prevAssistant);
  return carry;
}

/** Phase-1 confirm-only extractor: rebalance scope (cash-only / custom amount /
 *  full portfolio + asset class). Alias of `detectScopedRebalanceMode` — pure. */
export const extractRebalanceScope = detectScopedRebalanceMode;

/** Detect an asset-class choice (ETF / stock / mix) in a rebalance message. */
export function detectAssetClass(message: string): AssetClass | null {
  const m = (message || '').toLowerCase();
  if (!m || m.length > 240) return null;
  // "mix" / "both" / ETF+stock together → mix
  if (/\bmix\b/.test(m) || /\bboth\b/.test(m) || (/\betfs?\b/.test(m) && /\bstocks?\b/.test(m))) {
    return 'mix';
  }
  if (/\bstocks?\b/.test(m) || /\bequities\b/.test(m) || /individual\s+stocks?/.test(m)) return 'stock';
  if (/\betfs?\b/.test(m)) return 'etf';
  return null;
}

/** Asset-class prompt shown after the budget is chosen (before computing the plan). */
export function formatAssetClassPrompt(
  scope: 'cash-only' | 'custom' | 'full',
  customAmount?: number,
): string {
  const scopeLine =
    scope === 'cash-only'
      ? '**Cash-only rebalance** — deploy only your available cash.'
      : scope === 'custom'
        ? `**Custom rebalance** — deploy ${usd(customAmount ?? 0)}.`
        : '**Full portfolio rebalance** — rebalance your entire account.';
  return [
    `${scopeLine} What do you want to put the money into?`,
    '',
    `Choose one below 👇`,
  ].join('\n');
}

/** Budget-selection prompt shown when the user asks to rebalance (no scope given). */
export function formatRebalanceBudgetPrompt(
  portfolio: PortfolioSnapshot | null,
  style: string,
): string {
  const { styleName } = getInvestorStyleTargets(style);
  const cash = portfolio?.cash ?? 0;
  const equity = portfolio?.equity ?? 0;
  return [
    `Let's rebalance to **${styleName}**. How much do you want to put to work?`,
    '',
    `• Available cash: ${usd(cash)}`,
    `• Full portfolio value: ${usd(equity)}`,
    '',
    `Choose one below 👇`,
  ].join('\n');
}

export interface RebalanceLeg {
  symbol: string;
  side: 'BUY' | 'SELL';
  dollarAmount: number;
  shares?: number | null;
}

/** Convert a rebalance plan into executable order legs (excludes the CASH bucket). */
export function rebalancePlanToLegs(plan: RebalancePlan): RebalanceLeg[] {
  return plan.lines
    .filter((l) => l.symbol && l.symbol.toUpperCase() !== 'CASH')
    .filter((l) => Math.abs(l.delta) >= 1)
    .map((l) => {
      const side: 'BUY' | 'SELL' = l.action === 'buy' ? 'BUY' : 'SELL';
      const dollarAmount = Math.round(Math.abs(l.delta) * 100) / 100;
      // Sells are full liquidations of non-target holdings → use the EXACT held
      // share count (not a notional dollar amount). A notional sell gets
      // converted back to fractional shares by the broker, which can round to
      // slightly MORE than the held quantity → "insufficient qty available".
      if (side === 'SELL') {
        return { symbol: l.symbol.toUpperCase(), side, dollarAmount, shares: l.qty || null };
      }
      return { symbol: l.symbol.toUpperCase(), side, dollarAmount };
    });
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
  if (plan.cashOnly) {
    return [
      `Ready to execute the **cash-only** rebalance to **${plan.styleName}** — ${count} buy${count === 1 ? '' : 's'}:`,
      '',
      table,
      '',
      `**Total:** buy ${usd(totalBuy)}.`,
      '',
      `⚠️ Nothing has run yet. Reply "confirm" to place these trades, or "cancel" to abort.`,
    ].join('\n');
  }
  if (plan.customAmount != null) {
    return [
      `Ready to execute the **custom** rebalance to **${plan.styleName}** — deploy ${usd(plan.customAmount)} across ${count} buy${count === 1 ? '' : 's'}:`,
      '',
      table,
      '',
      `**Total:** buy ${usd(totalBuy)}.`,
      '',
      `⚠️ Nothing has run yet. Reply "confirm" to place these trades, or "cancel" to abort.`,
    ].join('\n');
  }
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
  const riskish = /\b(aggressive|conservative|moderate|balanced|risk|more|less)\b/i.test(requested);
  if (riskish) {
    return `That's a risk level, not a style — but I can switch your investor style. Pick one below (Livermore Momentum and Soros Macro are the most aggressive):`;
  }
  return `"${requested}" isn't one of the predefined investor styles — pick one below and I'll update your profile.`;
}

/** Risk-tolerance change confirmation (deterministic, grounded in the risk lens). */
export function formatRiskChangeAnswer(risk: RiskLevel): string {
  return [
    `✅ Your risk tolerance is now **${risk}**.`,
    '',
    getRiskTolerancePrompt(risk),
    '',
    `This now drives how I size positions and frame risk across Vantage. Want me to rebalance your portfolio to match? Just say "rebalance".`,
  ].join('\n');
}

/** Read-only, deterministic account-state answer (cash / equity / positions). */
export function buildAccountStateAnswer(snapshot: PortfolioSnapshot, risk: string): string {  const usd = (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const sorted = [...snapshot.positions].sort((a, b) => b.marketValue - a.marketValue);
  const lines = [
    `Here's your account as it stands now:`,
    '',
    `- **Equity:** ${usd(snapshot.equity)}`,
    `- **Cash:** ${usd(snapshot.cash)}`,
    `- **Positions:** ${sorted.length} held`,
  ];
  if (sorted.length > 0) {
    lines.push('', 'Top positions:');
    for (const p of sorted.slice(0, 6)) {
      lines.push(`- ${p.symbol}${p.name ? ` (${p.name})` : ''} — ${usd(p.marketValue)} · ${p.qty} @ ${usd(p.price)}`);
    }
  }
  lines.push('', `Risk tolerance: **${risk}**.`);
  return lines.join('\n');
}

/**
 * Detect a tax-loss-harvesting / tax-check intent on MY portfolio.
 * Distinct from educational tax questions ("what's the capital gains rate?").
 * Returns true for "run a tax check", "tax-loss harvesting", "harvest my
 * losses", "wash sale" analysis, etc.
 */
export function detectTaxLossHarvestIntent(message: string): boolean {
  const s = (message || '').trim().toLowerCase();
  if (!s || s.length > 300) return false;
  // Definitional / conceptual tax questions ("what is a wash sale", "how does
  // the wash-sale rule work", "what's the capital gains tax rate") are
  // educational — NOT a request to analyze MY holdings. Let those reach the model.
  if (/\b(what\s+(is|are|does)|how\s+does|define|explain|meaning\s+of|whats?\s+(a|the|is))\b/.test(s)) return false;
  if (/tax[\s-]?loss/.test(s)) return true;
  if (/\bharvest(?:ing)?\b/.test(s) && /(loss|tax|wash)/.test(s)) return true;
  if (/\bwash\s+sale\b/.test(s)) return true;
  if (/\btax\b/.test(s) && /\b(unrealized|unrealised)\s+loss/.test(s)) return true;
  if (/\btax\s+(check|review|audit|harvest|optimiz\w*)\b/.test(s) && /\b(portfolio|positions|holdings|my)\b/.test(s)) return true;
  return false;
}

/**
 * Deterministic tax-loss-harvesting analysis from the live portfolio snapshot.
 * Lists unrealized-loss positions (harvest candidates), flags wash-sale risk
 * (bought within the last 30 days), and surfaces year-end optimization moves.
 * Read-only — never mutates anything.
 */
export function buildTaxLossHarvestAnswer(snapshot: PortfolioSnapshot): string {
  const usd = (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const positions = snapshot.positions || [];

  const enriched = positions.map((p) => {
    const unrealized = p.unrealizedPnl ?? (p.avgCost != null ? (p.price - p.avgCost) * p.qty : null);
    const costTotal = p.avgCost != null ? p.avgCost * p.qty : null;
    const pct = unrealized != null && costTotal && costTotal > 0 ? (unrealized / costTotal) * 100 : null;
    const daysSinceBuy = p.buyDate ? Math.floor((Date.now() - new Date(p.buyDate).getTime()) / 86400000) : null;
    return { ...p, unrealized, pct, daysSinceBuy };
  });

  const losers = enriched
    .filter((p) => p.unrealized != null && p.unrealized < 0)
    .sort((a, b) => (a.unrealized as number) - (b.unrealized as number));

  const totalHarvestable = losers.reduce((s, p) => s + (p.unrealized ?? 0), 0);
  const estSavings = Math.abs(totalHarvestable) * 0.2; // ~20% blended federal rate

  if (losers.length === 0) {
    return [
      `Good news — I scanned your ${positions.length} position${positions.length === 1 ? '' : 's'} and found **no unrealized losses** to harvest right now.`,
      '',
      `Year-end tax moves to keep in mind:`,
      `- **Defer gains** — avoid realizing new short-term gains before year-end if you can push them into January.`,
      `- **Max retirement contributions** — pre-tax 401(k)/IRA contributions before year-end lower this year's taxable income.`,
      `- **Mind the wash-sale rule** — if you do harvest later, don't rebuy the same (or "substantially identical") security within 30 days.`,
    ].join('\n');
  }

  const lines: string[] = [
    `Here's your **tax-loss harvesting** scan — ${losers.length} position${losers.length === 1 ? '' : 's'} with unrealized losses you could harvest:`,
    '',
  ];
  for (const p of losers.slice(0, 8)) {
    const pctTxt = p.pct != null ? ` (${p.pct.toFixed(1)}%)` : '';
    const washFlag =
      p.daysSinceBuy != null && p.daysSinceBuy < 30
        ? ` ⚠️ bought ${p.daysSinceBuy}d ago — still in the wash-sale window, wait before harvesting`
        : '';
    lines.push(`- **${p.symbol}** — ${usd(p.unrealized as number)}${pctTxt} · ${p.qty} shares${washFlag}`);
  }
  lines.push('', `**Total harvestable loss:** ${usd(totalHarvestable)} → ~**${usd(estSavings)}** estimated federal tax savings (assumes a ~20% blended rate).`);
  lines.push('', '**Year-end moves to consider:**');
  lines.push('1. **Harvest the losses above** — sell to realize the loss, then redeploy into a *non-identical* replacement (e.g. swap an individual stock for a sector ETF) to stay invested.');
  lines.push('2. **Respect the wash-sale rule** — any position bought in the last 30 days can\'t be harvested cleanly; wait 30 days from the last buy.');
  lines.push('3. **Offset gains first** — realized losses offset realized capital gains dollar-for-dollar, then up to $3,000 of ordinary income per year (excess carries forward).');
  lines.push('4. **Defer new gains** — if you hold winners, consider realizing them in January rather than December.');
  lines.push('5. **Max retirement contributions** — pre-tax 401(k)/IRA contributions before year-end lower this year\'s taxable income.');
  return lines.join('\n');
}

/**
 * Detect a read-only account-state query (cash / equity / balance / buying
 * power / net worth / "how am I doing"). Deterministic backstop for the
 * account_state taxonomy — the classifier mislabels "whats my account balance"
 * → single_security_research and "whats my situation" → market_commentary, so
 * these common phrasings are answered before the LLM can mis-route them.
 *
 * Deliberately excludes trade/research instructions about a specific security
 * ("how much cash should i invest in nvda", "buy $100 worth of voo") and
 * company fundamentals ("apple balance sheet", "meta debt situation").
 */
export function detectAccountStateIntent(m: string): boolean {
  const s = m.trim().toLowerCase();
  if (!s || s.length > 240) return false;

  // Trade / research about a specific security is NOT account state.
  if (/\b(?:invest\s+(?:in|into)|buy|sell|purchase|trade)\b/.test(s)) return false;

  // Rebalance / deployment commands are ACTIONS, not balance queries.
  // "rebalance for the available cash" / "deploy my available cash" use
  // "available cash" as the SCOPE of the action, not the thing being asked
  // about. They must route to the rebalance path, not a cash-balance readout.
  if (/\b(?:rebalance|deploy|allocate)\b/.test(s)) return false;

  // Company fundamentals (not MY account).
  if (/\b(?:balance\s*sheet|debt\s*situation)\b/.test(s)) return false;

  // Strong account nouns (unambiguous in a finance chat).
  const strong = /\b(?:account\s*balance|current\s*balance|portfolio\s*balance|cash\s*balance|overall\s*balance|available\s*cash|cash\s*position|reserved\s*funds?|buy(?:ing|in)\s*power|spending\s*power|net\s*worth|account\s*(?:value|worth)|portfolio\s*(?:value|worth)|total\s*(?:account\s*value|portfolio\s*value|invested)|(?:my|current|total|account)\s+equity)\b/;
  if (strong.test(s)) return true;

  // "cash" with an ownership/inquiry signal.
  if (/\bcash\b/.test(s) && /\b(my|mine|i\s+have|i've|i\s+got|do\s+i\s+have|have\s+i\s+got|have\s+left|\bleft\b|available|reserved|sitting|position|in\s+my\s+account|how\s+much|whats?\s+my)\b/.test(s)) return true;

  // "reserved" (cash) on its own — "how much is reserved right now".
  if (/\breserved\b/.test(s)) return true;

  // "funds" with ownership ("reserved funds", "how much do i have in funds").
  if (/\bfunds?\b/.test(s) && /\b(reserved|available|my|mine|i\s+have|do\s+i\s+have|in\s+my\s+account|how\s+much|have\s+i\s+got)\b/.test(s)) return true;

  // "money" specifically about account balance (NOT "losing money" / "money move").
  if (/\bmoney\b/.test(s) && /\b(in\s+my\s+account|is\s+in\s+my\s+account|do\s+i\s+have|have\s+i\s+got|going\s+on\s+with\s+my|have\s+total|to\s+invest)\b/.test(s)) return true;

  // "invested" total / amount.
  if (/\b(invested\s+(?:total|amount)|total\s+invested)\b/.test(s)) return true;

  // Vague account-health probes (safe — don't collide with tickers).
  if (/\b(how\s+(?:am\s+)?i\s+doing|hows?\s+my\s+account|whats?\s+going\s+on\s+with\s+my\s+money|whats?\s+my\s+situation|total\s+damage|what\s+do\s+i\s+own|sitting\s+in\s+my\s+account)\b/.test(s)) return true;

  // "how much am i worth / working with / got in here / got to spend".
  if (/\bhow\s+much\s+(?:am\s+i\s+worth|am\s+i\s+working\s+with|have\s+i\s+got\s+in\s+here|have\s+i\s+got\s+to\s+spend)\b/.test(s)) return true;

  // "how much do i have" / "how much have i got" as a COMPLETE query — not
  // "how much do i have in nvda" (position size in a single security).
  if (/\bhow\s+much\s+(?:do\s+i\s+have|have\s+i\s+got|i\s+have)\s*$/i.test(s)) return true;

  return false;
}

// ── Scheduled / queued activity (DCA + open orders) ─────────────────────────

/** Detect "what are my scheduled/pending/open/recurring buys or orders" queries. */
/**
 * True when the message is a DCA / recurring-buy CREATION command ("set up a
 * DCA plan", "create a recurring buy", "start a weekly DCA", "schedule a
 * monthly investment"). These are ACTIONS for the tool path (previewDcaCreate
 * → dca_create), NOT read-only "show me my schedule" queries — so the
 * scheduled-activity router (deterministic AND classifier) must let them fall
 * through to the model instead of returning a schedule listing.
 */
export function isDcaCreationCommand(m: string): boolean {
  const s = m.trim().toLowerCase();
  if (!s || s.length > 240) return false;
  if (/\b(set\s*up|create|start|begin|establish|initiate|launch|make|add)\b/.test(s) && /\b(dca|dollar[\s-]?cost[\s-]?averaging|recurring|automatic(?:al)?ly?|auto[\s-]?(?:invest|buy)|weekly|monthly|daily|scheduled)\b/.test(s)) return true;
  if (/\bschedule\b/.test(s) && /\b(?:a|an|some|the)?\s*(?:dca|dollar[\s-]?cost[\s-]?averaging|recurring|weekly|monthly|daily|automatic|regular)\s*(?:buy|invest|plan|contribution)?\b/.test(s)) return true;
  return false;
}

export function detectScheduledActivityIntent(m: string): boolean {
  const s = m.trim().toLowerCase();
  if (!s || s.length > 240) return false;

  // Mutation commands on scheduled items ("cancel my DCA", "delete the open
  // order", "pause my recurring buys") are ACTIONS for the tool path (dca_delete
  // / order cancel), not "show me my schedule" queries. Don't intercept them as
  // a read-only listing. ("stop" deliberately excluded — "stop loss order" is a
  // legit read-only status query.)
  if (/\b(cancel|delete|remove|pause|deactivate|turn\s*off)\b/.test(s) && /\b(dca|dollar|order|buy|trade|schedule|recurring|investment|plan|alert)\b/.test(s)) return false;

  // DCA / recurring-buy CREATION commands are tool-path actions, not listings.
  if (isDcaCreationCommand(s)) return false;

  // Gains/returns/P&L math ("realized gain from DCA fills", "what did my DCA
  // earn") is a computation, not a schedule listing — let the model answer it
  // rather than returning a DCA/order list that doesn't answer the question.
  if (/\b(gains?|returns?|profit|earn(?:ed|s)?|made|yield|p&l|performance|appreciation)\b/.test(s)) return false;

  // Educational definitions are NOT scheduled activity — "explain DCA",
  // "what is dollar cost averaging", "what's a dca" (no ownership/next/when signal).
  const definitional = /\b(what\s+is|whats|what's|explain|define|meaning|mean|tell\s+me\s+(about|how)|how\s+(does|do|to))\b/;
  const mentionsDca = /\b(dca|dollar[\s-]?cost[\s-]?averaging)\b/.test(s);
  if (mentionsDca) {
    const ownsDca = /\b(my|mine|i\s+have|next|when|schedule|plan|active|running|set\s*up|have\s+any|any)\b/.test(s);
    if (definitional.test(s) && !ownsDca) return false;
    return true;
  }

  // "scheduled buys" / "pending orders" / "open orders" / "recurring buys" / "queued trades"
  if (/\b(scheduled|pending|open|recurring|queued|upcoming)\s+(buys?|purchases?|orders?|trades?|investments?|activity)\b/.test(s)) return true;
  // "what's scheduled/pending/queued" (order noun may be elsewhere in the sentence).
  if (/(what'?s?|wuts?|wats?|any|show|list|see|check)\b.*\b(scheduled|pending|queued|recurring)\b/.test(s)) return true;
  // "what am I waiting to fill" / "still waiting to execute" / "waiting to go
  // through". Gerund "waiting" only — bare "wait" is usually a timing question
  // ("should I wait to buy") that must route to research, not to the schedule.
  if (/\b(waiting|still\s+waiting|waiting\s+(?:on|for))\b.*\b(fill|filled|execute|executed|order|trade|go\s*(through|thru)|clear)\b/.test(s)) return true;
  // Order status: "did my order go through", "when does my next order execute",
  // "did my order go thru yet", "did my sell order clear".
  if (/\b(did|when|does|is|has|will)\b.*\b(order|buy|trade|purchase|fill)\b.*\b(go\s*(through|thru)|execute|executed|fill|filled|clear|cleared|happen|complete)\b/.test(s)) return true;
  return false;
}

// ── Order history (executed/filled trades over a time window) ─────────────

/**
 * Parse a time window for a trade-history query into a `since` Date.
 * Returns `null` when no explicit window is given (caller decides the default).
 * Handles: "last week/month/year", "last 30 days", "this week", "over the
 * past month", "recent/recently/today".
 */
export function parseOrderHistoryWindow(m: string): Date | null {
  const s = m.trim().toLowerCase();
  const now = new Date();
  const days = (n: number) => { const d = new Date(now); d.setDate(d.getDate() - n); d.setHours(0, 0, 0, 0); return d; };

  const num = s.match(/\blast\s+(\d+)\s+(days?|weeks?|months?|years?)\b/);
  if (num) {
    const n = parseInt(num[1], 10) || 1;
    const u = num[2];
    if (u.startsWith('day')) return days(n);
    if (u.startsWith('week')) return days(n * 7);
    if (u.startsWith('month')) return days(n * 30);
    if (u.startsWith('year')) return days(n * 365);
  }

  const unit = s.match(/\b(?:this|past|over\s+the|last)\s+(week|month|year)\b/);
  if (unit) {
    const u = unit[1];
    if (u === 'week') return days(7);
    if (u === 'month') return days(30);
    if (u === 'year') return days(365);
  }

  if (/\b(?:recently|today)\b/.test(s)) return days(1);
  if (/\brecent\b/.test(s)) return days(7);
  return null;
}

/** Human label for the parsed window ("in the last week", "in the last 30 days", "recently"). */
export function orderHistoryWindowLabel(m: string): string {
  const s = m.trim().toLowerCase();
  const num = s.match(/\blast\s+(\d+)\s+(days?|weeks?|months?|years?)\b/);
  if (num) return `in the last ${num[1]} ${num[2].replace(/s$/, '')}${num[1] === '1' ? '' : 's'}`;
  const unit = s.match(/\b(?:this|past|over\s+the|last)\s+(week|month|year)\b/);
  if (unit) return `in the last ${unit[1]}`;
  if (/\brecently\b/.test(s)) return 'recently';
  if (/\brecent\b/.test(s)) return 'in the last week';
  return '';
}

/**
 * Detect a read-only "what did I trade/buy/sell over [window]" history query
 * ("orders executed last week", "recent trades", "trade history", "what did I
 * buy this month"). Complementary to detectScheduledActivityIntent (open/pending
 * orders) — this one is about COMPLETED/EXECUTED orders. Deterministic backstop
 * because the classifier mislabels these as account_state ("orders executed"
 * reads like a balance probe to GPT-5 nano) and returns the account summary.
 */
export function detectOrderHistoryIntent(m: string): boolean {
  const s = m.trim().toLowerCase();
  if (!s || s.length > 240) return false;

  // Mutations (cancel/delete/modify an order) are tool-path actions, not a listing.
  if (/\b(cancel|delete|remove|pause|modify|change|edit)\b/.test(s) && /\b(order|trade|buy|sell)\b/.test(s)) return false;
  // DCA creation commands → structured form, not a history listing.
  if (isDcaCreationCommand(s)) return false;
  // Open/pending/scheduled/queued → the scheduled-activity router (runs first).
  if (/\b(open|pending|scheduled|queued|upcoming|waiting)\s+(orders?|trades?|buys?|fills?)\b/.test(s)) return false;
  // Future-tense scheduling ("orders for next week", "trades coming up") is
  // NOT executed history.
  if (/\b(next\s+(week|month|year)|upcoming|tomorrow|coming\s+up|in\s+the\s+future)\b/.test(s)) return false;
  // Educational definitions without an ownership signal.
  if (/\b(what\s+is|whats|what's|explain|define|meaning|how\s+(does|do|to))\b/.test(s) && /\b(order|trade)\b/.test(s) && !/\b(my|mine|i\s+have|i've|did\s+i|have\s+i|i\s+made|my\s+account)\b/.test(s)) return false;

  // Explicit "trade/order/transaction history".
  if (/\b(?:trade|order|transaction|activity)\s*history\b/.test(s)) return true;
  // Recency word + trade noun ("recent trades", "orders in the last week", "trades this month").
  if (/\b(?:recent|recently|past|last|this)\b/.test(s) && /\b(trades?|orders?|transactions?|buys?|sells?|purchases?|fills?)\b/.test(s)) return true;
  // "orders executed/filled/completed/went through" (with or without a window).
  if (/\borders?\b/.test(s) && /\b(executed|filled|completed|closed|went\s+(through|thru)|filled\s+in)\b/.test(s)) return true;
  // "what did I buy/sell", "what have I bought/sold/traded".
  if (/\b(what|which)\b/.test(s) && /\b(did\s+i|have\s+i|i've|i\s+have)\b/.test(s) && /\b(buy|bought|sell|sold|trade|traded|purchase|purchased)\b/.test(s)) return true;
  // "my trades/orders this week", "orders over the last month".
  if (/\b(?:my|i)\b/.test(s) && /\b(trades?|orders?)\b/.test(s) && /\b(in|over|during|for|since|this|last|past)\b/.test(s)) return true;
  return false;
}

export interface OrderHistoryRow {
  symbol: string;
  companyName?: string | null;
  side: 'buy' | 'sell';
  qty: number | null;
  filledQty: number | null;
  status: string;
  filledPrice: number | null;
  notional: number | null;
  filledAt: string | null;
  createdAt: string | null;
}

function formatOrderHistoryDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  } catch { return '—'; }
}

/** Read-only, deterministic answer listing executed orders over a window. */
export function buildOrderHistoryAnswer(orders: OrderHistoryRow[], windowLabel: string): string {
  const usd = (n: number | null | undefined) =>
    n == null ? null : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
  if (orders.length === 0) {
    return `You have no executed orders${windowLabel ? ` ${windowLabel}` : ''} — nothing has filled recently.`;
  }
  const lines = [`Here are your executed orders${windowLabel ? ` ${windowLabel}` : ''}:`];
  for (const o of orders) {
    const side = o.side === 'buy' ? 'Bought' : 'Sold';
    const qty = o.filledQty != null ? Number(o.filledQty) : (o.qty != null ? Number(o.qty) : null);
    const shares = qty != null ? `${Number(qty).toLocaleString('en-US', { maximumFractionDigits: 4 })} sh` : null;
    const price = usd(o.filledPrice);
    const notional = usd(o.notional);
    const name = o.companyName ? ` (${o.companyName})` : '';
    const date = formatOrderHistoryDate(o.filledAt || o.createdAt);
    const detail = notional
      ? `${notional}`
      : price && shares
        ? `${price} · ${shares}`
        : shares || price || '—';
    lines.push(`- ${side} ${o.symbol}${name} — ${detail} · ${date}`);
  }
  lines.push('', 'Want a longer window (e.g. "last 30 days") or just buys/sells?');
  return lines.join('\n');
}

export interface ScheduledDca {
  symbol: string;
  amount: number | null;
  frequency: string | null;
  dayOfWeek?: string;
  dayOfMonth?: string;
  endDate?: string | null;
  nextRunAt: string | null;
  isActive: boolean;
}

export interface QueuedOrder {
  symbol: string;
  side: 'buy' | 'sell';
  qty: number | null;
  notional: number | null;
  status: string;
  createdAt: string | null;
}

function formatDcaFrequency(freq: string | null, dayOfWeek?: string, dayOfMonth?: string): string {
  switch (freq) {
    case 'daily': return 'daily';
    case 'weekly': return dayOfWeek ? `weekly (${dayOfWeek})` : 'weekly';
    case 'biweekly': return dayOfWeek ? `every 2 weeks (${dayOfWeek})` : 'every 2 weeks';
    case 'monthly': return dayOfMonth ? `monthly (day ${dayOfMonth})` : 'monthly';
    default: return freq || 'recurring';
  }
}

function formatDcaDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  } catch { return '—'; }
}

/** Read-only, deterministic answer listing DCA schedules + open/queued orders. */
export function buildScheduledActivityAnswer(dcas: ScheduledDca[], orders: QueuedOrder[]): string {
  const usd = (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const active = dcas.filter((d) => d.isActive);
  const paused = dcas.filter((d) => !d.isActive);

  if (active.length === 0 && paused.length === 0 && orders.length === 0) {
    return [
      `You don't have any scheduled buys or open orders right now.`,
      '',
      `To start a recurring buy, tell me something like "invest $100 weekly into VOO" and I'll stage the schedule for your confirmation.`,
    ].join('\n');
  }

  const lines: string[] = [`Here's your scheduled and queued activity:`];

  if (active.length > 0) {
    lines.push('', '**Recurring buys (DCA)**');
    for (const d of active) {
      const freq = formatDcaFrequency(d.frequency, d.dayOfWeek, d.dayOfMonth);
      const next = d.nextRunAt ? formatDcaDate(d.nextRunAt) : 'not scheduled';
      const end = d.endDate ? ` · ends ${formatDcaDate(d.endDate)}` : '';
      lines.push(`- ${d.symbol}: ${usd(d.amount ?? 0)} ${freq} · next ${next}${end}`);
    }
  }

  if (paused.length > 0) {
    lines.push('', '**Paused DCA**');
    for (const d of paused) {
      lines.push(`- ${d.symbol}: ${usd(d.amount ?? 0)} ${formatDcaFrequency(d.frequency, d.dayOfWeek, d.dayOfMonth)} (paused)`);
    }
  }

  if (orders.length > 0) {
    lines.push('', '**Open orders (waiting to fill)**');
    for (const o of orders) {
      const side = o.side === 'buy' ? 'Buy' : 'Sell';
      const amount = o.notional != null
        ? usd(o.notional)
        : o.qty != null
          ? `${Number(o.qty).toLocaleString('en-US', { maximumFractionDigits: 4 })} sh`
          : '—';
      lines.push(`- ${side} ${o.symbol}: ${amount} · ${o.status}`);
    }
  }

  lines.push('', 'Orders fill at the next market open; DCA buys run automatically on their schedule.');
  return lines.join('\n');
}

/** Ask which style to switch to (when the user said "change my style" with no target). */
export function formatStylePickPrompt(currentStyle: string): string {
  const current = getStyleConfig(currentStyle).label;
  const labels = getAllStyleLabels().map((s) => s.label);
  return [
    `You're currently on **${current}**. Which investor style would you like to switch to?`,
    '',
    labels.map((l) => `• ${l}`).join('\n'),
    '',
    `Pick one below and I'll update your profile — then I can analyze your portfolio against the new style and rebalance if you want.`,
  ].join('\n');
}

export function formatRebalancePlanAnswer(plan: RebalancePlan): string {
  if (plan.lines.length === 0) {
    if (plan.customAmount != null) {
      return `That amount is too small to split into the **${plan.styleName}** targets (each buy would be under $1). Try a larger amount, or say "rebalance my portfolio" for the full plan.`;
    }
    return plan.cashOnly
      ? `You have no available cash to deploy right now. Once your pending orders fill or you add cash, say "rebalance using cash only" again.`
      : `Your portfolio is already aligned with the **${plan.styleName}** targets — no rebalancing trades needed.`;
  }
  const { table, totalBuy, totalSell, count } = buildRebalanceTable(plan, true);
  if (plan.cashOnly) {
    const remaining = Math.max(0, plan.cash - totalBuy);
    return [
      `Here's the **cash-only** rebalance plan to **${plan.styleName}** — deploy your available cash across the target ${plan.assetClass === 'stock' ? 'stocks' : plan.assetClass === 'mix' ? 'ETFs and stocks' : 'ETFs'} (no sells, existing positions untouched):`,
      '',
      `Available cash: ${usd(plan.cash)}`,
      '',
      table,
      '',
      `**Summary:** ${count} buy${count === 1 ? '' : 's'} — ${usd(totalBuy)} to deploy · ${usd(remaining)} stays in cash.`,
      '',
      `⚠️ I haven't executed anything. Say "execute the rebalance" to place these buys.`,
    ].join('\n');
  }
  if (plan.customAmount != null) {
    const remaining = Math.max(0, plan.customAmount - totalBuy);
    return [
      `Here's the **custom rebalance** plan to **${plan.styleName}** — deploy ${usd(plan.customAmount)} across the target ${plan.assetClass === 'stock' ? 'stocks' : plan.assetClass === 'mix' ? 'ETFs and stocks' : 'ETFs'} (no sells, existing positions untouched):`,
      '',
      table,
      '',
      `**Summary:** ${count} buy${count === 1 ? '' : 's'} — ${usd(totalBuy)} to deploy · ${usd(remaining)} stays in cash.`,
      '',
      `⚠️ I haven't executed anything. Say "execute the rebalance" to place these buys.`,
    ].join('\n');
  }
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
