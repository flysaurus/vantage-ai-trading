import { describe, it, expect } from 'vitest';
import {
  detectTaxLossHarvestIntent,
  buildTaxLossHarvestAnswer,
  type PortfolioSnapshot,
} from '../lib/ai/account-actions';

const POSITIVE = [
  'run a tax check on my portfolio',
  'tax loss harvesting',
  'tax-loss harvest my positions',
  'which losses can i harvest',
  'flag any wash sale risks',
  'which positions have unrealized losses i can harvest',
  'tax optimization moves for my portfolio',
  'run a tax check on my portfolio — identify any positions with unrealized losses I could harvest, flag wash sale risks, and give me any year-end tax optimization moves to consider.',
];

const NEGATIVE = [
  'what is the capital gains tax rate',
  'how does the wash sale rule work',
  'what is a tax loss',
  'how do i rebalance my portfolio',
  'whats my account balance',
  'buy 100 shares of aapl',
  'whats the difference between an etf and a stock',
];

describe('detectTaxLossHarvestIntent', () => {
  for (const m of POSITIVE) {
    it(`detects: "${m.slice(0, 40)}"`, () => {
      expect(detectTaxLossHarvestIntent(m)).toBe(true);
    });
  }
  for (const m of NEGATIVE) {
    it(`does not detect: "${m.slice(0, 40)}"`, () => {
      expect(detectTaxLossHarvestIntent(m)).toBe(false);
    });
  }
});

describe('buildTaxLossHarvestAnswer', () => {
  const snapshot: PortfolioSnapshot = {
    equity: 100000,
    cash: 5000,
    positions: [
      { symbol: 'ALB', qty: 10, price: 100, marketValue: 1000, avgCost: 150, unrealizedPnl: -500, buyDate: new Date(Date.now() - 5 * 86400000).toISOString() },
      { symbol: 'NVDA', qty: 5, price: 200, marketValue: 1000, avgCost: 100, unrealizedPnl: 500 },
      { symbol: 'TSLA', qty: 2, price: 300, marketValue: 600, avgCost: 400, unrealizedPnl: -200, buyDate: new Date(Date.now() - 100 * 86400000).toISOString() },
    ],
  };

  it('lists losers and flags wash-sale window', () => {
    const out = buildTaxLossHarvestAnswer(snapshot);
    expect(out).toContain('ALB');
    expect(out).toContain('TSLA');
    expect(out).toContain('wash-sale window');
    expect(out).toContain('Total harvestable loss');
  });

  it('reports no losses when none exist', () => {
    const none: PortfolioSnapshot = {
      equity: 1000,
      cash: 0,
      positions: [{ symbol: 'NVDA', qty: 5, price: 200, marketValue: 1000, avgCost: 100, unrealizedPnl: 500 }],
    };
    expect(buildTaxLossHarvestAnswer(none)).toContain('no unrealized losses');
  });

  it('computes unrealized P&L from cost basis when explicit field is absent', () => {
    const derived: PortfolioSnapshot = {
      equity: 1000,
      cash: 0,
      positions: [{ symbol: 'ALB', qty: 10, price: 80, marketValue: 800, avgCost: 100 }],
    };
    const out = buildTaxLossHarvestAnswer(derived);
    expect(out).toContain('ALB');
    expect(out).toContain('Total harvestable loss');
  });
});
