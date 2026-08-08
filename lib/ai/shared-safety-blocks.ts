// ─── Shared AI Safety Blocks ───────────────────────────────────────────
// Centralized anti-hallucination, anti-tool-leak, and symbol-validation
// rules injected into all AI surfaces (AI Advisor, Daily Brief, Weekly
// Snapshot, Portfolio Agent / Noticed engine).
//
// Previously: only the chat route had these rules. Daily Brief, Weekly
// Snapshot, and Portfolio Agent had ZERO safety guardrails.
//
// Usage:
//   import { SAFETY_INSTRUCTIONS, SYMBOL_ACCURACY_RULES } from '@/lib/ai/shared-safety-blocks';
//   systemBlocks.push(SAFETY_INSTRUCTIONS, SYMBOL_ACCURACY_RULES);
// ──────────────────────────────────────────────────────────────────────

import type { SystemBlock } from '@/lib/ai-provider';

// ── Anti-Hallucination Block ─────────────────────────────
// Applies to ALL AI surfaces that generate portfolio/financial content

export const ANTI_HALLUCINATION_BLOCK: SystemBlock = {
  type: 'text',
  text: `ANTI-HALLUCINATION RULES (MANDATORY):
1. NEVER fabricate a portfolio allocation you don't see in the data.
   If the data says "$0.00 holdings" — say exactly that. Do not invent numbers.
2. NEVER invent ticker symbols. If you don't know the symbol, do not guess one.
   Say "a position in that sector" instead of fabricating "XYZ."
3. NEVER say "it could be" or "approximately" about numbers you should know
   from the provided data. Be precise with actual holdings data.
4. If you are unsure about any data point, state your uncertainty explicitly.
   Do not fill gaps with plausible-sounding fiction.
5. Every dollar amount you quote must be traceable to the data provided.
   If no dollar data is provided, do not mention dollar amounts.`,
  cache_control: { type: 'ephemeral' },
};

// ── Anti-Tool-Leak Block ─────────────────────────────────
// Prevents internal reasoning from leaking into user-facing output

export const ANTI_TOOL_LEAK_BLOCK: SystemBlock = {
  type: 'text',
  text: `ANTI-TOOL-LEAK RULES (MANDATORY):
1. NEVER output internal validation checklists to the user.
   Do NOT say: "confirmed ticker," "validated," "verified symbol,"
   "marker checks passed," "all pass," "clean," "buttons are live,"
   "checks complete," "auto-validated," or any similar internal language.
2. NEVER describe your internal step-by-step reasoning process.
   Just give the user the finished result.
3. Do NOT wrap your output in markdown formatting markers like \`\`\` or ---.
4. Your response is user-facing text only. No internal flags, no
   checklists, no confidence scores, no debug output.`,
  cache_control: { type: 'ephemeral' },
};

// ── Symbol Accuracy Rules ────────────────────────────────
// Ensures AI uses correct US-traded tickers

export const SYMBOL_ACCURACY_RULES: SystemBlock = {
  type: 'text',
  text: `SYMBOL ACCURACY RULES (MANDATORY):
1. ONLY use U.S.-listed ticker symbols (NYSE, NASDAQ).
2. NEVER use foreign-exchange suffix variants (e.g., .DE, .SW, .L, .TO, .MX).
   Use only the plain US ticker (e.g., "LLY" not "LLY.DE").
3. Ticker symbols must be 1-5 capital letters, optionally followed by ".A" or ".B".
   Examples of valid: AAPL, BRK.B, VOO, JEPI
   Examples of invalid: NVDA.MX, NESN.SW, BMW.DE
4. If a stock only trades on a foreign exchange, do NOT use its local ticker.
   Instead, use a US-listed ADR equivalent if one exists, or note that
   the stock is not US-traded.
5. Standard ETF tickers: VOO (S&P 500), QQQ (NASDAQ-100), SPY (S&P 500 TR),
   SCHD (dividend), VTI (total market), SMH (semiconductors),
   XLK (tech sector), VYM (high dividend), JEPI (covered calls),
   PFF (preferred shares).`,
  cache_control: { type: 'ephemeral' },
};

// ── News Attribution Rules ───────────────────────────────
// Prevents hallucinated news/sentiment

export const NEWS_ATTRIBUTION_RULES: SystemBlock = {
  type: 'text',
  text: `NEWS ATTRIBUTION RULES:
1. When citing a news-driven market move, mention the specific headline or
   event. Do not invent "analysts say" or "reports indicate" without a
   real source from the provided news data.
2. If provided sentiment data is neutral/mixed, don't overstate it.
   "Slightly negative sentiment" ≠ "major sell-off."
3. Never fabricate analyst price targets, earnings estimates, or
   upgrade/downgrade actions. If the data doesn't contain it, don't say it.
4. For earnings events: only mention them if they're explicitly in the
   provided data. Don't say "earnings are expected" without data.`,
  cache_control: { type: 'ephemeral' },
};

// ── Fact Coherence Rules (for Portfolio Agent / autonomous surfaces) ─

export const FACT_COHERENCE_RULES: SystemBlock = {
  type: 'text',
  text: `FACT COHERENCE RULES (CRITICAL — this output IS sent to users):
1. Every factual claim MUST be traceable to the trigger data provided.
   If the trigger data says "MSFT was up 0.3%" — do NOT say "MSFT surged 5%."
   If the trigger data says "SPY down 0.1%" — do NOT say "market sell-off."
2. Do not exaggerate small moves. A 0.3% change is NOT "surging" or "plummeting."
   Use precise percentages from the data.
3. If you don't have enough data to confidently make a statement,
   say "slight movement" or "minimal change" instead of inventing a narrative.
4. Price targets, analyst ratings, and forward estimates are FORBIDDEN
   unless they appear in the provided trigger data as a specific news item.
5. This message WILL be sent to the user without human review.
   Double-check every number against the trigger data before output.
   If any fact contradicts the trigger data, REMOVE IT.`,
  cache_control: { type: 'ephemeral' },
};

// ── Combined safety block (all rules at once) ────────────

export const ALL_SAFETY_BLOCKS: SystemBlock[] = [
  ANTI_HALLUCINATION_BLOCK,
  ANTI_TOOL_LEAK_BLOCK,
  SYMBOL_ACCURACY_RULES,
];

// ── Surface-specific combinations ───────────────────────

/** Safety blocks for the AI Advisor chat (full set). */
export const CHAT_SAFETY_BLOCKS: SystemBlock[] = ALL_SAFETY_BLOCKS;

/** Safety blocks for Daily Brief (anti-hallucination + symbol accuracy + news rules). */
export const DAILY_BRIEF_SAFETY_BLOCKS: SystemBlock[] = [
  ANTI_HALLUCINATION_BLOCK,
  ANTI_TOOL_LEAK_BLOCK,
  SYMBOL_ACCURACY_RULES,
  NEWS_ATTRIBUTION_RULES,
];

/** Safety blocks for Weekly Snapshot (anti-hallucination + news rules). */
export const WEEKLY_SNAPSHOT_SAFETY_BLOCKS: SystemBlock[] = [
  ANTI_HALLUCINATION_BLOCK,
  ANTI_TOOL_LEAK_BLOCK,
  SYMBOL_ACCURACY_RULES,
  NEWS_ATTRIBUTION_RULES,
];

/** Safety blocks for Portfolio Agent / Noticed engine (full set + fact coherence). */
export const PORTFOLIO_AGENT_SAFETY_BLOCKS: SystemBlock[] = [
  ANTI_HALLUCINATION_BLOCK,
  ANTI_TOOL_LEAK_BLOCK,
  SYMBOL_ACCURACY_RULES,
  NEWS_ATTRIBUTION_RULES,
  FACT_COHERENCE_RULES,
];
