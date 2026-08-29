// ═══════════════════════════════════════════════════════════════
// tests/style-change.test.ts — Investor style-change flow unit tests
// ═══════════════════════════════════════════════════════════════
//
// Run: npx vitest run tests/style-change.test.ts
//
// Covers:
//   - detectAccountAction("change my style") → change_style_ask (no target)
//   - detectAccountAction("change my style to X") → change_style (valid target)
//   - detectAccountAction("change my style to <invalid>") → invalid_style
//   - hypothetical phrasing → null (no mutation)
//   - formatStylePickPrompt includes all 5 styles + current style
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  detectAccountAction,
  formatStylePickPrompt,
} from '../lib/ai/account-actions';

describe('detectAccountAction — style-change ask (no target)', () => {
  it('routes "change my investment style" to change_style_ask', () => {
    expect(detectAccountAction('change my investment style')).toEqual({ type: 'change_style_ask' });
  });

  it('routes bare "change my style" to change_style_ask', () => {
    expect(detectAccountAction('change my style')).toEqual({ type: 'change_style_ask' });
  });

  it('routes "switch my style" to change_style_ask', () => {
    expect(detectAccountAction('switch my style')).toEqual({ type: 'change_style_ask' });
  });

  it('does NOT treat a hypothetical as a style change', () => {
    expect(detectAccountAction('how would the app react if I change my style')).toBeNull();
  });
});

describe('detectAccountAction — style change with target', () => {
  it.each([
    ['change my style to Buffett', 'buffett'],
    ['change my style to Lynch', 'lynch'],
    ['change my style to Livermore', 'livermore'],
    ['change my style to Munger', 'munger'],
    ['change my style to Soros', 'soros'],
    ['change my style to warren buffett', 'buffett'],
  ])('maps %s → change_style(%s)', (msg, style) => {
    expect(detectAccountAction(msg)).toEqual({ type: 'change_style', style });
  });

  it('maps an unknown target to invalid_style', () => {
    expect(detectAccountAction('change my style to banana')).toEqual({ type: 'invalid_style', requested: 'banana' });
  });

  it('does NOT fire the ask path when a target style is present', () => {
    expect(detectAccountAction('change my style to Lynch')).not.toEqual({ type: 'change_style_ask' });
  });
});

describe('formatStylePickPrompt', () => {
  it('mentions the current style and all five available styles', () => {
    const text = formatStylePickPrompt('Lynch');
    expect(text).toContain('Lynch');
    for (const label of ['Buffett', 'Livermore', 'Munger', 'Soros']) {
      expect(text).toContain(label);
    }
  });
});
