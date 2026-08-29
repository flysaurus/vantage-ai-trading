// ═══════════════════════════════════════════════════════════════
// tests/rebalance-asset-class.test.ts — ETF / Stocks / Mix unit tests
// ═══════════════════════════════════════════════════════════════
//
// Run: npx vitest run tests/rebalance-asset-class.test.ts
//
// Covers:
//   - resolveRebalanceTargets (etf / stock / mix)
//   - detectAssetClass
//   - formatAssetClassPrompt (scope markers for carry-forward)
//   - computeRebalancePlan({ assetClass }) — stock buy-only, mix split
//   - detectScopedRebalanceMode (assetClass carry-forward)
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { resolveRebalanceTargets, getInvestorStyleStocks, type AssetClass } from '../lib/investor-style-targets';
import {
  computeRebalancePlan,
  detectAssetClass,
  formatAssetClassPrompt,
  detectScopedRebalanceMode,
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

describe('resolveRebalanceTargets', () => {
  it('etf (default) returns the style ETF targets unchanged', () => {
    const targets = resolveRebalanceTargets('buffett', 'etf');
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.every((t) => t.type === 'ETF')).toBe(true);
    const sum = targets.reduce((s, t) => s + t.targetPercent, 0);
    expect(sum).toBeCloseTo(100, 2);
  });

  it('null assetClass falls back to ETF targets', () => {
    expect(resolveRebalanceTargets('buffett', null)).toEqual(resolveRebalanceTargets('buffett', 'etf'));
  });

  it('stock returns only Stock targets summing to 100', () => {
    const stocks = getInvestorStyleStocks('buffett');
    const targets = resolveRebalanceTargets('buffett', 'stock');
    const nonCash = targets.filter((t) => t.symbol !== 'CASH');
    expect(targets.length).toBe(stocks.length);
    expect(nonCash.every((t) => t.type === 'Stock')).toBe(true);
    expect(targets.reduce((s, t) => s + t.targetPercent, 0)).toBeCloseTo(100, 2);
  });

  it('mix halves each non-CASH ETF+stock weight and keeps one CASH bucket', () => {
    const targets = resolveRebalanceTargets('buffett', 'mix');
    const cash = targets.filter((t) => t.symbol === 'CASH');
    expect(cash.length).toBe(1);
    const sum = targets.reduce((s, t) => s + t.targetPercent, 0);
    expect(sum).toBeCloseTo(100, 2);
    // No symbol should appear twice in a mix.
    const symbols = targets.map((t) => t.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
  });
});

describe('detectAssetClass', () => {
  it('detects ETF phrases', () => {
    expect(detectAssetClass('rebalance into ETFs')).toBe('etf');
    expect(detectAssetClass('rebalance into an ETF')).toBe('etf');
  });

  it('detects stock phrases', () => {
    expect(detectAssetClass('rebalance into stocks')).toBe('stock');
    expect(detectAssetClass('rebalance into individual stocks')).toBe('stock');
  });

  it('detects mix phrases (mix / both / ETF+stock)', () => {
    expect(detectAssetClass('rebalance into a mix')).toBe('mix');
    expect(detectAssetClass('rebalance into a mix of ETFs and stocks')).toBe('mix');
    expect(detectAssetClass('buy both ETFs and stocks')).toBe('mix');
  });

  it('returns null for non-asset-class messages', () => {
    expect(detectAssetClass('execute the rebalance')).toBeNull();
    expect(detectAssetClass('rebalance my portfolio')).toBeNull();
    expect(detectAssetClass('')).toBeNull();
  });
});

describe('formatAssetClassPrompt', () => {
  it('encodes the cash-only scope for carry-forward', () => {
    const p = formatAssetClassPrompt('cash-only');
    expect(p).toMatch(/cash-only/i);
    expect(p).toMatch(/What do you want to put the money into\?/);
  });

  it('encodes the custom scope + amount for carry-forward', () => {
    const p = formatAssetClassPrompt('custom', 7_500);
    expect(p).toMatch(/custom rebalance/i);
    expect(p).toMatch(/\$7,500/);
  });

  it('encodes the full scope without a cash/custom marker', () => {
    const p = formatAssetClassPrompt('full');
    expect(p).toMatch(/full portfolio/i);
    expect(p).not.toMatch(/cash-only/i);
    expect(p).not.toMatch(/custom rebalance/i);
  });
});

describe('computeRebalancePlan with assetClass', () => {
  it('stock mode is buy-only under a cash-only budget', () => {
    const plan = computeRebalancePlan(portfolio, 'buffett', { cashOnly: true, assetClass: 'stock' });
    expect(plan.assetClass).toBe('stock');
    expect(plan.totalSell).toBe(0);
    expect(plan.lines.every((l) => l.action === 'buy')).toBe(true);
    // Existing stock positions (e.g. TSLA) are not sold — buy-only.
    expect(plan.lines.some((l) => l.symbol === 'TSLA')).toBe(false);
  });

  it('stock mode deploys the same budget as ETF mode (95% non-cash)', () => {
    const plan = computeRebalancePlan(portfolio, 'buffett', { customAmount: 10_000, assetClass: 'stock' });
    expect(plan.totalBuy).toBeCloseTo(10_000 * 0.95, 1);
    expect(plan.totalSell).toBe(0);
  });

  it('mix mode deploys the budget across both ETFs and stocks', () => {
    const plan = computeRebalancePlan(portfolio, 'buffett', { cashOnly: true, assetClass: 'mix' });
    expect(plan.totalSell).toBe(0);
    expect(plan.lines.every((l) => l.action === 'buy')).toBe(true);
    // Mix includes both ETF symbols (e.g. XLF) and stock symbols (e.g. JPM).
    const symbols = plan.lines.map((l) => l.symbol);
    expect(symbols.some((s) => s === 'XLF')).toBe(true);
    expect(symbols.some((s) => s === 'JPM')).toBe(true);
  });
});

describe('detectScopedRebalanceMode carries assetClass forward', () => {
  it('recovers cash-only + etf from a plan-then-execute conversation', () => {
    const messages = [
      { role: 'user', content: 'rebalance using available cash only' },
      { role: 'assistant', content: 'Cash-only rebalance — what do you want to put the money into?' },
      { role: 'user', content: 'rebalance into ETFs' },
      { role: 'assistant', content: 'Here is the cash-only rebalance plan to Value-Style — deploy your available cash across the target ETFs.' },
      { role: 'user', content: 'execute the rebalance' },
    ];
    const mode = detectScopedRebalanceMode(messages);
    expect(mode.cashOnly).toBe(true);
    expect(mode.assetClass).toBe('etf');
  });

  it('recovers custom amount + stock from a plan-then-execute conversation', () => {
    const messages = [
      { role: 'user', content: 'rebalance with $7500' },
      { role: 'assistant', content: 'Custom rebalance — deploy $7,500. What do you want to put the money into?' },
      { role: 'user', content: 'rebalance into stocks' },
      { role: 'assistant', content: 'Here is the custom rebalance plan to Value-Style — deploy $7,500 across the target stocks.' },
      { role: 'user', content: 'execute the rebalance' },
    ];
    const mode = detectScopedRebalanceMode(messages);
    expect(mode.cashOnly).toBe(false);
    expect(mode.customAmount).toBe(7_500);
    expect(mode.assetClass).toBe('stock');
  });

  it('defaults to full + null assetClass for a bare plan', () => {
    const mode = detectScopedRebalanceMode([
      { role: 'user', content: 'rebalance my portfolio' },
      { role: 'assistant', content: 'Ready to rebalance to Value-Style.' },
      { role: 'user', content: 'execute the rebalance' },
    ]);
    expect(mode.cashOnly).toBe(false);
    expect(mode.customAmount).toBeNull();
    expect(mode.assetClass).toBeNull();
  });
});
