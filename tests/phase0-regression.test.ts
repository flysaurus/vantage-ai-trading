// ═══════════════════════════════════════════════════════════════
// tests/phase0-regression.test.ts — Phase 0 surgical-fix regression
// ═══════════════════════════════════════════════════════════════
//
// Run: npx vitest run tests/phase0-regression.test.ts
//
// Locks in the two Phase 0 fixes so they never regress:
//   Bug 1 — "make it count" over-capture (make/turn idiom → invalid_style)
//           fixed by guarding the "make/turn X" form to only fire when X is a
//           recognized risk word, a recognized style word, or an explicit
//           "style/investor/..." qualifier is present.
//   Bug 2 — "one solid stick suggesting" dictation taken literally as tickers
//           fixed by preserving case in the tokenizer: bare lowercase words are
//           prose (passed to Tier 1 as-is), only $-prefixed / ALL-CAPS words are
//           ticker candidates.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { detectAccountAction } from '../lib/ai/account-actions';
import { tokenizeMessage } from '../lib/ticker-resolver';

// ── Bug 1: "make/turn X" idiom over-capture ──────────────────

describe('Phase 0 — makeStyleMatch idiom guard (bug 1)', () => {
  const idioms = [
    'make it count',
    'make it matter',
    'make it work',
    'make it happen',
    'make it rain',
    'make it stick',
    'turn it around',
    'turn me around',
    'make this quick',
    'make that work',
    'make me proud',
    'make it right',
  ];

  it.each(idioms)('does NOT treat "%s" as a style/risk command', (msg) => {
    expect(detectAccountAction(msg)).toBeNull();
  });

  // Recognized risk/style words and explicit qualifiers must still route.
  const stillCommands: Array<[string, unknown]> = [
    ['make it aggressive', { type: 'invalid_style', requested: 'aggressive' }],
    ['make me aggressive', { type: 'invalid_style', requested: 'aggressive' }],
    ['make my style aggressive', { type: 'invalid_style', requested: 'aggressive' }],
    ['make me more aggressive', { type: 'change_risk', risk: 'Aggressive' }],
    ['make me more conservative', { type: 'change_risk', risk: 'Conservative' }],
    ['make my style growth', { type: 'change_style', style: 'lynch' }],
    ['turn me conservative', { type: 'invalid_style', requested: 'conservative' }],
  ];

  it.each(stillCommands)('still routes "%s" → %j', (msg, expected) => {
    expect(detectAccountAction(msg)).toEqual(expected);
  });
});

// ── Bug 2: dictation taken literally as tickers ──────────────

describe('Phase 0 — ticker dictation guard (bug 2)', () => {
  it('no longer uppercases prose in "one solid stick suggesting"', () => {
    const tokens = tokenizeMessage('one solid stick suggesting');
    expect(tokens).not.toContain('SOLID');
    expect(tokens).not.toContain('STICK');
    // every surviving token is lowercase prose (nothing masquerades as a ticker)
    expect(tokens.every((t) => t === t.toLowerCase())).toBe(true);
  });

  it('no longer uppercases prose in "give me one solid stock suggestion"', () => {
    const tokens = tokenizeMessage('give me one solid stock suggestion');
    expect(tokens).not.toContain('SOLID');
    expect(tokens.every((t) => t === t.toLowerCase())).toBe(true);
  });

  it('preserves real ALL-CAPS tickers', () => {
    const tokens = tokenizeMessage('buy NVDA and AMD');
    expect(tokens).toContain('NVDA');
    expect(tokens).toContain('AMD');
  });

  it('still tokenizes a lowercase real ticker (resolved case-insensitively in Tier 0)', () => {
    const tokens = tokenizeMessage('buy nvda');
    expect(tokens).toContain('nvda');
  });

  it('still tokenizes $-prefixed tickers as uppercase', () => {
    const tokens = tokenizeMessage('buy $aapl');
    expect(tokens).toContain('AAPL');
  });

  // Broad dictation-collision sweep: no uppercase false tickers should survive.
  const prose = [
    'one solid stick suggesting',
    'give me one solid stock suggestion',
    'what should I buy next',
    'whats the best ticker for me',
    'pick a stock for me',
    'i have no idea what to buy',
    'can you suggest something safe',
    'whats nvda p/e ratio',
  ];

  it.each(prose)('produces no uppercase false tickers for "%s"', (msg) => {
    const tokens = tokenizeMessage(msg);
    const falseTickers = tokens.filter((t) => /^[A-Z]{2,5}$/.test(t));
    expect(falseTickers).toEqual([]);
  });
});
