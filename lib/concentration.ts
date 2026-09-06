/**
 * ─── Concentration Thresholds ───────────────────────────────
 * Single source of truth for the position-concentration alert
 * thresholds used by the AI Noticed feed (REVIEW_POSITION / REBALANCE cards).
 *
 * Values are per-user customisable (stored on `users.conc_single_pct` /
 * `users.conc_top3_pct`). When unset, we fall back to an investor-style
 * suggestion, then to a global default.
 *
 * Isomorphic — safe to import from server (engine) and client (settings/onboarding).
 */

import type { InvestorStyleKey } from '@/lib/content/investor-styles';

export const DEFAULT_CONC_SINGLE_PCT = 20; // largest single position >20% → REVIEW_POSITION CTA
export const DEFAULT_CONC_TOP3_PCT = 50; // top-3 holdings >50% → REBALANCE CTA

/** Style-suggested thresholds (used only when the user hasn't set their own). */
export const STYLE_CONC_DEFAULTS: Record<InvestorStyleKey, { single: number; top3: number }> = {
  buffett: { single: 30, top3: 65 }, // concentration is how patient value wins
  munger: { single: 30, top3: 65 }, // "concentrate" is the whole thesis
  soros: { single: 30, top3: 65 }, // asymmetric macro bets
  livermore: { single: 20, top3: 50 }, // momentum: bet hard but cut fast
  lynch: { single: 12, top3: 40 }, // GARP: spread across many growth stories
};

export interface ConcentrationPreset {
  id: 'concentrated' | 'balanced' | 'diversified';
  label: string;
  single: number;
  top3: number;
  blurb: string;
}

/** Selectable profiles for onboarding / quick-pick in settings. */
export const CONCENTRATION_PRESETS: ConcentrationPreset[] = [
  {
    id: 'concentrated',
    label: 'Concentrated',
    single: 30,
    top3: 65,
    blurb: 'Big bets are fine — flag me only when one name really dominates.',
  },
  {
    id: 'balanced',
    label: 'Balanced',
    single: 20,
    top3: 50,
    blurb: 'Standard guardrails. The sensible middle ground.',
  },
  {
    id: 'diversified',
    label: 'Diversified',
    single: 12,
    top3: 40,
    blurb: 'Keep every single bet small — warn me early.',
  },
];

export function presetById(id: string): ConcentrationPreset {
  return CONCENTRATION_PRESETS.find((p) => p.id === id) ?? CONCENTRATION_PRESETS[1];
}

/** Which preset to recommend for a given investor style. */
export function suggestedPresetForStyle(style: string | null): ConcentrationPreset['id'] {
  if (style === 'buffett' || style === 'munger' || style === 'soros') return 'concentrated';
  if (style === 'lynch') return 'diversified';
  return 'balanced'; // livermore + unknown fallback
}

export interface ResolvedConcentration {
  single: number;
  top3: number;
  /** true when the values came from the user's explicit settings (not a default). */
  custom: boolean;
}

/**
 * Resolve effective thresholds:
 *   user explicit value → style suggestion → global default.
 * Accepts nullable DB values (`conc_single_pct`, `conc_top3_pct`).
 */
export function resolveConcentrationThresholds(
  style: string | null,
  concSinglePct?: number | null,
  concTop3Pct?: number | null,
): ResolvedConcentration {
  const styleDefault =
    STYLE_CONC_DEFAULTS[style as InvestorStyleKey] ??
    { single: DEFAULT_CONC_SINGLE_PCT, top3: DEFAULT_CONC_TOP3_PCT };

  const single = typeof concSinglePct === 'number' ? concSinglePct : styleDefault.single;
  const top3 = typeof concTop3Pct === 'number' ? concTop3Pct : styleDefault.top3;

  return {
    single,
    top3,
    custom: typeof concSinglePct === 'number' || typeof concTop3Pct === 'number',
  };
}
