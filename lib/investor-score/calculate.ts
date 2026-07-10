// ─── Investor Score: Calculation Engine v2 ──────────────────
// Four-pillar scoring (0-1000). New accounts start near 0.
// No generous defaults — score comes from real, verified activity.
//
// All weights, caps, and thresholds are configurable via the
// gamification_config DB table. Pass a GamificationConfig to
// calculateInvestorScore(); if omitted, hardcoded defaults are used.
//
// Pillars:
//   Discipline  (40%, 400 pts) — style consistency, drawdown resilience
//   Understanding (25%, 250 pts) — deep learning engagement
//   Construction (20%, 200 pts) — diversification, position sizing
//   Engagement  (15%, 150 pts) — streak, AI sessions (diminishing returns)
//
// Style-specific level ladders (4 stages each, 250-point bands).
// Tier-aware: Silver cannot observe trade execution → lower ceiling.

import type { PillarWeights, PointCaps } from '@/lib/gamification/config';

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
  config?: { weights: PillarWeights; caps: PointCaps },
): ScoreResult {
  const w = config?.weights ?? { discipline: 40, understanding: 25, construction: 20, engagement: 15 };
  const c = config?.caps;

  // Compute max point ceilings from weights (weight × 10 = max points)
  const DISCIPLINE_MAX = w.discipline * 10;
  const UNDERSTANDING_MAX = w.understanding * 10;
  const CONSTRUCTION_MAX = w.construction * 10;
  const ENGAGEMENT_MAX = w.engagement * 10;
  // ═══════════════════════════════════════════════════════════
  // PILLAR 1: DISCIPLINE
  // ═══════════════════════════════════════════════════════════
  const styleConsistency = computeStyleConsistency(metrics, c);
  const drawdownBonus = computeDrawdownBonus(metrics, c);
  const discipline = Math.min(DISCIPLINE_MAX, styleConsistency + drawdownBonus);

  // ═══════════════════════════════════════════════════════════
  // PILLAR 2: UNDERSTANDING
  // ═══════════════════════════════════════════════════════════
  const learningDepth = computeLearningDepth(metrics, c);
  const understanding = Math.min(UNDERSTANDING_MAX, learningDepth);

  // ═══════════════════════════════════════════════════════════
  // PILLAR 3: CONSTRUCTION
  // ═══════════════════════════════════════════════════════════
  const diversification = computeDiversificationScore(metrics, c);
  const positionSizing = computePositionSizing(metrics, c);
  const construction = Math.min(CONSTRUCTION_MAX, diversification + positionSizing);

  // ═══════════════════════════════════════════════════════════
  // PILLAR 4: ENGAGEMENT
  // ═══════════════════════════════════════════════════════════
  const streakPoints = computeStreakScore(metrics, c);
  const aiSessionPoints = computeAISessionScore(metrics, c);
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
 * Style consistency: points from matching_trades / trades_executed ratio.
 * Configurable max (default 300). No default — 0 until real trade history exists.
 */
function computeStyleConsistency(metrics: ScoreMetrics, caps?: PointCaps): number {
  const max = caps?.style_consistency_max ?? 300;
  if (metrics.trades_executed === 0) return 0;
  const rate = metrics.matching_trades / metrics.trades_executed;
  return Math.round(rate * max);
}

/**
 * Drawdown bonus: configurable bonus points for holding through a dip.
 */
function computeDrawdownBonus(metrics: ScoreMetrics, caps?: PointCaps): number {
  const bonus = caps?.drawdown_bonus ?? 100;
  return metrics.held_through_drawdown ? bonus : 0;
}

/**
 * Learning depth: points per deep engagement, with configurable cap and per-unit value.
 * Default: 50 points × up to 5 deep engagements = 250 max.
 */
function computeLearningDepth(metrics: ScoreMetrics, caps?: PointCaps): number {
  const cap = caps?.learning_depth_max ?? 5;
  const points = caps?.learning_depth_points ?? 50;
  return Math.min(cap * points, metrics.deep_engagement_count * points);
}

/**
 * Diversification: configurable points from Herfindahl-based diversification_score.
 * Default: 0-150 points (diversification_score × 1.5).
 */
function computeDiversificationScore(metrics: ScoreMetrics, caps?: PointCaps): number {
  if (metrics.position_count === 0) return 0;
  const max = caps?.diversification_max ?? 150;
  const mult = caps?.diversification_multiplier ?? 1.5;
  return Math.min(max, Math.round(metrics.diversification_score * mult));
}

/**
 * Position sizing sanity: configurable points.
 * Default: ideal ≤25% → 50 points, worst 50%+ → 0 points.
 */
function computePositionSizing(metrics: ScoreMetrics, caps?: PointCaps): number {
  if (metrics.position_count === 0) return 0;
  const idealMax = caps?.position_sizing_ideal_pct ?? 25;
  const worstMax = caps?.position_sizing_worst_pct ?? 50;
  const maxPts = caps?.position_sizing_max ?? 50;
  const clamped = Math.max(idealMax, Math.min(worstMax, metrics.max_position_pct));
  const score = Math.round(maxPts * (1 - (clamped - idealMax) / (worstMax - idealMax)));
  return Math.max(0, score);
}

/**
 * Streak score: configurable points per day, with a configurable cap.
 * Default: 3 pts/day, capped at 90 (30 days).
 */
function computeStreakScore(metrics: ScoreMetrics, caps?: PointCaps): number {
  const max = caps?.streak_max ?? 90;
  const perDay = caps?.streak_points_per_day ?? 3;
  return Math.min(max, metrics.current_streak * perDay);
}

/**
 * AI session score: diminishing returns with configurable tiers.
 * Default: tier1=10×3pts, tier2=10×2pts, tier3=0.5pts, hard cap 60.
 */
function computeAISessionScore(metrics: ScoreMetrics, caps?: PointCaps): number {
  const s = metrics.ai_sessions;
  const max = caps?.ai_max ?? 60;
  const t1Count = caps?.ai_session_tier1_count ?? 10;
  const t1Pts = caps?.ai_session_tier1_points ?? 3;
  const t2Count = caps?.ai_session_tier2_count ?? 10;
  const t2Pts = caps?.ai_session_tier2_points ?? 2;
  const t3Pts = caps?.ai_session_tier3_points ?? 0.5;

  const t1End = t1Count;
  const t2End = t1Count + t2Count;
  const t1Total = t1Count * t1Pts;
  const t2Total = t2Count * t2Pts;

  if (s <= t1End) return s * t1Pts;
  if (s <= t2End) return t1Total + (s - t1End) * t2Pts;
  return Math.min(max, t1Total + t2Total + (s - t2End) * t3Pts);
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
