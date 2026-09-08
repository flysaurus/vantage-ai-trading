// ═══════════════════════════════════════════════════════════════
// tests/bounce-back.test.ts — deterministic "bounce-back candidate" trigger
// ═══════════════════════════════════════════════════════════════
//
// Run: npx vitest run tests/bounce-back.test.ts
//
// Verifies the 4-filter CONJUNCTION (any single fail = silent), the one-per-
// week frequency cap (single most-discounted candidate + already-fired
// exclusion + keep-alive persistence), and that the deterministic copy is
// tone-compliant (review-only, no urgency, mandatory closing phrase).
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  evaluateBounceBack,
  selectWeeklyBounceBack,
  buildBounceBackTrigger,
  SECTOR_ETF,
  type BounceCandidate,
  type BounceBackData,
} from '@/lib/noticed/bounce-back';

// A fully-qualifying input: revenue growing, no miss, broad decline, and
// P/E 20% below own 3yr average (25 → 20 = -20%).
function qualifyingData(overrides: Partial<BounceBackData> = {}): BounceBackData {
  return {
    revenueGrowthTTM: 6.2,
    latestSurprisePct: 1.01,
    tickerRet: -14,
    benchmarkRet: -9,
    peCurrent: 20,
    peAvg: 25,
    pbCurrent: null,
    pbAvg: null,
    years: 3,
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<BounceCandidate> = {}): BounceCandidate {
  return {
    symbol: 'KO',
    discountType: 'pe',
    discountPct: 20,
    peCurrent: 20,
    peAvg: 25,
    pbCurrent: null,
    pbAvg: null,
    tickerRet: -14,
    benchmarkRet: -9,
    benchmarkSymbol: 'XLP',
    years: 3,
    ...overrides,
  };
}

describe('evaluateBounceBack — 4-filter conjunction', () => {
  it('fires when all four filters pass', () => {
    const r = evaluateBounceBack(qualifyingData());
    expect(r).not.toBeNull();
    expect(r!.discountType).toBe('pe');
    expect(r!.discountPct).toBeGreaterThanOrEqual(20);
  });

  it('uses P/B fallback when P/E is unavailable', () => {
    const r = evaluateBounceBack(
      qualifyingData({ peCurrent: null, peAvg: null, pbCurrent: 1.6, pbAvg: 2.0 }),
    );
    expect(r).not.toBeNull();
    expect(r!.discountType).toBe('pb');
  });

  describe('filter (a) — fundamentals intact', () => {
    it('fails on declining revenue', () => {
      expect(evaluateBounceBack(qualifyingData({ revenueGrowthTTM: -1.5 }))).toBeNull();
    });
    it('fails when revenue growth is missing (cannot confirm intact)', () => {
      expect(evaluateBounceBack(qualifyingData({ revenueGrowthTTM: null }))).toBeNull();
    });
    it('fails on latest-earnings miss', () => {
      expect(evaluateBounceBack(qualifyingData({ latestSurprisePct: -5.2 }))).toBeNull();
    });
    it('allows a null surprise (no miss data)', () => {
      expect(evaluateBounceBack(qualifyingData({ latestSurprisePct: null }))).not.toBeNull();
    });
  });

  describe('filter (b) — broad decline, not company-specific', () => {
    it('fails when ticker is not down enough', () => {
      expect(evaluateBounceBack(qualifyingData({ tickerRet: -5 }))).toBeNull();
    });
    it('fails when benchmark is not also down', () => {
      expect(evaluateBounceBack(qualifyingData({ benchmarkRet: 2 }))).toBeNull();
    });
    it('fails when ticker underperforms benchmark by >10pp (company-specific)', () => {
      expect(evaluateBounceBack(qualifyingData({ tickerRet: -25, benchmarkRet: -9 }))).toBeNull();
    });
    it('passes when ticker trails benchmark by exactly 10pp (boundary)', () => {
      expect(evaluateBounceBack(qualifyingData({ tickerRet: -19, benchmarkRet: -9 }))).not.toBeNull();
    });
    it('fails when return data is missing', () => {
      expect(evaluateBounceBack(qualifyingData({ tickerRet: null }))).toBeNull();
      expect(evaluateBounceBack(qualifyingData({ benchmarkRet: null }))).toBeNull();
    });
  });

  describe('filter (c) — valuation below own history', () => {
    it('fails when P/E is not at least 20% below own average', () => {
      // 25 → 22 = -12% → below threshold
      expect(evaluateBounceBack(qualifyingData({ peCurrent: 22, peAvg: 25 }))).toBeNull();
    });
    it('fails when no valuation data is available', () => {
      expect(
        evaluateBounceBack(qualifyingData({ peCurrent: null, peAvg: null, pbCurrent: null, pbAvg: null })),
      ).toBeNull();
    });
    it('ignores negative averages', () => {
      expect(evaluateBounceBack(qualifyingData({ peCurrent: 10, peAvg: -5 }))).toBeNull();
    });
  });
});

describe('selectWeeklyBounceBack — one-per-week cap', () => {
  it('surfaces only the single most-discounted fresh candidate', () => {
    const candidates = [
      makeCandidate({ symbol: 'KO', discountPct: 20 }),
      makeCandidate({ symbol: 'JNJ', discountPct: 35 }),
      makeCandidate({ symbol: 'PG', discountPct: 25 }),
    ];
    const { fire, keepAlive } = selectWeeklyBounceBack(
      candidates,
      new Set<string>(),
      new Set<string>(),
    );
    expect(fire?.symbol).toBe('JNJ');
    expect(keepAlive).toEqual([]);
  });

  it('excludes already-fired symbols from fresh candidacy', () => {
    const candidates = [
      makeCandidate({ symbol: 'KO', discountPct: 20 }),
      makeCandidate({ symbol: 'JNJ', discountPct: 35 }),
    ];
    const { fire } = selectWeeklyBounceBack(
      candidates,
      new Set(['JNJ']), // JNJ already nudged
      new Set<string>(),
    );
    expect(fire?.symbol).toBe('KO');
  });

  it('keeps already-fired, still-qualifying, still-active cards alive', () => {
    const candidates = [makeCandidate({ symbol: 'JNJ', discountPct: 35 })];
    const { fire, keepAlive } = selectWeeklyBounceBack(
      candidates,
      new Set(['JNJ']),
      new Set(['BOUNCE_JNJ']), // still active
    );
    expect(fire).toBeNull(); // nothing fresh this week
    expect(keepAlive.map((c) => c.symbol)).toEqual(['JNJ']);
  });

  it('does NOT keep-alive a fired symbol that recovered (not in candidates)', () => {
    // If a symbol is no longer qualifying it won't be in candidates at all.
    const candidates: BounceCandidate[] = [];
    const { fire, keepAlive } = selectWeeklyBounceBack(
      candidates,
      new Set(['KO']),
      new Set(['BOUNCE_KO']),
    );
    expect(fire).toBeNull();
    expect(keepAlive).toEqual([]);
  });
});

describe('buildBounceBackTrigger — tone + CTA', () => {
  const trigger = buildBounceBackTrigger(makeCandidate());

  it('is a single-position review (never a buy/trade instruction)', () => {
    expect(trigger.meta.action).toBe('REVIEW_POSITION:KO');
  });

  it('uses the approved title + accent variant + magnifier icon', () => {
    expect(trigger.title).toBe('KO — quality position, temporarily discounted');
    expect(trigger.variant).toBe('accent');
    expect(trigger.icon).toBe('🔎');
  });

  it('always ends with the mandatory closing phrase', () => {
    expect(trigger.context).toMatch(/Worth reviewing the position yourself\.\s*$/);
  });

  it('has no urgency language', () => {
    expect(trigger.context.toLowerCase()).not.toMatch(/act now|don't miss|jump on|buy now/);
    expect(trigger.context).not.toContain('!');
  });

  it('uses a stable one-per-symbol trigger key', () => {
    expect(trigger.trigger_key).toBe('BOUNCE_KO');
    expect(trigger.trigger_type).toBe('bounce_back');
  });
});

describe('SECTOR_ETF benchmark map', () => {
  it('maps sector labels to ETFs with SPY fallback', () => {
    expect(SECTOR_ETF['Technology']).toBe('XLK');
    expect(SECTOR_ETF['Healthcare']).toBe('XLV');
    expect(SECTOR_ETF['Financial Services']).toBe('XLF');
    expect(SECTOR_ETF['Consumer Defensive']).toBe('XLP');
    expect(SECTOR_ETF['Utilities']).toBe('XLU');
    expect(SECTOR_ETF['Does Not Exist']).toBeUndefined();
  });
});
