// ═══════════════════════════════════════════════════════════════
// tests/etf-sectors.test.ts — broad-market ETF sector decomposition
// ═══════════════════════════════════════════════════════════════
//
// Run: npx vitest run tests/etf-sectors.test.ts
//
// Verifies that broad-market ETFs (SPY/VOO/QQQ/…) are decomposed into their
// underlying sector weights so the drift engine sees true exposure instead of
// a 100% "Broad Market" bucket (which it skips → spurious "everything
// underweight" triggers).
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  decomposePositionValue,
  getEtfSectorWeights,
  normalizeSectorBucket,
  yahooSectorWeightingsToBuckets,
} from '@/lib/etf-sectors';
import { findDriftTriggers } from '@/lib/noticed/engine';
import type { NoticedRuleInput } from '@/lib/noticed/engine';

function makeInput(positions: any[], cash = 0): NoticedRuleInput {
  return {
    account: {
      cash,
      equity: 100000,
      totalPnl: 0,
      totalPnlPercent: 0,
      dayPnl: 0,
      dayPnlPercent: 0,
    },
    positions,
    watchlistSymbols: [],
    daysSinceLastTrade: 0,
  };
}

describe('etf-sectors — decomposition', () => {
  it('SPY decomposes across underlying sectors and sums back to value', () => {
    const out = decomposePositionValue('SPY', 'Broad Market', 100000);
    const total = Object.values(out).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(100000, 1);
    expect(out.Technology).toBeCloseTo(31000, 0);
    expect(out['Financial Services']).toBeCloseTo(13000, 0);
    expect(out.Healthcare).toBeCloseTo(11000, 0);
    expect(out.Consumer).toBeCloseTo(16000, 0);
  });

  it('QQQ is tech-heavy', () => {
    const out = decomposePositionValue('QQQ', 'Broad Market', 10000);
    expect(out.Technology).toBeCloseTo(4900, 0);
    expect(out.Consumer).toBeCloseTo(2200, 0);
    expect(out['Media & Entertainment']).toBeCloseTo(1600, 0);
  });

  it('non-ETF passes through its sector (normalized to style bucket)', () => {
    expect(decomposePositionValue('AAPL', 'Technology', 10000)).toEqual({ Technology: 10000 });
    expect(decomposePositionValue('KO', 'Consumer Defensive', 10000)).toEqual({ Consumer: 10000 });
    expect(decomposePositionValue('CVX', 'Energy', 10000)).toEqual({ Materials: 10000 });
  });

  it('getEtfSectorWeights is case-insensitive and null for unknown tickers', () => {
    expect(getEtfSectorWeights('voo')).toBeTruthy();
    expect(getEtfSectorWeights('spy')).toBeTruthy();
    expect(getEtfSectorWeights('AAPL')).toBeNull();
  });

  it('normalizeSectorBucket maps GICS → style bucket and falls through', () => {
    expect(normalizeSectorBucket('Consumer Defensive')).toBe('Consumer');
    expect(normalizeSectorBucket('Communication Services')).toBe('Media & Entertainment');
    expect(normalizeSectorBucket('Technology')).toBe('Technology');
    expect(normalizeSectorBucket(undefined)).toBe('Unclassified');
  });

  it('100% SPY vs buffett → tech overweight + financials underweight (NOT "everything underweight")', () => {
    const input = makeInput([
      { symbol: 'SPY', qty: 1, marketValue: 100000, avgCost: 0, totalPnl: 0, totalPnlPercent: 0, sector: 'Broad Market' },
    ]);

    const triggers = findDriftTriggers(input, new Set(), 'buffett');
    const sectors = triggers.map((t) => t.meta.sector);

    // True exposures surface:
    expect(sectors).toContain('Technology');        // 31% vs 15% → overweight
    expect(sectors).toContain('Financial Services'); // 13% vs 30% → underweight
    // Broad Market bucket is never compared:
    expect(sectors).not.toContain('Broad Market');
    // Not the old explosion of "every sector underweight":
    expect(triggers.length).toBeLessThanOrEqual(3);
  });

  it('balanced demo (non-ETF) drift is unchanged by decomposition', () => {
    // Decomposition is a no-op for individual stocks — drift still resolves the
    // same way it did before (demo stays balanced → []).
    const input = makeInput([
      { symbol: 'AAPL', qty: 30, marketValue: 5850, avgCost: 195, totalPnl: 0, totalPnlPercent: 0, sector: 'Technology' },
      { symbol: 'BRK.B', qty: 15, marketValue: 6300, avgCost: 420, totalPnl: 0, totalPnlPercent: 0, sector: 'Financial Services' },
    ], 88000);

    // Technology 5.85% vs 15 → -9; Financials 6.3% vs 30 → -23.7 → underweight.
    const triggers = findDriftTriggers(input, new Set(), 'buffett');
    const fin = triggers.find((t) => t.meta.sector === 'Financial Services');
    expect(fin).toBeDefined();
    expect(fin!.meta.action).toBe('REBALANCE');
  });
});

describe('etf-sectors — dynamic resolver (pure parts)', () => {
  it('yahooSectorWeightingsToBuckets flattens array-of-objects 0–1 fractions → pct buckets', () => {
    const sw = [
      { technology: 0.387 },
      { consumer_cyclical: 0.093 },
      { consumer_defensive: 0.045 },
      { financial_services: 0.121 },
      { energy: 0.035 },
      { basic_materials: 0.017 },
      { realestate: 0.018 },
      { communication_services: 0.095 },
      { industrials: 0.078 },
      { utilities: 0.020 },
      { healthcare: 0.093 },
    ];
    const buckets = yahooSectorWeightingsToBuckets(sw)!;
    expect(buckets.Technology).toBeCloseTo(38.7, 2);
    expect(buckets.Consumer).toBeCloseTo(9.3 + 4.5, 2); // cyclical + defensive roll up
    expect(buckets['Financial Services']).toBeCloseTo(12.1, 2);
    expect(buckets.Materials).toBeCloseTo(3.5 + 1.7, 2); // energy + basic materials
    expect(buckets['Broad Market']).toBeCloseTo(1.8, 2); // realestate
    expect(buckets['Media & Entertainment']).toBeCloseTo(9.5, 2);
  });

  it('yahooSectorWeightingsToBuckets accepts a flat object and returns null when empty', () => {
    const buckets = yahooSectorWeightingsToBuckets({ technology: 0.5, healthcare: 0.5 })!;
    expect(buckets.Technology).toBeCloseTo(50, 2);
    expect(buckets.Healthcare).toBeCloseTo(50, 2);
    expect(yahooSectorWeightingsToBuckets(null)).toBeNull();
    expect(yahooSectorWeightingsToBuckets([])).toBeNull();
  });

  it('decomposePositionValue prefers resolvedWeights over the static profile', () => {
    // Dynamic (live) SPY weights override the static ballpark.
    const resolved = { Technology: 40, 'Financial Services': 20, Healthcare: 15 };
    const out = decomposePositionValue('SPY', 'Broad Market', 100000, resolved);
    expect(out.Technology).toBeCloseTo(40000, 0);
    expect(out['Financial Services']).toBeCloseTo(20000, 0);
    // Static profile would have given 31000 — dynamic must win.
    expect(out.Technology).not.toBeCloseTo(31000, 0);
  });

  it('findDriftTriggers uses the passed etfWeights map to decompose', () => {
    const input = makeInput([
      { symbol: 'SPY', qty: 1, marketValue: 100000, avgCost: 0, totalPnl: 0, totalPnlPercent: 0, sector: 'Broad Market' },
    ]);
    const etfWeights = new Map([['SPY', { Technology: 31, 'Financial Services': 13, Healthcare: 11, Consumer: 16, 'Media & Entertainment': 9, Industrials: 8, Materials: 6, Utilities: 3, 'Broad Market': 3 }]]);
    const triggers = findDriftTriggers(input, new Set(), 'buffett', etfWeights);
    expect(triggers.map((t) => t.meta.sector)).toContain('Technology');
    expect(triggers.map((t) => t.meta.sector)).not.toContain('Broad Market');
  });
});
