import { describe, it, expect } from 'vitest';
import { planToExportPayload } from '@/lib/export/rebalance-export';
import type { RebalancePlan } from '@/lib/ai/account-actions';

const plan: RebalancePlan = {
  styleName: 'Buffett (Value)',
  description: 'Deploy into value-style core ETFs.',
  equity: 10000,
  cash: 3000,
  totalBuy: 2800,
  totalSell: 500,
  lines: [
    { symbol: 'VTI', name: 'Core', targetPercent: 60, currentValue: 5000, targetValue: 6000, delta: 1000, qty: 0, action: 'buy' },
    { symbol: 'SCHD', name: 'Dividend', targetPercent: 30, currentValue: 2000, targetValue: 3000, delta: 1000, qty: 0, action: 'buy' },
    { symbol: 'INTC', name: 'Intel', targetPercent: 0, currentValue: 500, targetValue: 0, delta: -500, qty: 10, action: 'sell' },
    { symbol: 'CASH', name: 'Cash', targetPercent: 10, currentValue: 3000, targetValue: 1000, delta: -2000, qty: 0, action: 'sell' },
  ],
};

describe('planToExportPayload', () => {
  it('maps trades to rows, excludes CASH', () => {
    const payload = planToExportPayload(plan);
    expect(payload.rows.map((r) => r.ticker)).toEqual(['VTI', 'SCHD', 'INTC']);
    expect(payload.rows[0]).toMatchObject({ action: 'buy', amountUsd: 1000, lineTotal: 1000 });
    expect(payload.rows[2]).toMatchObject({ action: 'sell', qty: 10, amountUsd: 500 });
  });

  it('computes sell price from currentValue / qty', () => {
    const payload = planToExportPayload(plan);
    expect(payload.rows[2].price).toBe(50);
  });

  it('sets grand total to totalBuy and a descriptive subtitle', () => {
    const payload = planToExportPayload(plan);
    expect(payload.grandTotal).toBe(2800);
    expect(payload.subtitle).toBe('2 buys · 1 sell');
    expect(payload.title).toBe('Rebalance Plan — Buffett (Value)');
  });

  it('handles cash-only plans with a cash-only subtitle', () => {
    const cashOnly: RebalancePlan = { ...plan, cashOnly: true, totalSell: 0, lines: plan.lines.filter((l) => l.symbol === 'VTI' || l.symbol === 'SCHD') };
    const payload = planToExportPayload(cashOnly);
    expect(payload.subtitle).toBe('Cash-only deployment — 2 buys, no sells');
  });
});
