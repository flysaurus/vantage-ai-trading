import type { Position } from '@/types';

// ─── Types ────────────────────────────────────────────────────

export interface ConflictAnalysis {
  hasConflict: boolean;
  severity: 'low' | 'medium' | 'high';
  conflictMessage: string;
  metrics: Record<string, { current: number | string; ideal: number | string; unit: string }>;
  suggestions: string[];
}

interface StockDataMap {
  [symbol: string]: {
    dividendYield?: number;
    pb?: number;
    pe?: number;
    revenueGrowth?: number;
    payoutRatio?: number;
    currentPrice?: number;
    price200ma?: number | null;
  };
}

interface MacroIndicators {
  ratesRising?: boolean;
  recessionRisk?: number; // 0-100
}

// ─── Portfolio Metrics ────────────────────────────────────────

function calcPortfolioMetrics(positions: Position[], stockData: StockDataMap) {
  const totalValue = positions.reduce((s, p) => s + p.marketValue, 0);
  let totalDivIncome = 0, divPayers = 0;
  let totalPB = 0, pbCount = 0;
  let totalPE = 0, peCount = 0;
  let growthStocks = 0;
  let totalPayout = 0, payoutCount = 0;
  let above200 = 0, with200 = 0;
  let revGrowthSum = 0, revCount = 0;

  for (const pos of positions) {
    const d = stockData[pos.symbol];
    if (!d) continue;

    if (d.dividendYield && d.dividendYield > 0) {
      totalDivIncome += (pos.marketValue * d.dividendYield) / 100;
      divPayers++;
    }
    if (d.pb) { totalPB += d.pb; pbCount++; }
    if (d.pe) { totalPE += d.pe; peCount++; }
    if (d.revenueGrowth) {
      revGrowthSum += d.revenueGrowth;
      revCount++;
      if (d.revenueGrowth > 15) growthStocks++;
    }
    if (d.payoutRatio) { totalPayout += d.payoutRatio; payoutCount++; }
    if (d.price200ma != null && d.currentPrice != null) {
      with200++;
      if (d.currentPrice > d.price200ma) above200++;
    }
  }

  return {
    totalValue,
    portfolioYield: totalValue ? (totalDivIncome / totalValue) * 100 : 0,
    dividendPayingPercent: positions.length ? (divPayers / positions.length) * 100 : 0,
    avgPB: pbCount ? totalPB / pbCount : 0,
    avgPE: peCount ? totalPE / peCount : 0,
    growthStockPercent: positions.length ? (growthStocks / positions.length) * 100 : 0,
    avgRevenueGrowth: revCount ? revGrowthSum / revCount : 0,
    avgPayoutRatio: payoutCount ? totalPayout / payoutCount : 0,
    above200Percent: with200 ? (above200 / with200) * 100 : 0,
  };
}

function severity(conflictCount: number): 'low' | 'medium' | 'high' {
  if (conflictCount > 2) return 'high';
  if (conflictCount > 0) return 'medium';
  return 'low';
}

// ─── Buffett ──────────────────────────────────────────────────

export function detectBuffettConflict(
  positions: Position[],
  stockData: StockDataMap,
): ConflictAnalysis {
  const m = calcPortfolioMetrics(positions, stockData);
  const metrics: ConflictAnalysis['metrics'] = {};
  const conflicts: string[] = [];

  if (m.growthStockPercent > 50) {
    conflicts.push('Too much growth/speculative exposure');
    metrics.growthExposure = { current: m.growthStockPercent.toFixed(1), ideal: '<50', unit: '%' };
  }
  if (m.avgPE > 20) {
    conflicts.push('Average P/E too high (premium valuation)');
    metrics.avgPE = { current: m.avgPE.toFixed(1), ideal: '<18', unit: '×' };
  }
  if (m.portfolioYield < 2) {
    conflicts.push('Portfolio yield below target');
    metrics.yield = { current: m.portfolioYield.toFixed(2), ideal: '>2.0', unit: '%' };
  }
  if (m.dividendPayingPercent < 50) {
    conflicts.push('Not enough dividend-paying stocks');
    metrics.dividendPayers = { current: `${m.dividendPayingPercent.toFixed(0)}%`, ideal: '>60%', unit: '' };
  }

  const suggestions: string[] = [];
  if (m.growthStockPercent > 50) suggestions.push('Consider trimming growth stocks and rotating into dividend payers');
  if (m.avgPE > 20) suggestions.push('Look for undervalued quality companies to add');
  if (m.portfolioYield < 2) suggestions.push('Target portfolio yield of 3-4% for income generation');

  return {
    hasConflict: conflicts.length > 0,
    severity: severity(conflicts.length),
    conflictMessage: conflicts.length > 0
      ? `Your portfolio is ${m.growthStockPercent.toFixed(0)}% growth stocks, but Buffett prefers dividend-paying quality stocks.`
      : 'Your portfolio aligns well with value investing principles.',
    metrics,
    suggestions,
  };
}

// ─── Lynch ────────────────────────────────────────────────────

export function detectLynchConflict(
  positions: Position[],
  stockData: StockDataMap,
): ConflictAnalysis {
  const m = calcPortfolioMetrics(positions, stockData);
  const metrics: ConflictAnalysis['metrics'] = {};
  const conflicts: string[] = [];

  if (m.avgRevenueGrowth < 10) {
    conflicts.push('Average revenue growth too low');
    metrics.growthRate = { current: `${m.avgRevenueGrowth.toFixed(1)}%`, ideal: '>15%', unit: '' };
  }
  if (m.avgPE > 0 && m.avgRevenueGrowth > 0) {
    const peg = m.avgPE / m.avgRevenueGrowth;
    if (peg > 2) {
      conflicts.push('Portfolio overvalued relative to growth rate');
      metrics.peg = { current: peg.toFixed(2), ideal: '<1.5', unit: '' };
    }
  }

  const suggestions: string[] = [];
  if (m.avgRevenueGrowth < 10) suggestions.push('Rotate into companies with higher growth rates (>15%)');
  if (m.avgPE > m.avgRevenueGrowth * 1.5) suggestions.push('Portfolio appears overvalued. Look for better growth/value combinations');

  return {
    hasConflict: conflicts.length > 0,
    severity: severity(conflicts.length),
    conflictMessage: conflicts.length > 0
      ? `Your portfolio's average growth is ${m.avgRevenueGrowth.toFixed(1)}%, but Lynch prefers faster-growing companies.`
      : 'Your portfolio has good growth characteristics.',
    metrics,
    suggestions,
  };
}

// ─── Livermore ────────────────────────────────────────────────

export function detectLivermoreConflict(
  positions: Position[],
  stockData: StockDataMap,
): ConflictAnalysis {
  const m = calcPortfolioMetrics(positions, stockData);
  const metrics: ConflictAnalysis['metrics'] = {};

  if (m.above200Percent < 50) {
    metrics.uptrend = { current: `${m.above200Percent.toFixed(0)}%`, ideal: '>70%', unit: '' };
  }

  const hasConflict = m.above200Percent < 50;

  return {
    hasConflict,
    severity: hasConflict ? 'medium' : 'low',
    conflictMessage: hasConflict
      ? `Only ${m.above200Percent.toFixed(0)}% of your portfolio is above the 200-day moving average.`
      : 'Your portfolio shows strong technical trends.',
    metrics,
    suggestions: [
      'Trim positions below 200-day MA',
      'Look to add positions in established uptrends',
      'Review positions weekly for momentum changes',
    ],
  };
}

// ─── Soros ────────────────────────────────────────────────────

export function detectSorosConflict(
  positions: Position[],
  stockData: StockDataMap,
  macro?: MacroIndicators,
): ConflictAnalysis {
  const m = calcPortfolioMetrics(positions, stockData);
  const metrics: ConflictAnalysis['metrics'] = {};
  const conflicts: string[] = [];

  if (macro?.ratesRising && m.growthStockPercent > 70) {
    conflicts.push('Growth-heavy portfolio vulnerable to rising rates');
    metrics.growthInRates = { current: `${m.growthStockPercent.toFixed(0)}%`, ideal: '<40%', unit: '' };
  }
  if (macro?.recessionRisk && macro.recessionRisk > 60 && m.growthStockPercent > 60) {
    conflicts.push('Growth exposure too high for elevated recession risk');
    metrics.recession = { current: `${macro.recessionRisk.toFixed(0)}% risk`, ideal: 'Lower exposure', unit: '' };
  }

  return {
    hasConflict: conflicts.length > 0,
    severity: severity(conflicts.length),
    conflictMessage: conflicts.length > 0
      ? 'Current macro environment may not align with portfolio composition.'
      : 'Portfolio positioned appropriately for current macro regime.',
    metrics,
    suggestions: conflicts.length > 0
      ? ['Review sector allocation relative to macro backdrop', 'Consider defensive positions if recession risk rising', 'Monitor interest rate trends closely']
      : [],
  };
}

// ─── Munger ───────────────────────────────────────────────────

export function detectMungerConflict(
  positions: Position[],
  stockData: StockDataMap,
): ConflictAnalysis {
  const m = calcPortfolioMetrics(positions, stockData);
  const metrics: ConflictAnalysis['metrics'] = {};
  const conflicts: string[] = [];

  if (m.portfolioYield < 2.5) {
    conflicts.push('Portfolio yield below target range');
    metrics.yield = { current: `${m.portfolioYield.toFixed(2)}%`, ideal: '3-4%', unit: '' };
  }
  if (m.growthStockPercent > 40) {
    conflicts.push('Too much growth exposure for income strategy');
    metrics.growthExposure = { current: `${m.growthStockPercent.toFixed(0)}%`, ideal: '<30%', unit: '' };
  }
  if (m.avgPayoutRatio > 75) {
    conflicts.push('Average payout ratio too high (dividend cut risk)');
    metrics.payout = { current: `${m.avgPayoutRatio.toFixed(0)}%`, ideal: '<65%', unit: '' };
  }
  if (m.dividendPayingPercent < 70) {
    conflicts.push('Not enough dividend-paying stocks');
    metrics.dividendPayers = { current: `${m.dividendPayingPercent.toFixed(0)}%`, ideal: '>80%', unit: '' };
  }

  const suggestions: string[] = [];
  if (m.portfolioYield < 3) suggestions.push('Add dividend aristocrats (10+ year dividend growers)', 'Target portfolio yield of 3-4%');
  if (m.growthStockPercent > 40) suggestions.push('Gradually rotate growth stocks into dividend payers');
  if (m.avgPayoutRatio > 75) suggestions.push('Trim positions with unsustainable payout ratios');

  return {
    hasConflict: conflicts.length > 0,
    severity: severity(conflicts.length),
    conflictMessage: conflicts.length > 0
      ? `Your portfolio yield is ${m.portfolioYield.toFixed(2)}%, but Munger prefers 3-4% for steady income.`
      : 'Your portfolio has excellent income-generating characteristics.',
    metrics,
    suggestions,
  };
}

// ─── Main dispatcher ──────────────────────────────────────────

export function detectConflict(
  style: string,
  positions: Position[],
  stockData: StockDataMap,
  macro?: MacroIndicators,
): ConflictAnalysis {
  switch (style) {
    case 'buffett': return detectBuffettConflict(positions, stockData);
    case 'lynch': return detectLynchConflict(positions, stockData);
    case 'livermore': return detectLivermoreConflict(positions, stockData);
    case 'soros': return detectSorosConflict(positions, stockData, macro);
    case 'munger': return detectMungerConflict(positions, stockData);
    default:
      return { hasConflict: false, severity: 'low', conflictMessage: 'No conflict detected', metrics: {}, suggestions: [] };
  }
}
