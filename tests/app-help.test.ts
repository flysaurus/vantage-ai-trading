// ═══════════════════════════════════════════════════════════════
// tests/app-help.test.ts — Deterministic app-help router unit tests
// ═══════════════════════════════════════════════════════════════
//
// Run: npx vitest run tests/app-help.test.ts
//
// Covers detectAppHelpIntent (capabilities/how-to) and that account-action
// commands are NOT intercepted, plus the detectAccountAction regression guard
// for "how do I rebalance" no longer firing a plan.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { detectAppHelpIntent, buildAppHelpAnswer } from '../lib/ai/app-help';
import { detectAccountAction } from '../lib/ai/account-actions';

describe('detectAppHelpIntent — capabilities/help', () => {
  it.each([
    'help',
    'help me',
    'what can you do',
    'what can I ask',
    'what are you',
    'what features do you have',
    'capabilities',
    'menu',
  ])('maps %s → capabilities', (msg) => {
    expect(detectAppHelpIntent(msg)).toBe('capabilities');
  });
});

describe('detectAppHelpIntent — how-to', () => {
  it.each([
    ['how do I rebalance', 'how_to_rebalance'],
    ['how does rebalancing work', 'how_to_rebalance'],
    ['what is rebalancing', 'how_to_rebalance'],
    ['how do I set up DCA', 'how_to_dca'],
    ['how does dollar cost averaging work', 'how_to_dca'],
    ['how do I change my style', 'how_to_style'],
    ['how do I connect my broker', 'how_to_broker'],
    ['how do I set up alerts', 'how_to_alerts'],
    ['how do I add funds', 'how_to_funds'],
  ])('maps %s → %s', (msg, kind) => {
    expect(detectAppHelpIntent(msg)).toBe(kind);
  });
});

describe('detectAppHelpIntent — does NOT intercept real commands', () => {
  it.each([
    'rebalance',
    'rebalance using available cash only',
    'change my style to Lynch',
    'change my style',
    'set up a dollar-cost averaging (DCA) plan',
    'what is my investment style',
    'how much cash do I have',
    'what are my positions',
    'help me rebalance',
  ])('returns null for %s', (msg) => {
    expect(detectAppHelpIntent(msg)).toBeNull();
  });
});

describe('detectAccountAction — "how do I rebalance" is not a command', () => {
  it('returns null for a how-to rebalance question (no plan fired)', () => {
    expect(detectAccountAction('how do I rebalance')).toBeNull();
  });

  it('returns null for "should I rebalance" (question, not command)', () => {
    expect(detectAccountAction('should I rebalance')).toBeNull();
  });

  it('still fires a real rebalance for "rebalance"', () => {
    expect(detectAccountAction('rebalance')).toEqual({ type: 'rebalance', style: null });
  });
});

describe('buildAppHelpAnswer', () => {
  it('returns non-empty grounded text for every kind', () => {
    const kinds = ['capabilities', 'how_to_rebalance', 'how_to_dca', 'how_to_style', 'how_to_broker', 'how_to_alerts', 'how_to_funds'] as const;
    for (const k of kinds) {
      expect(buildAppHelpAnswer(k).length).toBeGreaterThan(20);
    }
  });
});
