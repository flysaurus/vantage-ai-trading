/**
 * Confidence Scoring Engine
 *
 * Computes a portfolio confidence score (0-100) using a 5-factor weighted algorithm.
 * Each factor produces both a numeric score AND a natural-language explanation
 * so the ConfidenceRing component can show users WHY their score is what it is.
 *
 * Weights:
 *   - Diversification:      25%
 *   - Technical Health:     20%
 *   - Volatility Exposure:  20%
 *   - Macro Alignment:      15%
 *   - Position Quality:     20%
 */

import type { Position } from '@/types';

export interface FactorResult {
  score: number;      // 0-100
  explanation: string;
  detail?: string;    // extra context for expanded view
}

export interface ConfidenceResult {
  overall: number;
  factors: {
    diversification: FactorResult;
    technicalHealth: FactorResult;
    volatilityExposure: FactorResult;
    macroAlignment: FactorResult;
    positionQuality: FactorResult;
  };
  explanation: string;
  warnings: string[];
}

// ─── Sector ETF proxies for macro alignment ───
const SECTOR_CATEGORIES: Record<string, string[]> = {
  'Technology': ['NVDA', 'AAPL', 'MSFT', 'GOOGL', 'META', 'AMD', 'INTC', 'AVGO', 'CRM', 'ADBE', 'PLTR', 'SNOW', 'NET', 'TSEM'],
  'Healthcare': ['UNH', 'JNJ', 'PFE', 'ABBV', 'MRK', 'LLY', 'TMO', 'ABT', 'ISRG', 'GILD', 'REGN', 'VRTX', 'BMY', 'AMGN'],
  'Financial Services': ['JPM', 'BAC', 'WFC', 'GS', 'MS', 'C', 'BLK', 'AXP', 'V', 'MA', 'SCHW', 'PNC', 'COF', 'USB'],
  'Energy': ['XOM', 'CVX', 'COP', 'SLB', 'EOG', 'MPC', 'PSX', 'VLO', 'OXY', 'PXD', 'KMI', 'WMB'],
  'Consumer': ['AMZN', 'TSLA', 'HD', 'MCD', 'NKE', 'SBUX', 'TGT', 'LOW', 'COKE', 'LULU', 'CMG', 'BKNG', 'ABNB'],
  'Industrials': ['ETN', 'CAT', 'DE', 'GE', 'HON', 'UPS', 'BA', 'RTX', 'LMT', 'MM', 'ITW', 'FDX'],
  'Utilities': ['NEE', 'DUK', 'SO', 'D', 'AEP', 'EXC', 'SRE', 'PCG', 'ED'],
  'Materials': ['LIN', 'SHW', 'FCX', 'NEM', 'DOW', 'DD', 'APD'],
  'Real Estate': ['PLD', 'AMT', 'CCI', 'EQIX', 'SPG', 'O', 'WELL'],
  'Media & Entertainment': ['GOOG', 'NFLX', 'DIS', 'CMCSA', 'T', 'VZ', 'TMUS', 'CHTR', 'SPOT', 'WBD', 'PARA'],
  'Automotive': ['F', 'GM', 'RIVN', 'LCID'],
};

function inferSector(symbol: string): string {
  const upper = symbol.toUpperCase();
  for (const [sector, symbols] of Object.entries(SECTOR_CATEGORIES)) {
    if (symbols.includes(upper)) return sector;
  }
  return 'Other';
}

// ─── Factor 1: Diversification (25%) ───
function scoreDiversification(positions: Position[]): FactorResult {
  if (positions.length === 0) {
    return { score: 0, explanation: 'No active positions. Build a diversified portfolio to reduce risk.', detail: '0 positions across 0 sectors.' };
  }

  const totalValue = positions.reduce((s, p) => s + p.marketValue, 0);

  // Sector concentration (Herfindahl-like)
  const sectorValues: Record<string, number> = {};
  for (const p of positions) {
    const sector = p.sector || inferSector(p.symbol);
    sectorValues[sector] = (sectorValues[sector] || 0) + p.marketValue;
  }

  const sectorCount = Object.keys(sectorValues).length;
  const maxSectorPct = Math.max(...Object.values(sectorValues).map((v) => (v / totalValue) * 100));
  const top3SectorPct = Object.values(sectorValues)
    .sort((a, b) => b - a)
    .slice(0, 3)
    .reduce((s, v) => s + (v / totalValue) * 100, 0);

  // Position concentration
  const top3Pct = positions
    .sort((a, b) => b.marketValue - a.marketValue)
    .slice(0, 3)
    .reduce((s, p) => s + (p.marketValue / totalValue) * 100, 0);

  // Scoring
  let score = 100;
  if (positions.length < 5) score -= 25;
  else if (positions.length < 10) score -= 10;

  if (maxSectorPct > 50) score -= 35;
  else if (maxSectorPct > 35) score -= 20;
  else if (maxSectorPct > 25) score -= 10;

  if (top3Pct > 60) score -= 25;
  else if (top3Pct > 45) score -= 15;
  else if (top3Pct > 30) score -= 5;

  if (sectorCount < 3) score -= 20;
  else if (sectorCount < 5) score -= 5;

  score = Math.max(0, Math.min(100, score));

  const topSymbol = positions.sort((a, b) => b.profitLossPct || 0 - (a.profitLossPct || 0))[0]?.symbol || '';
  const maxSector = Object.entries(sectorValues).sort((a, b) => b[1] - a[1])[0]?.[0] || '';

  const explanation = [
    `Diversification (${score}/100): `,
    maxSectorPct > 35
      ? `Your largest sector (${maxSector}) makes up ${maxSectorPct.toFixed(0)}% of your portfolio. Consider reducing concentration. `
      : `Good sector spread across ${sectorCount} sectors. `,
    top3Pct > 45
      ? `Your top 3 positions make up ${top3Pct.toFixed(0)}% of your portfolio. Trim if any exceed your risk comfort.`
      : `Top 3 positions at ${top3Pct.toFixed(0)}% — reasonable concentration.`,
  ].join('');

  const detail = `${positions.length} positions across ${sectorCount} sectors. Top sector: ${maxSector} (${maxSectorPct.toFixed(0)}%). Top 3 holdings: ${top3Pct.toFixed(0)}%.`;

  return { score, explanation, detail };
}

// ─── Factor 2: Technical Health (20%) ───
function scoreTechnicalHealth(positions: Position[]): FactorResult {
  if (positions.length === 0) {
    return { score: 50, explanation: 'No positions to evaluate. Add holdings to build technical health insight.', detail: 'Score defaults to neutral without active positions.' };
  }

  // Without real-time technical data (RSI, MACD, MAs), we approximate
  // using dayChangePercent as a proxy for momentum
  const winningPct = positions.filter((p) => p.dayChangePercent > 0).length / positions.length;
  const avgDayChange = positions.reduce((s, p) => s + p.dayChangePercent, 0) / positions.length;

  let score = 60; // neutral baseline

  if (winningPct >= 0.7) score += 25;
  else if (winningPct >= 0.55) score += 15;
  else if (winningPct >= 0.4) score += 5;
  else score -= 15;

  if (avgDayChange > 1) score += 10;
  else if (avgDayChange > 0) score += 5;
  else if (avgDayChange < -2) score -= 15;
  else if (avgDayChange < -1) score -= 5;

  // Penalize if any single position is down >5% on the day
  const bigLosers = positions.filter((p) => p.dayChangePercent < -5).length;
  if (bigLosers > 2) score -= 15;
  else if (bigLosers > 0) score -= 5 * bigLosers;

  score = Math.max(0, Math.min(100, score));

  const winners = (winningPct * 100).toFixed(0);
  const explanation = [
    `Technical Health (${score}/100): `,
    winningPct >= 0.7
      ? `${winners}% of positions are up today — strong momentum across the board. `
      : winningPct >= 0.5
      ? `${winners}% of positions are up today — mixed performance. `
      : `Only ${winners}% of positions are up today — watch for downside momentum. `,
    bigLosers > 0
      ? `${bigLosers} position${bigLosers > 1 ? 's' : ''} down >5% today — consider stop-losses.`
      : 'No extreme daily moves — volatility contained.',
  ].join('');

  const detail = `Day performance: ${winners}% winning, avg change ${avgDayChange > 0 ? '+' : ''}${avgDayChange.toFixed(2)}%. ${bigLosers} position(s) with >5% daily drawdown.`;

  return { score, explanation, detail };
}

// ─── Factor 3: Volatility Exposure (20%) ───
function scoreVolatilityExposure(positions: Position[]): FactorResult {
  if (positions.length === 0) {
    return { score: 80, explanation: 'No exposure — zero volatility risk. But missing upside too.', detail: 'Cash-only portfolio has no volatility exposure.' };
  }

  // Without actual beta data, approximate:
  // - Tech/heavy positions → higher beta proxy
  // - Number of positions → diversification reduces portfolio volatility
  // - Position sizes → large positions amplify volatility
  const totalValue = positions.reduce((s, p) => s + p.marketValue, 0);

  // High-beta proxies: Tech, Consumer Discretionary, Crypto
  const highBetaSectors = ['Technology', 'Consumer', 'Media & Entertainment'];
  let highBetaExposure = 0;
  let largePositionRisk = 0;

  for (const p of positions) {
    const sector = p.sector || inferSector(p.symbol);
    if (highBetaSectors.some((hb) => sector.includes(hb))) {
      highBetaExposure += p.marketValue;
    }
    const pct = (p.marketValue / totalValue) * 100;
    if (pct > 20) largePositionRisk += pct - 20;
  }

  const highBetaPct = (highBetaExposure / totalValue) * 100;

  let score = 100;

  // High beta concentration
  if (highBetaPct > 60) score -= 35;
  else if (highBetaPct > 40) score -= 20;
  else if (highBetaPct > 25) score -= 10;

  // Large position risk
  score -= Math.min(30, Math.round(largePositionRisk * 1.5));

  // Few positions = higher volatility
  if (positions.length < 5) score -= 20;
  else if (positions.length < 8) score -= 10;
  else score += 5;

  score = Math.max(0, Math.min(100, score));

  const explanation = [
    `Volatility Exposure (${score}/100): `,
    highBetaPct > 40
      ? `High-beta sectors (tech, consumer) make up ${highBetaPct.toFixed(0)}% — expect amplified market moves. `
      : `Moderate high-beta exposure at ${highBetaPct.toFixed(0)}% — balanced volatility profile. `,
    largePositionRisk > 0
      ? 'Some positions are oversized, increasing portfolio-level volatility.'
      : 'Position sizing is well-controlled.',
  ].join('');

  const detail = `High-beta exposure: ${highBetaPct.toFixed(0)}%. ${positions.length} positions. Oversized positions add ~${Math.round(largePositionRisk * 1.5)}% volatility penalty.`;

  return { score, explanation, detail };
}

// ─── Factor 4: Macro Alignment (15%) ───
function scoreMacroAlignment(positions: Position[]): FactorResult {
  if (positions.length === 0) {
    return { score: 50, explanation: 'No positions to evaluate macro alignment.', detail: 'Add holdings for macro context analysis.' };
  }

  // Without real economic data, approximate:
  // - Rate sensitivity: Financials benefit from higher rates, Tech/Real Estate suffer
  // - Sector balance across economic regimes
  // - Defensive vs cyclical mix
  const totalValue = positions.reduce((s, p) => s + p.marketValue, 0);

  // Classify by macro sensitivity
  const rateSensitive: Record<string, number> = {}; // sectors that move with rates
  const defensive: Record<string, number> = {};
  const cyclical: Record<string, number> = {};

  const defensiveSectors = ['Healthcare', 'Utilities', 'Consumer'];
  const cyclicalSectors = ['Technology', 'Industrials', 'Energy', 'Materials', 'Financial Services'];

  for (const p of positions) {
    const sector = p.sector || inferSector(p.symbol);
    if (defensiveSectors.some((ds) => sector.includes(ds))) {
      defensive[sector] = (defensive[sector] || 0) + p.marketValue;
    } else if (cyclicalSectors.some((cs) => sector.includes(cs))) {
      cyclical[sector] = (cyclical[sector] || 0) + p.marketValue;
    }
  }

  const defensivePct =
    Object.values(defensive).reduce((s, v) => s + v, 0) / totalValue * 100;
  const cyclicalPct =
    Object.values(cyclical).reduce((s, v) => s + v, 0) / totalValue * 100;

  let score = 75;

  // Good balance is ~30-40% defensive, 50-60% cyclical
  if (defensivePct >= 25 && defensivePct <= 45) score += 10;
  else if (defensivePct < 15) score -= 15;
  else if (defensivePct > 60) score -= 10;

  if (cyclicalPct > 75) score -= 15;
  else if (cyclicalPct > 60) score -= 5;
  else if (cyclicalPct < 40) score -= 10;

  score = Math.max(0, Math.min(100, score));

  const explanation = [
    `Macro Alignment (${score}/100): `,
    `Portfolio is ${defensivePct.toFixed(0)}% defensive, ${cyclicalPct.toFixed(0)}% cyclical. `,
    defensivePct < 20
      ? 'Heavy cyclical tilt — vulnerable in recessions. Consider adding defensive names.'
      : defensivePct > 50
      ? 'High defensive allocation — may lag in bull markets.'
      : 'Good balance across economic regimes.',
  ].join('');

  const detail = `Defensive: ${defensivePct.toFixed(0)}%, Cyclical: ${cyclicalPct.toFixed(0)}%. Ideal balance is ~30% defensive, ~60% cyclical in current rate environment.`;

  return { score, explanation, detail };
}

// ─── Factor 5: Position Quality (20%) ───
function scorePositionQuality(positions: Position[]): FactorResult {
  if (positions.length === 0) {
    return { score: 0, explanation: 'No positions to evaluate.', detail: 'Build quality positions to improve this score.' };
  }

  // Position quality = combination of:
  // 1. Profitability ratio (how many positions are in profit)
  // 2. Average return on positions
  // 3. Risk/reward balance (no single position too dominant)
  // 4. Holding diversity (different entry points = good cost averaging)
  const totalValue = positions.reduce((s, p) => s + p.marketValue, 0);

  const profitableCount = positions.filter((p) => p.totalPnlPercent > 0).length;
  const profitRatio = profitableCount / positions.length;
  const avgReturn =
    positions.reduce((s, p) => s + p.totalPnlPercent, 0) / positions.length;

  // Check for positions with terrible cost basis
  const largeLosers = positions.filter((p) => p.totalPnlPercent < -20).length;
  const bigWinners = positions.filter((p) => p.totalPnlPercent > 30).length;

  let score = 60;

  // Profitability
  if (profitRatio >= 0.8) score += 20;
  else if (profitRatio >= 0.6) score += 10;
  else if (profitRatio <= 0.3) score -= 20;
  else if (profitRatio <= 0.5) score -= 10;

  // Average return quality
  if (avgReturn > 15) score += 15;
  else if (avgReturn > 5) score += 10;
  else if (avgReturn < -10) score -= 20;
  else if (avgReturn < 0) score -= 10;

  // Large losers penalty
  score -= largeLosers * 10;

  // Big winners bonus
  score += Math.min(10, bigWinners * 5);

  score = Math.max(0, Math.min(100, score));

  const explanation = [
    `Position Quality (${score}/100): `,
    `${profitRatio >= 0.6 ? 'Most positions are profitable' : 'Several positions underwater'} `,
    `— ${profitableCount}/${positions.length} in profit. `,
    avgReturn > 0
      ? `Average return: +${avgReturn.toFixed(1)}%. `
      : `Average return: ${avgReturn.toFixed(1)}%. `,
    largeLosers > 0
      ? `${largeLosers} position${largeLosers > 1 ? 's' : ''} down >20% — review thesis or set stop-losses.`
      : 'No deeply underwater positions — good risk management.',
  ].join('');

  const detail = `${profitableCount}/${positions.length} positions profitable (${(profitRatio * 100).toFixed(0)}%). Avg return: ${avgReturn > 0 ? '+' : ''}${avgReturn.toFixed(1)}%. ${largeLosers} large loser(s), ${bigWinners} big winner(s).`;

  return { score, explanation, detail };
}

// ─── Main Scoring Function ───
export function calculateConfidence(positions: Position[]): ConfidenceResult {
  const diversification = scoreDiversification(positions);
  const technicalHealth = scoreTechnicalHealth(positions);
  const volatilityExposure = scoreVolatilityExposure(positions);
  const macroAlignment = scoreMacroAlignment(positions);
  const positionQuality = scorePositionQuality(positions);

  const overall = Math.round(
    diversification.score * 0.25 +
    technicalHealth.score * 0.20 +
    volatilityExposure.score * 0.20 +
    macroAlignment.score * 0.15 +
    positionQuality.score * 0.20
  );

  // Gather warnings
  const warnings: string[] = [];
  if (diversification.score < 60) {
    warnings.push(diversification.explanation.replace(/^Diversification \(\d+\/100\): /, ''));
  }
  if (volatilityExposure.score < 60) {
    warnings.push(volatilityExposure.explanation.replace(/^Volatility Exposure \(\d+\/100\): /, ''));
  }
  if (positionQuality.score < 50) {
    warnings.push('Several positions showing significant unrealized losses. Review cost basis.');
  }
  if (technicalHealth.score < 50) {
    warnings.push('Technical momentum is weak across portfolio. Consider tightening stop-losses.');
  }

  // Build summary explanation
  const strongest = Object.entries({
    diversification: diversification.score,
    technicalHealth: technicalHealth.score,
    volatilityExposure: volatilityExposure.score,
    macroAlignment: macroAlignment.score,
    positionQuality: positionQuality.score,
  }).sort((a, b) => b[1] - a[1])[0];

  const weakest = Object.entries({
    diversification: diversification.score,
    technicalHealth: technicalHealth.score,
    volatilityExposure: volatilityExposure.score,
    macroAlignment: macroAlignment.score,
    positionQuality: positionQuality.score,
  }).sort((a, b) => a[1] - b[1])[4];

  const explanation = [
    `Overall score of ${overall}% — `,
    overall >= 80
      ? 'strong risk-adjusted positioning. '
      : overall >= 60
      ? 'moderate positioning with room for improvement. '
      : 'needs attention. Several factors are below target. ',
    `Strongest factor: ${strongest[0]} (${strongest[1]}%). `,
    `Weakest factor: ${weakest[0]} (${weakest[1]}%).`,
  ].join('');

  return {
    overall,
    factors: {
      diversification,
      technicalHealth,
      volatilityExposure,
      macroAlignment,
      positionQuality,
    },
    explanation,
    warnings,
  };
}
