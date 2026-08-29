// ═══════════════════════════════════════════════════════════════
// tests/rebalance-budget.test.ts — Rebalance budget-options unit tests
// ═══════════════════════════════════════════════════════════════
//
// Run: npx vitest run tests/rebalance-budget.test.ts
//
// Covers:
//   - computeRebalancePlan({ customAmount }) deploys a fixed budget buy-only
//   - parseCustomRebalanceAmount / detectCustomAmountRebalance
//   - detectFullPortfolioRebalance
//   - detectScopedRebalanceMode (literal + carry-forward)
//   - formatRebalanceBudgetPrompt
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  computeRebalancePlan,
  parseCustomRebalanceAmount,
  detectCustomAmountRebalance,
  detectFullPortfolioRebalance,
  detectScopedRebalanceMode,
  formatRebalanceBudgetPrompt,
  type PortfolioSnapshot,
} from '../lib/ai/account-actions';

const portfolio: PortfolioSnapshot = {
  equity: 101_930,
  cash: 4_032,
  positions: [
    { symbol: 'TSLA', qty: 0.5, price: 402, marketValue: 201 },
    { symbol: 'XLF', qty: 1, price: 50, marketValue: 50 },
  ],
};

describe('computeRebalancePlan custom amount', () => {
  it('deploys the fixed budget buy-only with no sells', () => {
    const plan = computeRebalancePlan(portfolio, 'buffett', { customAmount: 10_000 });

    expect(plan.customAmount).toBe(10_000);
    expect(plan.cashOnly).toBe(false);
    expect(plan.totalSell).toBe(0);
    expect(plan.lines.every((l) => l.action === 'buy')).toBe(true);
    expect(plan.lines.some((l) => l.symbol === 'TSLA')).toBe(false);

    // 95% of the budget is deployed across non-CASH targets (5% stays cash).
    expect(plan.totalBuy).toBeCloseTo(10_000 * 0.95, 1);
  });

  it('custom amount overrides cash (not limited to available cash)', () => {
    const plan = computeRebalancePlan(portfolio, 'buffett', { customAmount: 50_000 });
    expect(plan.totalBuy).toBeCloseTo(50_000 * 0.95, 1);
  });

  it('empty lines when the custom budget is below the buy threshold', () => {
    const plan = computeRebalancePlan({ equity: 0, cash: 0, positions: [] }, 'buffett', {
      customAmount: 0.5,
    });
    expect(plan.lines.length).toBe(0);
  });
});

describe('custom-amount parsing / detection', () => {
  it('parses dollar amounts, thousands and millions', () => {
    expect(parseCustomRebalanceAmount('rebalance with $5,000')).toBe(5000);
    expect(parseCustomRebalanceAmount('rebalance with $5k')).toBe(5000);
    expect(parseCustomRebalanceAmount('rebalance with $1.5m')).toBe(1_500_000);
    expect(parseCustomRebalanceAmount('no amount here')).toBeNull();
  });

  it('detects a custom-amount rebalance phrase', () => {
    expect(detectCustomAmountRebalance('rebalance with $5000')).toBe(5000);
    expect(detectCustomAmountRebalance('rebalance with $7,500')).toBe(7500);
    expect(detectCustomAmountRebalance('rebalance my portfolio')).toBeNull();
    expect(detectCustomAmountRebalance('rebalance using cash only')).toBeNull();
  });
});

describe('full-portfolio detection', () => {
  it('detects explicit full-portfolio phrasings', () => {
    expect(detectFullPortfolioRebalance('rebalance with my full portfolio')).toBe(true);
    expect(detectFullPortfolioRebalance('rebalance my entire account')).toBe(true);
    expect(detectFullPortfolioRebalance('rebalance my whole balance')).toBe(true);
    expect(detectFullPortfolioRebalance('rebalance my portfolio')).toBe(false);
    expect(detectFullPortfolioRebalance('rebalance using cash only')).toBe(false);
  });
});

describe('detectScopedRebalanceMode', () => {
  it('returns cash-only for a literal cash-only message', () => {
    const mode = detectScopedRebalanceMode([{ role: 'user', content: 'rebalance using cash only' }]);
    expect(mode.cashOnly).toBe(true);
    expect(mode.customAmount).toBeNull();
  });

  it('returns a custom amount for a literal custom message', () => {
    const mode = detectScopedRebalanceMode([{ role: 'user', content: 'rebalance with $5000' }]);
    expect(mode.cashOnly).toBe(false);
    expect(mode.customAmount).toBe(5000);
  });

  it('returns full mode for an explicit full-portfolio message', () => {
    const mode = detectScopedRebalanceMode([{ role: 'user', content: 'rebalance with my full portfolio' }]);
    expect(mode.cashOnly).toBe(false);
    expect(mode.customAmount).toBeNull();
  });

  it('carries cash-only forward from a prior cash-only plan', () => {
    const messages = [
      { role: 'user', content: 'rebalance using cash only' },
      { role: 'assistant', content: "Here's the **cash-only** rebalance plan to **Value-Style**" },
      { role: 'user', content: 'execute the rebalance' },
    ];
    expect(detectScopedRebalanceMode(messages).cashOnly).toBe(true);
  });

  it('carries a custom amount forward from a prior custom plan', () => {
    const messages = [
      { role: 'user', content: 'rebalance with $7500' },
      { role: 'assistant', content: "Here's the **custom rebalance** plan — deploy $7,500 across the target ETFs" },
      { role: 'user', content: 'execute the rebalance' },
    ];
    expect(detectScopedRebalanceMode(messages).customAmount).toBe(7500);
  });

  it('defaults to full mode with no scope', () => {
    const mode = detectScopedRebalanceMode([{ role: 'user', content: 'rebalance my portfolio' }]);
    expect(mode.cashOnly).toBe(false);
    expect(mode.customAmount).toBeNull();
  });
});

describe('formatRebalanceBudgetPrompt', () => {
  it('lists available cash and full portfolio value', () => {
    const prompt = formatRebalanceBudgetPrompt(portfolio, 'buffett');
    expect(prompt).toContain('Available cash');
    expect(prompt).toContain('Full portfolio value');
    expect(prompt).toContain('Value-Style');
  });
});
