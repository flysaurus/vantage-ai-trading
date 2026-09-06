import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CONC_SINGLE_PCT,
  DEFAULT_CONC_TOP3_PCT,
  STYLE_CONC_DEFAULTS,
  CONCENTRATION_PRESETS,
  suggestedPresetForStyle,
  resolveConcentrationThresholds,
} from '@/lib/concentration';

describe('concentration thresholds — resolver', () => {
  it('uses explicit user values when provided', () => {
    const r = resolveConcentrationThresholds('soros', 42, 77);
    expect(r).toEqual({ single: 42, top3: 77, custom: true });
  });

  it('falls back to style suggestion when user values are null', () => {
    const r = resolveConcentrationThresholds('soros', null, null);
    expect(r.single).toBe(STYLE_CONC_DEFAULTS.soros.single);
    expect(r.top3).toBe(STYLE_CONC_DEFAULTS.soros.top3);
    expect(r.custom).toBe(false);
  });

  it('falls back to global default for unknown style', () => {
    const r = resolveConcentrationThresholds('bogus-style', null, null);
    expect(r.single).toBe(DEFAULT_CONC_SINGLE_PCT);
    expect(r.top3).toBe(DEFAULT_CONC_TOP3_PCT);
  });

  it('mixes a user value with a style default independently', () => {
    const r = resolveConcentrationThresholds('lynch', 99, null);
    expect(r.single).toBe(99);
    expect(r.top3).toBe(STYLE_CONC_DEFAULTS.lynch.top3);
    expect(r.custom).toBe(true);
  });
});

describe('concentration thresholds — style defaults + presets', () => {
  it('suggests concentrated for concentration-comfortable styles', () => {
    for (const s of ['buffett', 'munger', 'soros']) {
      expect(suggestedPresetForStyle(s)).toBe('concentrated');
    }
  });

  it('suggests diversified for lynch (growth/diversification)', () => {
    expect(suggestedPresetForStyle('lynch')).toBe('diversified');
  });

  it('defaults to balanced for livermore + unknown', () => {
    expect(suggestedPresetForStyle('livermore')).toBe('balanced');
    expect(suggestedPresetForStyle(null)).toBe('balanced');
    expect(suggestedPresetForStyle('whatever')).toBe('balanced');
  });

  it('presets carry the expected numeric bands', () => {
    const byId = Object.fromEntries(CONCENTRATION_PRESETS.map((p) => [p.id, p]));
    expect(byId.concentrated.single).toBeGreaterThan(byId.balanced.single);
    expect(byId.balanced.single).toBeGreaterThan(byId.diversified.single);
    expect(byId.concentrated.top3).toBeGreaterThan(byId.balanced.top3);
    expect(byId.balanced.top3).toBeGreaterThan(byId.diversified.top3);
  });

  it('style defaults are all sane (single < top3, within 1-100)', () => {
    for (const s of Object.keys(STYLE_CONC_DEFAULTS) as Array<keyof typeof STYLE_CONC_DEFAULTS>) {
      const d = STYLE_CONC_DEFAULTS[s];
      expect(d.single).toBeGreaterThan(0);
      expect(d.top3).toBeGreaterThan(d.single);
      expect(d.top3).toBeLessThanOrEqual(100);
    }
  });
});
