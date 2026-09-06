// ─── Risk-Narrative → Deterministic CTA Bridge ─────────────────
// Derives the action marker (REBALANCE / REVIEW_POSITION:<TICKER>) shown on the
// Portfolio-tab RiskNarrativeCard. This is a *separate* deterministic field that
// rides alongside the LLM narrative — it is derived from the SAME rules engine
// the Noticed pipeline uses (findConcentrationTriggers / findDriftTriggers),
// never parsed from the LLM's free-text suggestion prose.
//
// Kept in its own leaf module (not inside lib/risk-narrative.ts) to avoid a
// circular import: lib/noticed/engine.ts already imports lib/risk-narrative.ts.

import {
  findConcentrationTriggers,
  findDriftTriggers,
} from './noticed/engine';
import type { NoticedRuleInput } from './noticed/engine';
import { resolveConcentrationThresholds } from './concentration';

export interface RiskNarrativeActionInput {
  symbol: string;
  qty: number;
  currentPrice: number;
  avgCost: number;
  sector?: string;
}

export function computeDeterministicActions(
  positions: RiskNarrativeActionInput[],
  investorStyle: string | null,
  concSinglePct: number | null,
  concTop3Pct: number | null,
  etfWeights: Map<string, Record<string, number>>,
): string[] {
  const { single, top3 } = resolveConcentrationThresholds(
    investorStyle,
    concSinglePct,
    concTop3Pct,
  );

  const input: NoticedRuleInput = {
    account: {
      cash: 0,
      equity: 0,
      totalPnl: 0,
      totalPnlPercent: 0,
      dayPnl: 0,
      dayPnlPercent: 0,
    },
    positions: positions.map((p) => ({
      symbol: p.symbol,
      qty: p.qty,
      marketValue: p.qty * p.currentPrice,
      avgCost: p.avgCost,
      totalPnl: (p.currentPrice - p.avgCost) * p.qty,
      totalPnlPercent: 0,
      sector: p.sector,
    })),
    watchlistSymbols: [],
    daysSinceLastTrade: 0,
  };

  const concTriggers = findConcentrationTriggers(input, new Set<string>(), single, top3);
  const driftTriggers = investorStyle
    ? findDriftTriggers(input, new Set<string>(), investorStyle, etfWeights)
    : [];

  const actions: string[] = [];
  for (const t of [...concTriggers, ...driftTriggers]) {
    const a = t.meta?.action;
    if (typeof a === 'string' && a && !actions.includes(a)) {
      actions.push(a);
    }
  }
  return actions;
}
