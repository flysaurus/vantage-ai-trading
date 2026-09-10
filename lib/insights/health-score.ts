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
  /** Settled cash / buying power. */
  cash: number;
  /** Decimal percent, e.g. 12.4 for +12.4%. */
  totalPnlPercent: number;
  /** Raw value from user settings; case/format insensitive. */
  riskTolerance?: string | null;
}

export interface HealthSubScores {
  diversification: number;
  riskBalance: number;
  returns: number;
}

export interface HealthResult {
  score: number;
  grade: 'Strong' | 'Fair' | 'Needs attention';
  subScores: HealthSubScores;
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
    cashWeightPct: number;
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
  const cash = Math.max(0, input.cash || 0);
  const total = invested + cash;

  // ── Empty portfolio: everything is deterministic zeros, no crash ──
  if (total <= 0 || positions.length === 0) {
    return {
      score: 0,
      grade: 'Needs attention',
      subScores: { diversification: 0, riskBalance: 50, returns: 50 },
      supportingLine: 'No holdings to measure yet — add a position to start scoring.',
      explainPrompt:
        'My portfolio health score is 0 right now (Diversification 0, Risk balance 50, Returns 50) because there are no holdings. What should I do first?',
      breakdown: {
        hhi: 0,
        effectiveNames: 0,
        hhiSector: 0,
        largestPct: 0,
        top3Pct: 0,
        beta: 0,
        cashWeightPct: total > 0 ? 100 : 0,
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

  const cashWeightPct = total > 0 ? (cash / total) * 100 : 0;
  if (cashWeightPct > 50) riskBalance -= 30;
  else if (cashWeightPct > 25) riskBalance -= 15;
  riskBalance = Math.round(clamp100(riskBalance));

  // ── Returns ──
  const r = Number.isFinite(input.totalPnlPercent) ? input.totalPnlPercent : 0;
  const returns = Math.round(clamp100(50 + 50 * Math.max(-1, Math.min(1, r / 20))));

  // ── Overall ──
  const score = Math.round(0.4 * diversification + 0.35 * riskBalance + 0.25 * returns);
  const grade: HealthResult['grade'] = score >= 80 ? 'Strong' : score >= 60 ? 'Fair' : 'Needs attention';

  // ── Data-derived supporting line (names the real top holding) ──
  const topHolding = [...positions].sort((a, b) => (b.marketValue || 0) - (a.marketValue || 0))[0];
  const topPct = invested > 0 ? ((topHolding.marketValue || 0) / invested) * 100 : 0;
  const weakest = [
    { k: 'diversification', v: diversification },
    { k: 'risk balance', v: riskBalance },
    { k: 'returns', v: returns },
  ].sort((a, b) => a.v - b.v)[0];

  const supportingLine =
    `${topHolding.symbol} is ${topPct.toFixed(1)}% of your holdings — ` +
    `${weakest.k} is the weakest of the three sub-scores at ${weakest.v}/100.`;

  const explainPrompt =
    `Explain my portfolio health score of ${score}/100. ` +
    `Sub-scores: Diversification ${diversification}, Risk balance ${riskBalance}, Returns ${returns}. ` +
    `My largest holding is ${topHolding.symbol} at ${topPct.toFixed(1)}% of the portfolio, ` +
    `estimated portfolio beta ${beta.toFixed(2)}, cash ${cashWeightPct.toFixed(0)}% of the account. ` +
    `Walk me through what's driving each sub-score and what would move the score the most.`;

  return {
    score,
    grade,
    subScores: { diversification, riskBalance, returns },
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
