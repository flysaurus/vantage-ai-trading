// ═══════════════════════════════════════════════════════════════
// tests/noticed-action.test.ts — deterministic [ACTION:...] markers
// ═══════════════════════════════════════════════════════════════
//
// Run: npx vitest run tests/noticed-action.test.ts
//
// Verifies the rules engine emits the structured CTA marker in
// `meta.action` (never via free-text LLM parsing):
//   - portfolio_drift   → 'REBALANCE'
//   - position_milestone → 'REVIEW_POSITION:<TICKER>'
//   - idle_cash         → 'INVEST_CASH:<amount>'
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { findNewTriggers, findDriftTriggers } from '@/lib/noticed/engine';
import type { NoticedRuleInput } from '@/lib/noticed/engine';
import { DEMO_PORTFOLIOS } from '@/lib/demo-data';

function makeInput(overrides: Partial<NoticedRuleInput> = {}): NoticedRuleInput {
  return {
    account: {
      cash: 0,
      equity: 100000,
      totalPnl: 0,
      totalPnlPercent: 0,
      dayPnl: 0,
      dayPnlPercent: 0,
    },
    positions: [],
    watchlistSymbols: [],
    daysSinceLastTrade: 0,
    ...overrides,
  };
}

describe('noticed engine — deterministic action markers', () => {
  it('portfolio_drift emits [ACTION:REBALANCE]', () => {
    // Technology overweight 60% vs buffett 15% target → +45% deviation
    const input = makeInput({
      positions: [
        {
          symbol: 'NVDA',
          qty: 10,
          marketValue: 60000,
          avgCost: 100,
          totalPnl: 59000,
          totalPnlPercent: 120,
          sector: 'Technology',
        },
      ],
    });

    const triggers = findDriftTriggers(input, new Set(), 'buffett');
    const tech = triggers.find((t) => t.meta.sector === 'Technology');
    expect(tech).toBeDefined();
    expect(tech!.trigger_type).toBe('portfolio_drift');
    expect(tech!.meta.action).toBe('REBALANCE');
  });

  it('position_milestone emits [ACTION:REVIEW_POSITION:<TICKER>]', () => {
    const input = makeInput({
      positions: [
        {
          symbol: 'AAPL',
          qty: 10,
          marketValue: 3000,
          avgCost: 2000,
          totalPnl: 1000,
          totalPnlPercent: 50, // crosses +15, +25, +50
        },
      ],
    });

    const triggers = findNewTriggers(input, new Set());
    const milestones = triggers.filter((t) => t.trigger_type === 'position_milestone');
    expect(milestones.length).toBeGreaterThan(0);
    for (const t of milestones) {
      expect(t.meta.action).toBe('REVIEW_POSITION:AAPL');
    }
  });

  it('idle_cash does NOT fire without availableCash/streak (old heuristic removed)', () => {
    // Legacy trigger used cashPct>50 && daysSinceLastTrade>7. That is gone:
    // without an explicit availableCash + streak the trigger must not fire.
    const input = makeInput({
      account: {
        cash: 90000,
        equity: 10000,
        totalPnl: 0,
        totalPnlPercent: 0,
        dayPnl: 0,
        dayPnlPercent: 0,
      },
      daysSinceLastTrade: 30,
    });

    const triggers = findNewTriggers(input, new Set());
    const idle = triggers.find((t) => t.trigger_type === 'idle_cash');
    expect(idle).toBeUndefined();
  });

  it('idle_cash emits [ACTION:INVEST_CASH:<amount>] above threshold + streak', () => {
    const input = makeInput({
      availableCash: 8423.7,
      idleCashStreak: 4,
      isReadOnly: false,
    });

    const triggers = findNewTriggers(input, new Set(), 'buffett');
    const idle = triggers.find((t) => t.trigger_type === 'idle_cash');
    expect(idle).toBeDefined();
    expect(idle!.meta.action).toBe('INVEST_CASH:8423');
    expect(idle!.meta.amount).toBe(8423);
    expect(idle!.meta.daysIdle).toBe(4);
    expect(idle!.context).toContain('buffett');
  });

  it('idle_cash is skipped for read-only accounts', () => {
    const input = makeInput({
      availableCash: 10000,
      idleCashStreak: 5,
      isReadOnly: true,
    });

    const triggers = findNewTriggers(input, new Set());
    const idle = triggers.find((t) => t.trigger_type === 'idle_cash');
    expect(idle).toBeUndefined();
  });

  it('idle_cash is skipped when streak < 3 trading days', () => {
    const input = makeInput({
      availableCash: 10000,
      idleCashStreak: 2,
      isReadOnly: false,
    });

    const triggers = findNewTriggers(input, new Set());
    const idle = triggers.find((t) => t.trigger_type === 'idle_cash');
    expect(idle).toBeUndefined();
  });

  it('demo buffett portfolio is pre-balanced → NO drift trigger (honest baseline)', () => {
    // The seeded Demo "Buffett" portfolio is ~58% cash with all sectors UNDER
    // their style targets, so no sector deviates >15 pts. This documents WHY a
    // real demo account shows no Rebalance card unless the user concentrates.
    const pf = (DEMO_PORTFOLIOS as Record<string, { positions: { symbol: string; qty: number; avgCost: number; sector: string }[] }>).buffett;
    const cash = 58570; // per demo-data comment: cash $58,570, equity $100,000
    const positions = pf.positions.map((p) => ({
      symbol: p.symbol,
      qty: p.qty,
      marketValue: p.qty * p.avgCost,
      avgCost: p.avgCost,
      totalPnl: 0,
      totalPnlPercent: 0,
      sector: p.sector,
    }));
    const input = makeInput({
      account: { cash, equity: 100000, totalPnl: 0, totalPnlPercent: 0, dayPnl: 0, dayPnlPercent: 0 },
      positions,
    });

    const triggers = findDriftTriggers(input, new Set(), 'buffett');
    expect(triggers).toEqual([]);
  });

  it('concentrated portfolio (42% tech vs 15% target) DOES trigger REBALANCE with correct cash denominator', () => {
    // Technology overweight: 42k invested + 58k cash = 100k total, tech = 42%
    // vs buffett 15% target → +27 pts deviation → REBALANCE fires.
    const input = makeInput({
      account: { cash: 58000, equity: 100000, totalPnl: 0, totalPnlPercent: 0, dayPnl: 0, dayPnlPercent: 0 },
      positions: [
        { symbol: 'NVDA', qty: 100, marketValue: 42000, avgCost: 100, totalPnl: 0, totalPnlPercent: 0, sector: 'Technology' },
        { symbol: 'BRK.B', qty: 10, marketValue: 0, avgCost: 0, totalPnl: 0, totalPnlPercent: 0, sector: 'Financial Services' },
      ],
    });

    const triggers = findDriftTriggers(input, new Set(), 'buffett');
    const tech = triggers.find((t) => t.meta.sector === 'Technology');
    expect(tech).toBeDefined();
    expect(tech!.meta.action).toBe('REBALANCE');
    expect(Math.round(tech!.meta.currentPct)).toBe(42);
  });
});
