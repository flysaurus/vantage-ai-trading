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
  weekHigh52?: number;
  weekLow52?: number;
  type?: 'Stock' | 'ETF';
}

export const DEMO_PORTFOLIOS: Record<InvestorStyle, DemoPortfolio> = {
  buffett: {
    label: 'Diversified Growth',
    description: 'Broad-market core with growth tilt',
    positions: [
      { symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust', sector: 'Core ETF', industry: 'S&P 500 ETF', qty: 25, avgCost: 480.00, weekHigh52: 620, weekLow52: 380, type: 'ETF' },
      { symbol: 'QQQ', name: 'Invesco QQQ Trust', sector: 'Core ETF', industry: 'Nasdaq-100 ETF', qty: 20, avgCost: 415.00, weekHigh52: 560, weekLow52: 330, type: 'ETF' },
      { symbol: 'GOOGL', name: 'Alphabet Inc.', sector: 'Technology', industry: 'Internet Services', qty: 60, avgCost: 140.00, weekHigh52: 230, weekLow52: 140, type: 'Stock' },
      { symbol: 'MSFT', name: 'Microsoft Corp.', sector: 'Technology', industry: 'Cloud Software', qty: 20, avgCost: 415.00, weekHigh52: 520, weekLow52: 385, type: 'Stock' },
      { symbol: 'JPM', name: 'JPMorgan Chase & Co.', sector: 'Financial Services', industry: 'Banking', qty: 45, avgCost: 195.00, weekHigh52: 285, weekLow52: 180, type: 'Stock' },
      { symbol: 'ADBE', name: 'Adobe Inc.', sector: 'Technology', industry: 'Design Software', qty: 25, avgCost: 560.00, weekHigh52: 650, weekLow52: 420, type: 'Stock' },
      { symbol: 'UNH', name: 'UnitedHealth Group', sector: 'Healthcare', industry: 'Health Insurance', qty: 15, avgCost: 520.00, weekHigh52: 640, weekLow52: 460, type: 'Stock' },
      { symbol: 'NVDA', name: 'NVIDIA Corp.', sector: 'Technology', industry: 'Semiconductors', qty: 80, avgCost: 108.00, weekHigh52: 220, weekLow52: 102, type: 'Stock' },
      { symbol: 'COST', name: 'Costco Wholesale', sector: 'Consumer', industry: 'Wholesale Retail', qty: 10, avgCost: 720.00, weekHigh52: 1020, weekLow52: 685, type: 'Stock' },
      { symbol: 'LLY', name: 'Eli Lilly & Co.', sector: 'Healthcare', industry: 'Pharmaceuticals', qty: 12, avgCost: 750.00, weekHigh52: 980, weekLow52: 710, type: 'Stock' },
    ],
  },
  lynch: {
    label: 'Diversified Growth',
    description: 'Broad-market core with growth tilt',
    positions: [
      { symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust', sector: 'Core ETF', industry: 'S&P 500 ETF', qty: 25, avgCost: 480.00, weekHigh52: 620, weekLow52: 380, type: 'ETF' },
      { symbol: 'QQQ', name: 'Invesco QQQ Trust', sector: 'Core ETF', industry: 'Nasdaq-100 ETF', qty: 20, avgCost: 415.00, weekHigh52: 560, weekLow52: 330, type: 'ETF' },
      { symbol: 'GOOGL', name: 'Alphabet Inc.', sector: 'Technology', industry: 'Internet Services', qty: 60, avgCost: 140.00, weekHigh52: 230, weekLow52: 140, type: 'Stock' },
      { symbol: 'MSFT', name: 'Microsoft Corp.', sector: 'Technology', industry: 'Cloud Software', qty: 20, avgCost: 415.00, weekHigh52: 520, weekLow52: 385, type: 'Stock' },
      { symbol: 'JPM', name: 'JPMorgan Chase & Co.', sector: 'Financial Services', industry: 'Banking', qty: 45, avgCost: 195.00, weekHigh52: 285, weekLow52: 180, type: 'Stock' },
      { symbol: 'ADBE', name: 'Adobe Inc.', sector: 'Technology', industry: 'Design Software', qty: 25, avgCost: 560.00, weekHigh52: 650, weekLow52: 420, type: 'Stock' },
      { symbol: 'UNH', name: 'UnitedHealth Group', sector: 'Healthcare', industry: 'Health Insurance', qty: 15, avgCost: 520.00, weekHigh52: 640, weekLow52: 460, type: 'Stock' },
      { symbol: 'NVDA', name: 'NVIDIA Corp.', sector: 'Technology', industry: 'Semiconductors', qty: 80, avgCost: 108.00, weekHigh52: 220, weekLow52: 102, type: 'Stock' },
      { symbol: 'COST', name: 'Costco Wholesale', sector: 'Consumer', industry: 'Wholesale Retail', qty: 10, avgCost: 720.00, weekHigh52: 1020, weekLow52: 685, type: 'Stock' },
      { symbol: 'LLY', name: 'Eli Lilly & Co.', sector: 'Healthcare', industry: 'Pharmaceuticals', qty: 12, avgCost: 750.00, weekHigh52: 980, weekLow52: 710, type: 'Stock' },
    ],
  },
  livermore: {
    label: 'Diversified Growth',
    description: 'Broad-market core with growth tilt',
    positions: [
      { symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust', sector: 'Core ETF', industry: 'S&P 500 ETF', qty: 25, avgCost: 480.00, weekHigh52: 620, weekLow52: 380, type: 'ETF' },
      { symbol: 'QQQ', name: 'Invesco QQQ Trust', sector: 'Core ETF', industry: 'Nasdaq-100 ETF', qty: 20, avgCost: 415.00, weekHigh52: 560, weekLow52: 330, type: 'ETF' },
      { symbol: 'GOOGL', name: 'Alphabet Inc.', sector: 'Technology', industry: 'Internet Services', qty: 60, avgCost: 140.00, weekHigh52: 230, weekLow52: 140, type: 'Stock' },
      { symbol: 'MSFT', name: 'Microsoft Corp.', sector: 'Technology', industry: 'Cloud Software', qty: 20, avgCost: 415.00, weekHigh52: 520, weekLow52: 385, type: 'Stock' },
      { symbol: 'JPM', name: 'JPMorgan Chase & Co.', sector: 'Financial Services', industry: 'Banking', qty: 45, avgCost: 195.00, weekHigh52: 285, weekLow52: 180, type: 'Stock' },
      { symbol: 'ADBE', name: 'Adobe Inc.', sector: 'Technology', industry: 'Design Software', qty: 25, avgCost: 560.00, weekHigh52: 650, weekLow52: 420, type: 'Stock' },
      { symbol: 'UNH', name: 'UnitedHealth Group', sector: 'Healthcare', industry: 'Health Insurance', qty: 15, avgCost: 520.00, weekHigh52: 640, weekLow52: 460, type: 'Stock' },
      { symbol: 'NVDA', name: 'NVIDIA Corp.', sector: 'Technology', industry: 'Semiconductors', qty: 80, avgCost: 108.00, weekHigh52: 220, weekLow52: 102, type: 'Stock' },
      { symbol: 'COST', name: 'Costco Wholesale', sector: 'Consumer', industry: 'Wholesale Retail', qty: 10, avgCost: 720.00, weekHigh52: 1020, weekLow52: 685, type: 'Stock' },
      { symbol: 'LLY', name: 'Eli Lilly & Co.', sector: 'Healthcare', industry: 'Pharmaceuticals', qty: 12, avgCost: 750.00, weekHigh52: 980, weekLow52: 710, type: 'Stock' },
    ],
  },
  soros: {
    label: 'Diversified Growth',
    description: 'Broad-market core with growth tilt',
    positions: [
      { symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust', sector: 'Core ETF', industry: 'S&P 500 ETF', qty: 25, avgCost: 480.00, weekHigh52: 620, weekLow52: 380, type: 'ETF' },
      { symbol: 'QQQ', name: 'Invesco QQQ Trust', sector: 'Core ETF', industry: 'Nasdaq-100 ETF', qty: 20, avgCost: 415.00, weekHigh52: 560, weekLow52: 330, type: 'ETF' },
      { symbol: 'GOOGL', name: 'Alphabet Inc.', sector: 'Technology', industry: 'Internet Services', qty: 60, avgCost: 140.00, weekHigh52: 230, weekLow52: 140, type: 'Stock' },
      { symbol: 'MSFT', name: 'Microsoft Corp.', sector: 'Technology', industry: 'Cloud Software', qty: 20, avgCost: 415.00, weekHigh52: 520, weekLow52: 385, type: 'Stock' },
      { symbol: 'JPM', name: 'JPMorgan Chase & Co.', sector: 'Financial Services', industry: 'Banking', qty: 45, avgCost: 195.00, weekHigh52: 285, weekLow52: 180, type: 'Stock' },
      { symbol: 'ADBE', name: 'Adobe Inc.', sector: 'Technology', industry: 'Design Software', qty: 25, avgCost: 560.00, weekHigh52: 650, weekLow52: 420, type: 'Stock' },
      { symbol: 'UNH', name: 'UnitedHealth Group', sector: 'Healthcare', industry: 'Health Insurance', qty: 15, avgCost: 520.00, weekHigh52: 640, weekLow52: 460, type: 'Stock' },
      { symbol: 'NVDA', name: 'NVIDIA Corp.', sector: 'Technology', industry: 'Semiconductors', qty: 80, avgCost: 108.00, weekHigh52: 220, weekLow52: 102, type: 'Stock' },
      { symbol: 'COST', name: 'Costco Wholesale', sector: 'Consumer', industry: 'Wholesale Retail', qty: 10, avgCost: 720.00, weekHigh52: 1020, weekLow52: 685, type: 'Stock' },
      { symbol: 'LLY', name: 'Eli Lilly & Co.', sector: 'Healthcare', industry: 'Pharmaceuticals', qty: 12, avgCost: 750.00, weekHigh52: 980, weekLow52: 710, type: 'Stock' },
    ],
  },
  munger: {
    label: 'Diversified Growth',
    description: 'Broad-market core with growth tilt',
    positions: [
      { symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust', sector: 'Core ETF', industry: 'S&P 500 ETF', qty: 25, avgCost: 480.00, weekHigh52: 620, weekLow52: 380, type: 'ETF' },
      { symbol: 'QQQ', name: 'Invesco QQQ Trust', sector: 'Core ETF', industry: 'Nasdaq-100 ETF', qty: 20, avgCost: 415.00, weekHigh52: 560, weekLow52: 330, type: 'ETF' },
      { symbol: 'GOOGL', name: 'Alphabet Inc.', sector: 'Technology', industry: 'Internet Services', qty: 60, avgCost: 140.00, weekHigh52: 230, weekLow52: 140, type: 'Stock' },
      { symbol: 'MSFT', name: 'Microsoft Corp.', sector: 'Technology', industry: 'Cloud Software', qty: 20, avgCost: 415.00, weekHigh52: 520, weekLow52: 385, type: 'Stock' },
      { symbol: 'JPM', name: 'JPMorgan Chase & Co.', sector: 'Financial Services', industry: 'Banking', qty: 45, avgCost: 195.00, weekHigh52: 285, weekLow52: 180, type: 'Stock' },
      { symbol: 'ADBE', name: 'Adobe Inc.', sector: 'Technology', industry: 'Design Software', qty: 25, avgCost: 560.00, weekHigh52: 650, weekLow52: 420, type: 'Stock' },
      { symbol: 'UNH', name: 'UnitedHealth Group', sector: 'Healthcare', industry: 'Health Insurance', qty: 15, avgCost: 520.00, weekHigh52: 640, weekLow52: 460, type: 'Stock' },
      { symbol: 'NVDA', name: 'NVIDIA Corp.', sector: 'Technology', industry: 'Semiconductors', qty: 80, avgCost: 108.00, weekHigh52: 220, weekLow52: 102, type: 'Stock' },
      { symbol: 'COST', name: 'Costco Wholesale', sector: 'Consumer', industry: 'Wholesale Retail', qty: 10, avgCost: 720.00, weekHigh52: 1020, weekLow52: 685, type: 'Stock' },
      { symbol: 'LLY', name: 'Eli Lilly & Co.', sector: 'Healthcare', industry: 'Pharmaceuticals', qty: 12, avgCost: 750.00, weekHigh52: 980, weekLow52: 710, type: 'Stock' },
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
    { symbol: 'SPY', qty: 25, side: 'buy', type: 'market', status: 'filled', filledPrice: 480.00, filledAt: new Date('2024-01-08T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'QQQ', qty: 20, side: 'buy', type: 'market', status: 'filled', filledPrice: 415.00, filledAt: new Date('2024-01-08T14:31:00Z'), timeInForce: 'day' },
    { symbol: 'GOOGL', qty: 60, side: 'buy', type: 'market', status: 'filled', filledPrice: 140.00, filledAt: new Date('2024-01-15T14:45:00Z'), timeInForce: 'day' },
    { symbol: 'MSFT', qty: 20, side: 'buy', type: 'market', status: 'filled', filledPrice: 415.00, filledAt: new Date('2024-02-05T15:00:00Z'), timeInForce: 'day' },
    { symbol: 'JPM', qty: 45, side: 'buy', type: 'market', status: 'filled', filledPrice: 195.00, filledAt: new Date('2024-02-20T19:30:00Z'), timeInForce: 'day' },
    { symbol: 'ADBE', qty: 25, side: 'buy', type: 'market', status: 'filled', filledPrice: 560.00, filledAt: new Date('2024-03-01T18:00:00Z'), timeInForce: 'day' },
    { symbol: 'UNH', qty: 15, side: 'buy', type: 'market', status: 'filled', filledPrice: 520.00, filledAt: new Date('2024-04-12T15:15:00Z'), timeInForce: 'day' },
    { symbol: 'NVDA', qty: 80, side: 'buy', type: 'market', status: 'filled', filledPrice: 108.00, filledAt: new Date('2024-08-15T14:15:00Z'), timeInForce: 'day' },
    { symbol: 'COST', qty: 10, side: 'buy', type: 'market', status: 'filled', filledPrice: 720.00, filledAt: new Date('2024-05-03T18:00:00Z'), timeInForce: 'day' },
    { symbol: 'LLY', qty: 12, side: 'buy', type: 'market', status: 'filled', filledPrice: 750.00, filledAt: new Date('2024-06-18T14:45:00Z'), timeInForce: 'day' },
  ],
  lynch: [
    { symbol: 'SPY', qty: 25, side: 'buy', type: 'market', status: 'filled', filledPrice: 480.00, filledAt: new Date('2024-01-08T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'QQQ', qty: 20, side: 'buy', type: 'market', status: 'filled', filledPrice: 415.00, filledAt: new Date('2024-01-08T14:31:00Z'), timeInForce: 'day' },
    { symbol: 'GOOGL', qty: 60, side: 'buy', type: 'market', status: 'filled', filledPrice: 140.00, filledAt: new Date('2024-01-15T14:45:00Z'), timeInForce: 'day' },
    { symbol: 'MSFT', qty: 20, side: 'buy', type: 'market', status: 'filled', filledPrice: 415.00, filledAt: new Date('2024-02-05T15:00:00Z'), timeInForce: 'day' },
    { symbol: 'JPM', qty: 45, side: 'buy', type: 'market', status: 'filled', filledPrice: 195.00, filledAt: new Date('2024-02-20T19:30:00Z'), timeInForce: 'day' },
    { symbol: 'ADBE', qty: 25, side: 'buy', type: 'market', status: 'filled', filledPrice: 560.00, filledAt: new Date('2024-03-01T18:00:00Z'), timeInForce: 'day' },
    { symbol: 'UNH', qty: 15, side: 'buy', type: 'market', status: 'filled', filledPrice: 520.00, filledAt: new Date('2024-04-12T15:15:00Z'), timeInForce: 'day' },
    { symbol: 'NVDA', qty: 80, side: 'buy', type: 'market', status: 'filled', filledPrice: 108.00, filledAt: new Date('2024-08-15T14:15:00Z'), timeInForce: 'day' },
    { symbol: 'COST', qty: 10, side: 'buy', type: 'market', status: 'filled', filledPrice: 720.00, filledAt: new Date('2024-05-03T18:00:00Z'), timeInForce: 'day' },
    { symbol: 'LLY', qty: 12, side: 'buy', type: 'market', status: 'filled', filledPrice: 750.00, filledAt: new Date('2024-06-18T14:45:00Z'), timeInForce: 'day' },
  ],
  livermore: [
    { symbol: 'SPY', qty: 25, side: 'buy', type: 'market', status: 'filled', filledPrice: 480.00, filledAt: new Date('2024-01-08T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'QQQ', qty: 20, side: 'buy', type: 'market', status: 'filled', filledPrice: 415.00, filledAt: new Date('2024-01-08T14:31:00Z'), timeInForce: 'day' },
    { symbol: 'GOOGL', qty: 60, side: 'buy', type: 'market', status: 'filled', filledPrice: 140.00, filledAt: new Date('2024-01-15T14:45:00Z'), timeInForce: 'day' },
    { symbol: 'MSFT', qty: 20, side: 'buy', type: 'market', status: 'filled', filledPrice: 415.00, filledAt: new Date('2024-02-05T15:00:00Z'), timeInForce: 'day' },
    { symbol: 'JPM', qty: 45, side: 'buy', type: 'market', status: 'filled', filledPrice: 195.00, filledAt: new Date('2024-02-20T19:30:00Z'), timeInForce: 'day' },
    { symbol: 'ADBE', qty: 25, side: 'buy', type: 'market', status: 'filled', filledPrice: 560.00, filledAt: new Date('2024-03-01T18:00:00Z'), timeInForce: 'day' },
    { symbol: 'UNH', qty: 15, side: 'buy', type: 'market', status: 'filled', filledPrice: 520.00, filledAt: new Date('2024-04-12T15:15:00Z'), timeInForce: 'day' },
    { symbol: 'NVDA', qty: 80, side: 'buy', type: 'market', status: 'filled', filledPrice: 108.00, filledAt: new Date('2024-08-15T14:15:00Z'), timeInForce: 'day' },
    { symbol: 'COST', qty: 10, side: 'buy', type: 'market', status: 'filled', filledPrice: 720.00, filledAt: new Date('2024-05-03T18:00:00Z'), timeInForce: 'day' },
    { symbol: 'LLY', qty: 12, side: 'buy', type: 'market', status: 'filled', filledPrice: 750.00, filledAt: new Date('2024-06-18T14:45:00Z'), timeInForce: 'day' },
  ],
  munger: [
    { symbol: 'SPY', qty: 25, side: 'buy', type: 'market', status: 'filled', filledPrice: 480.00, filledAt: new Date('2024-01-08T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'QQQ', qty: 20, side: 'buy', type: 'market', status: 'filled', filledPrice: 415.00, filledAt: new Date('2024-01-08T14:31:00Z'), timeInForce: 'day' },
    { symbol: 'GOOGL', qty: 60, side: 'buy', type: 'market', status: 'filled', filledPrice: 140.00, filledAt: new Date('2024-01-15T14:45:00Z'), timeInForce: 'day' },
    { symbol: 'MSFT', qty: 20, side: 'buy', type: 'market', status: 'filled', filledPrice: 415.00, filledAt: new Date('2024-02-05T15:00:00Z'), timeInForce: 'day' },
    { symbol: 'JPM', qty: 45, side: 'buy', type: 'market', status: 'filled', filledPrice: 195.00, filledAt: new Date('2024-02-20T19:30:00Z'), timeInForce: 'day' },
    { symbol: 'ADBE', qty: 25, side: 'buy', type: 'market', status: 'filled', filledPrice: 560.00, filledAt: new Date('2024-03-01T18:00:00Z'), timeInForce: 'day' },
    { symbol: 'UNH', qty: 15, side: 'buy', type: 'market', status: 'filled', filledPrice: 520.00, filledAt: new Date('2024-04-12T15:15:00Z'), timeInForce: 'day' },
    { symbol: 'NVDA', qty: 80, side: 'buy', type: 'market', status: 'filled', filledPrice: 108.00, filledAt: new Date('2024-08-15T14:15:00Z'), timeInForce: 'day' },
    { symbol: 'COST', qty: 10, side: 'buy', type: 'market', status: 'filled', filledPrice: 720.00, filledAt: new Date('2024-05-03T18:00:00Z'), timeInForce: 'day' },
    { symbol: 'LLY', qty: 12, side: 'buy', type: 'market', status: 'filled', filledPrice: 750.00, filledAt: new Date('2024-06-18T14:45:00Z'), timeInForce: 'day' },
  ],
  soros: [
    { symbol: 'SPY', qty: 25, side: 'buy', type: 'market', status: 'filled', filledPrice: 480.00, filledAt: new Date('2024-01-08T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'QQQ', qty: 20, side: 'buy', type: 'market', status: 'filled', filledPrice: 415.00, filledAt: new Date('2024-01-08T14:31:00Z'), timeInForce: 'day' },
    { symbol: 'GOOGL', qty: 60, side: 'buy', type: 'market', status: 'filled', filledPrice: 140.00, filledAt: new Date('2024-01-15T14:45:00Z'), timeInForce: 'day' },
    { symbol: 'MSFT', qty: 20, side: 'buy', type: 'market', status: 'filled', filledPrice: 415.00, filledAt: new Date('2024-02-05T15:00:00Z'), timeInForce: 'day' },
    { symbol: 'JPM', qty: 45, side: 'buy', type: 'market', status: 'filled', filledPrice: 195.00, filledAt: new Date('2024-02-20T19:30:00Z'), timeInForce: 'day' },
    { symbol: 'ADBE', qty: 25, side: 'buy', type: 'market', status: 'filled', filledPrice: 560.00, filledAt: new Date('2024-03-01T18:00:00Z'), timeInForce: 'day' },
    { symbol: 'UNH', qty: 15, side: 'buy', type: 'market', status: 'filled', filledPrice: 520.00, filledAt: new Date('2024-04-12T15:15:00Z'), timeInForce: 'day' },
    { symbol: 'NVDA', qty: 80, side: 'buy', type: 'market', status: 'filled', filledPrice: 108.00, filledAt: new Date('2024-08-15T14:15:00Z'), timeInForce: 'day' },
    { symbol: 'COST', qty: 10, side: 'buy', type: 'market', status: 'filled', filledPrice: 720.00, filledAt: new Date('2024-05-03T18:00:00Z'), timeInForce: 'day' },
    { symbol: 'LLY', qty: 12, side: 'buy', type: 'market', status: 'filled', filledPrice: 750.00, filledAt: new Date('2024-06-18T14:45:00Z'), timeInForce: 'day' },
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

  const CASH_BALANCE = 57585;
  const equity = totalValue + CASH_BALANCE;
  const cash = CASH_BALANCE;
  const buyingPower = CASH_BALANCE;

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
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust', qty: 25, currentPrice: 520.00, avgCost: 480.00, marketValue: 13000, totalPnl: 1000.00, totalPnlPct: 8.3, todayChange: 32.00, todayChangePct: 0.25, pctOfAccount: 13.6, sector: 'Core ETF' },
  { symbol: 'QQQ', name: 'Invesco QQQ Trust', qty: 20, currentPrice: 450.00, avgCost: 415.00, marketValue: 9000, totalPnl: 700.00, totalPnlPct: 8.4, todayChange: 24.00, todayChangePct: 0.27, pctOfAccount: 9.4, sector: 'Core ETF' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', qty: 60, currentPrice: 155.00, avgCost: 140.00, marketValue: 9300, totalPnl: 900.00, totalPnlPct: 10.7, todayChange: 45.00, todayChangePct: 0.49, pctOfAccount: 9.7, sector: 'Technology' },
  { symbol: 'MSFT', name: 'Microsoft Corp.', qty: 20, currentPrice: 450.00, avgCost: 415.00, marketValue: 9000, totalPnl: 700.00, totalPnlPct: 8.4, todayChange: 18.00, todayChangePct: 0.20, pctOfAccount: 9.4, sector: 'Technology' },
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.', qty: 45, currentPrice: 220.00, avgCost: 195.00, marketValue: 9900, totalPnl: 1125.00, totalPnlPct: 12.8, todayChange: 38.00, todayChangePct: 0.39, pctOfAccount: 10.4, sector: 'Financial Services' },
  { symbol: 'ADBE', name: 'Adobe Inc.', qty: 25, currentPrice: 485.00, avgCost: 560.00, marketValue: 12125, totalPnl: -1875.00, totalPnlPct: -13.4, todayChange: -28.00, todayChangePct: -0.23, pctOfAccount: 12.7, sector: 'Technology' },
  { symbol: 'UNH', name: 'UnitedHealth Group', qty: 15, currentPrice: 316.00, avgCost: 520.00, marketValue: 4740, totalPnl: -3060.00, totalPnlPct: -39.2, todayChange: -22.00, todayChangePct: -0.46, pctOfAccount: 5.0, sector: 'Healthcare' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', qty: 80, currentPrice: 135.00, avgCost: 108.00, marketValue: 10800, totalPnl: 2160.00, totalPnlPct: 25.0, todayChange: 56.00, todayChangePct: 0.52, pctOfAccount: 11.3, sector: 'Technology' },
  { symbol: 'COST', name: 'Costco Wholesale', qty: 10, currentPrice: 760.00, avgCost: 720.00, marketValue: 7600, totalPnl: 400.00, totalPnlPct: 5.6, todayChange: 14.00, todayChangePct: 0.18, pctOfAccount: 8.0, sector: 'Consumer' },
  { symbol: 'LLY', name: 'Eli Lilly & Co.', qty: 12, currentPrice: 840.00, avgCost: 750.00, marketValue: 10080, totalPnl: 1080.00, totalPnlPct: 12.0, todayChange: 22.00, todayChangePct: 0.22, pctOfAccount: 10.6, sector: 'Healthcare' },
];
