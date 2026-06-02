/**
 * Investor Style Default Target Allocations
 * Sector-based allocation fallbacks used when no saved rebalancing targets exist.
 * Each style maps to specific ETFs to generate actionable rebalance trades.
 */

export interface StyleTarget {
  symbol: string;
  name: string;
  type: 'ETF' | 'Stock';
  targetPercent: number; // percentage of portfolio
}

export interface StyleAllocation {
  styleName: string;
  description: string;
  targets: StyleTarget[];
}

// ─── Style Definitions ─────────────────────────────────────────────────────

const STYLE_ALLOCATIONS: Record<string, StyleAllocation> = {
  lynch: {
    styleName: 'Growth-Style',
    description: 'Aggressive growth focus — overweight technology and consumer cyclicals. Higher volatility, higher return potential.',
    targets: [
      { symbol: 'XLK', name: 'Technology Select Sector SPDR', type: 'ETF', targetPercent: 35 },
      { symbol: 'XLY', name: 'Consumer Discretionary SPDR', type: 'ETF', targetPercent: 20 },
      { symbol: 'XLV', name: 'Health Care Select Sector SPDR', type: 'ETF', targetPercent: 15 },
      { symbol: 'XLF', name: 'Financial Select Sector SPDR', type: 'ETF', targetPercent: 10 },
      { symbol: 'XLI', name: 'Industrial Select Sector SPDR', type: 'ETF', targetPercent: 5 },
      { symbol: 'SPY', name: 'SPDR S&P 500 ETF', type: 'ETF', targetPercent: 10 },
      { symbol: 'CASH', name: 'Cash / Short-Term', type: 'ETF', targetPercent: 5 },
    ],
  },

  buffett: {
    styleName: 'Value-Style',
    description: 'Focus on undervalued, high-quality businesses. Overweight financials and consumer staples. Long holding periods.',
    targets: [
      { symbol: 'XLF', name: 'Financial Select Sector SPDR', type: 'ETF', targetPercent: 30 },
      { symbol: 'XLP', name: 'Consumer Staples SPDR', type: 'ETF', targetPercent: 20 },
      { symbol: 'XLV', name: 'Health Care Select Sector SPDR', type: 'ETF', targetPercent: 15 },
      { symbol: 'XLK', name: 'Technology Select Sector SPDR', type: 'ETF', targetPercent: 15 },
      { symbol: 'XLI', name: 'Industrial Select Sector SPDR', type: 'ETF', targetPercent: 5 },
      { symbol: 'SPY', name: 'SPDR S&P 500 ETF', type: 'ETF', targetPercent: 10 },
      { symbol: 'CASH', name: 'Cash / Short-Term', type: 'ETF', targetPercent: 5 },
    ],
  },

  livermore: {
    styleName: 'Momentum-Style',
    description: 'Trend following — overweight technology and growth sectors. Ride winners, cut losers. Shorter holding periods.',
    targets: [
      { symbol: 'XLK', name: 'Technology Select Sector SPDR', type: 'ETF', targetPercent: 45 },
      { symbol: 'XLY', name: 'Consumer Discretionary SPDR', type: 'ETF', targetPercent: 20 },
      { symbol: 'XLF', name: 'Financial Select Sector SPDR', type: 'ETF', targetPercent: 10 },
      { symbol: 'XLC', name: 'Communication Services SPDR', type: 'ETF', targetPercent: 10 },
      { symbol: 'SPY', name: 'SPDR S&P 500 ETF', type: 'ETF', targetPercent: 10 },
      { symbol: 'CASH', name: 'Cash / Short-Term', type: 'ETF', targetPercent: 5 },
    ],
  },

  soros: {
    styleName: 'Macro-Style',
    description: 'Top-down macro approach. Heavy bonds/treasuries, international exposure, broad equity. Defensive positioning.',
    targets: [
      { symbol: 'SPY', name: 'SPDR S&P 500 ETF', type: 'ETF', targetPercent: 35 },
      { symbol: 'TLT', name: 'iShares 20+ Year Treasury Bond ETF', type: 'ETF', targetPercent: 20 },
      { symbol: 'EFA', name: 'iShares MSCI EAFE ETF (International)', type: 'ETF', targetPercent: 15 },
      { symbol: 'GLD', name: 'SPDR Gold Shares', type: 'ETF', targetPercent: 10 },
      { symbol: 'IEF', name: 'iShares 7-10 Year Treasury Bond ETF', type: 'ETF', targetPercent: 10 },
      { symbol: 'CASH', name: 'Cash / Short-Term', type: 'ETF', targetPercent: 10 },
    ],
  },

  munger: {
    styleName: 'Dividend-Style',
    description: 'Dividend growth focus — overweight financials, consumer staples, healthcare. Steady income generation.',
    targets: [
      { symbol: 'XLF', name: 'Financial Select Sector SPDR', type: 'ETF', targetPercent: 25 },
      { symbol: 'XLP', name: 'Consumer Staples SPDR', type: 'ETF', targetPercent: 20 },
      { symbol: 'XLV', name: 'Health Care Select Sector SPDR', type: 'ETF', targetPercent: 15 },
      { symbol: 'XLU', name: 'Utilities Select Sector SPDR', type: 'ETF', targetPercent: 10 },
      { symbol: 'VYM', name: 'Vanguard High Dividend Yield ETF', type: 'ETF', targetPercent: 15 },
      { symbol: 'SPY', name: 'SPDR S&P 500 ETF', type: 'ETF', targetPercent: 10 },
      { symbol: 'CASH', name: 'Cash / Short-Term', type: 'ETF', targetPercent: 5 },
    ],
  },
};

// ─── Display name map ──────────────────────────────────────────────────────

export const STYLE_DISPLAY_NAMES: Record<string, string> = {
  lynch: 'Growth-Style',
  buffett: 'Value-Style',
  livermore: 'Momentum-Style',
  soros: 'Macro-Style',
  munger: 'Dividend-Style',
};

// ─── Helper ───────────────────────────────────────────────────────────────

/**
 * Get default target allocations for a given investor style.
 * Falls back to 'buffett' (Value-Style) if style is unknown.
 * Returns targets as {symbol, targetPercent} for calculateRebalanceTrades().
 */
export function getInvestorStyleTargets(
  style: string
): { targets: StyleTarget[]; styleName: string; description: string } {
  const allocation = STYLE_ALLOCATIONS[style] || STYLE_ALLOCATIONS['buffett'];
  return {
    targets: allocation.targets,
    styleName: allocation.styleName,
    description: allocation.description,
  };
}

/**
 * Get the display name for an investor style key.
 */
export function getStyleDisplayName(style: string): string {
  return STYLE_DISPLAY_NAMES[style] || 'Value-Style';
}
