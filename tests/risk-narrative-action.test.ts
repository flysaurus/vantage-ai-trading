import { describe, it, expect } from 'vitest';
import { computeDeterministicActions } from '@/lib/risk-narrative-action';
import type { RiskNarrativeActionInput } from '@/lib/risk-narrative-action';

// Helper: build a position with a target market value via qty=1, currentPrice=mv.
const pos = (symbol: string, mv: number, sector?: string): RiskNarrativeActionInput => ({
  symbol,
  qty: 1,
  currentPrice: mv,
  avgCost: mv * 0.9,
  sector,
});

describe('computeDeterministicActions', () => {
  it('returns [] for empty positions', () => {
    expect(computeDeterministicActions([], null, null, null, new Map())).toEqual([]);
  });

  it('flags REVIEW_POSITION + REBALANCE for a fully concentrated book (default 20/50)', () => {
    // Single 100% holding → both single > 20 and top3 > 50 fire.
    const actions = computeDeterministicActions(
      [pos('SPY', 1000)],
      null,
      null,
      null,
      new Map(),
    );
    expect(actions).toContain('REVIEW_POSITION:SPY');
    expect(actions).toContain('REBALANCE');
  });

  it('respects custom thresholds (soros 30/65) — Fidelity case fires Review only', () => {
    // SPY 35.7% > 30 → Review; top-3 64.4% < 65 → NO Rebalance.
    const positions = [
      pos('SPY', 357),
      pos('VOO', 239),
      pos('QQQ', 48),
      pos('AAPL', 40),
      pos('MSFT', 40),
      pos('NVDA', 40),
      pos('AMZN', 40),
      pos('GOOGL', 40),
      pos('META', 40),
      pos('TSLA', 40),
      pos('BRK.B', 40),
      pos('JPM', 36),
    ]; // total 1000 → SPY 35.7%, top3 (SPY+VOO+QQQ) = 64.4%
    const actions = computeDeterministicActions(positions, 'soros', null, null, new Map());
    expect(actions).toContain('REVIEW_POSITION:SPY');
    expect(actions).not.toContain('REBALANCE');
  });

  it('respects custom thresholds — Alpaca case fires Review AND Rebalance', () => {
    // XLF 30.1% > 30 → Review; top-3 65.7% > 65 → Rebalance.
    const positions = [
      pos('XLF', 301),
      pos('SPY', 226),
      pos('QQQ', 130),
      pos('AAPL', 40),
      pos('MSFT', 40),
      pos('NVDA', 40),
      pos('AMZN', 40),
      pos('GOOGL', 40),
      pos('META', 40),
      pos('TSLA', 40),
      pos('BRK.B', 40),
      pos('JPM', 23),
    ]; // total 1000 → XLF 30.1%, top3 (XLF+SPY+QQQ) = 65.7%
    const actions = computeDeterministicActions(positions, 'soros', null, null, new Map());
    expect(actions).toContain('REVIEW_POSITION:XLF');
    expect(actions).toContain('REBALANCE');
  });

  it('explicit numeric thresholds work without a style', () => {
    // Force top3 threshold high enough that 64.4% does NOT fire, single low enough to fire.
    const positions = [
      pos('SPY', 357),
      pos('VOO', 239),
      pos('QQQ', 48),
      pos('AAPL', 40),
      pos('MSFT', 40),
      pos('NVDA', 40),
      pos('AMZN', 40),
      pos('GOOGL', 40),
      pos('META', 40),
      pos('TSLA', 40),
      pos('BRK.B', 40),
      pos('JPM', 36),
    ];
    const actions = computeDeterministicActions(positions, null, 10, 70, new Map());
    expect(actions).toContain('REVIEW_POSITION:SPY');
    expect(actions).not.toContain('REBALANCE');
  });

  it('dedupes repeated REBALANCE markers to a single action', () => {
    const actions = computeDeterministicActions(
      [pos('SPY', 1000)],
      null,
      null,
      null,
      new Map(),
    );
    expect(actions.filter((a) => a === 'REBALANCE').length).toBe(1);
  });
});
