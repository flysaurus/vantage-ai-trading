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

// ─── Stock targets (per style) ─────────────────────────────────────────────
// Curated large-cap stock lists matched to each style's sector thesis. Used by
// the "Stocks" / "Mix" asset-class options in the rebalance flow. Each list sums
// to 100% including a CASH bucket (mirrors the ETF target structure).

export interface StockTarget {
  symbol: string;
  name: string;
  targetPercent: number; // percentage of portfolio (sums to 100 incl CASH)
}

const STYLE_STOCKS: Record<string, StockTarget[]> = {
  buffett: [
    // Financials 30
    { symbol: 'JPM', name: 'JPMorgan Chase', targetPercent: 10 },
    { symbol: 'BAC', name: 'Bank of America', targetPercent: 8 },
    { symbol: 'WFC', name: 'Wells Fargo', targetPercent: 6 },
    { symbol: 'GS', name: 'Goldman Sachs', targetPercent: 6 },
    // Staples 20
    { symbol: 'WMT', name: 'Walmart', targetPercent: 6 },
    { symbol: 'COST', name: 'Costco', targetPercent: 5 },
    { symbol: 'PG', name: 'Procter & Gamble', targetPercent: 5 },
    { symbol: 'KO', name: 'Coca-Cola', targetPercent: 4 },
    // Healthcare 15
    { symbol: 'JNJ', name: 'Johnson & Johnson', targetPercent: 5 },
    { symbol: 'UNH', name: 'UnitedHealth', targetPercent: 4 },
    { symbol: 'PFE', name: 'Pfizer', targetPercent: 3 },
    { symbol: 'ABBV', name: 'AbbVie', targetPercent: 3 },
    // Tech 15
    { symbol: 'MSFT', name: 'Microsoft', targetPercent: 5 },
    { symbol: 'AAPL', name: 'Apple', targetPercent: 4 },
    { symbol: 'CSCO', name: 'Cisco', targetPercent: 3 },
    { symbol: 'ORCL', name: 'Oracle', targetPercent: 3 },
    // Industrials 5
    { symbol: 'CAT', name: 'Caterpillar', targetPercent: 2 },
    { symbol: 'DE', name: 'Deere', targetPercent: 2 },
    { symbol: 'HON', name: 'Honeywell', targetPercent: 1 },
    // Broad 10
    { symbol: 'BRK.B', name: 'Berkshire Hathaway', targetPercent: 3 },
    { symbol: 'GOOGL', name: 'Alphabet', targetPercent: 3 },
    { symbol: 'AMZN', name: 'Amazon', targetPercent: 2 },
    { symbol: 'NVDA', name: 'NVIDIA', targetPercent: 2 },
    // Cash 5
    { symbol: 'CASH', name: 'Cash / Short-Term', targetPercent: 5 },
  ],
  lynch: [
    // Tech 35
    { symbol: 'MSFT', name: 'Microsoft', targetPercent: 9 },
    { symbol: 'AAPL', name: 'Apple', targetPercent: 8 },
    { symbol: 'NVDA', name: 'NVIDIA', targetPercent: 8 },
    { symbol: 'AVGO', name: 'Broadcom', targetPercent: 5 },
    { symbol: 'AMD', name: 'Advanced Micro Devices', targetPercent: 5 },
    // Consumer Discretionary 20
    { symbol: 'AMZN', name: 'Amazon', targetPercent: 7 },
    { symbol: 'TSLA', name: 'Tesla', targetPercent: 6 },
    { symbol: 'HD', name: 'Home Depot', targetPercent: 4 },
    { symbol: 'NKE', name: 'Nike', targetPercent: 3 },
    // Healthcare 15
    { symbol: 'LLY', name: 'Eli Lilly', targetPercent: 5 },
    { symbol: 'UNH', name: 'UnitedHealth', targetPercent: 4 },
    { symbol: 'ISRG', name: 'Intuitive Surgical', targetPercent: 3 },
    { symbol: 'VRTX', name: 'Vertex', targetPercent: 3 },
    // Financials 10
    { symbol: 'V', name: 'Visa', targetPercent: 3 },
    { symbol: 'MA', name: 'Mastercard', targetPercent: 3 },
    { symbol: 'JPM', name: 'JPMorgan Chase', targetPercent: 2 },
    { symbol: 'GS', name: 'Goldman Sachs', targetPercent: 2 },
    // Industrials 5
    { symbol: 'GE', name: 'GE Aerospace', targetPercent: 2 },
    { symbol: 'CAT', name: 'Caterpillar', targetPercent: 2 },
    { symbol: 'HON', name: 'Honeywell', targetPercent: 1 },
    // Broad 10
    { symbol: 'GOOGL', name: 'Alphabet', targetPercent: 4 },
    { symbol: 'META', name: 'Meta', targetPercent: 3 },
    { symbol: 'NFLX', name: 'Netflix', targetPercent: 3 },
    { symbol: 'CASH', name: 'Cash / Short-Term', targetPercent: 5 },
  ],
  livermore: [
    // Tech 45
    { symbol: 'NVDA', name: 'NVIDIA', targetPercent: 12 },
    { symbol: 'AVGO', name: 'Broadcom', targetPercent: 9 },
    { symbol: 'AMD', name: 'Advanced Micro Devices', targetPercent: 8 },
    { symbol: 'MSFT', name: 'Microsoft', targetPercent: 8 },
    { symbol: 'AAPL', name: 'Apple', targetPercent: 8 },
    // Consumer Discretionary 20
    { symbol: 'AMZN', name: 'Amazon', targetPercent: 8 },
    { symbol: 'TSLA', name: 'Tesla', targetPercent: 7 },
    { symbol: 'BKNG', name: 'Booking Holdings', targetPercent: 5 },
    // Financials 10
    { symbol: 'JPM', name: 'JPMorgan Chase', targetPercent: 4 },
    { symbol: 'GS', name: 'Goldman Sachs', targetPercent: 3 },
    { symbol: 'V', name: 'Visa', targetPercent: 3 },
    // Communication 10
    { symbol: 'META', name: 'Meta', targetPercent: 4 },
    { symbol: 'GOOGL', name: 'Alphabet', targetPercent: 4 },
    { symbol: 'NFLX', name: 'Netflix', targetPercent: 2 },
    // Broad 10
    { symbol: 'CRM', name: 'Salesforce', targetPercent: 4 },
    { symbol: 'NOW', name: 'ServiceNow', targetPercent: 3 },
    { symbol: 'SHOP', name: 'Shopify', targetPercent: 3 },
    { symbol: 'CASH', name: 'Cash / Short-Term', targetPercent: 5 },
  ],
  soros: [
    // Broad equity 35 (macro → diversified defensive basket)
    { symbol: 'MSFT', name: 'Microsoft', targetPercent: 7 },
    { symbol: 'AAPL', name: 'Apple', targetPercent: 6 },
    { symbol: 'NVDA', name: 'NVIDIA', targetPercent: 5 },
    { symbol: 'AMZN', name: 'Amazon', targetPercent: 5 },
    { symbol: 'GOOGL', name: 'Alphabet', targetPercent: 4 },
    { symbol: 'BRK.B', name: 'Berkshire Hathaway', targetPercent: 4 },
    { symbol: 'JPM', name: 'JPMorgan Chase', targetPercent: 4 },
    // Staples 20
    { symbol: 'WMT', name: 'Walmart', targetPercent: 5 },
    { symbol: 'COST', name: 'Costco', targetPercent: 4 },
    { symbol: 'PG', name: 'Procter & Gamble', targetPercent: 4 },
    { symbol: 'KO', name: 'Coca-Cola', targetPercent: 3 },
    { symbol: 'PEP', name: 'PepsiCo', targetPercent: 4 },
    // Healthcare 15
    { symbol: 'UNH', name: 'UnitedHealth', targetPercent: 4 },
    { symbol: 'JNJ', name: 'Johnson & Johnson', targetPercent: 4 },
    { symbol: 'ABBV', name: 'AbbVie', targetPercent: 3 },
    { symbol: 'MRK', name: 'Merck', targetPercent: 4 },
    // Gold miners 10
    { symbol: 'NEM', name: 'Newmont', targetPercent: 5 },
    { symbol: 'FCX', name: 'Freeport-McMoRan', targetPercent: 5 },
    // Utilities 10
    { symbol: 'NEE', name: 'NextEra Energy', targetPercent: 4 },
    { symbol: 'DUK', name: 'Duke Energy', targetPercent: 3 },
    { symbol: 'SO', name: 'Southern Company', targetPercent: 3 },
    { symbol: 'CASH', name: 'Cash / Short-Term', targetPercent: 10 },
  ],
  munger: [
    // Financials 25
    { symbol: 'JPM', name: 'JPMorgan Chase', targetPercent: 7 },
    { symbol: 'BAC', name: 'Bank of America', targetPercent: 6 },
    { symbol: 'BLK', name: 'BlackRock', targetPercent: 5 },
    { symbol: 'SCHW', name: 'Charles Schwab', targetPercent: 4 },
    { symbol: 'TRV', name: 'Travelers', targetPercent: 3 },
    // Staples 20
    { symbol: 'PG', name: 'Procter & Gamble', targetPercent: 5 },
    { symbol: 'KO', name: 'Coca-Cola', targetPercent: 5 },
    { symbol: 'PEP', name: 'PepsiCo', targetPercent: 4 },
    { symbol: 'WMT', name: 'Walmart', targetPercent: 3 },
    { symbol: 'COST', name: 'Costco', targetPercent: 3 },
    // Healthcare 15
    { symbol: 'JNJ', name: 'Johnson & Johnson', targetPercent: 5 },
    { symbol: 'ABBV', name: 'AbbVie', targetPercent: 4 },
    { symbol: 'MRK', name: 'Merck', targetPercent: 3 },
    { symbol: 'PFE', name: 'Pfizer', targetPercent: 3 },
    // Utilities 10
    { symbol: 'NEE', name: 'NextEra Energy', targetPercent: 4 },
    { symbol: 'DUK', name: 'Duke Energy', targetPercent: 3 },
    { symbol: 'SO', name: 'Southern Company', targetPercent: 3 },
    // Dividend 15
    { symbol: 'XOM', name: 'Exxon Mobil', targetPercent: 4 },
    { symbol: 'CVX', name: 'Chevron', targetPercent: 4 },
    { symbol: 'MO', name: 'Altria', targetPercent: 3 },
    { symbol: 'IBM', name: 'IBM', targetPercent: 4 },
    // Broad 10
    { symbol: 'V', name: 'Visa', targetPercent: 3 },
    { symbol: 'HD', name: 'Home Depot', targetPercent: 3 },
    { symbol: 'MCD', name: "McDonald's", targetPercent: 4 },
    { symbol: 'CASH', name: 'Cash / Short-Term', targetPercent: 5 },
  ],
};

/** Get the curated stock target list for a style (falls back to Value-Style). */
export function getInvestorStyleStocks(style: string): StockTarget[] {
  return STYLE_STOCKS[style] || STYLE_STOCKS['buffett'];
}

export type AssetClass = 'etf' | 'stock' | 'mix';

/**
 * Resolve the rebalance target list for a given asset-class choice.
 *   'etf'   → the style's ETF targets (default)
 *   'stock' → the style's curated stock targets
 *   'mix'   → 50/50 — non-CASH ETF targets halved + non-CASH stock targets
 *             halved, with the ETF side's CASH bucket preserved.
 */
export function resolveRebalanceTargets(
  style: string,
  assetClass?: AssetClass | null,
): StyleTarget[] {
  const { targets } = getInvestorStyleTargets(style);
  if (!assetClass || assetClass === 'etf') return targets;
  const stocks = getInvestorStyleStocks(style);
  if (assetClass === 'stock') {
    return stocks.map((s) => ({ ...s, type: 'Stock' as const }));
  }
  const cashPct = targets.find((t) => t.symbol === 'CASH')?.targetPercent ?? 5;
  const etfHalf = targets
    .filter((t) => t.symbol !== 'CASH')
    .map((t) => ({ ...t, targetPercent: t.targetPercent / 2 }));
  const stockHalf = stocks
    .filter((s) => s.symbol !== 'CASH')
    .map((s) => ({ ...s, type: 'Stock' as const, targetPercent: s.targetPercent / 2 }));
  return [...etfHalf, ...stockHalf, { symbol: 'CASH', name: 'Cash / Short-Term', type: 'ETF' as const, targetPercent: cashPct }];
}
