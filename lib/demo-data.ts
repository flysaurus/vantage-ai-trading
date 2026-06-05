// ─── Demo Data Engine ──────────────────────────────────────────
// Generates plausible demo portfolios for each investor style.
// Stock selection and quantities are fictional — prices come from
// the /api/market/quotes endpoint (Finnhub).
//
// Used when no broker is connected — populates all tabs with
// realistic dummy data so the app is fully functional out of the box.

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
  positions: PositionDef[];
}

interface PositionDef {
  symbol: string;
  qty: number;
  avgCost: number;
  name: string;
  sector: string;
}

export const DEMO_PORTFOLIOS: Record<InvestorStyle, DemoPortfolio> = {
  buffett: {
    label: 'Warren Buffett · Value Hunter',
    positions: [
      { symbol: 'AAPL', name: 'Apple Inc.', sector: 'Technology', qty: 100, avgCost: 182.50 },
      { symbol: 'KO', name: 'Coca-Cola Co.', sector: 'Consumer', qty: 200, avgCost: 62.80 },
      { symbol: 'AXP', name: 'American Express', sector: 'Financial Services', qty: 60, avgCost: 176.00 },
      { symbol: 'BAC', name: 'Bank of America', sector: 'Financial Services', qty: 300, avgCost: 35.20 },
      { symbol: 'PG', name: 'Procter & Gamble', sector: 'Consumer', qty: 80, avgCost: 156.00 },
      { symbol: 'JNJ', name: 'Johnson & Johnson', sector: 'Healthcare', qty: 50, avgCost: 161.00 },
      { symbol: 'BRK.B', name: 'Berkshire Hathaway B', sector: 'Financial Services', qty: 30, avgCost: 392.00 },
    ],
  },
  lynch: {
    label: 'Peter Lynch · Growth Chaser',
    positions: [
      { symbol: 'MSFT', name: 'Microsoft Corp.', sector: 'Technology', qty: 40, avgCost: 422.00 },
      { symbol: 'NVDA', name: 'NVIDIA Corp.', sector: 'Technology', qty: 30, avgCost: 130.00 },
      { symbol: 'META', name: 'Meta Platforms', sector: 'Technology', qty: 50, avgCost: 482.00 },
      { symbol: 'AMZN', name: 'Amazon.com Inc.', sector: 'Consumer', qty: 60, avgCost: 186.00 },
      { symbol: 'GOOGL', name: 'Alphabet Inc.', sector: 'Technology', qty: 45, avgCost: 156.00 },
      { symbol: 'CRM', name: 'Salesforce Inc.', sector: 'Technology', qty: 70, avgCost: 292.00 },
    ],
  },
  livermore: {
    label: 'Jesse Livermore · Momentum Rider',
    positions: [
      { symbol: 'TSLA', name: 'Tesla Inc.', sector: 'Consumer', qty: 80, avgCost: 242.00 },
      { symbol: 'MSTR', name: 'MicroStrategy Inc.', sector: 'Technology', qty: 5, avgCost: 1210.00 },
      { symbol: 'SMCI', name: 'Super Micro Computer', sector: 'Technology', qty: 30, avgCost: 705.00 },
      { symbol: 'COIN', name: 'Coinbase Global', sector: 'Financial Services', qty: 50, avgCost: 212.00 },
      { symbol: 'RKLB', name: 'Rocket Lab USA', sector: 'Industrials', qty: 500, avgCost: 18.50 },
      { symbol: 'PLTR', name: 'Palantir Technologies', sector: 'Technology', qty: 200, avgCost: 40.50 },
    ],
  },
  soros: {
    label: 'George Soros · Macro Strategist',
    positions: [
      { symbol: 'GLD', name: 'SPDR Gold Trust', sector: 'Materials', qty: 200, avgCost: 201.00 },
      { symbol: 'XLE', name: 'Energy Select Sector', sector: 'Energy', qty: 150, avgCost: 92.50 },
      { symbol: 'XLF', name: 'Financial Select Sector', sector: 'Financial Services', qty: 250, avgCost: 42.30 },
      { symbol: 'TLT', name: 'iShares 20+ Year Treasury', sector: 'Financial Services', qty: 100, avgCost: 92.00 },
      { symbol: 'DIA', name: 'SPDR Dow Jones ETF', sector: 'Industrials', qty: 80, avgCost: 421.00 },
      { symbol: 'TQQQ', name: 'ProShares UltraPro QQQ', sector: 'Technology', qty: 100, avgCost: 68.50 },
    ],
  },
  munger: {
    label: 'Charlie Munger · Dividend Compounder',
    positions: [
      { symbol: 'JNJ', name: 'Johnson & Johnson', sector: 'Healthcare', qty: 120, avgCost: 161.00 },
      { symbol: 'PG', name: 'Procter & Gamble', sector: 'Consumer', qty: 150, avgCost: 156.00 },
      { symbol: 'KO', name: 'Coca-Cola Co.', sector: 'Consumer', qty: 300, avgCost: 62.80 },
      { symbol: 'PEP', name: 'PepsiCo Inc.', sector: 'Consumer', qty: 100, avgCost: 178.50 },
      { symbol: 'MCD', name: "McDonald's Corp.", sector: 'Consumer', qty: 80, avgCost: 286.00 },
      { symbol: 'O', name: 'Realty Income Corp.', sector: 'Real Estate', qty: 200, avgCost: 65.50 },
      { symbol: 'VZ', name: 'Verizon Communications', sector: 'Media & Entertainment', qty: 250, avgCost: 42.50 },
    ],
  },
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
 * Generate demo order history for the given investor style.
 * All orders are BUY-only (filled) — realistic executions for
 * each position in the demo portfolio.
 */
export function getDemoOrders(style: InvestorStyle): Order[] {
  const portfolio = DEMO_PORTFOLIOS[style];
  if (!portfolio) return [];

  const orders: Order[] = [];
  const now = new Date();

  for (const pos of portfolio.positions) {
    // 1-3 buy orders per position, spread over 1-5 months
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
      const price = pos.avgCost * (0.97 + Math.random() * 0.06); // ±3% around avgCost
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

  // Sort newest first
  orders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return orders;
}
