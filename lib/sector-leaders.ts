// ─── Sector Leaders by Investor Style ────────────────────────
// Maps sectors to specific stock candidates based on investor style.
// Each style provides different tickers tailored to that philosophy.

import { analyzeStockForSector, rankStocksForStyle } from '@/lib/stock-analyst';
import type { StockAnalysis } from '@/lib/stock-analyst';

// ─── Sector Allocation from Style Targets ─────────────────────
// These map investor-style ETF targets to sector names & gaps.

export interface StyleSectorTarget {
  sector: string;
  symbol: string; // the ETF/stock symbol
  targetPercent: number;
  type: 'ETF' | 'Stock';
}

// ─── Stock Candidates per Style/Sector ────────────────────────

export const SECTOR_LEADERS_BY_STYLE: Record<string, Record<string, string[]>> = {
  lynch: {
    // Growth: high EPS & revenue growth, momentum, analyst upgrades
    'Technology': ['NVDA', 'AVGO', 'CRM', 'ADBE', 'MSFT', 'ORCL'],
    'Healthcare': ['UNH', 'ISRG', 'LLY', 'VRTX', 'DHR', 'TMO'],
    'Consumer': ['AMZN', 'MELI', 'TSLA', 'DASH', 'NKE', 'SBUX'],
    'Media & Entertainment': ['META', 'NFLX', 'SPOT', 'RBLX', 'TTD'],
    'Financial Services': ['MA', 'V', 'MSCI', 'BX', 'SPGI'],
    'Industrials': ['AJG', 'CAT', 'UBER', 'CPRT', 'MMM'],
    'Energy': ['LNG', 'OXY', 'TRGP'], // growth names in energy
  },
  buffett: {
    // Value: PE < sector, high ROE, low debt, dividend
    'Financial Services': ['JPM', 'BRK.B', 'BAC', 'MCO', 'TRV'],
    'Consumer': ['KO', 'PG', 'JNJ', 'PEP', 'WMT', 'COST', 'KHC'],
    'Healthcare': ['JNJ', 'ABT', 'MDT', 'BMY', 'GILD'],
    'Utilities': ['NEE', 'DUK', 'SO', 'AEP', 'WEC'],
    'Energy': ['XOM', 'CVX', 'COP', 'PSX', 'KMI'],
    'Technology': ['CSCO', 'INTC', 'IBM', 'QCOM', 'TXN'],
    'Industrials': ['LMT', 'RTX', 'HON', 'WM', 'RSG'],
    'Materials': ['LIN', 'NEM', 'SHW'],
  },
  livermore: {
    // Momentum: strong trend, RSI 50-70, above MAs, volume surge
    'Technology': ['NVDA', 'AVGO', 'SMCI', 'SNOW', 'PLTR', 'DELL'],
    'Media & Entertainment': ['META', 'NFLX', 'SPOT', 'PINS', 'SNAP'],
    'Financial Services': ['COIN', 'BK', 'AXP', 'C', 'HOOD'],
    'Consumer': ['TSLA', 'RIVN', 'CMG', 'LULU', 'DKNG'],
    'Healthcare': ['LLY', 'VRTX', 'MRNA', 'CRSP'],
    'Energy': ['VLO', 'XOM', 'HAL'],
  },
  soros: {
    // Macro: broad-based, defensive, international, gold
    'Financial Services': ['JPM', 'BAC', 'GS', 'MS', 'C'],
    'Energy': ['XOM', 'CVX'],
    'Technology': ['AAPL', 'MSFT', 'GOOGL'],
    'Healthcare': ['JNJ', 'UNH'],
    'Consumer': ['WMT', 'COST', 'PG'],
    'Materials': ['GLD', 'NEM'], // gold exposure
    'Industrials': ['LMT', 'RTX'], // defense
  },
  munger: {
    // Dividend: high yield, safe payout, stable sectors
    'Financial Services': ['JPM', 'MA', 'V', 'BX', 'ARES'],
    'Consumer': ['KO', 'PG', 'PEP', 'MCD', 'CL', 'KMB'],
    'Healthcare': ['JNJ', 'UNH', 'ABT', 'PFE', 'AMGN'],
    'Utilities': ['NEE', 'DUK', 'SO', 'AEP', 'D'],
    'Energy': ['XOM', 'CVX', 'KMI', 'OKE', 'EPD'],
    'Real Estate': ['PLD', 'O', 'AMT', 'WELL', 'DLR'],
    'Technology': ['AVGO', 'QCOM', 'CSCO', 'INTC'],
  },
};

// ─── Sector Name Normalization ───────────────────────────────

/**
 * Map ETF symbol or sector name to our canonical sector name for the leaders map.
 */
export function mapETFToSector(etfSymbol: string): string | null {
  const ETF_SECTOR_MAP: Record<string, string> = {
    'XLK': 'Technology',
    'XLY': 'Consumer',
    'XLV': 'Healthcare',
    'XLF': 'Financial Services',
    'XLI': 'Industrials',
    'XLE': 'Energy',
    'XLU': 'Utilities',
    'XLB': 'Materials',
    'XLRE': 'Real Estate',
    'XLC': 'Media & Entertainment',
    'XLP': 'Consumer',
    'SPY': 'Technology',
    'VYM': 'Financial Services',
  };
  return ETF_SECTOR_MAP[etfSymbol] || null;
}

/**
 * Get sector gaps from style targets.
 * Returns sectors where allocation is below target (potential buy opportunities).
 */
export function getSectorGapsFromStyle(
  etfTargets: Array<{ symbol: string; targetPercent: number }>,
  currentPositions: Array<{ symbol: string; marketValue: number }>,
  totalValue: number,
): Array<{ sector: string; etfSymbol: string; currentPct: number; targetPct: number; gap: number }> {
  const gaps: Array<{ sector: string; etfSymbol: string; currentPct: number; targetPct: number; gap: number }> = [];

  for (const target of etfTargets) {
    const sector = mapETFToSector(target.symbol);
    if (!sector) continue;

    const position = currentPositions.find(p => p.symbol === target.symbol);
    const currentPct = position ? (position.marketValue / totalValue) * 100 : 0;
    const gap = target.targetPercent - currentPct;

    if (gap > 1) {
      gaps.push({ sector, etfSymbol: target.symbol, currentPct, targetPct: target.targetPercent, gap });
    }
  }

  gaps.sort((a, b) => b.gap - a.gap);
  return gaps;
}

// ─── Top Sector Leaders ──────────────────────────────────────

/**
 * Get top N stock leaders for a sector, ranked by investor style.
 * Fetches deep analysis (fundamentals + technicals + sentiment) for each candidate.
 * Falls back gracefully — stocks with failed fetches are simply skipped.
 */
export async function getTopSectorLeaders(
  sector: string,
  investorStyle: string,
  count: number = 3,
): Promise<StockAnalysis[]> {
  const style = investorStyle.toLowerCase();
  const styleLeaders = SECTOR_LEADERS_BY_STYLE[style] || SECTOR_LEADERS_BY_STYLE['buffett'];

  // Try exact sector match first, then find the closest match
  let candidates: string[] = styleLeaders[sector] || [];

  // Fuzzy match: try partial sector names
  if (candidates.length === 0) {
    for (const [key, symbols] of Object.entries(styleLeaders)) {
      if (sector.includes(key) || key.includes(sector)) {
        candidates = symbols;
        break;
      }
    }
  }

  // Still no match? Fall back to Technology sector
  if (candidates.length === 0) {
    candidates = styleLeaders['Technology'] || ['MSFT', 'AAPL'];
  }

  // Take up to 5 candidates for analysis (to have enough after failures/ranking)
  const toAnalyze = candidates.slice(0, 5);

  // Fetch deep analysis for all candidates in parallel
  const analyses = await Promise.all(
    toAnalyze.map(sym =>
      analyzeStockForSector(sym, sector, investorStyle)
        .catch(() => null)
    ),
  );

  // Filter out nulls and rank
  const valid = analyses.filter((a): a is StockAnalysis => a !== null && a.dataPoints >= 3);

  // Rank and take top N
  const ranked = rankStocksForStyle(valid, investorStyle);
  return ranked.slice(0, count);
}

// ─── Style Descriptions ──────────────────────────────────────

export const STYLE_STRATEGY_NOTES: Record<string, string> = {
  lynch: 'Growth-Style: Prioritizes EPS growth, revenue acceleration, and upward momentum. Prefers companies expanding faster than their sectors.',
  buffett: 'Value-Style: Seeks undervalued companies with strong ROE, low debt, and durable competitive advantages (moats).',
  livermore: 'Momentum-Style: Rides strong trends. Looks for RSI in 50-70 range, above key moving averages, with volume confirmation.',
  soros: 'Macro-Style: Top-down approach. Overweights broad indices, bonds, gold, and international exposure for defensive positioning.',
  munger: 'Dividend-Style: Focuses on sustainable dividend yield, safe payout ratios, and stable cash-flow businesses.',
};
