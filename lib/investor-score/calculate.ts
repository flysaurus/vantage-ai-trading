// ─── Investor Score: Calculation Engine v2 ──────────────────
// Four-pillar scoring (0-1000). New accounts start near 0.
// No generous defaults — score comes from real, verified activity.
//
// Pillars:
//   Discipline  (40%, 400 pts) — style consistency, drawdown resilience
//   Understanding (25%, 250 pts) — deep learning engagement
//   Construction (20%, 200 pts) — diversification, position sizing
//   Engagement  (15%, 150 pts) — streak, AI sessions (diminishing returns)
//
// Style-specific level ladders (4 stages each, 250-point bands).
// Tier-aware: Silver cannot observe trade execution → lower ceiling.

// ─── Types ────────────────────────────────────────────────────

export interface ScoreMetrics {
  // Discipline (40%)
  trades_executed: number;
  matching_trades: number;       // trades whose inferTradeStyle() matches declared style
  held_through_drawdown: boolean; // Steady Hands: held a position through ≥10% dip

  // Understanding (25%)
  learning_count: number;         // total Learning Moments completed
  deep_engagement_count: number;  // subset with depth (time/engagement, not click-through)

  // Construction (20%)
  diversification_score: number;  // 0-100 from confidence.ts Herfindahl
  position_count: number;
  max_position_pct: number;       // largest single position as % of portfolio (0-100)

  // Engagement (15%)
  current_streak: number;
  ai_sessions: number;
}

export interface PillarBreakdown {
  discipline: number;     // 0-400
  understanding: number;  // 0-250
  construction: number;   // 0-200
  engagement: number;     // 0-150
  // Sub-components for transparency
  styleConsistency: number;
  drawdownBonus: number;
  learningDepth: number;
  diversification: number;
  positionSizing: number;
  streakPoints: number;
  aiSessionPoints: number;
}

export interface ScoreResult {
  score: number;
  level: string;
  levelIndex: number;
  nextThreshold: number | null;
  progress: number; // 0-100% within current level
  breakdown: PillarBreakdown;
}

// ─── Style-Specific Level Ladders ─────────────────────────────
// 4 levels per style, 250-point bands (0-249 → 250-499 → 500-749 → 750-1000)

const STYLE_LADDERS: Record<string, readonly string[]> = {
  buffett: [
    'Value Seeker',
    'Patient Builder',
    'Disciplined Compounder',
    'Wonderful-Company Owner',
  ],
  lynch: [
    'Story Spotter',
    'Homework Hawk',
    'Conviction Buyer',
    'Tenbagger Hunter',
  ],
  livermore: [
    'Tape Reader',
    'Loss Cutter',
    'Trend Surfer',
    'Market Whisperer',
  ],
  munger: [
    'Model Collector',
    'Circle Keeper',
    'Fat-Pitch Waiter',
    'Latticework Thinker',
  ],
  soros: [
    'Pattern Spotter',
    'Thesis Builder',
    'Asymmetric Better',
    'Cycle Master',
  ],
};

const DEFAULT_LADDER = [
  'Apprentice',
  'Trader',
  'Investor',
  'Master',
] as const;

const LEVEL_THRESHOLDS = [250, 500, 750] as const;

export const MAX_SCORE = 1000;

// ─── Pillar Constants ─────────────────────────────────────────

const DISCIPLINE_MAX = 400;
const UNDERSTANDING_MAX = 250;
const CONSTRUCTION_MAX = 200;
const ENGAGEMENT_MAX = 150;

// Engagement sub-caps
const STREAK_MAX = 90;   // 3pts/day, 30 days
const AI_MAX = 60;       // diminishing: 3pts × first 10, 2pts × next 10, 0.5pts thereafter

// ─── Public API ───────────────────────────────────────────────

/**
 * Calculate the Investor Score using the four-pillar system.
 *
 * New accounts (0 trades, 0 learning, no portfolio, no streak) score 0.
 * Score builds from real activity only — no generous defaults.
 *
 * @param metrics  Raw activity metrics
 * @param investorStyle  Declared style (buffett/lynch/livermore/munger/soros) for level names
 * @returns  ScoreResult with score, level, breakdown
 */
export function calculateInvestorScore(
  metrics: ScoreMetrics,
  investorStyle?: string,
): ScoreResult {
  // ═══════════════════════════════════════════════════════════
  // PILLAR 1: DISCIPLINE (40% = 400 points)
  // ═══════════════════════════════════════════════════════════
  const styleConsistency = computeStyleConsistency(metrics);
  const drawdownBonus = computeDrawdownBonus(metrics);
  const discipline = Math.min(DISCIPLINE_MAX, styleConsistency + drawdownBonus);

  // ═══════════════════════════════════════════════════════════
  // PILLAR 2: UNDERSTANDING (25% = 250 points)
  // ═══════════════════════════════════════════════════════════
  const learningDepth = computeLearningDepth(metrics);
  const understanding = Math.min(UNDERSTANDING_MAX, learningDepth);

  // ═══════════════════════════════════════════════════════════
  // PILLAR 3: CONSTRUCTION (20% = 200 points)
  // ═══════════════════════════════════════════════════════════
  const diversification = computeDiversificationScore(metrics);
  const positionSizing = computePositionSizing(metrics);
  const construction = Math.min(CONSTRUCTION_MAX, diversification + positionSizing);

  // ═══════════════════════════════════════════════════════════
  // PILLAR 4: ENGAGEMENT (15% = 150 points)
  // ═══════════════════════════════════════════════════════════
  const streakPoints = computeStreakScore(metrics);
  const aiSessionPoints = computeAISessionScore(metrics);
  const engagement = Math.min(ENGAGEMENT_MAX, streakPoints + aiSessionPoints);

  // ── Total ──────────────────────────────────────────────────
  const raw = discipline + understanding + construction + engagement;
  const score = Math.min(MAX_SCORE, Math.max(0, Math.round(raw)));

  // ── Level assignment ───────────────────────────────────────
  const style = (investorStyle || '').toLowerCase();
  const ladder = STYLE_LADDERS[style] || DEFAULT_LADDER;
  const { name: level, levelIndex, nextThreshold, progress } =
    getLevelDetails(score, ladder);

  return {
    score,
    level,
    levelIndex,
    nextThreshold,
    progress,
    breakdown: {
      discipline,
      understanding,
      construction,
      engagement,
      styleConsistency,
      drawdownBonus,
      learningDepth,
      diversification,
      positionSizing,
      streakPoints,
      aiSessionPoints,
    },
  };
}

/**
 * Get the level name for a given score and investor style.
 */
export function getLevel(score: number, investorStyle?: string): string {
  const style = (investorStyle || '').toLowerCase();
  const ladder = STYLE_LADDERS[style] || DEFAULT_LADDER;
  return getLevelDetails(score, ladder).name;
}

/**
 * Get the minimum score needed to reach the next level.
 */
export function getNextLevelThreshold(
  score: number,
  investorStyle?: string,
): number | null {
  const style = (investorStyle || '').toLowerCase();
  const ladder = STYLE_LADDERS[style] || DEFAULT_LADDER;
  return getLevelDetails(score, ladder).nextThreshold;
}

/**
 * Get progress (0-100%) toward the next level.
 */
export function getLevelProgress(score: number, investorStyle?: string): number {
  const style = (investorStyle || '').toLowerCase();
  const ladder = STYLE_LADDERS[style] || DEFAULT_LADDER;
  return getLevelDetails(score, ladder).progress;
}

/**
 * Get the full level ladder for a given investor style.
 * Falls back to default generic ladder if style is unrecognized.
 */
export function getLadderForStyle(investorStyle?: string): readonly string[] {
  const style = (investorStyle || '').toLowerCase();
  return STYLE_LADDERS[style] || DEFAULT_LADDER;
}

// ─── Pillar Calculators ──────────────────────────────────────

/**
 * Style consistency: 0-300 points from matching_trades / trades_executed ratio.
 * No default — 0 until real trade history exists.
 */
function computeStyleConsistency(metrics: ScoreMetrics): number {
  if (metrics.trades_executed === 0) return 0;
  const rate = metrics.matching_trades / metrics.trades_executed;
  return Math.round(rate * 300);
}

/**
 * Drawdown bonus: 100 points for holding through a ≥10% dip.
 * Binary — either you've done it or you haven't.
 *
 * LIMITATION: Only detects currently-held positions with ≥10% unrealized loss
 * (computed at call time by comparing entry price → current market price).
 * The historical case — bought, dipped ≥10% intra-hold, then sold at/above entry —
 * is NOT computable from trade_history alone and requires per-position price-history
 * data. This is flagged as a future enhancement.
 */
function computeDrawdownBonus(metrics: ScoreMetrics): number {
  return metrics.held_through_drawdown ? 100 : 0;
}

/**
 * Learning depth: 50 points per deep engagement, capped at 5 (250 points).
 * Shallow/click-through learning moments contribute 0.
 */
function computeLearningDepth(metrics: ScoreMetrics): number {
  return Math.min(250, metrics.deep_engagement_count * 50);
}

/**
 * Diversification: 0-150 points from Herfindahl-based diversification_score.
 * No default — 0 until a real portfolio exists.
 */
function computeDiversificationScore(metrics: ScoreMetrics): number {
  if (metrics.position_count === 0) return 0;
  return Math.min(150, Math.round(metrics.diversification_score * 1.5));
}

/**
 * Position sizing sanity: 0-50 points.
 * Ideal: max position ≤ 25% of portfolio. Penalizes concentration beyond that.
 * 0 until portfolio exists.
 */
function computePositionSizing(metrics: ScoreMetrics): number {
  if (metrics.position_count === 0) return 0;
  // 25% per position is the sweet spot → 50 points
  // 50% per position → 0 points
  // Linear interpolation between 25% and 50%
  const idealMax = 25;
  const worstMax = 50;
  const clamped = Math.max(idealMax, Math.min(worstMax, metrics.max_position_pct));
  const score = Math.round(50 * (1 - (clamped - idealMax) / (worstMax - idealMax)));
  return Math.max(0, score);
}

/**
 * Streak score: 3 points per consecutive day, capped at 90 (30 days).
 */
function computeStreakScore(metrics: ScoreMetrics): number {
  return Math.min(STREAK_MAX, metrics.current_streak * 3);
}

/**
 * AI session score: diminishing returns.
 * Sessions 1-10:  3pts each → max 30
 * Sessions 11-20: 2pts each → max 20
 * Sessions 21+:   0.5pts each (asymptotically negligible)
 * Hard cap: 60
 */
function computeAISessionScore(metrics: ScoreMetrics): number {
  const s = metrics.ai_sessions;
  if (s <= 10) return s * 3;
  if (s <= 20) return 30 + (s - 10) * 2;
  return Math.min(AI_MAX, 50 + (s - 20) * 0.5);
}

// ─── Level Determination ─────────────────────────────────────

interface LevelDetails {
  name: string;
  levelIndex: number;
  nextThreshold: number | null;
  progress: number;
}

function getLevelDetails(
  score: number,
  ladder: readonly string[],
): LevelDetails {
  const bandSize = MAX_SCORE / ladder.length; // 250 for 4-level ladders
  const totalLevels = ladder.length;

  for (let i = 0; i < totalLevels; i++) {
    const min = i * bandSize;
    const max = (i + 1) * bandSize - (i === totalLevels - 1 ? 0 : 1);

    if (score <= max) {
      const range = max - min;
      const position = score - min;
      const progress = range > 0 ? Math.round((position / range) * 100) : 100;
      const nextThreshold = i < totalLevels - 1 ? (i + 1) * bandSize : null;
      return {
        name: ladder[i],
        levelIndex: i,
        nextThreshold,
        progress,
      };
    }
  }

  // Capped at max — highest level
  return {
    name: ladder[totalLevels - 1],
    levelIndex: totalLevels - 1,
    nextThreshold: null,
    progress: 100,
  };
}

// ─── Style Inference (kept for external use) ─────────────────

/**
 * Infer investor style from a trade's characteristics.
 *
 * Heuristic:
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

// ─── Risk Adherence (kept for PortfolioContext external use) ──

/**
 * Calculate risk adherence (0-100) comparing portfolio volatility
 * to the investor's declared risk tolerance.
 *
 * NOTE: risk_adherence is NOT part of the four-pillar score formula.
 * It remains available for portfolio analysis / confidence scoring
 * but does not contribute to the Investor Score.
 */
export function calculateRiskAdherence(
  riskTolerance: string,
  portfolioMetrics: {
    volatility?: number;
    growthExposure?: number;
    cashRatio?: number;
    diversification?: number;
  },
): number {
  const { volatility = 0.2, growthExposure = 50, cashRatio = 10, diversification = 70 } =
    portfolioMetrics;

  switch (riskTolerance.toLowerCase()) {
    case 'conservative': {
      let score = 100;
      if (volatility > 0.3) score -= 30;
      else if (volatility > 0.2) score -= 15;
      if (growthExposure > 50) score -= 25;
      else if (growthExposure > 30) score -= 10;
      if (cashRatio < 10) score -= 15;
      if (diversification < 60) score -= 15;
      return Math.max(0, score);
    }
    case 'aggressive': {
      let score = 50;
      if (volatility > 0.3) score += 25;
      else if (volatility > 0.2) score += 15;
      else score -= 10;
      if (growthExposure > 70) score += 20;
      else if (growthExposure > 50) score += 10;
      else score -= 15;
      if (cashRatio < 5) score += 5;
      return Math.min(100, Math.max(0, score));
    }
    case 'moderate':
    default: {
      let score = 70;
      if (volatility > 0.15 && volatility < 0.35) score += 15;
      else score -= 10;
      if (growthExposure > 30 && growthExposure < 70) score += 10;
      else score -= 5;
      if (cashRatio > 5 && cashRatio < 20) score += 5;
      if (diversification > 50 && diversification < 90) score += 0;
      else score -= 10;
      return Math.min(100, Math.max(0, score));
    }
  }
}

// ─── Tier-Aware Level Display ─────────────────────────────────
// Silver (read-only) cannot observe trade execution → muted tone.

const SILVER_TONE: Record<string, string> = {
  'Value Seeker': 'Observer',
  'Patient Builder': 'Quiet Accumulator',
  'Disciplined Compounder': 'Steady Hand',
  'Wonderful-Company Owner': 'Portfolio Steward',
};

/**
 * Return the display-appropriate level name.
 * Silver tier gets muted labels; Demo/Gold get full intensity.
 */
export function getTierLevelName(
  levelName: string,
  tier?: string,
): string {
  if (tier === 'silver' && SILVER_TONE[levelName]) {
    return SILVER_TONE[levelName];
  }
  return levelName;
}
