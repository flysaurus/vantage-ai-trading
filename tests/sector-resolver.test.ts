import { describe, it, expect } from 'vitest';
import {
  resolveSectorStatic,
  industryStringToSector,
  canonicalizeSymbol,
} from '@/lib/sector-resolver';

describe('sector-resolver', () => {
  it('canonicalizes symbols (case + class-share separators)', () => {
    expect(canonicalizeSymbol('aapl')).toBe('AAPL');
    expect(canonicalizeSymbol('brk.b')).toBe('BRK.B');
    expect(canonicalizeSymbol('BRK/B')).toBe('BRK.B');
    expect(canonicalizeSymbol('BRK-B')).toBe('BRK.B');
  });

  it('maps known symbols via the static map', () => {
    expect(resolveSectorStatic('AAPL')).toBe('Technology');
    expect(resolveSectorStatic('JPM')).toBe('Financial Services');
    expect(resolveSectorStatic('KO')).toBe('Consumer Defensive');
    expect(resolveSectorStatic('BRK.B')).toBe('Financial Services');
    expect(resolveSectorStatic('VOO')).toBe('Broad Market');
    expect(resolveSectorStatic('XLK')).toBe('Technology');
  });

  it('returns null for unknown symbols', () => {
    expect(resolveSectorStatic('ZZZZZZ')).toBeNull();
  });

  it('prefers an industry string over the static map', () => {
    // An explicit industry that maps elsewhere should win.
    expect(industryStringToSector('Software - Application')).toBe('Technology');
    expect(industryStringToSector('Banks - Diversified')).toBe('Financial Services');
    expect(industryStringToSector('')).toBeNull();
    expect(industryStringToSector(null)).toBeNull();
  });

  it('maps finnhub industry strings', () => {
    expect(industryStringToSector('Software & Services')).toBe('Technology');
    expect(industryStringToSector('Banks')).toBe('Financial Services');
  });
});
