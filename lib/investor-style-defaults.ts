// ─── Investor Style Defaults — Single Authority ──────────────────────
// Merges three previously-separate style configurations:
//   1. app/api/chat/route.ts getStyleScreeningDefaults()   — screening criteria
//   2. lib/investor-style-targets.ts                       — allocation templates
//   3. lib/advisor/engine.ts analyze{Buffett|Lynch|...}()  — stock-scoring thresholds
//
// Single source for all style-specific configuration. Each style defines:
//   - Screening criteria (PE cap, growth floor, market cap min)
//   - Sector allocation targets (ETF weights)
//   - Scoring thresholds (PE range, growth preference, momentum weight)
// ──────────────────────────────────────────────────────────────────────

import type { InvestorStyle } from '@/types';

export interface StyleScreeningDefaults {
  market_cap_min: number;
  market_cap_max?: number;
  pe_max?: number;
  min_growth_rate?: number;
  volume_min?: number;
}

export interface StyleAllocationTarget {
  symbol: string;
  name: string;
  type: 'ETF' | 'Stock' | 'CASH';
  targetPercent: number;
}

export interface StyleAllocation {
  style: InvestorStyle;
  label: string;
  targets: StyleAllocationTarget[];
}

export interface StyleScoringThresholds {
  /** Ideal P/E range for this style */
  peMin: number;
  peMax: number;
  /** Minimum earnings growth rate (decimal) */
  minEpsGrowth: number;
  /** Minimum dividend yield (decimal) */
  minDividendYield: number;
  /** Momentum weight (0–1), how much recent price action matters */
  momentumWeight: number;
  /** Minimum market cap */
  minMarketCap: number;
}

export interface InvestorStyleConfig {
  style: InvestorStyle;
  label: string;
  description: string;
  screening: StyleScreeningDefaults;
  allocation: StyleAllocationTarget[];
  scoring: StyleScoringThresholds;
}

// ── Style configurations ──────────────────────────────────

const STYLE_CONFIGS: Record<InvestorStyle, InvestorStyleConfig> = {
  buffett: {
    style: 'buffett',
    label: 'Buffett (Value)',
    description: 'Moat stocks — wide competitive advantage, low P/E, large established companies',
    screening: {
      market_cap_min: 10_000_000_000,
      pe_max: 20,
    },
    allocation: [
      { symbol: 'XLF', name: 'Financial Select Sector SPDR', type: 'ETF', targetPercent: 30 },
      { symbol: 'XLP', name: 'Consumer Staples SPDR', type: 'ETF', targetPercent: 20 },
      { symbol: 'XLV', name: 'Health Care Select Sector SPDR', type: 'ETF', targetPercent: 15 },
      { symbol: 'XLK', name: 'Technology Select Sector SPDR', type: 'ETF', targetPercent: 15 },
      { symbol: 'XLI', name: 'Industrial Select Sector SPDR', type: 'ETF', targetPercent: 5 },
      { symbol: 'SPY', name: 'SPDR S&P 500 ETF', type: 'ETF', targetPercent: 10 },
      { symbol: 'CASH', name: 'Cash / Short-Term', type: 'CASH', targetPercent: 5 },
    ],
    scoring: {
      peMin: 5,
      peMax: 20,
      minEpsGrowth: 0.05,
      minDividendYield: 0.02,
      momentumWeight: 0.2,
      minMarketCap: 10_000_000_000,
    },
  },

  lynch: {
    style: 'lynch',
    label: 'Lynch (GARP)',
    description: 'Growth at a reasonable price — earnings growth matters but don\'t overpay',
    screening: {
      market_cap_min: 2_000_000_000,
      pe_max: 30,
      min_growth_rate: 0.10,
    },
    allocation: [
      { symbol: 'XLK', name: 'Technology Select Sector SPDR', type: 'ETF', targetPercent: 35 },
      { symbol: 'XLY', name: 'Consumer Discretionary SPDR', type: 'ETF', targetPercent: 20 },
      { symbol: 'XLV', name: 'Health Care Select Sector SPDR', type: 'ETF', targetPercent: 15 },
      { symbol: 'XLF', name: 'Financial Select Sector SPDR', type: 'ETF', targetPercent: 10 },
      { symbol: 'XLI', name: 'Industrial Select Sector SPDR', type: 'ETF', targetPercent: 5 },
      { symbol: 'SPY', name: 'SPDR S&P 500 ETF', type: 'ETF', targetPercent: 10 },
      { symbol: 'CASH', name: 'Cash / Short-Term', type: 'CASH', targetPercent: 5 },
    ],
    scoring: {
      peMin: 8,
      peMax: 30,
      minEpsGrowth: 0.10,
      minDividendYield: 0.0,
      momentumWeight: 0.4,
      minMarketCap: 2_000_000_000,
    },
  },

  livermore: {
    style: 'livermore',
    label: 'Livermore (Momentum)',
    description: 'Momentum setups — breakouts, trend acceleration, high volume',
    screening: {
      market_cap_min: 1_000_000_000,
      min_growth_rate: 0.20,
      volume_min: 500_000,
    },
    allocation: [
      { symbol: 'XLK', name: 'Technology Select Sector SPDR', type: 'ETF', targetPercent: 45 },
      { symbol: 'XLY', name: 'Consumer Discretionary SPDR', type: 'ETF', targetPercent: 20 },
      { symbol: 'SMH', name: 'VanEck Semiconductor ETF', type: 'ETF', targetPercent: 15 },
      { symbol: 'XLC', name: 'Communication Services SPDR', type: 'ETF', targetPercent: 10 },
      { symbol: 'CASH', name: 'Cash / Short-Term', type: 'CASH', targetPercent: 10 },
    ],
    scoring: {
      peMin: 0,
      peMax: 1000,
      minEpsGrowth: 0.20,
      minDividendYield: 0.0,
      momentumWeight: 0.9,
      minMarketCap: 1_000_000_000,
    },
  },

  munger: {
    style: 'munger',
    label: 'Munger (Quality)',
    description: 'Quality at fair price — strong businesses on sale, reasonable P/E',
    screening: {
      market_cap_min: 5_000_000_000,
      pe_max: 25,
    },
    allocation: [
      { symbol: 'VOO', name: 'Vanguard S&P 500 ETF', type: 'ETF', targetPercent: 35 },
      { symbol: 'XLF', name: 'Financial Select Sector SPDR', type: 'ETF', targetPercent: 20 },
      { symbol: 'XLV', name: 'Health Care Select Sector SPDR', type: 'ETF', targetPercent: 15 },
      { symbol: 'XLP', name: 'Consumer Staples SPDR', type: 'ETF', targetPercent: 10 },
      { symbol: 'SCHD', name: 'Schwab U.S. Dividend Equity ETF', type: 'ETF', targetPercent: 10 },
      { symbol: 'CASH', name: 'Cash / Short-Term', type: 'CASH', targetPercent: 10 },
    ],
    scoring: {
      peMin: 5,
      peMax: 25,
      minEpsGrowth: 0.05,
      minDividendYield: 0.015,
      momentumWeight: 0.2,
      minMarketCap: 5_000_000_000,
    },
  },

  soros: {
    style: 'soros',
    label: 'Soros (Macro)',
    description: 'Contrarian — wide net, finds diamonds in overlooked areas',
    screening: {
      market_cap_min: 500_000_000,
    },
    allocation: [
      { symbol: 'SPY', name: 'SPDR S&P 500 ETF', type: 'ETF', targetPercent: 30 },
      { symbol: 'VEA', name: 'Vanguard FTSE Developed Markets ETF', type: 'ETF', targetPercent: 20 },
      { symbol: 'XLK', name: 'Technology Select Sector SPDR', type: 'ETF', targetPercent: 15 },
      { symbol: 'XLE', name: 'Energy Select Sector SPDR', type: 'ETF', targetPercent: 10 },
      { symbol: 'GDX', name: 'VanEck Gold Miners ETF', type: 'ETF', targetPercent: 10 },
      { symbol: 'CASH', name: 'Cash / Short-Term', type: 'CASH', targetPercent: 15 },
    ],
    scoring: {
      peMin: 0,
      peMax: 1000,
      minEpsGrowth: 0.0,
      minDividendYield: 0.0,
      momentumWeight: 0.5,
      minMarketCap: 500_000_000,
    },
  },
};

// ── Public API ────────────────────────────────────────────

/** Get the full config for a specific investor style. */
export function getStyleConfig(style: InvestorStyle | string): InvestorStyleConfig {
  const normalized = style.toLowerCase() as InvestorStyle;
  return STYLE_CONFIGS[normalized] || STYLE_CONFIGS.lynch; // Lynch = default
}

/** Get only the screening defaults for a style. */
export function getStyleScreeningDefaults(style: InvestorStyle | string): StyleScreeningDefaults {
  return getStyleConfig(style).screening;
}

/** Get the sector allocation template for a style. */
export function getStyleAllocation(style: InvestorStyle | string): StyleAllocation {
  const config = getStyleConfig(style);
  return { style: config.style, label: config.label, targets: config.allocation };
}

/** Get the scoring thresholds for a style. */
export function getStyleScoringThresholds(style: InvestorStyle | string): StyleScoringThresholds {
  return getStyleConfig(style).scoring;
}

/** Check if a given string matches a known investor style. */
export function isValidStyle(style: string): style is InvestorStyle {
  return style.toLowerCase() in STYLE_CONFIGS;
}

/** Get all style labels for display. */
export function getAllStyleLabels(): Array<{ style: InvestorStyle; label: string }> {
  return Object.values(STYLE_CONFIGS).map(c => ({ style: c.style, label: c.label }));
}

// Re-export for backward compatibility with existing code
export { STYLE_CONFIGS };
