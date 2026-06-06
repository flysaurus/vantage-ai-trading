// ─── Demo Data Engine ──────────────────────────────────────────
// Generates plausible demo portfolios for each investor style.
// Stock selection and quantities are fictional — prices come from
// the /api/market/quotes endpoint (Finnhub).
//
// Used when no broker is connected — populates all tabs with
// realistic dummy data so the app is fully functional out of the box.
//
// SINGLE SOURCE OF TRUTH for all demo portfolio data:
// 5 investor-style portfolios, each with 10 positions + orders.

import type {
  AccountSummary,
  Position,
  MarketIndex,
  Quote,
  SectorAllocation,
  Order,
} from '@/types';
import type { InvestorStyle } from '@/types';

// ─── Style-specific Portfolios (structure only, no prices) ───

interface DemoPortfolio {
  label: string;
  description?: string;
  positions: PositionDef[];
}

interface PositionDef {
  symbol: string;
  qty: number;
  avgCost: number;
  name: string;
  sector: string;
  industry?: string;
}

export const DEMO_PORTFOLIOS: Record<InvestorStyle, DemoPortfolio> = {
  buffett: {
    label: 'Warren Buffett · Value Hunter',
    description: 'Wide moat, long horizon',
    positions: [
      { symbol: 'AAPL', name: 'Apple Inc.', sector: 'Technology', industry: 'Consumer Electronics', qty: 100, avgCost: 165.20 },
      { symbol: 'KO', name: 'Coca-Cola Co.', sector: 'Consumer', industry: 'Beverages', qty: 300, avgCost: 58.40 },
      { symbol: 'BAC', name: 'Bank of America', sector: 'Financial Services', industry: 'Banking', qty: 400, avgCost: 32.80 },
      { symbol: 'AXP', name: 'American Express', sector: 'Financial Services', industry: 'Payments', qty: 80, avgCost: 168.50 },
      { symbol: 'CVX', name: 'Chevron Corp.', sector: 'Energy', industry: 'Oil & Gas', qty: 90, avgCost: 152.30 },
      { symbol: 'OXY', name: 'Occidental Petroleum', sector: 'Energy', industry: 'Oil & Gas', qty: 200, avgCost: 58.70 },
      { symbol: 'MCO', name: "Moody's Corp.", sector: 'Financial Services', industry: 'Credit Ratings', qty: 35, avgCost: 368.40 },
      { symbol: 'KHC', name: 'Kraft Heinz Co.', sector: 'Consumer', industry: 'Packaged Foods', qty: 250, avgCost: 34.20 },
      { symbol: 'VZ', name: 'Verizon Communications', sector: 'Media & Entertainment', industry: 'Wireless', qty: 300, avgCost: 38.60 },
      { symbol: 'JNJ', name: 'Johnson & Johnson', sector: 'Healthcare', industry: 'Pharmaceuticals', qty: 75, avgCost: 155.80 },
    ],
  },
  lynch: {
    label: 'Peter Lynch · Growth Chaser',
    description: 'Growth at reasonable price',
    positions: [
      { symbol: 'META', name: 'Meta Platforms', sector: 'Technology', industry: 'Social Media', qty: 50, avgCost: 285.40 },
      { symbol: 'MSFT', name: 'Microsoft Corp.', sector: 'Technology', industry: 'Cloud Software', qty: 40, avgCost: 378.20 },
      { symbol: 'GOOGL', name: 'Alphabet Inc.', sector: 'Technology', industry: 'Internet Services', qty: 45, avgCost: 142.80 },
      { symbol: 'AMZN', name: 'Amazon.com Inc.', sector: 'Consumer', industry: 'E-Commerce', qty: 60, avgCost: 158.30 },
      { symbol: 'NVDA', name: 'NVIDIA Corp.', sector: 'Technology', industry: 'Semiconductors', qty: 30, avgCost: 485.20 },
      { symbol: 'CRM', name: 'Salesforce Inc.', sector: 'Technology', industry: 'Enterprise Software', qty: 70, avgCost: 195.60 },
      { symbol: 'NFLX', name: 'Netflix Inc.', sector: 'Media & Entertainment', industry: 'Streaming', qty: 25, avgCost: 445.30 },
      { symbol: 'ADBE', name: 'Adobe Inc.', sector: 'Technology', industry: 'Design Software', qty: 20, avgCost: 520.40 },
      { symbol: 'UBER', name: 'Uber Technologies', sector: 'Technology', industry: 'Ridesharing', qty: 120, avgCost: 62.80 },
      { symbol: 'SQ', name: 'Block Inc.', sector: 'Financial Services', industry: 'Fintech', qty: 85, avgCost: 68.20 },
    ],
  },
  livermore: {
    label: 'Jesse Livermore · Momentum Rider',
    description: 'Ride the trend, cut losses fast',
    positions: [
      { symbol: 'NVDA', name: 'NVIDIA Corp.', sector: 'Technology', industry: 'Semiconductors', qty: 80, avgCost: 420.50 },
      { symbol: 'AMD', name: 'Advanced Micro Devices', sector: 'Technology', industry: 'Semiconductors', qty: 150, avgCost: 142.30 },
      { symbol: 'TSLA', name: 'Tesla Inc.', sector: 'Automotive', industry: 'Electric Vehicles', qty: 60, avgCost: 215.80 },
      { symbol: 'SMCI', name: 'Super Micro Computer', sector: 'Technology', industry: 'Server Hardware', qty: 40, avgCost: 385.20 },
      { symbol: 'ARM', name: 'ARM Holdings', sector: 'Technology', industry: 'Chip Design', qty: 55, avgCost: 128.40 },
      { symbol: 'MSTR', name: 'MicroStrategy Inc.', sector: 'Technology', industry: 'Bitcoin Treasury', qty: 20, avgCost: 285.60 },
      { symbol: 'COIN', name: 'Coinbase Global', sector: 'Financial Services', industry: 'Crypto Exchange', qty: 45, avgCost: 168.30 },
      { symbol: 'PLTR', name: 'Palantir Technologies', sector: 'Technology', industry: 'Data Analytics', qty: 200, avgCost: 18.40 },
      { symbol: 'RKLB', name: 'Rocket Lab USA', sector: 'Industrials', industry: 'Space', qty: 300, avgCost: 8.20 },
      { symbol: 'SOFI', name: 'SoFi Technologies', sector: 'Financial Services', industry: 'Digital Banking', qty: 400, avgCost: 9.80 },
    ],
  },
  soros: {
    label: 'George Soros · Macro Strategist',
    description: 'Global macro positioning',
    positions: [
      { symbol: 'GLD', name: 'SPDR Gold Trust', sector: 'Materials', industry: 'Gold ETF', qty: 150, avgCost: 185.40 },
      { symbol: 'TLT', name: 'iShares 20+ Year Treasury', sector: 'Financial Services', industry: 'Long Treasury ETF', qty: 300, avgCost: 92.80 },
      { symbol: 'EEM', name: 'iShares MSCI Emerging Markets', sector: 'International', industry: 'Emerging Markets ETF', qty: 200, avgCost: 38.60 },
      { symbol: 'FXI', name: 'iShares China Large-Cap', sector: 'International', industry: 'China ETF', qty: 250, avgCost: 24.30 },
      { symbol: 'GDX', name: 'VanEck Gold Miners ETF', sector: 'Materials', industry: 'Gold Miners ETF', qty: 180, avgCost: 28.40 },
      { symbol: 'USO', name: 'United States Oil Fund', sector: 'Energy', industry: 'Oil ETF', qty: 120, avgCost: 68.20 },
      { symbol: 'SPY', name: 'SPDR S&P 500 ETF', sector: 'Industrials', industry: 'S&P 500 ETF', qty: 40, avgCost: 445.80 },
      { symbol: 'QQQ', name: 'Invesco QQQ Trust', sector: 'Technology', industry: 'Nasdaq ETF', qty: 30, avgCost: 368.40 },
      { symbol: 'UUP', name: 'Invesco DB USD Index Bullish', sector: 'Financial Services', industry: 'USD ETF', qty: 400, avgCost: 28.60 },
      { symbol: 'BITO', name: 'ProShares Bitcoin Strategy', sector: 'Financial Services', industry: 'Bitcoin ETF', qty: 100, avgCost: 22.40 },
    ],
  },
  munger: {
    label: 'Charlie Munger · Dividend Compounder',
    description: 'Quality businesses held forever',
    positions: [
      { symbol: 'BRK.B', name: 'Berkshire Hathaway B', sector: 'Financial Services', industry: 'Conglomerate', qty: 100, avgCost: 325.40 },
      { symbol: 'COST', name: 'Costco Wholesale', sector: 'Consumer', industry: 'Wholesale Retail', qty: 45, avgCost: 568.20 },
      { symbol: 'V', name: 'Visa Inc.', sector: 'Financial Services', industry: 'Payments', qty: 80, avgCost: 228.60 },
      { symbol: 'MA', name: 'Mastercard Inc.', sector: 'Financial Services', industry: 'Payments', qty: 60, avgCost: 385.40 },
      { symbol: 'MSFT', name: 'Microsoft Corp.', sector: 'Technology', industry: 'Cloud Software', qty: 55, avgCost: 312.80 },
      { symbol: 'WM', name: 'Waste Management Inc.', sector: 'Industrials', industry: 'Waste Management', qty: 70, avgCost: 168.30 },
      { symbol: 'UNH', name: 'UnitedHealth Group', sector: 'Healthcare', industry: 'Health Insurance', qty: 25, avgCost: 485.60 },
      { symbol: 'SPGI', name: 'S&P Global Inc.', sector: 'Financial Services', industry: 'Data & Analytics', qty: 30, avgCost: 415.20 },
      { symbol: 'ROL', name: 'Rollins Inc.', sector: 'Consumer', industry: 'Pest Control', qty: 150, avgCost: 42.80 },
      { symbol: 'NVO', name: 'Novo Nordisk', sector: 'Healthcare', industry: 'Pharmaceuticals', qty: 65, avgCost: 108.40 },
    ],
  },
};

// ─── Demo Orders (predefined per investor style) ──────────────

interface DemoOrderDef {
  symbol: string;
  qty: number;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  status: 'filled';
  filledPrice: number;
  filledAt: Date;
  timeInForce: 'day' | 'gtc';
}

const NOW = Date.now();
const DAY = 86400000;

export const DEMO_ORDERS: Record<string, DemoOrderDef[]> = {
  buffett: [
    { symbol: 'AAPL', qty: 50, side: 'buy', type: 'market', status: 'filled', filledPrice: 162.40, filledAt: new Date(NOW - 180 * DAY), timeInForce: 'day' },
    { symbol: 'AAPL', qty: 50, side: 'buy', type: 'market', status: 'filled', filledPrice: 168.00, filledAt: new Date(NOW - 90 * DAY), timeInForce: 'day' },
    { symbol: 'KO', qty: 300, side: 'buy', type: 'limit', status: 'filled', filledPrice: 58.40, filledAt: new Date(NOW - 365 * DAY), timeInForce: 'gtc' },
    { symbol: 'BAC', qty: 400, side: 'buy', type: 'market', status: 'filled', filledPrice: 32.80, filledAt: new Date(NOW - 300 * DAY), timeInForce: 'day' },
    { symbol: 'CVX', qty: 90, side: 'buy', type: 'limit', status: 'filled', filledPrice: 152.30, filledAt: new Date(NOW - 200 * DAY), timeInForce: 'gtc' },
    { symbol: 'OXY', qty: 200, side: 'buy', type: 'market', status: 'filled', filledPrice: 58.70, filledAt: new Date(NOW - 150 * DAY), timeInForce: 'day' },
    { symbol: 'MCO', qty: 35, side: 'buy', type: 'limit', status: 'filled', filledPrice: 368.40, filledAt: new Date(NOW - 240 * DAY), timeInForce: 'gtc' },
    { symbol: 'KHC', qty: 250, side: 'buy', type: 'market', status: 'filled', filledPrice: 34.20, filledAt: new Date(NOW - 280 * DAY), timeInForce: 'day' },
    { symbol: 'VZ', qty: 300, side: 'buy', type: 'market', status: 'filled', filledPrice: 38.60, filledAt: new Date(NOW - 320 * DAY), timeInForce: 'day' },
    { symbol: 'JNJ', qty: 75, side: 'buy', type: 'limit', status: 'filled', filledPrice: 155.80, filledAt: new Date(NOW - 100 * DAY), timeInForce: 'gtc' },
  ],
  lynch: [
    { symbol: 'META', qty: 25, side: 'buy', type: 'market', status: 'filled', filledPrice: 285.40, filledAt: new Date(NOW - 45 * DAY), timeInForce: 'day' },
    { symbol: 'META', qty: 25, side: 'buy', type: 'market', status: 'filled', filledPrice: 291.20, filledAt: new Date(NOW - 30 * DAY), timeInForce: 'day' },
    { symbol: 'MSFT', qty: 40, side: 'buy', type: 'limit', status: 'filled', filledPrice: 378.20, filledAt: new Date(NOW - 60 * DAY), timeInForce: 'gtc' },
    { symbol: 'GOOGL', qty: 45, side: 'buy', type: 'market', status: 'filled', filledPrice: 142.80, filledAt: new Date(NOW - 90 * DAY), timeInForce: 'day' },
    { symbol: 'NVDA', qty: 30, side: 'buy', type: 'market', status: 'filled', filledPrice: 485.20, filledAt: new Date(NOW - 15 * DAY), timeInForce: 'day' },
    { symbol: 'AMZN', qty: 60, side: 'buy', type: 'limit', status: 'filled', filledPrice: 158.30, filledAt: new Date(NOW - 75 * DAY), timeInForce: 'gtc' },
    { symbol: 'CRM', qty: 70, side: 'buy', type: 'market', status: 'filled', filledPrice: 195.60, filledAt: new Date(NOW - 120 * DAY), timeInForce: 'day' },
    { symbol: 'NFLX', qty: 25, side: 'buy', type: 'market', status: 'filled', filledPrice: 445.30, filledAt: new Date(NOW - 20 * DAY), timeInForce: 'day' },
    { symbol: 'ADBE', qty: 20, side: 'buy', type: 'limit', status: 'filled', filledPrice: 520.40, filledAt: new Date(NOW - 50 * DAY), timeInForce: 'gtc' },
    { symbol: 'UBER', qty: 120, side: 'buy', type: 'market', status: 'filled', filledPrice: 62.80, filledAt: new Date(NOW - 35 * DAY), timeInForce: 'day' },
    { symbol: 'SQ', qty: 85, side: 'buy', type: 'market', status: 'filled', filledPrice: 68.20, filledAt: new Date(NOW - 10 * DAY), timeInForce: 'day' },
  ],
  livermore: [
    { symbol: 'NVDA', qty: 80, side: 'buy', type: 'market', status: 'filled', filledPrice: 420.50, filledAt: new Date(NOW - 25 * DAY), timeInForce: 'day' },
    { symbol: 'AMD', qty: 150, side: 'buy', type: 'market', status: 'filled', filledPrice: 142.30, filledAt: new Date(NOW - 18 * DAY), timeInForce: 'day' },
    { symbol: 'TSLA', qty: 40, side: 'buy', type: 'market', status: 'filled', filledPrice: 205.30, filledAt: new Date(NOW - 45 * DAY), timeInForce: 'day' },
    { symbol: 'TSLA', qty: 20, side: 'buy', type: 'market', status: 'filled', filledPrice: 236.80, filledAt: new Date(NOW - 12 * DAY), timeInForce: 'day' },
    { symbol: 'SMCI', qty: 40, side: 'buy', type: 'market', status: 'filled', filledPrice: 385.20, filledAt: new Date(NOW - 8 * DAY), timeInForce: 'day' },
    { symbol: 'COIN', qty: 45, side: 'buy', type: 'limit', status: 'filled', filledPrice: 168.30, filledAt: new Date(NOW - 22 * DAY), timeInForce: 'gtc' },
    { symbol: 'PLTR', qty: 200, side: 'buy', type: 'limit', status: 'filled', filledPrice: 18.40, filledAt: new Date(NOW - 90 * DAY), timeInForce: 'gtc' },
    { symbol: 'RKLB', qty: 300, side: 'buy', type: 'market', status: 'filled', filledPrice: 8.20, filledAt: new Date(NOW - 6 * DAY), timeInForce: 'day' },
    { symbol: 'SOFI', qty: 400, side: 'buy', type: 'market', status: 'filled', filledPrice: 9.80, filledAt: new Date(NOW - 4 * DAY), timeInForce: 'day' },
    { symbol: 'MSTR', qty: 20, side: 'buy', type: 'limit', status: 'filled', filledPrice: 285.60, filledAt: new Date(NOW - 14 * DAY), timeInForce: 'gtc' },
    { symbol: 'ARM', qty: 55, side: 'buy', type: 'market', status: 'filled', filledPrice: 128.40, filledAt: new Date(NOW - 10 * DAY), timeInForce: 'day' },
  ],
  munger: [
    { symbol: 'BRK.B', qty: 100, side: 'buy', type: 'market', status: 'filled', filledPrice: 325.40, filledAt: new Date(NOW - 400 * DAY), timeInForce: 'day' },
    { symbol: 'COST', qty: 45, side: 'buy', type: 'limit', status: 'filled', filledPrice: 568.20, filledAt: new Date(NOW - 250 * DAY), timeInForce: 'gtc' },
    { symbol: 'V', qty: 80, side: 'buy', type: 'market', status: 'filled', filledPrice: 228.60, filledAt: new Date(NOW - 365 * DAY), timeInForce: 'day' },
    { symbol: 'MA', qty: 60, side: 'buy', type: 'limit', status: 'filled', filledPrice: 385.40, filledAt: new Date(NOW - 180 * DAY), timeInForce: 'gtc' },
    { symbol: 'MSFT', qty: 55, side: 'buy', type: 'market', status: 'filled', filledPrice: 312.80, filledAt: new Date(NOW - 210 * DAY), timeInForce: 'day' },
    { symbol: 'NVO', qty: 65, side: 'buy', type: 'market', status: 'filled', filledPrice: 108.40, filledAt: new Date(NOW - 60 * DAY), timeInForce: 'day' },
    { symbol: 'UNH', qty: 25, side: 'buy', type: 'limit', status: 'filled', filledPrice: 485.60, filledAt: new Date(NOW - 140 * DAY), timeInForce: 'gtc' },
    { symbol: 'SPGI', qty: 30, side: 'buy', type: 'market', status: 'filled', filledPrice: 415.20, filledAt: new Date(NOW - 170 * DAY), timeInForce: 'day' },
    { symbol: 'WM', qty: 70, side: 'buy', type: 'market', status: 'filled', filledPrice: 168.30, filledAt: new Date(NOW - 290 * DAY), timeInForce: 'day' },
    { symbol: 'ROL', qty: 150, side: 'buy', type: 'limit', status: 'filled', filledPrice: 42.80, filledAt: new Date(NOW - 330 * DAY), timeInForce: 'gtc' },
  ],
  soros: [
    { symbol: 'GLD', qty: 150, side: 'buy', type: 'market', status: 'filled', filledPrice: 185.40, filledAt: new Date(NOW - 120 * DAY), timeInForce: 'day' },
    { symbol: 'TLT', qty: 200, side: 'buy', type: 'limit', status: 'filled', filledPrice: 89.60, filledAt: new Date(NOW - 90 * DAY), timeInForce: 'gtc' },
    { symbol: 'TLT', qty: 100, side: 'buy', type: 'market', status: 'filled', filledPrice: 96.00, filledAt: new Date(NOW - 30 * DAY), timeInForce: 'day' },
    { symbol: 'EEM', qty: 200, side: 'buy', type: 'market', status: 'filled', filledPrice: 38.60, filledAt: new Date(NOW - 150 * DAY), timeInForce: 'day' },
    { symbol: 'FXI', qty: 250, side: 'buy', type: 'limit', status: 'filled', filledPrice: 24.30, filledAt: new Date(NOW - 180 * DAY), timeInForce: 'gtc' },
    { symbol: 'GDX', qty: 180, side: 'buy', type: 'market', status: 'filled', filledPrice: 28.40, filledAt: new Date(NOW - 110 * DAY), timeInForce: 'day' },
    { symbol: 'USO', qty: 120, side: 'buy', type: 'limit', status: 'filled', filledPrice: 68.20, filledAt: new Date(NOW - 80 * DAY), timeInForce: 'gtc' },
    { symbol: 'SPY', qty: 40, side: 'buy', type: 'market', status: 'filled', filledPrice: 445.80, filledAt: new Date(NOW - 200 * DAY), timeInForce: 'day' },
    { symbol: 'QQQ', qty: 30, side: 'buy', type: 'market', status: 'filled', filledPrice: 368.40, filledAt: new Date(NOW - 190 * DAY), timeInForce: 'day' },
    { symbol: 'BITO', qty: 100, side: 'buy', type: 'market', status: 'filled', filledPrice: 22.40, filledAt: new Date(NOW - 20 * DAY), timeInForce: 'day' },
  ],
};

// ─── Demo Index Symbols (for real price fetching) ─────────────

const DEMO_INDEX_SYMBOLS = ['SPY', 'QQQ', 'IWM', 'DIA', 'XLF'];

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
  '#eab308', // International — yellow
  '#f43f5e', // Bonds — rose
  '#10b981', // Commodities — emerald
];

// ─── Price Data Type ─────────────────────────────────────────

type PriceData = Record<string, {
  price: number;
  change: number;
  changePercent: number;
  previousClose: number;
}>;

// ─── Public API ───────────────────────────────────────────────

/**
 * Returns an empty price map — used when API is unavailable.
 * Shows "prices unavailable" state in the UI.
 */
export const EMPTY_PRICES: PriceData = {};

/**
 * Get just the symbols for a style (to fetch real prices).
 */
export function getDemoSymbols(style: InvestorStyle): string[] {
  const portfolio = DEMO_PORTFOLIOS[style];
  if (!portfolio) return DEMO_PORTFOLIOS.buffett.positions.map(p => p.symbol);
  return portfolio.positions.map(p => p.symbol);
}

/**
 * Get all unique symbols across all portfolios + indexes.
 */
export function getAllDemoSymbols(): string[] {
  const seen = new Set<string>();
  for (const style of Object.values(DEMO_PORTFOLIOS)) {
    for (const pos of style.positions) {
      seen.add(pos.symbol);
    }
  }
  for (const sym of DEMO_INDEX_SYMBOLS) {
    seen.add(sym);
  }
  return [...seen];
}

/**
 * Build an AccountSummary with real prices overlaid on demo positions.
 */
export function getDemoAccount(
  style: InvestorStyle,
  prices: PriceData,
): AccountSummary | null {
  const portfolio = DEMO_PORTFOLIOS[style];
  if (!portfolio) return null;

  const positions: Position[] = portfolio.positions.map((p) => {
    const quote = prices[p.symbol];
    const currentPrice = quote?.price ?? 0;
    const dayChangePx = quote?.change ?? 0;
    const dayChangePct = quote?.changePercent ?? 0;

    const marketValue = Math.round(p.qty * currentPrice * 100) / 100;
    const dayChange = Math.round(p.qty * dayChangePx * 100) / 100;
    const totalPnl = Math.round(p.qty * (currentPrice - p.avgCost) * 100) / 100;
    // Clamp total P&L to max -25% per position for realistic demo display
    const rawPnlPercent = p.avgCost > 0
      ? Math.round(((currentPrice - p.avgCost) / p.avgCost) * 10000) / 100
      : 0;
    const totalPnlPercent = Math.max(rawPnlPercent, -25);

    return {
      symbol: p.symbol,
      name: p.name,
      qty: p.qty,
      avgCost: p.avgCost,
      currentPrice,
      marketValue,
      dayChange,
      dayChangePercent: Math.round(dayChangePct * 100) / 100,
      totalPnl,
      totalPnlPercent,
      portfolioPercent: 0,
      sector: p.sector,
    };
  });

  const totalValue = positions.reduce((s, p) => s + p.marketValue, 0);
  const totalCost = positions.reduce((s, p) => s + p.qty * p.avgCost, 0);
  const totalPnl = totalValue - totalCost;
  const totalPnlPercent = Math.max(totalCost > 0 ? (totalPnl / totalCost) * 100 : 0, -25);

  for (const pos of positions) {
    pos.portfolioPercent = totalValue > 0 ? (pos.marketValue / totalValue) * 100 : 0;
  }

  const dayPnl = positions.reduce((s, p) => s + p.dayChange, 0);
  const dayPnlPercent = totalValue > 0 ? (dayPnl / (totalValue - dayPnl)) * 100 : 0;

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
 * Build demo indexes with real prices.
 */
export function getDemoIndexes(prices: PriceData): MarketIndex[] {
  return DEMO_INDEX_SYMBOLS.map(sym => {
    const quote = prices[sym];
    if (!quote) {
      return { symbol: sym, price: 0, change: 0, changePercent: 0 };
    }
    return {
      symbol: sym,
      price: quote.price,
      change: quote.change,
      changePercent: Math.round(quote.changePercent * 100) / 100,
    };
  });
}

/**
 * Build demo quotes from real prices.
 */
export function getDemoQuotes(prices: PriceData): Record<string, Quote> {
  const quotes: Record<string, Quote> = {};
  const seen = new Set<string>();

  for (const style of Object.values(DEMO_PORTFOLIOS)) {
    for (const pos of style.positions) {
      if (seen.has(pos.symbol)) continue;
      seen.add(pos.symbol);
      const quote = prices[pos.symbol];
      if (!quote) continue; // skip if no price data
      quotes[pos.symbol] = {
        symbol: pos.symbol,
        bid: quote.price - 0.25,
        ask: quote.price + 0.25,
        last: quote.price,
        change: quote.change,
        changePercent: quote.changePercent,
        volume: 0,
        high52w: Math.round(quote.price * 1.25 * 100) / 100,
        low52w: Math.round(quote.price * 0.70 * 100) / 100,
      };
    }
  }

  for (const sym of DEMO_INDEX_SYMBOLS) {
    if (quotes[sym]) continue;
    const quote = prices[sym];
    if (!quote) continue;
    quotes[sym] = {
      symbol: sym,
      bid: quote.price - 0.50,
      ask: quote.price + 0.50,
      last: quote.price,
      change: quote.change,
      changePercent: quote.changePercent,
      volume: 0,
      high52w: Math.round(quote.price * 1.2 * 100) / 100,
      low52w: Math.round(quote.price * 0.8 * 100) / 100,
    };
  }

  return quotes;
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
  if (positions.length === 0) return 'No positions in this portfolio.';

  const topPnl = [...positions].sort((a, b) => b.totalPnl - a.totalPnl)[0];
  const worstPnl = [...positions].sort((a, b) => a.totalPnl - b.totalPnl)[0];
  const sectors = new Set(positions.map(p => p.sector)).size;
  const posCount = positions.length;

  if (account.totalPnlPercent >= 10) {
    return `Strong portfolio performance at +${account.totalPnlPercent.toFixed(1)}%. ${topPnl.symbol} leads with $${topPnl.totalPnl.toFixed(0)} P&L across ${sectors} sectors.`;
  }
  if (account.totalPnlPercent >= 0) {
    return `Modest gains at +${account.totalPnlPercent.toFixed(1)}%. ${posCount} positions across ${sectors} sectors. ${topPnl.symbol} is your top performer.`;
  }
  return `Portfolio down ${account.totalPnlPercent.toFixed(1)}%. ${worstPnl.symbol} is the biggest drag. Diversified across ${sectors} sectors with ${posCount} positions.`;
}

// ─── Demo Orders ─────────────────────────────────────────────

/**
 * Get raw demo order definitions (not converted to Order interface).
 * Used by portfolio-operations for DB seeding.
 */
export function getRawDemoOrders(style: string): DemoOrderDef[] {
  return DEMO_ORDERS[style] || [];
}

/**
 * Generate demo order history for the given investor style.
 * Uses predefined orders from DEMO_ORDERS if available,
 * otherwise falls back to dynamic generation.
 */
export function getDemoOrders(style: InvestorStyle): Order[] {
  const predefinedOrders = DEMO_ORDERS[style];
  
  if (predefinedOrders && predefinedOrders.length > 0) {
    return predefinedOrders.map((o, i) => {
      const totalValue = o.qty * o.filledPrice;
      const createdAt = o.filledAt.toISOString();
      return {
        id: `demo-${o.symbol}-${i}-${Date.now()}`,
        symbol: o.symbol,
        side: o.side,
        type: o.type as 'market' | 'limit',
        status: o.status as 'filled',
        qty: o.qty,
        filledQty: o.qty,
        limitPrice: o.type === 'limit' ? Number(o.filledPrice.toFixed(2)) : undefined,
        filledPrice: Number(o.filledPrice.toFixed(2)),
        totalValue: Number(totalValue.toFixed(2)),
        timeInForce: o.timeInForce,
        createdAt,
        updatedAt: createdAt,
      };
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  // Fallback: dynamic generation from positions (for any styles not in DEMO_ORDERS)
  const portfolio = DEMO_PORTFOLIOS[style];
  if (!portfolio) return [];

  const orders: Order[] = [];
  const now = new Date();

  for (const pos of portfolio.positions) {
    const numOrders = pos.qty > 100 ? 3 : pos.qty > 30 ? 2 : 1;
    let remainingQty = pos.qty;
    for (let i = 0; i < numOrders; i++) {
      const isLast = i === numOrders - 1;
      const orderQty = isLast ? remainingQty : Math.floor(remainingQty * (0.3 + Math.random() * 0.4));
      if (orderQty <= 0) break;
      remainingQty -= orderQty;

      const monthsAgo = 1 + Math.random() * 4;
      const daysAgo = Math.random() * 30;
      const createdAt = new Date(now.getTime() - monthsAgo * 30 * 24 * 60 * 60 * 1000 - daysAgo * 24 * 60 * 60 * 1000);
      const type = Math.random() > 0.3 ? 'market' : 'limit';
      const price = pos.avgCost * (0.97 + Math.random() * 0.06);
      const totalValue = orderQty * price;

      orders.push({
        id: `demo-${pos.symbol}-${i}-${Date.now()}`,
        symbol: pos.symbol,
        side: 'buy',
        type: type as 'market' | 'limit',
        status: 'filled',
        qty: orderQty,
        filledQty: orderQty,
        limitPrice: type === 'limit' ? Number(price.toFixed(2)) : undefined,
        filledPrice: Number(price.toFixed(2)),
        totalValue: Number(totalValue.toFixed(2)),
        timeInForce: type === 'limit' ? 'gtc' : 'day',
        createdAt: createdAt.toISOString(),
        updatedAt: createdAt.toISOString(),
      });
    }
  }

  orders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return orders;
}

// ─── Demo Mode Helpers ───────────────────────────────────────

// ─── Available Styles Export ───────────────────────────────

export const AVAILABLE_STYLES = Object.keys(DEMO_PORTFOLIOS);

/**
 * Convenience function to get a demo portfolio's raw positions
 * (without prices). Returns the lynch portfolio as default fallback.
 */
export function getDemoPortfolio(investorStyle: string): {
  name: string;
  description: string;
  positions: Array<{ symbol: string; qty: number; avgCost: number; name: string; sector: string; industry?: string }>;
} {
  const portfolio = DEMO_PORTFOLIOS[investorStyle as InvestorStyle] || DEMO_PORTFOLIOS.lynch;
  return {
    name: portfolio.label,
    description: portfolio.description || '',
    positions: portfolio.positions.map(p => ({
      symbol: p.symbol,
      qty: p.qty,
      avgCost: p.avgCost,
      name: p.name,
      sector: p.sector,
      industry: p.industry,
    })),
  };
}

/**
 * Check if a user is in demo mode (no broker connected).
 * Safe to use server-side; only checks boolean flags.
 */
export function isUserInDemo(user: any): boolean {
  return !user?.broker_connected || !!user?.is_demo;
}
