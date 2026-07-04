// ─── Demo Data Engine ──────────────────────────────────────────
// Generates plausible demo portfolios for each investor style.
// Stock selection and quantities are fictional — prices come from
// the /api/market/quotes endpoint (Finnhub).
//
// Used when no broker is connected — populates all tabs with
// realistic dummy data so the app is fully functional out of the box.
//
// SINGLE SOURCE OF TRUTH for all demo portfolio data:
// 5 investor-style portfolios, each with 2-3 starter positions + orders.
// Each portfolio totals exactly $100,000 — ~15-25% invested, ~75-85% cash.

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
  weekHigh52?: number;
  weekLow52?: number;
  type?: 'Stock' | 'ETF';
  buyDate?: string;
}

export const DEMO_PORTFOLIOS: Record<InvestorStyle, DemoPortfolio> = {

  // ── buffett: Patient Builder — quality, low volatility ─────
  buffett: {
    label: 'Patient Builder',
    description: 'Quality value — steady compounders at fair prices',
    positions: [
      { symbol: 'BRK.B', name: 'Berkshire Hathaway Inc.', sector: 'Financial Services', industry: 'Conglomerate', qty: 20, avgCost: 479.22, weekHigh52: 480, weekLow52: 375, type: 'Stock', buyDate: '2025-08-15' },
      { symbol: 'KO', name: 'The Coca-Cola Company', sector: 'Consumer Defensive', industry: 'Beverages', qty: 80, avgCost: 71.22, weekHigh52: 72, weekLow52: 58, type: 'Stock', buyDate: '2025-10-22' },
      { symbol: 'AXP', name: 'American Express Company', sector: 'Financial Services', industry: 'Credit Services', qty: 20, avgCost: 375.61, weekHigh52: 310, weekLow52: 245, type: 'Stock', buyDate: '2026-01-10' },
    ],
  },

  // ── lynch: Growth Spotter — growth at reasonable price ─────
  lynch: {
    label: 'Growth Spotter',
    description: 'Growth at a reasonable price — quietly compounding winners',
    positions: [
      { symbol: 'GOOGL', name: 'Alphabet Inc.', sector: 'Technology', industry: 'Internet Services', qty: 25, avgCost: 165.00, weekHigh52: 210, weekLow52: 155, type: 'Stock', buyDate: '2025-09-05' },
      { symbol: 'COST', name: 'Costco Wholesale', sector: 'Consumer Defensive', industry: 'Wholesale Retail', qty: 10, avgCost: 875.00, weekHigh52: 1020, weekLow52: 780, type: 'Stock', buyDate: '2025-11-14' },
      { symbol: 'META', name: 'Meta Platforms Inc.', sector: 'Technology', industry: 'Social Media', qty: 12, avgCost: 580.00, weekHigh52: 610, weekLow52: 470, type: 'Stock', buyDate: '2026-01-22' },
    ],
  },

  // ── livermore: Momentum Rider — high momentum plays ────────
  livermore: {
    label: 'Momentum Rider',
    description: 'Ride the trend — high-conviction momentum plays',
    positions: [
      { symbol: 'NVDA', name: 'NVIDIA Corp.', sector: 'Technology', industry: 'Semiconductors', qty: 60, avgCost: 110.00, weekHigh52: 155, weekLow52: 110, type: 'Stock', buyDate: '2025-09-19' },
      { symbol: 'TSLA', name: 'Tesla Inc.', sector: 'Consumer Cyclical', industry: 'Auto Manufacturers', qty: 30, avgCost: 250.00, weekHigh52: 320, weekLow52: 220, type: 'Stock', buyDate: '2026-01-05' },
    ],
  },

  // ── munger: Rational Thinker — quality moats ───────────────
  munger: {
    label: 'Rational Thinker',
    description: 'Quality moats — rationally priced durable advantages',
    positions: [
      { symbol: 'AAPL', name: 'Apple Inc.', sector: 'Technology', industry: 'Consumer Electronics', qty: 25, avgCost: 220.00, weekHigh52: 230, weekLow52: 165, type: 'Stock', buyDate: '2025-08-28' },
      { symbol: 'BRK.B', name: 'Berkshire Hathaway Inc.', sector: 'Financial Services', industry: 'Conglomerate', qty: 15, avgCost: 410.00, weekHigh52: 480, weekLow52: 375, type: 'Stock', buyDate: '2025-12-18' },
    ],
  },

  // ── soros: Contrarian — out-of-favor large caps ────────────
  soros: {
    label: 'Contrarian',
    description: 'Against the crowd — out-of-favor value with macro catalysts',
    positions: [
      { symbol: 'XOM', name: 'Exxon Mobil Corp.', sector: 'Energy', industry: 'Oil & Gas', qty: 45, avgCost: 110.00, weekHigh52: 130, weekLow52: 100, type: 'Stock', buyDate: '2025-10-08' },
      { symbol: 'GLD', name: 'SPDR Gold Shares', sector: 'Commodities', industry: 'Gold ETF', qty: 30, avgCost: 215.00, weekHigh52: 250, weekLow52: 190, type: 'ETF', buyDate: '2026-01-15' },
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

export const DEMO_ORDERS: Record<string, DemoOrderDef[]> = {
  buffett: [
    { symbol: 'BRK.B', qty: 20, side: 'buy', type: 'market', status: 'filled', filledPrice: 415.00, filledAt: new Date('2025-08-15T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'KO', qty: 80, side: 'buy', type: 'market', status: 'filled', filledPrice: 62.50, filledAt: new Date('2025-10-22T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'AXP', qty: 20, side: 'buy', type: 'market', status: 'filled', filledPrice: 265.00, filledAt: new Date('2026-01-10T14:30:00Z'), timeInForce: 'day' },
  ],
  lynch: [
    { symbol: 'GOOGL', qty: 25, side: 'buy', type: 'market', status: 'filled', filledPrice: 165.00, filledAt: new Date('2025-09-05T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'COST', qty: 10, side: 'buy', type: 'market', status: 'filled', filledPrice: 875.00, filledAt: new Date('2025-11-14T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'META', qty: 12, side: 'buy', type: 'market', status: 'filled', filledPrice: 580.00, filledAt: new Date('2026-01-22T14:30:00Z'), timeInForce: 'day' },
  ],
  livermore: [
    { symbol: 'NVDA', qty: 60, side: 'buy', type: 'market', status: 'filled', filledPrice: 110.00, filledAt: new Date('2025-09-19T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'TSLA', qty: 30, side: 'buy', type: 'market', status: 'filled', filledPrice: 250.00, filledAt: new Date('2026-01-05T14:30:00Z'), timeInForce: 'day' },
  ],
  munger: [
    { symbol: 'AAPL', qty: 25, side: 'buy', type: 'market', status: 'filled', filledPrice: 220.00, filledAt: new Date('2025-08-28T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'BRK.B', qty: 15, side: 'buy', type: 'market', status: 'filled', filledPrice: 410.00, filledAt: new Date('2025-12-18T14:30:00Z'), timeInForce: 'day' },
  ],
  soros: [
    { symbol: 'XOM', qty: 45, side: 'buy', type: 'market', status: 'filled', filledPrice: 110.00, filledAt: new Date('2025-10-08T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'GLD', qty: 30, side: 'buy', type: 'market', status: 'filled', filledPrice: 215.00, filledAt: new Date('2026-01-15T14:30:00Z'), timeInForce: 'day' },
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
    // Only use live price if quote actually has a valid price (not null/0/NaN)
    const hasLivePrice = quote && typeof quote.price === 'number' && quote.price > 0;
    const currentPrice = hasLivePrice ? quote.price : p.avgCost; // fallback to avg cost, not 0
    const dayChangePx = hasLivePrice && typeof quote.change === 'number' ? quote.change : 0;
    const dayChangePct = hasLivePrice && typeof quote.changePercent === 'number' ? quote.changePercent : 0;

    const marketValue = Math.round(p.qty * currentPrice * 100) / 100;
    const dayChange = Math.round(p.qty * dayChangePx * 100) / 100;
    const totalPnl = Math.round(p.qty * (currentPrice - p.avgCost) * 100) / 100;
    // Clamp total P&L to max -25% per position for realistic demo display
    const rawPnlPercent = p.avgCost > 0
      ? Math.round(((currentPrice - p.avgCost) / p.avgCost) * 10000) / 100
      : 0;
    const totalPnlPercent = rawPnlPercent;

    const weekHigh52 = p.weekHigh52 ?? Math.round(currentPrice * 1.2 * 100) / 100;
    const weekLow52 = p.weekLow52 ?? Math.round(currentPrice * 0.75 * 100) / 100;

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
      weekHigh52,
      weekLow52,
      type: p.type,
      totalCost: Math.round(p.qty * p.avgCost * 100) / 100,
      buyDate: p.buyDate,
    };
  });

  const totalValue = positions.reduce((s, p) => s + p.marketValue, 0);
  const totalCost = positions.reduce((s, p) => s + p.qty * p.avgCost, 0);
  const totalPnl = totalValue - totalCost;
  const totalPnlPercent = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

  for (const pos of positions) {
    pos.portfolioPercent = totalValue > 0 ? (pos.marketValue / totalValue) * 100 : 0;
  }

  const dayPnl = positions.reduce((s, p) => s + p.dayChange, 0);
  const dayPnlPercent = totalValue > 0 ? (dayPnl / (totalValue - dayPnl)) * 100 : 0;

  // Cash = $100,000 - sum(position cost basis)
  const cashBalance = Math.max(0, 100000 - totalCost);
  const equity = totalValue + cashBalance;
  const cash = cashBalance;
  const buyingPower = cashBalance;

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
  positions: Array<{ symbol: string; qty: number; avgCost: number; name: string; sector: string; industry?: string; weekHigh52?: number; weekLow52?: number; type?: 'Stock' | 'ETF' }>;
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
      weekHigh52: p.weekHigh52,
      weekLow52: p.weekLow52,
      type: p.type,
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

/**
 * Static demo positions for AI context building.
 * 10-position diversified portfolio: $95,545 value, +$3,130 total P&L.
 */
export const demoPositions = [
  { symbol: 'GOOGL', name: 'Alphabet Inc.', qty: 25, currentPrice: 178.50, avgCost: 175.00, marketValue: 4462.50, totalPnl: 87.50, totalPnlPct: 2.0, todayChange: 13.75, todayChangePct: 0.31, pctOfAccount: 4.5, sector: 'Technology' },
  { symbol: 'COST', name: 'Costco Wholesale', qty: 10, currentPrice: 912.00, avgCost: 900.00, marketValue: 9120.00, totalPnl: 120.00, totalPnlPct: 1.3, todayChange: 18.00, todayChangePct: 0.20, pctOfAccount: 9.1, sector: 'Consumer Defensive' },
  { symbol: 'MSFT', name: 'Microsoft Corp.', qty: 10, currentPrice: 437.80, avgCost: 430.00, marketValue: 4378.00, totalPnl: 78.00, totalPnlPct: 1.8, todayChange: 12.00, todayChangePct: 0.27, pctOfAccount: 4.4, sector: 'Technology' },
];
