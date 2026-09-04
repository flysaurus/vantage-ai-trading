// ═══════════════════════════════════════════════════════════════
// tests/grounding-check.test.ts — Phase 3 light-path "solid check"
// ═══════════════════════════════════════════════════════════════
//
// Run: npx vitest run tests/grounding-check.test.ts
//
// Covers the post-generation grounding backstop: cross-checks account-relative
// claims in a light-path response against the server-known portfolio and returns
// a correction when the model fabricated a portfolio total, cash figure, or
// claimed ownership of a ticker it doesn't hold. All pure/read-only.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  detectPortfolioTotalMismatch,
  detectCashMismatch,
  detectUnheldTickerClaim,
  detectPortfolioGroundingMismatch,
  type PortfolioSnapshot,
} from '../lib/ai/account-actions';

const SNAPSHOT: PortfolioSnapshot = {
  equity: 101000,
  cash: 500,
  positions: [
    { symbol: 'AAPL', name: 'Apple', qty: 10, price: 200, marketValue: 2000 },
    { symbol: 'NVDA', name: 'NVIDIA', qty: 5, price: 800, marketValue: 4000 },
  ],
};

describe('detectPortfolioTotalMismatch', () => {
  it('flags a fabricated portfolio total (>5% off)', () => {
    const r = detectPortfolioTotalMismatch('Your portfolio is worth $1,000.', 101000);
    expect(r).toContain('$101,000');
    expect(r).toContain('$1,000');
  });

  it('accepts a grounded portfolio total', () => {
    expect(detectPortfolioTotalMismatch('Your portfolio is worth $101,000.', 101000)).toBeNull();
    expect(detectPortfolioTotalMismatch('Your portfolio totals $100,000.', 101000)).toBeNull();
  });

  it('returns null for empty text or non-positive equity', () => {
    expect(detectPortfolioTotalMismatch('', 101000)).toBeNull();
    expect(detectPortfolioTotalMismatch('Your portfolio is worth $50,000.', 0)).toBeNull();
  });
});

describe('detectCashMismatch', () => {
  it('flags a fabricated cash balance', () => {
    const r = detectCashMismatch('Your cash balance is $50,000.', 500);
    expect(r).toContain('$500');
    expect(r).toContain('$50,000');
  });

  it('accepts a grounded cash figure', () => {
    expect(detectCashMismatch('You have $500 in cash.', 500)).toBeNull();
  });

  it('flags any non-trivial cash claim when actual cash is $0', () => {
    const r = detectCashMismatch('$40,000 in cash', 0);
    expect(r).toContain('$0');
  });

  it('ignores non-cash text (e.g. "cash flow")', () => {
    expect(detectCashMismatch('Free cash flow improved this quarter.', 500)).toBeNull();
  });
});

describe('detectUnheldTickerClaim', () => {
  const held = new Set(['AAPL', 'NVDA']);

  it('flags "you own X" for an unheld ticker', () => {
    const r = detectUnheldTickerClaim('You own PLTR.', held);
    expect(r).toContain("you don't currently hold PLTR");
  });

  it('flags "you already own X"', () => {
    expect(detectUnheldTickerClaim('You already own ROK.', held)).toContain('ROK');
  });

  it('flags "your position in X" and "you have N shares of X"', () => {
    expect(detectUnheldTickerClaim('Your position in AXON is small.', held)).toContain('AXON');
    expect(detectUnheldTickerClaim('You have 10 shares of TSLA.', held)).toContain('TSLA');
  });

  it('lists up to 3 distinct unheld tickers', () => {
    const r = detectUnheldTickerClaim('You own PLTR, you hold ROK, and your position in TSLA is small.', held)!;
    expect(r).toContain('PLTR');
    expect(r).toContain('ROK');
    expect(r).toContain('TSLA');
  });

  it('does NOT flag a held ticker', () => {
    expect(detectUnheldTickerClaim('You own NVDA.', held)).toBeNull();
  });

  it('skips mixed-case company names (not all-caps tickers)', () => {
    expect(detectUnheldTickerClaim('You own Apple.', held)).toBeNull();
  });

  it('skips common words via NOT_TICKERS', () => {
    expect(detectUnheldTickerClaim('You own THE stock.', held)).toBeNull();
  });

  it('returns null when holdings are empty (data unavailable)', () => {
    expect(detectUnheldTickerClaim('You own PLTR.', new Set())).toBeNull();
  });
});

describe('detectPortfolioGroundingMismatch (composite)', () => {
  it('combines total + ticker corrections in one response', () => {
    const r = detectPortfolioGroundingMismatch(
      'Your portfolio is worth $1,000. You already own PLTR.',
      SNAPSHOT,
    )!;
    expect(r).toContain('$101,000'); // total correction
    expect(r).toContain('PLTR');      // ticker correction
  });

  it('adds a cash correction when the cash figure is fabricated', () => {
    const r = detectPortfolioGroundingMismatch('Your cash is $50,000.', SNAPSHOT)!;
    expect(r).toContain('cash balance');
  });

  it('returns null for a fully grounded response', () => {
    const grounded = 'Your portfolio is worth $101,000. You own AAPL and NVDA.';
    expect(detectPortfolioGroundingMismatch(grounded, SNAPSHOT)).toBeNull();
  });

  it('returns null for null snapshot or empty text', () => {
    expect(detectPortfolioGroundingMismatch('', SNAPSHOT)).toBeNull();
    expect(detectPortfolioGroundingMismatch('Your portfolio is worth $1,000.', null as unknown as PortfolioSnapshot)).toBeNull();
  });
});
