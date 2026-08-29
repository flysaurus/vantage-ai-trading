// ═══════════════════════════════════════════════════════════════
// tests/risk-change.test.ts — Risk-tolerance change detection unit tests
// ═══════════════════════════════════════════════════════════════
//
// Run: npx vitest run tests/risk-change.test.ts
//
// Regression guard for the "change it to aggressive style" bug, where a risk
// change was mis-classified as portfolio construction and surfaced the
// irrelevant "Stocks only / ETFs only" vehicle question.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { detectAccountAction, detectRiskLevel, buildAccountStateAnswer, formatRiskChangeAnswer, type PortfolioSnapshot } from '../lib/ai/account-actions';

describe('detectAccountAction — risk-tolerance change', () => {
  it.each([
    ['change my risk tolerance to aggressive', 'Aggressive'],
    ['change my risk to conservative', 'Conservative'],
    ['make me more aggressive', 'Aggressive'],
    ['set my risk level to moderate', 'Moderate'],
    ['switch my risk profile to aggressive', 'Aggressive'],
    ['update my risk tolerance to low risk', 'Conservative'],
    ['change to low risk', 'Conservative'],
    ['change to high risk', 'Aggressive'],
  ])('maps %s → change_risk(%s)', (msg, risk) => {
    expect(detectAccountAction(msg)).toEqual({ type: 'change_risk', risk });
  });

  it('reinterprets a no-op comparative risk change as a style request', () => {
    // Risk already Aggressive → "more aggressive" can't be risk; it's style.
    expect(detectAccountAction('make me more aggressive', { riskTolerance: 'Aggressive' })).toEqual({ type: 'invalid_style', requested: 'more aggressive' });
    // But when risk is NOT already Aggressive, it's a genuine risk bump.
    expect(detectAccountAction('make me more aggressive', { riskTolerance: 'Moderate' })).toEqual({ type: 'change_risk', risk: 'Aggressive' });
  });

  it('does NOT reinterpret an explicit no-op risk change as style', () => {
    expect(detectAccountAction('change my risk to aggressive', { riskTolerance: 'Aggressive' })).toEqual({ type: 'change_risk', risk: 'Aggressive' });
  });

  it('does NOT treat a bare risk word as a risk change (it refers to style)', () => {
    expect(detectAccountAction('make it aggressive')).not.toEqual(expect.objectContaining({ type: 'change_risk' }));
    expect(detectAccountAction('change it to conservative')).not.toEqual(expect.objectContaining({ type: 'change_risk' }));
    expect(detectAccountAction('change to aggressive')).not.toEqual(expect.objectContaining({ type: 'change_risk' }));
    expect(detectAccountAction('change to more aggressive')).not.toEqual(expect.objectContaining({ type: 'change_risk' }));
  });

  it('does NOT treat a hypothetical risk question as a mutation', () => {
    expect(detectAccountAction('should I be more aggressive?')).toBeNull();
    expect(detectAccountAction('how do I change my risk tolerance?')).toBeNull();
  });
});

describe('detectAccountAction — style change still takes precedence', () => {
  it('maps a real style name to change_style (not risk)', () => {
    expect(detectAccountAction('change my style to Lynch')).toEqual({ type: 'change_style', style: 'lynch' });
    expect(detectAccountAction('change my style to warren buffett')).toEqual({ type: 'change_style', style: 'buffett' });
  });

  it('maps a non-style, non-risk word to invalid_style', () => {
    expect(detectAccountAction('change my style to banana')).toEqual({ type: 'invalid_style', requested: 'banana' });
  });
});

describe('formatRiskChangeAnswer', () => {
  it('mentions the new risk level and offers a rebalance', () => {
    const text = formatRiskChangeAnswer('Aggressive');
    expect(text).toContain('Aggressive');
    expect(text).toContain('rebalance');
  });
});

describe('detectRiskLevel (exported for classifier Tier-2 dispatch)', () => {
  it.each([
    ['aggressive', 'Aggressive'],
    ['Aggressive', 'Aggressive'],
    ['high risk', 'Aggressive'],
    ['risk taking', 'Aggressive'],
    ['risky', 'Aggressive'],
    ['conservative', 'Conservative'],
    ['low risk', 'Conservative'],
    ['risk averse', 'Conservative'],
    ['cautious', 'Conservative'],
    ['safe', 'Conservative'],
    ['moderate', 'Moderate'],
    ['balanced', 'Moderate'],
  ])('maps %s → %s', (val, risk) => {
    expect(detectRiskLevel(val)).toBe(risk);
  });

  it('returns null for non-risk values', () => {
    expect(detectRiskLevel('banana')).toBeNull();
    expect(detectRiskLevel('Lynch')).toBeNull();
  });
});

describe('buildAccountStateAnswer', () => {
  const snapshot: PortfolioSnapshot = {
    equity: 101930,
    cash: 100866,
    positions: [
      { symbol: 'TSLA', name: 'Tesla Inc', qty: 1, price: 201, marketValue: 201 },
      { symbol: 'NVDA', name: 'NVIDIA', qty: 2, price: 17.5, marketValue: 35 },
    ],
  };

  it('reports equity, cash, and positions deterministically', () => {
    const text = buildAccountStateAnswer(snapshot, 'Aggressive');
    expect(text).toContain('$101,930');
    expect(text).toContain('$100,866');
    expect(text).toContain('TSLA');
    expect(text).toContain('Aggressive');
    expect(text).toContain('2 held');
  });
});
