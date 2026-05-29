// ─── Demo Data Engine ──────────────────────────────────────────
// Generates plausible, varied demo portfolios for each investor style.
// All prices are approximate mid-2026 values. Positions are styled
// to match the philosophy of each archetype.
//
// Used when no broker is connected — populates all tabs with realistic
// dummy data so the app is fully functional out of the box.

import type {
  AccountSummary,
  Position,
  MarketIndex,
  Quote,
  SectorAllocation,
} from '@/types';
import type { InvestorStyle } from '@/types';

// ─── Style-specific Portfolios ─────────────────────────────────

interface DemoPortfolio {
  label: string;
  totalValue: number;
  positions: PositionDef[];
}

interface PositionDef {
  symbol: string;
  qty: number;
  avgCost: number;
  currentPrice: number;
  dayChange: number;
  dayChangePercent: number;
  totalPnl: number;
  totalPnlPercent: number;
  name: string;
  sector: string;
}

const DEMO_PORTFOLIOS: Record<InvestorStyle, DemoPortfolio> = {
  buffett: {
    label: 'Warren Buffett · Value Hunter',
    totalValue: 148_650,
    positions: [
      { symbol: 'AAPL', name: 'Apple Inc.', sector: 'Technology', qty: 100, avgCost: 182.50, currentPrice: 195.20, dayChange: 2.30, dayChangePercent: 1.19, totalPnl: 1270, totalPnlPercent: 6.96 },
      { symbol: 'KO', name: 'Coca-Cola Co.', sector: 'Consumer', qty: 200, avgCost: 62.80, currentPrice: 68.15, dayChange: 0.45, dayChangePercent: 0.66, totalPnl: 1070, totalPnlPercent: 8.52 },
      { symbol: 'AXP', name: 'American Express', sector: 'Financial Services', qty: 60, avgCost: 176.00, currentPrice: 191.50, dayChange: -0.80, dayChangePercent: -0.42, totalPnl: 930, totalPnlPercent: 8.81 },
      { symbol: 'BAC', name: 'Bank of America', sector: 'Financial Services', qty: 300, avgCost: 35.20, currentPrice: 38.45, dayChange: -0.15, dayChangePercent: -0.39, totalPnl: 975, totalPnlPercent: 9.23 },
      { symbol: 'PG', name: 'Procter & Gamble', sector: 'Consumer', qty: 80, avgCost: 156.00, currentPrice: 168.30, dayChange: 0.60, dayChangePercent: 0.36, totalPnl: 984, totalPnlPercent: 7.88 },
      { symbol: 'JNJ', name: 'Johnson & Johnson', sector: 'Healthcare', qty: 50, avgCost: 161.00, currentPrice: 158.75, dayChange: 1.25, dayChangePercent: 0.79, totalPnl: -112, totalPnlPercent: -1.40 },
      { symbol: 'BRK.B', name: 'Berkshire Hathaway B', sector: 'Financial Services', qty: 30, avgCost: 392.00, currentPrice: 411.50, dayChange: 3.40, dayChangePercent: 0.83, totalPnl: 585, totalPnlPercent: 4.97 },
    ],
  },
  lynch: {
    label: 'Peter Lynch · Growth Chaser',
    totalValue: 243_900,
    positions: [
      { symbol: 'MSFT', name: 'Microsoft Corp.', sector: 'Technology', qty: 40, avgCost: 422.00, currentPrice: 451.20, dayChange: 4.80, dayChangePercent: 1.08, totalPnl: 1168, totalPnlPercent: 6.92 },
      { symbol: 'NVDA', name: 'NVIDIA Corp.', sector: 'Technology', qty: 30, avgCost: 855.00, currentPrice: 922.50, dayChange: 15.50, dayChangePercent: 1.71, totalPnl: 2025, totalPnlPercent: 7.89 },
      { symbol: 'META', name: 'Meta Platforms', sector: 'Technology', qty: 50, avgCost: 482.00, currentPrice: 520.00, dayChange: -3.20, dayChangePercent: -0.61, totalPnl: 1900, totalPnlPercent: 7.88 },
      { symbol: 'AMZN', name: 'Amazon.com Inc.', sector: 'Consumer', qty: 60, avgCost: 186.00, currentPrice: 201.30, dayChange: 2.10, dayChangePercent: 1.05, totalPnl: 918, totalPnlPercent: 8.23 },
      { symbol: 'GOOGL', name: 'Alphabet Inc.', sector: 'Technology', qty: 45, avgCost: 156.00, currentPrice: 175.80, dayChange: 1.40, dayChangePercent: 0.80, totalPnl: 891, totalPnlPercent: 12.69 },
      { symbol: 'CRM', name: 'Salesforce Inc.', sector: 'Technology', qty: 70, avgCost: 292.00, currentPrice: 311.00, dayChange: -2.50, dayChangePercent: -0.80, totalPnl: 1330, totalPnlPercent: 6.51 },
    ],
  },
  livermore: {
    label: 'Jesse Livermore · Momentum Rider',
    totalValue: 102_650,
    positions: [
      { symbol: 'TSLA', name: 'Tesla Inc.', sector: 'Consumer', qty: 80, avgCost: 242.00, currentPrice: 265.50, dayChange: 8.50, dayChangePercent: 3.31, totalPnl: 1880, totalPnlPercent: 9.71 },
      { symbol: 'MSTR', name: 'MicroStrategy Inc.', sector: 'Technology', qty: 5, avgCost: 1210.00, currentPrice: 1385.00, dayChange: 42.00, dayChangePercent: 3.13, totalPnl: 875, totalPnlPercent: 14.46 },
      { symbol: 'SMCI', name: 'Super Micro Computer', sector: 'Technology', qty: 30, avgCost: 705.00, currentPrice: 782.00, dayChange: -18.00, dayChangePercent: -2.25, totalPnl: 2310, totalPnlPercent: 10.92 },
      { symbol: 'COIN', name: 'Coinbase Global', sector: 'Financial Services', qty: 50, avgCost: 212.00, currentPrice: 232.00, dayChange: 6.50, dayChangePercent: 2.88, totalPnl: 1000, totalPnlPercent: 9.43 },
      { symbol: 'RKLB', name: 'Rocket Lab USA', sector: 'Industrials', qty: 500, avgCost: 18.50, currentPrice: 22.40, dayChange: -0.30, dayChangePercent: -1.32, totalPnl: 1950, totalPnlPercent: 21.08 },
      { symbol: 'PLTR', name: 'Palantir Technologies', sector: 'Technology', qty: 200, avgCost: 40.50, currentPrice: 48.25, dayChange: 1.20, dayChangePercent: 2.55, totalPnl: 1550, totalPnlPercent: 19.14 },
    ],
  },
  soros: {
    label: 'George Soros · Macro Strategist',
    totalValue: 198_400,
    positions: [
      { symbol: 'GLD', name: 'SPDR Gold Trust', sector: 'Materials', qty: 200, avgCost: 201.00, currentPrice: 215.50, dayChange: 0.80, dayChangePercent: 0.37, totalPnl: 2900, totalPnlPercent: 7.21 },
      { symbol: 'XLE', name: 'Energy Select Sector', sector: 'Energy', qty: 150, avgCost: 92.50, currentPrice: 95.20, dayChange: -0.40, dayChangePercent: -0.42, totalPnl: 405, totalPnlPercent: 2.92 },
      { symbol: 'XLF', name: 'Financial Select Sector', sector: 'Financial Services', qty: 250, avgCost: 42.30, currentPrice: 44.10, dayChange: 0.25, dayChangePercent: 0.57, totalPnl: 450, totalPnlPercent: 4.26 },
      { symbol: 'TLT', name: 'iShares 20+ Year Treasury', sector: 'Financial Services', qty: 100, avgCost: 92.00, currentPrice: 88.50, dayChange: -0.60, dayChangePercent: -0.67, totalPnl: -350, totalPnlPercent: -3.80 },
      { symbol: 'DIA', name: 'SPDR Dow Jones ETF', sector: 'Industrials', qty: 80, avgCost: 421.00, currentPrice: 435.80, dayChange: 1.50, dayChangePercent: 0.35, totalPnl: 1184, totalPnlPercent: 3.52 },
      { symbol: 'TQQQ', name: 'ProShares UltraPro QQQ', sector: 'Technology', qty: 100, avgCost: 68.50, currentPrice: 75.60, dayChange: 2.10, dayChangePercent: 2.86, totalPnl: 710, totalPnlPercent: 10.36 },
    ],
  },
  munger: {
    label: 'Charlie Munger · Dividend Compounder',
    totalValue: 296_500,
    positions: [
      { symbol: 'JNJ', name: 'Johnson & Johnson', sector: 'Healthcare', qty: 120, avgCost: 161.00, currentPrice: 158.75, dayChange: 1.25, dayChangePercent: 0.79, totalPnl: -270, totalPnlPercent: -1.40 },
      { symbol: 'PG', name: 'Procter & Gamble', sector: 'Consumer', qty: 150, avgCost: 156.00, currentPrice: 168.30, dayChange: 0.60, dayChangePercent: 0.36, totalPnl: 1845, totalPnlPercent: 7.88 },
      { symbol: 'KO', name: 'Coca-Cola Co.', sector: 'Consumer', qty: 300, avgCost: 62.80, currentPrice: 68.15, dayChange: 0.45, dayChangePercent: 0.66, totalPnl: 1605, totalPnlPercent: 8.52 },
      { symbol: 'PEP', name: 'PepsiCo Inc.', sector: 'Consumer', qty: 100, avgCost: 178.50, currentPrice: 185.30, dayChange: -0.20, dayChangePercent: -0.11, totalPnl: 680, totalPnlPercent: 3.81 },
      { symbol: 'MCD', name: 'McDonald\'s Corp.', sector: 'Consumer', qty: 80, avgCost: 286.00, currentPrice: 301.40, dayChange: 2.20, dayChangePercent: 0.74, totalPnl: 1232, totalPnlPercent: 5.38 },
      { symbol: 'O', name: 'Realty Income Corp.', sector: 'Real Estate', qty: 200, avgCost: 65.50, currentPrice: 70.25, dayChange: 0.35, dayChangePercent: 0.50, totalPnl: 950, totalPnlPercent: 7.25 },
      { symbol: 'VZ', name: 'Verizon Communications', sector: 'Media & Entertainment', qty: 250, avgCost: 42.50, currentPrice: 44.20, dayChange: 0.15, dayChangePercent: 0.34, totalPnl: 425, totalPnlPercent: 4.00 },
    ],
  },
};

// ─── Demo Market Data ─────────────────────────────────────────

const DEMO_INDEXES: MarketIndex[] = [
  { symbol: 'SPY', price: 562.80, change: 4.20, changePercent: 0.75 },
  { symbol: 'QQQ', price: 485.40, change: 6.80, changePercent: 1.42 },
  { symbol: 'IWM', price: 218.30, change: -1.20, changePercent: -0.55 },
  { symbol: 'DIA', price: 435.80, change: 1.50, changePercent: 0.35 },
  { symbol: 'XLF', price: 44.10, change: 0.25, changePercent: 0.57 },
];

// Build demo quotes for all symbols across all portfolios
function buildQuotes(): Record<string, Quote> {
  const quotes: Record<string, Quote> = {};
  const seen = new Set<string>();

  for (const style of Object.values(DEMO_PORTFOLIOS)) {
    for (const pos of style.positions) {
      if (seen.has(pos.symbol)) continue;
      seen.add(pos.symbol);

      quotes[pos.symbol] = {
        symbol: pos.symbol,
        bid: pos.currentPrice - 0.25,
        ask: pos.currentPrice + 0.25,
        last: pos.currentPrice,
        change: pos.dayChange,
        changePercent: pos.dayChangePercent,
        volume: Math.floor(Math.random() * 10_000_000) + 500_000,
        high52w: Math.round(pos.currentPrice * 1.25 * 100) / 100,
        low52w: Math.round(pos.currentPrice * 0.70 * 100) / 100,
      };
    }
  }

  // Add index quotes
  for (const idx of DEMO_INDEXES) {
    quotes[idx.symbol] = {
      symbol: idx.symbol,
      bid: idx.price - 0.50,
      ask: idx.price + 0.50,
      last: idx.price,
      change: idx.change,
      changePercent: idx.changePercent,
      volume: Math.floor(Math.random() * 20_000_000) + 2_000_000,
      high52w: Math.round(idx.price * 1.20 * 100) / 100,
      low52w: Math.round(idx.price * 0.75 * 100) / 100,
    };
  }

  return quotes;
}

// ─── Sector Color Map ────────────────────────────────────────

const SECTOR_COLORS = [
  '#06b6d4', // Technology — cyan
  '#22c55e', // Financial Services — green
  '#f59e0b', // Consumer — amber
  '#8b5cf6', // Healthcare — purple
  '#3b82f6', // Energy — blue
  '#ec4899', // Industrials — pink
  '#ef4444', // Utilities — red
  '#14b8a6', // Real Estate — teal
  '#a855f7', // Materials — violet
  '#f97316', // Media & Entertainment — orange
  '#84cc16', // Automotive — lime
  '#64748b', // Other — gray
];

// ─── Public API ───────────────────────────────────────────────

/**
 * Generate a full demo account summary for the given investor style.
 * Returns null if style is unknown (should never happen).
 */
export function getDemoAccount(style: InvestorStyle): AccountSummary | null {
  const portfolio = DEMO_PORTFOLIOS[style];
  if (!portfolio) return null;

  const positions: Position[] = portfolio.positions.map((p) => ({
    symbol: p.symbol,
    name: p.name,
    qty: p.qty,
    avgCost: p.avgCost,
    currentPrice: p.currentPrice,
    marketValue: Math.round(p.qty * p.currentPrice * 100) / 100,
    dayChange: Math.round(p.qty * p.dayChange * 100) / 100,
    dayChangePercent: p.dayChangePercent,
    totalPnl: p.totalPnl,
    totalPnlPercent: p.totalPnlPercent,
    portfolioPercent: 0, // calculated below
    sector: p.sector,
  }));

  const totalValue = positions.reduce((s, p) => s + p.marketValue, 0);
  const totalCost = positions.reduce((s, p) => s + p.qty * p.avgCost, 0);
  const totalPnl = totalValue - totalCost;
  const totalPnlPercent = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

  // Calculate portfolio percent for each position
  for (const pos of positions) {
    pos.portfolioPercent = totalValue > 0 ? (pos.marketValue / totalValue) * 100 : 0;
  }

  // Day P&L
  const dayPnl = positions.reduce((s, p) => s + p.dayChange, 0);
  const dayPnlPercent = totalValue > 0 ? (dayPnl / (totalValue - dayPnl)) * 100 : 0;

  // Cash / buying power — roughly 15% of portfolio
  const equity = totalValue;
  const cash = Math.round(equity * 0.12 * 100) / 100;
  const buyingPower = Math.round(equity * 1.5 * 100) / 100;

  return {
    equity,
    buyingPower,
    cash,
    dayPnl: Math.round(dayPnl * 100) / 100,
    dayPnlPercent: Math.round(dayPnlPercent * 100) / 100,
    totalPnl: Math.round(totalPnl * 100) / 100,
    totalPnlPercent: Math.round(totalPnlPercent * 100) / 100,
    positions,
  };
}

/**
 * Get sector allocations for the given account summary.
 */
export function getDemoSectorAllocations(account: AccountSummary): SectorAllocation[] {
  const sectorTotals: Record<string, number> = {};
  for (const pos of account.positions) {
    const sector = pos.sector || 'Other';
    sectorTotals[sector] = (sectorTotals[sector] || 0) + pos.marketValue;
  }

  const totalValue = Object.values(sectorTotals).reduce((s, v) => s + v, 0);
  const entries = Object.entries(sectorTotals)
    .map(([sector, value], i) => ({
      sector,
      percent: totalValue > 0 ? Math.round((value / totalValue) * 100) : 0,
      color: SECTOR_COLORS[i % SECTOR_COLORS.length],
    }))
    .sort((a, b) => b.percent - a.percent);

  return entries;
}

/**
 * Get demo market indexes.
 */
export function getDemoIndexes(): MarketIndex[] {
  return DEMO_INDEXES;
}

/**
 * Get all demo quotes (all symbols across all portfolios + indexes).
 */
export function getDemoQuotes(): Record<string, Quote> {
  return buildQuotes();
}

/**
 * Get the style portfolio label (e.g. "Warren Buffett · Value Hunter").
 */
export function getDemoLabel(style: InvestorStyle): string {
  return DEMO_PORTFOLIOS[style]?.label ?? 'Demo Portfolio';
}

/**
 * Check if a demo portfolio exists for the given style.
 */
export function hasDemoPortfolio(style: InvestorStyle): boolean {
  return style in DEMO_PORTFOLIOS;
}

/**
 * Get a summary insight for the demo portfolio.
 */
export function getDemoInsight(account: AccountSummary): string {
  const positions = account.positions;
  if (positions.length === 0) return 'No positions in this demo portfolio.';

  const topSector = getDemoSectorAllocations(account)[0];
  const biggestPos = [...positions].sort((a, b) => b.marketValue - a.marketValue)[0];
  const bestPnl = [...positions].sort((a, b) => b.totalPnlPercent - a.totalPnlPercent)[0];
  const worstPnl = [...positions].sort((a, b) => a.totalPnlPercent - b.totalPnlPercent)[0];

  return [
    `${positions.length} positions across ${getDemoSectorAllocations(account).length} sectors.`,
    topSector ? `${topSector.sector} leads at ${topSector.percent}% allocation.` : '',
    biggestPos ? `${biggestPos.symbol} is the largest holding (${biggestPos.portfolioPercent.toFixed(0)}%).` : '',
    bestPnl && bestPnl.totalPnl > 0 ? `Top performer: ${bestPnl.symbol} (+${bestPnl.totalPnlPercent.toFixed(1)}%).` : '',
    worstPnl && worstPnl.totalPnl < 0 ? `Biggest laggard: ${worstPnl.symbol} (${worstPnl.totalPnlPercent.toFixed(1)}%).` : '',
    `Total return: ${account.totalPnl >= 0 ? '+' : ''}${Math.round(account.totalPnl).toLocaleString()} (${account.totalPnlPercent >= 0 ? '+' : ''}${account.totalPnlPercent.toFixed(1)}%).`,
  ].filter(Boolean).join(' ');
}
