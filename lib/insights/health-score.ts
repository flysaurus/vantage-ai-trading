// ─── Portfolio Health: DETERMINISTIC scoring ───────────────────
//
// ⚠️ NO LLM IS INVOLVED IN THIS NUMBER. Every value below is a pure
// function of portfolio data. Rufus only *explains* the numbers we
// computed here — it never produces them.
//
// ── THE FORMULA (auditable) ────────────────────────────────────
//
//   overall = round(0.40 × diversification
//                 + 0.35 × riskBalance
//                 + 0.25 × returns)                       ∈ [0,100]
//
//   diversification  (weight 0.40)  ← same holdings-spread data the
//       concentration-risk trigger already uses (position weights +
//       sector weights).
//         HHI          = Σ wᵢ²  over position weights wᵢ
//         N_eff        = 1 / HHI                      (effective # names)
//         positionPart = 100 × clamp01((min(N_eff,10) − 1) / 9)
//         HHI_sector   = Σ sⱼ²  over sector weights sⱼ
//         sectorPart   = 100 × clamp01((1/HHI_sector − 1) / 4)
//         penalty      = 1.5 × max(0, largestPct − 20)
//                      + 0.8 × max(0, top3Pct  − 50)
//         diversification = clamp(0,100,
//                           0.65 × positionPart + 0.35 × sectorPart − penalty)
//
//   riskBalance     (weight 0.35)  ← portfolio beta (sector-beta model,
//       below) vs the user's stated risk tolerance (Settings).
//         beta    = Σ wᵢ × SECTOR_BETA[ sectorᵢ ]      (unknown → 1.00)
//         band    = RISK_BANDS[ risk tolerance ]
//         tolerance = (band.hi − band.lo) / 2 + 0.15
//         riskBalance = 100 × clamp01(1 − |beta − band.mid| / tolerance)
//         then: −15 if cashWeight > 25%, −30 if cashWeight > 50%
//
//   returns         (weight 0.25)  ← actual total return already
//       computed for the account (totalPnlPercent).
//         returns = clamp(0,100, 50 + 50 × clamp(−1,1, totalPnlPercent / 20))
//         (0% → 50, +20% → 100, −20% → 0)
//
// Sub-scores are rounded to whole numbers; `overall` is computed from
// the ROUNDED sub-scores so the card's arithmetic is checkable by eye.
// ─────────────────────────────────────────────────────────────

export type RiskTolerance = 'conservative' | 'moderate' | 'aggressive';

export interface HealthPosition {
  symbol: string;
  marketValue: number;
  sector?: string | null;
}

export interface HealthInput {
  positions: HealthPosition[];
  /**
   * Settled cash / buying power, or `null` when the broker did not report it.
   * ⚠️ Unknown cash must NEVER be read as 0: a fabricated zero becomes a
   * fabricated "100% invested" verdict. Unknown ⇒ the cash-weight penalty is
   * not applied and the score is flagged partial.
   */
  cash: number | null;
  /** Decimal percent, e.g. 12.4 for +12.4%. `null` = unknown, never 0. */
  totalPnlPercent: number | null;
  /** Raw value from user settings; case/format insensitive. */
  riskTolerance?: string | null;
}

export interface HealthSubScores {
  diversification: number;
  riskBalance: number;
  /** `null` when the return figure was unavailable — never a stand-in 50. */
  returns: number | null;
}

export interface HealthResult {
  score: number;
  grade: 'Strong' | 'Fair' | 'Needs attention';
  subScores: HealthSubScores;
  /**
   * true when at least one input was unknown, so the score was computed over the
   * components that COULD be measured (weights renormalised) instead of
   * inventing a value for the missing one. Always surfaced to the reader.
   */
  partial: boolean;
  /** Which inputs were unknown, in reader-facing words. Empty when complete. */
  unknownInputs: string[];
  /** Data-derived, always names a real holding + real %. */
  supportingLine: string;
  /** Pre-filled Ask Rufus prompt grounded in these exact numbers. */
  explainPrompt: string;
  /** Raw inputs behind the score — kept for auditing / tests. */
  breakdown: {
    hhi: number;
    effectiveNames: number;
    hhiSector: number;
    largestPct: number;
    top3Pct: number;
    beta: number;
    /** `null` when cash was unknown (never 0-means-fully-invested). */
    cashWeightPct: number | null;
    targetBetaMid: number;
    tolerance: number;
    positionCount: number;
  };
}

/**
 * Deterministic sector betas (5-year published-market betas, rounded).
 * Used as the documented proxy for position betas — the app has no
 * per-symbol beta feed on the client, so this keeps the score both
 * deterministic AND reproducible. Unknown sectors fall back to 1.00.
 */
export const SECTOR_BETA: Record<string, number> = {
  technology: 1.25,
  'information technology': 1.25,
  communication: 1.05,
  'communication services': 1.05,
  'media & entertainment': 1.15,
  'consumer discretionary': 1.15,
  consumer: 0.85,
  'consumer staples': 0.60,
  healthcare: 0.80,
  'health care': 0.80,
  financials: 1.10,
  'financial services': 1.10,
  industrials: 1.05,
  energy: 1.20,
  materials: 1.00,
  utilities: 0.55,
  'real estate': 0.95,
  // Asset-class buckets emitted by the portfolio sector resolver
  // (lib/portfolio/position-sectors-server.ts) for funds/ETFs. Same coarse
  // sector-proxy basis as the equity rows above — broad published-market betas,
  // not per-position precision.
  'broad market': 1.00,
  'fixed income': 0.35,
  commodities: 0.45,
  international: 0.90,
  etf: 1.00,
  unknown: 1.00,
};

export const RISK_BANDS: Record<RiskTolerance, { lo: number; hi: number; mid: number }> = {
  conservative: { lo: 0.60, hi: 0.90, mid: 0.75 },
  moderate: { lo: 0.90, hi: 1.20, mid: 1.05 },
  aggressive: { lo: 1.20, hi: 1.70, mid: 1.45 },
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const clamp100 = (n: number) => Math.max(0, Math.min(100, n));

export function normalizeRiskTolerance(value?: string | null): RiskTolerance {
  const v = (value || '').trim().toLowerCase();
  if (v === 'conservative' || v === 'aggressive') return v;
  return 'moderate';
}

function sectorKey(sector?: string | null): string {
  const s = (sector || '').trim().toLowerCase();
  if (!s) return 'unknown';
  if (SECTOR_BETA[s] != null) return s;
  // substring match for the long Alpaca sector names
  for (const key of Object.keys(SECTOR_BETA)) {
    if (key !== 'unknown' && s.includes(key)) return key;
  }
  return 'unknown';
}

export function sectorBeta(sector?: string | null): number {
  return SECTOR_BETA[sectorKey(sector)] ?? 1.0;
}

export function computePortfolioHealth(input: HealthInput): HealthResult {
  const positions = (input.positions || []).filter((p) => (p.marketValue || 0) > 0);
  const invested = positions.reduce((s, p) => s + (p.marketValue || 0), 0);
  // Cash is a MEASUREMENT, not a default. `null`/non-finite ⇒ unknown.
  const cashKnown = typeof input.cash === 'number' && Number.isFinite(input.cash);
  const cash = cashKnown ? Math.max(0, input.cash as number) : 0;
  const total = invested + cash;

  // ── Empty portfolio: everything is deterministic zeros, no crash ──
  if (total <= 0 || positions.length === 0) {
    return {
      score: 0,
      grade: 'Needs attention',
      subScores: { diversification: 0, riskBalance: 50, returns: cashKnown ? 50 : null },
      partial: false,
      unknownInputs: [],
      supportingLine: 'No holdings to measure yet — add a position to start scoring.',
      explainPrompt:
        'My portfolio health score is 0 right now (Diversification 0, Risk balance 50) because there are no holdings. What should I do first?',
      breakdown: {
        hhi: 0,
        effectiveNames: 0,
        hhiSector: 0,
        largestPct: 0,
        top3Pct: 0,
        beta: 0,
        cashWeightPct: cashKnown && total > 0 ? 100 : null,
        targetBetaMid: 1.05,
        tolerance: 0.3,
        positionCount: 0,
      },
    };
  }

  const weights = positions.map((p) => (p.marketValue || 0) / invested);
  const sorted = [...weights].sort((a, b) => b - a);

  // ── Diversification ──
  const hhi = weights.reduce((s, w) => s + w * w, 0);
  const effectiveNames = hhi > 0 ? 1 / hhi : 0;

  const sectorWeights: Record<string, number> = {};
  for (const p of positions) {
    const key = sectorKey(p.sector);
    sectorWeights[key] = (sectorWeights[key] || 0) + (p.marketValue || 0) / invested;
  }
  const hhiSector = Object.values(sectorWeights).reduce((s, w) => s + w * w, 0);

  const largestPct = (sorted[0] || 0) * 100;
  const top3Pct = sorted.slice(0, 3).reduce((s, w) => s + w, 0) * 100;

  const positionPart = 100 * clamp01((Math.min(effectiveNames, 10) - 1) / 9);
  const sectorPart = 100 * clamp01((1 / Math.max(hhiSector, 1e-9) - 1) / 4);
  const penalty = 1.5 * Math.max(0, largestPct - 20) + 0.8 * Math.max(0, top3Pct - 50);
  const diversification = Math.round(clamp100(0.65 * positionPart + 0.35 * sectorPart - penalty));

  // ── Risk balance ──
  const beta = positions.reduce((s, p) => s + ((p.marketValue || 0) / invested) * sectorBeta(p.sector), 0);
  const band = RISK_BANDS[normalizeRiskTolerance(input.riskTolerance)];
  const tolerance = (band.hi - band.lo) / 2 + 0.15;
  let riskBalance = 100 * clamp01(1 - Math.abs(beta - band.mid) / tolerance);

  // The cash-weight penalty only exists when cash is KNOWN. Unknown cash means
  // we cannot know whether this account is over-cashed — so we do not punish it.
  const cashWeightPct: number | null = cashKnown && total > 0 ? (cash / total) * 100 : null;
  if (cashWeightPct !== null) {
    if (cashWeightPct > 50) riskBalance -= 30;
    else if (cashWeightPct > 25) riskBalance -= 15;
  }
  riskBalance = Math.round(clamp100(riskBalance));

  // ── Returns ──
  const returnsKnown = typeof input.totalPnlPercent === 'number' && Number.isFinite(input.totalPnlPercent);
  const r = returnsKnown ? (input.totalPnlPercent as number) : 0;
  const returns = returnsKnown ? Math.round(clamp100(50 + 50 * Math.max(-1, Math.min(1, r / 20)))) : null;

  // ── Overall ──
  // Measurable components keep their documented weights; when one is missing its
  // weight is dropped and the rest renormalise. A missing component is never
  // replaced by a neutral 50 that would then be reported as if measured.
  const components: { w: number; v: number | null }[] = [
    { w: 0.4, v: diversification },
    { w: 0.35, v: riskBalance },
    { w: 0.25, v: returns },
  ];
  const known = components.filter((c) => c.v !== null) as { w: number; v: number }[];
  const knownWeight = known.reduce((s, c) => s + c.w, 0);
  const score = Math.round(known.reduce((s, c) => s + c.w * c.v, 0) / (knownWeight || 1));
  const grade: HealthResult['grade'] = score >= 80 ? 'Strong' : score >= 60 ? 'Fair' : 'Needs attention';

  const unknownInputs: string[] = [];
  if (!cashKnown) unknownInputs.push('cash');
  if (!returnsKnown) unknownInputs.push('return');
  const partial = unknownInputs.length > 0;

  // ── Data-derived supporting line (names the real top holding) ──
  const topHolding = [...positions].sort((a, b) => (b.marketValue || 0) - (a.marketValue || 0))[0];
  const topPct = invested > 0 ? ((topHolding.marketValue || 0) / invested) * 100 : 0;
  const weakest = [
    { k: 'diversification', v: diversification },
    { k: 'risk balance', v: riskBalance },
    { k: 'returns', v: returns },
  ].filter((c) => c.v !== null)
    .sort((a, b) => (a.v as number) - (b.v as number))[0];

  const partialNote = partial
    ? ` ${unknownInputs.map((u) => (u === 'cash' ? 'Cash' : 'Return')).join(' and ')} data was unavailable, so the score covers only the components we could measure.`
    : '';

  const supportingLine =
    `${topHolding.symbol} is ${topPct.toFixed(1)}% of your holdings — ` +
    `${weakest.k} is the weakest of the measured sub-scores at ${weakest.v}/100.` + partialNote;

  const subScoreText = [
    `Diversification ${diversification}`,
    `Risk balance ${riskBalance}`,
    returnsKnown ? `Returns ${returns}` : 'Returns unknown',
  ].join(', ');

  const explainPrompt =
    `Explain my portfolio health score of ${score}/100. ` +
    `Sub-scores: ${subScoreText}. ` +
    `My largest holding is ${topHolding.symbol} at ${topPct.toFixed(1)}% of the portfolio, ` +
    `estimated portfolio beta ${beta.toFixed(2)}, ` +
    (cashWeightPct !== null ? `cash ${cashWeightPct.toFixed(0)}% of the account. ` : 'cash unknown (the broker did not report it). ') +
    (partial ? `Note: ${unknownInputs.join(' and ')} data was unavailable, so this score is partial. ` : '') +
    `Walk me through what's driving each sub-score and what would move the score the most.`;

  return {
    score,
    grade,
    subScores: { diversification, riskBalance, returns },
    partial,
    unknownInputs,
    supportingLine,
    explainPrompt,
    breakdown: {
      hhi,
      effectiveNames,
      hhiSector,
      largestPct,
      top3Pct,
      beta,
      cashWeightPct,
      targetBetaMid: band.mid,
      tolerance,
      positionCount: positions.length,
    },
  };
}
