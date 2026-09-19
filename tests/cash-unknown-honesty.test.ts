// ═══════════════════════════════════════════════════════════════
// tests/cash-unknown-honesty.test.ts — unknown cash must NEVER read as $0
// ═══════════════════════════════════════════════════════════════
//
// Run: npx vitest run tests/cash-unknown-honesty.test.ts
//
// Contract (mirrors types/index.ts AccountSummary.cash):
//   null = the broker did not report settled cash (UNKNOWN)
//   ⇒ render "unavailable", never "$0", and never derive a plan from it.
//
// These guard the (a) surface: the AI chat fabrication path. Before this
// change `cash ?? 0` produced a confident "Available cash: $0.00" claim
// about a balance we simply could not see.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  computeRebalancePlan,
  formatRebalanceBudgetPrompt,
  formatRebalancePlanAnswer,
  buildAccountStateAnswer,
  detectScopedRebalanceMode,
  type PortfolioSnapshot,
} from '@/lib/ai/account-actions';

const POSITIONS = [
  { symbol: 'VTI', qty: 10, price: 250, marketValue: 2500 },
  { symbol: 'VXUS', qty: 20, price: 60, marketValue: 1200 },
];

const KNOWN: PortfolioSnapshot = { equity: 10_000, cash: 2_000, positions: POSITIONS };
const UNKNOWN: PortfolioSnapshot = { equity: 10_000, cash: null as unknown as number, positions: POSITIONS };

describe('unknown cash — budget prompt', () => {
  it('says unavailable rather than $0', () => {
    const out = formatRebalanceBudgetPrompt(UNKNOWN, 'lynch');
    expect(out).toContain('unavailable');
    expect(out).not.toContain('$0');
  });

  it('still shows a real, known cash balance', () => {
    const out = formatRebalanceBudgetPrompt(KNOWN, 'lynch');
    expect(out).toContain('$2,000');
    expect(out).not.toContain('unavailable');
  });
});

describe('unknown cash — cash-only rebalance', () => {
  it('refuses to build a $0 plan and returns a warning instead', () => {
    const plan = computeRebalancePlan(UNKNOWN, 'lynch', { cashOnly: true });
    expect(plan.lines).toHaveLength(0);
    expect(plan.cash).toBeNull();
    expect(plan.warning).toBeTruthy();
    expect(plan.warning).not.toContain('$0');
  });

  it('the rendered answer never claims "no available cash"', () => {
    const plan = computeRebalancePlan(UNKNOWN, 'lynch', { cashOnly: true });
    const out = formatRebalancePlanAnswer(plan);
    expect(out).not.toMatch(/no available cash/i);
    expect(out).not.toContain('$0');
    expect(out).toMatch(/can'?t see|cannot see|tell me/i);
  });

  it('regression: a known cash balance still produces a real plan', () => {
    const plan = computeRebalancePlan(KNOWN, 'lynch', { cashOnly: true });
    expect(plan.lines.length).toBeGreaterThan(0);
    expect(plan.cash).toBe(2000);
    expect(plan.totalBuy).toBeGreaterThan(0);
  });
});

describe('unknown cash — full rebalance', () => {
  it('omits the CASH bucket line and flags the gap', () => {
    const plan = computeRebalancePlan(UNKNOWN, 'lynch');
    expect(plan.cash).toBeNull();
    expect(plan.warning).toBeTruthy();
    expect(plan.lines.some((l) => l.symbol.toUpperCase() === 'CASH')).toBe(false);
  });

  it('the rendered answer never prints a $0 cash figure', () => {
    const plan = computeRebalancePlan(UNKNOWN, 'lynch');
    const out = formatRebalancePlanAnswer(plan);
    expect(out).not.toContain('$0');
    expect(out).toContain('unavailable');
  });

  it('regression: known cash still yields a CASH bucket', () => {
    const plan = computeRebalancePlan(KNOWN, 'lynch');
    expect(plan.cash).toBe(2000);
    expect(plan.lines.some((l) => l.symbol.toUpperCase() === 'CASH')).toBe(true);
  });
});

describe('unknown cash — account-state answer', () => {
  it('says unavailable rather than $0', () => {
    const out = buildAccountStateAnswer(UNKNOWN, 'Moderate');
    expect(out).toContain('unavailable');
    expect(out).not.toContain('$0');
  });

  it('regression: known cash still renders', () => {
    expect(buildAccountStateAnswer(KNOWN, 'Moderate')).toContain('$2,000');
  });
});

describe('scoped rebalance detection is untouched by the cash change', () => {
  it('still detects an explicit cash-only request', () => {
    const scope = detectScopedRebalanceMode([{ role: 'user', content: 'rebalance using my available cash' }]);
    expect(scope.cashOnly).toBe(true);
  });
});
