import { describe, it, expect } from 'vitest';
import {
  computePortfolioHealth,
  normalizeRiskTolerance,
  sectorBeta,
  RISK_BANDS,
} from '@/lib/insights/health-score';

const pos = (symbol: string, marketValue: number, sector?: string) => ({ symbol, marketValue, sector });

describe('portfolio health — determinism', () => {
  it('returns byte-identical results for identical input (no randomness, no clock)', () => {
    const input = {
      positions: [pos('AAPL', 40000, 'technology'), pos('JNJ', 30000, 'healthcare'), pos('JPM', 30000, 'financials')],
      cash: 10000,
      totalPnlPercent: 8.4,
      riskTolerance: 'Moderate',
    };
    const a = computePortfolioHealth(input);
    const b = computePortfolioHealth(input);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('is order-independent (same portfolio, different input order)', () => {
    const forward = computePortfolioHealth({
      positions: [pos('AAPL', 40000, 'technology'), pos('JNJ', 30000, 'healthcare'), pos('JPM', 30000, 'financials')],
      cash: 5000,
      totalPnlPercent: 4,
      riskTolerance: 'Moderate',
    });
    const reversed = computePortfolioHealth({
      positions: [pos('JPM', 30000, 'financials'), pos('JNJ', 30000, 'healthcare'), pos('AAPL', 40000, 'technology')],
      cash: 5000,
      totalPnlPercent: 4,
      riskTolerance: 'Moderate',
    });
    expect(forward.subScores).toEqual(reversed.subScores);
    expect(forward.score).toBe(reversed.score);
  });
});

describe('portfolio health — documented weighting', () => {
  it('overall === round(0.40*div + 0.35*risk + 0.25*ret)', () => {
    const r = computePortfolioHealth({
      positions: [pos('AAPL', 60000, 'technology'), pos('XOM', 40000, 'energy')],
      cash: 0,
      totalPnlPercent: 12,
      riskTolerance: 'Aggressive',
    });
    const { diversification, riskBalance, returns } = r.subScores;
    expect(r.score).toBe(Math.round(0.4 * diversification + 0.35 * riskBalance + 0.25 * returns));
  });

  it('returns sub-score maps 0% → 50, +20% → 100, −20% → 0', () => {
    const mk = (pct: number) =>
      computePortfolioHealth({
        positions: [pos('AAA', 50, 'utilities'), pos('BBB', 50, 'utilities')],
        cash: 50,
        totalPnlPercent: pct,
        riskTolerance: 'Moderate',
      }).subScores.returns;
    expect(mk(0)).toBe(50);
    expect(mk(20)).toBe(100);
    expect(mk(-20)).toBe(0);
    expect(mk(50)).toBe(100);
    expect(mk(-50)).toBe(0);
  });
});

describe('portfolio health — diversification reacts to concentration', () => {
  it('a single-name portfolio scores far worse than an even 10-name portfolio', () => {
    const concentrated = computePortfolioHealth({
      positions: [pos('NVDA', 100000, 'technology')],
      cash: 0,
      totalPnlPercent: 10,
      riskTolerance: 'Moderate',
    });
    const spread = computePortfolioHealth({
      positions: Array.from({ length: 10 }, (_, i) => pos(`S${i}`, 10000, ['technology', 'healthcare', 'financials', 'utilities', 'energy'][i % 5])),
      cash: 0,
      totalPnlPercent: 10,
      riskTolerance: 'Moderate',
    });
    expect(concentrated.subScores.diversification).toBeLessThan(spread.subScores.diversification);
    expect(spread.subScores.diversification).toBeGreaterThan(60);
  });

  it('reports a real top holding and real % in the supporting line', () => {
    const r = computePortfolioHealth({
      positions: [pos('NVDA', 75000, 'technology'), pos('JNJ', 25000, 'healthcare')],
      cash: 0,
      totalPnlPercent: 5,
      riskTolerance: 'Moderate',
    });
    expect(r.supportingLine).toContain('NVDA');
    expect(r.supportingLine).toContain('75.0%');
  });

  it('explain prompt embeds the real score and all three sub-scores', () => {
    const r = computePortfolioHealth({
      positions: [pos('NVDA', 75000, 'technology'), pos('JNJ', 25000, 'healthcare')],
      cash: 0,
      totalPnlPercent: 5,
      riskTolerance: 'Moderate',
    });
    expect(r.explainPrompt).toContain(String(r.score));
    expect(r.explainPrompt).toContain(String(r.subScores.diversification));
    expect(r.explainPrompt).toContain(String(r.subScores.riskBalance));
    expect(r.explainPrompt).toContain(String(r.subScores.returns));
  });
});

describe('portfolio health — risk balance vs stated tolerance', () => {
  it('same portfolio scores better when tolerance matches its beta', () => {
    const tech = [pos('A', 50000, 'technology'), pos('B', 50000, 'technology')]; // beta 1.25
    const aggressive = computePortfolioHealth({ positions: tech, cash: 0, totalPnlPercent: 0, riskTolerance: 'aggressive' });
    const conservative = computePortfolioHealth({ positions: tech, cash: 0, totalPnlPercent: 0, riskTolerance: 'conservative' });
    expect(aggressive.subScores.riskBalance).toBeGreaterThan(conservative.subScores.riskBalance);
  });

  it('large idle cash penalises risk balance', () => {
    // industrials beta = 1.05 = the moderate mid, so the base score is 100
    // and the cash-drag penalties are directly observable.
    const invested = [pos('A', 25000, 'industrials'), pos('B', 25000, 'industrials')];
    const lean = computePortfolioHealth({ positions: invested, cash: 5000, totalPnlPercent: 0, riskTolerance: 'moderate' });
    const cashHeavy = computePortfolioHealth({ positions: invested, cash: 50000, totalPnlPercent: 0, riskTolerance: 'moderate' });
    expect(lean.subScores.riskBalance).toBe(100);
    expect(cashHeavy.subScores.riskBalance).toBeLessThan(lean.subScores.riskBalance);
  });
});

describe('portfolio health — guards', () => {
  it('handles an empty portfolio deterministically without NaN', () => {
    const r = computePortfolioHealth({ positions: [], cash: 0, totalPnlPercent: 0, riskTolerance: 'Moderate' });
    expect(r.score).toBe(0);
    expect(Number.isFinite(r.subScores.diversification)).toBe(true);
    expect(Number.isFinite(r.subScores.riskBalance)).toBe(true);
    expect(Number.isFinite(r.subScores.returns)).toBe(true);
  });

  it('never emits NaN with missing sector / missing pnl', () => {
    const r = computePortfolioHealth({
      positions: [pos('ZZZ', 1000, undefined)],
      cash: 0,
      totalPnlPercent: NaN as unknown as number,
      riskTolerance: null,
    });
    expect(Number.isNaN(r.score)).toBe(false);
    expect(Number.isNaN(r.subScores.diversification)).toBe(false);
  });

  it('normalises risk tolerance strings and unknown sectors', () => {
    expect(normalizeRiskTolerance('Conservative')).toBe('conservative');
    expect(normalizeRiskTolerance('AGGRESSIVE')).toBe('aggressive');
    expect(normalizeRiskTolerance(undefined)).toBe('moderate');
    expect(normalizeRiskTolerance('nonsense')).toBe('moderate');
    expect(sectorBeta('Information Technology')).toBe(1.25);
    expect(sectorBeta(null)).toBe(1.0);
    expect(RISK_BANDS.moderate.mid).toBeGreaterThan(RISK_BANDS.conservative.mid);
  });
});
