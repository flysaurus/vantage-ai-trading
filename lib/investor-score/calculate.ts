// ─── Investor Score: Calculation Engine ──────────────────────
// Computes the Vantage Investor Score (0-1000) from activity
// metrics, style consistency, and risk adherence.
//
// Formula:
//   score = baskets*5 + trades*3 + ai_sessions*1 + streak*2
//         + style_consistency*3 + risk_adherence*2
// Cap: 1000
//
// Levels: Apprentice → Trader → Investor → Master → Legend

// ─── Types ────────────────────────────────────────────────────

export interface ScoreMetrics {
  baskets_created: number;
  trades_executed: number;
  ai_sessions: number;
  current_streak: number;
  /** 0-100: % of trades matching declared investor style */
  style_consistency: number;
  /** 0-100: portfolio volatility alignment with risk tolerance */
  risk_adherence: number;
}

export interface ScoreResult {
  score: number;
  level: string;
  levelIndex: number;
  nextThreshold: number | null;
  progress: number; // 0-100% within current level
  breakdown: {
    baskets: number;
    trades: number;
    aiSessions: number;
    streak: number;
    styleConsistency: number;
    riskAdherence: number;
  };
}

// ─── Level Definitions ───────────────────────────────────────

export const LEVELS = [
  { name: 'Apprentice', min: 0, max: 99 },
  { name: 'Trader', min: 100, max: 299 },
  { name: 'Investor', min: 300, max: 599 },
  { name: 'Master', min: 600, max: 999 },
  { name: 'Legend', min: 1000, max: 1000 },
] as const;

const MAX_SCORE = 1000;

// ─── Public API ───────────────────────────────────────────────

/**
 * Calculate the Investor Score from raw metrics.
 *
 * Each component:
 * - baskets_created * 5    (activity bonus)
 * - trades_executed * 3    (experience bonus)
 * - ai_sessions * 1        (learning bonus)
 * - current_streak * 2     (consistency bonus)
 * - style_consistency * 3  (0-100 input — alignment with declared style)
 * - risk_adherence * 2     (0-100 input — volatility alignment)
 */
export function calculateInvestorScore(metrics: ScoreMetrics): ScoreResult {
  const breakdown = {
    baskets: metrics.baskets_created * 5,
    trades: metrics.trades_executed * 3,
    aiSessions: metrics.ai_sessions * 1,
    streak: metrics.current_streak * 2,
    styleConsistency: Math.min(100, Math.max(0, metrics.style_consistency)) * 3,
    riskAdherence: Math.min(100, Math.max(0, metrics.risk_adherence)) * 2,
  };

  const raw = Object.values(breakdown).reduce((sum, v) => sum + v, 0);
  const score = Math.min(MAX_SCORE, Math.max(0, Math.round(raw)));
  const { name: level, levelIndex, nextThreshold, progress } = getLevelDetails(score);

  return { score, level, levelIndex, nextThreshold, progress, breakdown };
}

/**
 * Get the level name for a given score.
 */
export function getLevel(score: number): string {
  return getLevelDetails(score).name;
}

/**
 * Get the minimum score needed to reach the next level.
 * Returns null if already at Legend.
 */
export function getNextLevelThreshold(score: number): number | null {
  return getLevelDetails(score).nextThreshold;
}

/**
 * Get progress (0-100%) toward the next level.
 * At Legend, returns 100.
 */
export function getLevelProgress(score: number): number {
  return getLevelDetails(score).progress;
}

// ─── Internal Helpers ────────────────────────────────────────

interface LevelDetails {
  name: string;
  levelIndex: number;
  nextThreshold: number | null;
  progress: number;
}

function getLevelDetails(score: number): LevelDetails {
  for (let i = 0; i < LEVELS.length; i++) {
    const level = LEVELS[i];
    if (score <= level.max) {
      const range = level.max - level.min;
      const position = score - level.min;
      const progress = range > 0 ? Math.round((position / range) * 100) : 100;
      const nextThreshold = i < LEVELS.length - 1 ? LEVELS[i + 1].min : null;
      return {
        name: level.name,
        levelIndex: i,
        nextThreshold,
        progress,
      };
    }
  }

  // Legend (capped at 1000)
  return {
    name: 'Legend',
    levelIndex: LEVELS.length - 1,
    nextThreshold: null,
    progress: 100,
  };
}

// ─── Style Consistency Calculator ────────────────────────────

/**
 * Calculate style consistency (0-100) from trade history.
 *
 * Each trade has an inferred style based on:
 * - Asset type (e.g., growth stocks → lynch, value stocks → buffett)
 * - Holding period (short → livermore, long → buffett/munger)
 * - Basket strategy type
 *
 * Returns the percentage of trades whose inferred style
 * matches the investor's declared style.
 */
export function calculateStyleConsistency(
  declaredStyle: string,
  trades: Array<{ inferredStyle: string }>
): number {
  if (!trades || trades.length === 0) return 50; // Default: neutral

  const matching = trades.filter(t => t.inferredStyle === declaredStyle).length;
  return Math.round((matching / trades.length) * 100);
}

/**
 * Infer investor style from a trade's characteristics.
 *
 * Simple heuristic:
 * - Growth/tech stocks, momentum baskets → lynch
 * - Blue chips, dividend stocks, long holds → buffett
 * - Short holding periods, rapid exits → livermore
 * - Concentrated positions, quality filters → munger
 * - Macro/commodity/forex, asymmetric bets → soros
 */
export function inferTradeStyle(params: {
  assetType?: string;
  holdingDays?: number;
  basketStrategy?: string;
  sector?: string;
}): string {
  const { assetType, holdingDays, basketStrategy } = params;

  // Basket strategy takes precedence
  if (basketStrategy) {
    const s = basketStrategy.toLowerCase();
    if (s.includes('momentum') || s.includes('growth')) return 'lynch';
    if (s.includes('value') || s.includes('dividend')) return 'buffett';
    if (s.includes('quality') || s.includes('compound')) return 'munger';
    if (s.includes('macro') || s.includes('global')) return 'soros';
  }

  // Holding period
  if (holdingDays !== undefined) {
    if (holdingDays < 7) return 'livermore';
    if (holdingDays < 90) return 'lynch';
  }

  // Asset type / sector
  if (assetType) {
    const t = assetType.toLowerCase();
    if (t.includes('tech') || t.includes('growth') || t.includes('innovation')) return 'lynch';
    if (t.includes('value') || t.includes('defensive') || t.includes('consumer')) return 'buffett';
    if (t.includes('quality') || t.includes('moat')) return 'munger';
    if (t.includes('macro') || t.includes('commodity') || t.includes('forex')) return 'soros';
  }

  // Default: moderate/long-term = buffett
  return 'buffett';
}

// ─── Risk Adherence Calculator ───────────────────────────────

/**
 * Calculate risk adherence (0-100) comparing portfolio volatility
 * to the investor's declared risk tolerance.
 *
 * - conservative: high score for low-volatility holdings
 * - moderate: high score for balanced mix
 * - aggressive: high score for high-growth exposure
 */
export function calculateRiskAdherence(
  riskTolerance: string,
  portfolioMetrics: {
    volatility?: number;    // annualized volatility (0-1 scale)
    growthExposure?: number; // % of portfolio in growth/high-beta
    cashRatio?: number;      // % cash
    diversification?: number; // 0-100, higher = more diversified
  }
): number {
  const { volatility = 0.2, growthExposure = 50, cashRatio = 10, diversification = 70 } = portfolioMetrics;

  switch (riskTolerance.toLowerCase()) {
    case 'conservative':
      // Reward: low volatility, high cash, high diversification
      let consScore = 100;
      if (volatility > 0.3) consScore -= 30;
      else if (volatility > 0.2) consScore -= 15;
      if (growthExposure > 50) consScore -= 25;
      else if (growthExposure > 30) consScore -= 10;
      if (cashRatio < 10) consScore -= 15;
      if (diversification < 60) consScore -= 15;
      return Math.max(0, consScore);

    case 'aggressive':
      // Reward: higher volatility, higher growth exposure
      let aggScore = 50; // Base score
      if (volatility > 0.3) aggScore += 25;
      else if (volatility > 0.2) aggScore += 15;
      else aggScore -= 10; // Too conservative for aggressive
      if (growthExposure > 70) aggScore += 20;
      else if (growthExposure > 50) aggScore += 10;
      else aggScore -= 15;
      if (cashRatio < 5) aggScore += 5; // Deployed capital is good
      return Math.min(100, Math.max(0, aggScore));

    case 'moderate':
    default:
      // Reward: balanced everything — not too hot, not too cold
      let modScore = 70; // Base score
      if (volatility > 0.15 && volatility < 0.35) modScore += 15;
      else modScore -= 10;
      if (growthExposure > 30 && growthExposure < 70) modScore += 10;
      else modScore -= 5;
      if (cashRatio > 5 && cashRatio < 20) modScore += 5;
      if (diversification > 50 && diversification < 90) modScore += 0;
      else modScore -= 10;
      return Math.min(100, Math.max(0, modScore));
  }
}
