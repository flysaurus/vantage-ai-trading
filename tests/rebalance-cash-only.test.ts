// ═══════════════════════════════════════════════════════════════
// tests/rebalance-cash-only.test.ts — Cash-only rebalance unit tests
// ═══════════════════════════════════════════════════════════════
//
// Run: npx vitest run tests/rebalance-cash-only.test.ts
//
// Covers:
//   - computeRebalancePlan({ cashOnly: true }) deploys available cash
//     across non-CASH target ETFs by style weight, buy-only, no sells
//   - detectCashOnlyRebalance / isCashOnlyRebalanceContext detection
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  computeRebalancePlan,
  detectCashOnlyRebalance,
  isCashOnlyRebalanceContext,
  rebalancePlanToLegs,
  type PortfolioSnapshot,
} from '../lib/ai/account-actions';

const portfolio: PortfolioSnapshot = {
  equity: 101_930,
  cash: 4_032, // available cash (cash − open buy reservations)
  positions: [
    { symbol: 'TSLA', qty: 0.5, price: 402, marketValue: 201 },
    { symbol: 'XLF', qty: 1, price: 50, marketValue: 50 },
  ],
};

describe('computeRebalancePlan cash-only', () => {
  it('is buy-only and deploys available cash across non-CASH targets', () => {
    const plan = computeRebalancePlan(portfolio, 'buffett', { cashOnly: true });

    expect(plan.cashOnly).toBe(true);
    expect(plan.totalSell).toBe(0);
    expect(plan.lines.every((l) => l.action === 'buy')).toBe(true);

    // No sells of existing positions (TSLA orphan must NOT appear).
    expect(plan.lines.some((l) => l.symbol === 'TSLA')).toBe(false);

    // Non-cash targets sum to 95% of available cash; 5% stays as cash buffer.
    const totalBuy = plan.lines.reduce((s, l) => s + l.delta, 0);
    expect(totalBuy).toBeCloseTo(4032 * 0.95, 1);
    expect(plan.cash - totalBuy).toBeCloseTo(4032 * 0.05, 1);
  });

  it('produces only BUY legs (no SELL legs)', () => {
    const plan = computeRebalancePlan(portfolio, 'buffett', { cashOnly: true });
    const legs = rebalancePlanToLegs(plan);
    expect(legs.length).toBeGreaterThan(0);
    expect(legs.every((l) => l.side === 'BUY')).toBe(true);
  });

  it('returns empty lines when there is no available cash', () => {
    const plan = computeRebalancePlan({ equity: 101_930, cash: 0, positions: [] }, 'buffett', {
      cashOnly: true,
    });
    expect(plan.lines.length).toBe(0);
  });

  it('full mode still liquidates orphan positions (unchanged)', () => {
    const plan = computeRebalancePlan(portfolio, 'buffett');
    expect(plan.lines.some((l) => l.symbol === 'TSLA' && l.action === 'sell')).toBe(true);
  });
});

describe('cash-only detection', () => {
  it('detects explicit cash-only phrasings', () => {
    expect(detectCashOnlyRebalance('rebalance using cash only')).toBe(true);
    expect(detectCashOnlyRebalance('rebalance with my available cash')).toBe(true);
    expect(detectCashOnlyRebalance('cash only rebalance')).toBe(true);
    expect(detectCashOnlyRebalance('rebalance my portfolio')).toBe(false);
    expect(detectCashOnlyRebalance('execute the rebalance')).toBe(false);
  });

  it('carries cash-only mode forward from a prior cash-only plan', () => {
    const messages = [
      { role: 'user', content: 'rebalance using cash only' },
      { role: 'assistant', content: "Here's the **cash-only** rebalance plan to **Value-Style**" },
      { role: 'user', content: 'execute the rebalance' },
    ];
    expect(isCashOnlyRebalanceContext(messages)).toBe(true);
  });

  it('does not treat a normal rebalance plan as cash-only', () => {
    const messages = [
      { role: 'user', content: 'rebalance my portfolio' },
      { role: 'assistant', content: "Here's the rebalance plan to **Value-Style**" },
      { role: 'user', content: 'execute the rebalance' },
    ];
    expect(isCashOnlyRebalanceContext(messages)).toBe(false);
  });
});
