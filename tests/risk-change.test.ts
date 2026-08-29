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
import { detectAccountAction, formatRiskChangeAnswer } from '../lib/ai/account-actions';

describe('detectAccountAction — risk-tolerance change', () => {
  it.each([
    ['change it to aggressive style', 'Aggressive'],
    ['change my risk tolerance to aggressive', 'Aggressive'],
    ['change my risk to conservative', 'Conservative'],
    ['make me more aggressive', 'Aggressive'],
    ['set my risk level to moderate', 'Moderate'],
    ['change it to conservative', 'Conservative'],
    ['switch my risk profile to aggressive', 'Aggressive'],
    ['update my risk tolerance to low risk', 'Conservative'],
  ])('maps %s → change_risk(%s)', (msg, risk) => {
    expect(detectAccountAction(msg)).toEqual({ type: 'change_risk', risk });
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
