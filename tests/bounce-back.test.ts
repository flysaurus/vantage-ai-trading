// ═══════════════════════════════════════════════════════════════
// tests/bounce-back.test.ts — deterministic "bounce-back candidate" trigger (v1)
// ═══════════════════════════════════════════════════════════════
//
// Run: npx vitest run tests/bounce-back.test.ts
//
// Verifies the 4-filter CONJUNCTION (any single fail = silent), the v1
// materiality assessment for filter (a) (magnitude vs OWN history + market
// reaction vs benchmark), the concurrent-active cap (MAX_CONCURRENT_ACTIVE) with
// keep-alive persistence, the historical-reversion evidence (evidence only), and
// that the deterministic copy stays tone-compliant (review-only, no urgency,
// mandatory closing phrase).
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  evaluateBounceBack,
  assessMateriality,
  computeHistoricalReversion,
  selectBounceBackCandidates,
  buildBounceBackTrigger,
  SECTOR_ETF,
  MAX_CONCURRENT_ACTIVE,
  type BounceCandidate,
  type BounceBackData,
} from '@/lib/noticed/bounce-back';

// A fully-qualifying input: revenue growing, an in-line beat, broad decline, and
// P/E 20% below own 3yr average (25 → 20 = -20%).
function qualifyingData(overrides: Partial<BounceBackData> = {}): BounceBackData {
  return {
    revenueGrowthTTM: 6.2,
    surpriseHistoryPct: [1.01, 2.4, 1.8, 0.9], // newest-first; latest is a BEAT
    earningsReactionExcessPp: null,
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
    materiality: null,
    historical: null,
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

  it('returns the materiality assessment alongside the decision', () => {
    const r = evaluateBounceBack(qualifyingData());
    expect(r!.materiality.latestSurprisePct).toBe(1.01);
    expect(r!.materiality.disqualified).toBe(false);
  });

  describe('filter (a) — fundamentals intact', () => {
    it('fails on declining revenue', () => {
      expect(evaluateBounceBack(qualifyingData({ revenueGrowthTTM: -1.5 }))).toBeNull();
    });
    it('fails when revenue growth is missing (cannot confirm intact)', () => {
      expect(evaluateBounceBack(qualifyingData({ revenueGrowthTTM: null }))).toBeNull();
    });

    // v1: a miss alone is NOT disqualifying — only a MATERIAL, COMPANY-SPECIFIC one.
    it('disqualifies a MATERIAL miss the market singled out (both conditions)', () => {
      expect(
        evaluateBounceBack(
          qualifyingData({
            surpriseHistoryPct: [-8, 1.2, 1.0, 0.9], // -8 vs own ~1% norm ⇒ material
            earningsReactionExcessPp: -5,            // trailed benchmark by 5pp ⇒ company-specific
          }),
        ),
      ).toBeNull();
    });

    it('KEEPS a material miss the market took in stride (not company-specific)', () => {
      const r = evaluateBounceBack(
        qualifyingData({
          surpriseHistoryPct: [-8, 1.2, 1.0, 0.9],
          earningsReactionExcessPp: -1, // tracked the benchmark
        }),
      );
      expect(r).not.toBeNull();
      expect(r!.materiality.missIsMaterial).toBe(true);
      expect(r!.materiality.reactionCompanySpecific).toBe(false);
    });

    it('KEEPS a material miss whose reaction could not be measured (no invented evidence)', () => {
      const r = evaluateBounceBack(
        qualifyingData({ surpriseHistoryPct: [-8, 1.2, 1.0, 0.9], earningsReactionExcessPp: null }),
      );
      expect(r).not.toBeNull();
      expect(r!.materiality.missIsMaterial).toBe(true);
      expect(r!.materiality.disqualified).toBe(false);
    });

    it('KEEPS a small miss that is in line with its own history', () => {
      const r = evaluateBounceBack(
        qualifyingData({ surpriseHistoryPct: [-1.0, 0.5, 0.8, 0.2] }),
      );
      expect(r).not.toBeNull();
      expect(r!.materiality.missIsMaterial).toBe(false);
    });

    it('KEEPS a miss that is normal FOR THIS COMPANY (normally misses)', () => {
      const r = evaluateBounceBack(
        qualifyingData({ surpriseHistoryPct: [-5, -4.5, -5.5, -4.0] }),
      );
      expect(r).not.toBeNull();
      expect(r!.materiality.missIsMaterial).toBe(false);
    });

    it('allows a null surprise history (no miss data)', () => {
      expect(evaluateBounceBack(qualifyingData({ surpriseHistoryPct: [] }))).not.toBeNull();
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

describe('assessMateriality — measurable only, never invented', () => {
  it('reports no materiality for a beat', () => {
    const m = assessMateriality([2.0, 1.0, 1.5], null);
    expect(m.missIsMaterial).toBe(false);
    expect(m.disqualified).toBe(false);
    expect(m.latestSurprisePct).toBe(2.0);
    expect(m.medianSurprisePct).toBe(1.25);
  });

  it('flags material + company-specific as disqualified with a reason', () => {
    const m = assessMateriality([-9, -1, -1, -1], -4);
    expect(m.missIsMaterial).toBe(true);
    expect(m.reactionCompanySpecific).toBe(true);
    expect(m.disqualified).toBe(true);
    expect(m.reason).toMatch(/missed by -9\.0%/);
  });

  it('disqualifies AT the reaction boundary (-3pp) but not just inside it', () => {
    expect(assessMateriality([-9, -1, -1, -1], -3).disqualified).toBe(true);
    // -2.9pp is not company-specific ⇒ kept
    const m2 = assessMateriality([-9, -1, -1, -1], -2.9);
    expect(m2.reactionCompanySpecific).toBe(false);
    expect(m2.disqualified).toBe(false);
  });

  it('handles an empty/null history without throwing', () => {
    const m = assessMateriality([], null);
    expect(m.latestSurprisePct).toBeNull();
    expect(m.disqualified).toBe(false);
  });
});

describe('computeHistoricalReversion — evidence only', () => {
  // 5 uptrending cycles, each 33 daily bars: 5 flat at the running level L → a
  // 5-bar ~8% dip → a 23-bar rise to 1.15·L. Every cycle bottoms ≥6% below its
  // local peak (so it clears the -6% threshold) and recovers well past half of
  // it (so the detector re-arms). Because each cycle ends higher than it started,
  // the 60-bar forward window — ~1.8 cycles — lands on a higher price.
  function synthBars(): { t: number; c: number }[] {
    const bars: { t: number; c: number }[] = [];
    let t = 0;
    let level = 100;
    const push = (c: number) => bars.push({ t: (t++) * 86400000, c });
    for (let cycle = 0; cycle < 5; cycle++) {
      for (let i = 0; i < 5; i++) push(level);
      for (let i = 1; i <= 5; i++) push(level * (1 - 0.016 * i)); // down to 0.92·level
      for (let i = 1; i <= 23; i++) push(level * (0.92 + (0.23 * i) / 23)); // up to 1.15·level
      level = level * 1.15;
    }
    return bars;
  }

  it('counts distinct past episodes and reports the forward outcome', () => {
    const r = computeHistoricalReversion(synthBars(), -6);
    expect(r).not.toBeNull();
    expect(r!.sample).toBeGreaterThanOrEqual(3);
    expect(r!.sufficient).toBe(true);
    expect(r!.positiveRate).not.toBeNull();
    expect(r!.medianForwardPct).toBeGreaterThan(0);
  });

  it('is insufficient when a drawdown this deep has no precedent', () => {
    const r = computeHistoricalReversion(synthBars(), -40); // deeper than any past dip
    expect(r).not.toBeNull();
    expect(r!.sufficient).toBe(false);
    expect(r!.sample).toBe(0);
    expect(r!.positiveRate).toBeNull();
  });

  it('returns null for a non-negative current drop or short history', () => {
    expect(computeHistoricalReversion(synthBars(), 4)).toBeNull();
    expect(computeHistoricalReversion(synthBars().slice(0, 40), -6)).toBeNull();
    expect(computeHistoricalReversion([], -6)).toBeNull();
  });
});

describe('selectBounceBackCandidates — concurrent-active cap', () => {
  const fresh = (n: number) =>
    Array.from({ length: n }, (_, i) => makeCandidate({ symbol: `S${i}`, discountPct: 20 + i }));

  it('fires at most MAX_CONCURRENT_ACTIVE fresh candidates, most-discounted first', () => {
    const { fire, keepAlive } = selectBounceBackCandidates(fresh(6), new Set<string>());
    expect(fire).toHaveLength(MAX_CONCURRENT_ACTIVE);
    expect(fire.map((c) => c.symbol)).toEqual(['S5', 'S4', 'S3', 'S2']);
    expect(keepAlive).toEqual([]);
  });

  it('counts live cards against the cap', () => {
    const candidates = [makeCandidate({ symbol: 'KO', discountPct: 40 }), ...fresh(5)];
    const { fire, keepAlive } = selectBounceBackCandidates(
      candidates,
      new Set(['BOUNCE_KO']),
    );
    expect(keepAlive.map((c) => c.symbol)).toEqual(['KO']);
    expect(fire).toHaveLength(MAX_CONCURRENT_ACTIVE - 1); // 3, not 4
    expect(fire.map((c) => c.symbol)).toEqual(['S4', 'S3', 'S2']);
  });

  it('fires nothing when the cap is already saturated by live cards', () => {
    const candidates = [makeCandidate({ symbol: 'KO' }), ...fresh(3)];
    const active = new Set(['BOUNCE_KO', 'BOUNCE_S2', 'BOUNCE_S1', 'BOUNCE_S0']);
    const { fire, keepAlive } = selectBounceBackCandidates(candidates, active);
    expect(fire).toEqual([]);
    expect(keepAlive.map((c) => c.symbol)).toEqual(['KO', 'S0', 'S1', 'S2']);
  });

  it('lets a previously-fired symbol re-fire once its card has resolved', () => {
    // No permanent exclusion any more: an inactive BOUNCE_KO is simply fresh.
    const { fire } = selectBounceBackCandidates([makeCandidate({ symbol: 'KO' })], new Set<string>());
    expect(fire.map((c) => c.symbol)).toEqual(['KO']);
  });

  it('honours an explicit cap override', () => {
    const { fire } = selectBounceBackCandidates(fresh(5), new Set<string>(), 2);
    expect(fire).toHaveLength(2);
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

  it('does not claim "no miss" when a miss happened', () => {
    const t = buildBounceBackTrigger(
      makeCandidate({
        materiality: {
          latestSurprisePct: -3.5,
          medianSurprisePct: 0.4,
          missIsMaterial: true,
          reactionExcessPp: -1,
          reactionCompanySpecific: false,
          disqualified: false,
          reason: null,
        },
      }),
    );
    expect(t.context).not.toMatch(/didn't miss/);
    expect(t.context).toMatch(/3\.5% light/);
  });

  it('mentions historical reversion only when the sample is sufficient', () => {
    const withEvidence = buildBounceBackTrigger(
      makeCandidate({ historical: { sample: 5, medianForwardPct: 12, positiveRate: 0.8, sufficient: true } }),
    );
    expect(withEvidence.context).toMatch(/comparable drawdowns/);
    const withoutEvidence = buildBounceBackTrigger(
      makeCandidate({ historical: { sample: 1, medianForwardPct: 3, positiveRate: 1, sufficient: false } }),
    );
    expect(withoutEvidence.context).not.toMatch(/comparable drawdowns/);
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
