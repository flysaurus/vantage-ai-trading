// ─── Demo Data Engine ──────────────────────────────────────────
// Generates plausible demo portfolios for each investor style.
// Stock selection and quantities are fictional — prices come from
// the /api/market/quotes endpoint (Finnhub).
//
// Used when no broker is connected — populates all tabs with
// realistic dummy data so the app is fully functional out of the box.
//
// SINGLE SOURCE OF TRUTH for all demo portfolio data:
// 5 investor-style portfolios, each with 10 positions + buy/sell orders.
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

  // ── buffett: Patient Builder — quality value, low volatility, wide moats ──
  // Math: total cost $41,430, cash $58,570, equity $100,000
  buffett: {
    label: 'Patient Builder',
    description: 'Quality value — steady compounders at fair prices',
    positions: [
      { symbol: 'AAPL', name: 'Apple Inc.', sector: 'Technology', industry: 'Consumer Electronics', qty: 30, avgCost: 195.00, weekHigh52: 250, weekLow52: 165, type: 'Stock', buyDate: '2025-06-12' },
      { symbol: 'BRK.B', name: 'Berkshire Hathaway Inc.', sector: 'Financial Services', industry: 'Conglomerate', qty: 15, avgCost: 420.00, weekHigh52: 480, weekLow52: 375, type: 'Stock', buyDate: '2025-08-15' },
      { symbol: 'JPM', name: 'JPMorgan Chase & Co.', sector: 'Financial Services', industry: 'Banks', qty: 25, avgCost: 210.00, weekHigh52: 265, weekLow52: 180, type: 'Stock', buyDate: '2025-09-03' },
      { symbol: 'KO', name: 'The Coca-Cola Company', sector: 'Consumer Defensive', industry: 'Beverages', qty: 60, avgCost: 65.00, weekHigh52: 75, weekLow52: 58, type: 'Stock', buyDate: '2025-10-22' },
      { symbol: 'AXP', name: 'American Express Company', sector: 'Financial Services', industry: 'Credit Services', qty: 15, avgCost: 275.00, weekHigh52: 310, weekLow52: 240, type: 'Stock', buyDate: '2026-01-10' },
      { symbol: 'PG', name: 'Procter & Gamble Co.', sector: 'Consumer Defensive', industry: 'Household Products', qty: 30, avgCost: 170.00, weekHigh52: 185, weekLow52: 155, type: 'Stock', buyDate: '2025-11-05' },
      { symbol: 'JNJ', name: 'Johnson & Johnson', sector: 'Healthcare', industry: 'Pharmaceuticals', qty: 25, avgCost: 160.00, weekHigh52: 175, weekLow52: 145, type: 'Stock', buyDate: '2025-07-18' },
      { symbol: 'WMT', name: 'Walmart Inc.', sector: 'Consumer Defensive', industry: 'Retail', qty: 25, avgCost: 85.00, weekHigh52: 105, weekLow52: 75, type: 'Stock', buyDate: '2025-12-01' },
      { symbol: 'BAC', name: 'Bank of America Corp.', sector: 'Financial Services', industry: 'Banks', qty: 40, avgCost: 42.00, weekHigh52: 48, weekLow52: 35, type: 'Stock', buyDate: '2026-02-14' },
      { symbol: 'CVX', name: 'Chevron Corporation', sector: 'Energy', industry: 'Oil & Gas', qty: 20, avgCost: 155.00, weekHigh52: 175, weekLow52: 140, type: 'Stock', buyDate: '2025-10-08' },
    ],
  },

  // ── lynch: Growth Spotter — GARP: growth at reasonable price ──
  // Math: total cost $45,340, cash $54,660, equity $100,000
  lynch: {
    label: 'Growth Spotter',
    description: 'Growth at a reasonable price — quietly compounding winners',
    positions: [
      { symbol: 'GOOGL', name: 'Alphabet Inc.', sector: 'Technology', industry: 'Internet Services', qty: 20, avgCost: 175.00, weekHigh52: 210, weekLow52: 155, type: 'Stock', buyDate: '2025-09-05' },
      { symbol: 'META', name: 'Meta Platforms Inc.', sector: 'Technology', industry: 'Social Media', qty: 10, avgCost: 550.00, weekHigh52: 650, weekLow52: 470, type: 'Stock', buyDate: '2026-01-22' },
      { symbol: 'COST', name: 'Costco Wholesale', sector: 'Consumer Defensive', industry: 'Wholesale Retail', qty: 8, avgCost: 880.00, weekHigh52: 1020, weekLow52: 780, type: 'Stock', buyDate: '2025-11-14' },
      { symbol: 'MSFT', name: 'Microsoft Corp.', sector: 'Technology', industry: 'Software', qty: 12, avgCost: 430.00, weekHigh52: 470, weekLow52: 380, type: 'Stock', buyDate: '2025-08-01' },
      { symbol: 'ADBE', name: 'Adobe Inc.', sector: 'Technology', industry: 'Software', qty: 10, avgCost: 520.00, weekHigh52: 590, weekLow52: 460, type: 'Stock', buyDate: '2025-10-15' },
      { symbol: 'CRM', name: 'Salesforce Inc.', sector: 'Technology', industry: 'Software', qty: 15, avgCost: 290.00, weekHigh52: 340, weekLow52: 250, type: 'Stock', buyDate: '2025-12-03' },
      { symbol: 'AMZN', name: 'Amazon.com Inc.', sector: 'Consumer Cyclical', industry: 'E-Commerce', qty: 10, avgCost: 210.00, weekHigh52: 240, weekLow52: 175, type: 'Stock', buyDate: '2026-01-15' },
      { symbol: 'NFLX', name: 'Netflix Inc.', sector: 'Media & Entertainment', industry: 'Streaming', qty: 8, avgCost: 680.00, weekHigh52: 780, weekLow52: 580, type: 'Stock', buyDate: '2025-11-28' },
      { symbol: 'NOW', name: 'ServiceNow Inc.', sector: 'Technology', industry: 'Software', qty: 5, avgCost: 850.00, weekHigh52: 980, weekLow52: 720, type: 'Stock', buyDate: '2026-02-05' },
      { symbol: 'UNH', name: 'UnitedHealth Group Inc.', sector: 'Healthcare', industry: 'Managed Care', qty: 5, avgCost: 560.00, weekHigh52: 630, weekLow52: 500, type: 'Stock', buyDate: '2025-09-20' },
    ],
  },

  // ── livermore: Momentum Rider — high momentum, trending plays ──
  // Math: total cost $39,220, cash $60,780, equity $100,000
  livermore: {
    label: 'Momentum Rider',
    description: 'Ride the trend — high-conviction momentum plays',
    positions: [
      { symbol: 'NVDA', name: 'NVIDIA Corp.', sector: 'Technology', industry: 'Semiconductors', qty: 40, avgCost: 115.00, weekHigh52: 155, weekLow52: 95, type: 'Stock', buyDate: '2025-09-19' },
      { symbol: 'TSLA', name: 'Tesla Inc.', sector: 'Consumer Cyclical', industry: 'Auto Manufacturers', qty: 20, avgCost: 260.00, weekHigh52: 350, weekLow52: 210, type: 'Stock', buyDate: '2026-01-05' },
      { symbol: 'PLTR', name: 'Palantir Technologies', sector: 'Technology', industry: 'Software', qty: 100, avgCost: 38.00, weekHigh52: 85, weekLow52: 28, type: 'Stock', buyDate: '2025-08-12' },
      { symbol: 'AVGO', name: 'Broadcom Inc.', sector: 'Technology', industry: 'Semiconductors', qty: 5, avgCost: 1850.00, weekHigh52: 2200, weekLow52: 1400, type: 'Stock', buyDate: '2025-11-08' },
      { symbol: 'AMD', name: 'Advanced Micro Devices', sector: 'Technology', industry: 'Semiconductors', qty: 25, avgCost: 160.00, weekHigh52: 210, weekLow52: 130, type: 'Stock', buyDate: '2025-10-20' },
      { symbol: 'COIN', name: 'Coinbase Global Inc.', sector: 'Financial Services', industry: 'Crypto Exchange', qty: 15, avgCost: 220.00, weekHigh52: 350, weekLow52: 170, type: 'Stock', buyDate: '2026-01-30' },
      { symbol: 'SNOW', name: 'Snowflake Inc.', sector: 'Technology', industry: 'Data Platform', qty: 12, avgCost: 175.00, weekHigh52: 230, weekLow52: 140, type: 'Stock', buyDate: '2025-12-15' },
      { symbol: 'NET', name: 'Cloudflare Inc.', sector: 'Technology', industry: 'Internet Services', qty: 20, avgCost: 115.00, weekHigh52: 160, weekLow52: 85, type: 'Stock', buyDate: '2026-02-10' },
      { symbol: 'DDOG', name: 'Datadog Inc.', sector: 'Technology', industry: 'Monitoring', qty: 15, avgCost: 130.00, weekHigh52: 170, weekLow52: 105, type: 'Stock', buyDate: '2025-10-01' },
      { symbol: 'CRWD', name: 'CrowdStrike Holdings', sector: 'Technology', industry: 'Cybersecurity', qty: 8, avgCost: 340.00, weekHigh52: 420, weekLow52: 260, type: 'Stock', buyDate: '2026-01-08' },
    ],
  },

  // ── munger: Rational Thinker — quality moats, durable advantages ──
  // Math: total cost $39,230, cash $60,770, equity $100,000
  munger: {
    label: 'Rational Thinker',
    description: 'Quality moats — rationally priced durable advantages',
    positions: [
      { symbol: 'AAPL', name: 'Apple Inc.', sector: 'Technology', industry: 'Consumer Electronics', qty: 20, avgCost: 225.00, weekHigh52: 250, weekLow52: 165, type: 'Stock', buyDate: '2025-08-28' },
      { symbol: 'BRK.B', name: 'Berkshire Hathaway Inc.', sector: 'Financial Services', industry: 'Conglomerate', qty: 12, avgCost: 440.00, weekHigh52: 480, weekLow52: 375, type: 'Stock', buyDate: '2025-12-18' },
      { symbol: 'COST', name: 'Costco Wholesale', sector: 'Consumer Defensive', industry: 'Wholesale Retail', qty: 6, avgCost: 850.00, weekHigh52: 1020, weekLow52: 780, type: 'Stock', buyDate: '2025-11-14' },
      { symbol: 'V', name: 'Visa Inc.', sector: 'Financial Services', industry: 'Payment Processing', qty: 15, avgCost: 300.00, weekHigh52: 330, weekLow52: 265, type: 'Stock', buyDate: '2025-09-10' },
      { symbol: 'MA', name: 'Mastercard Inc.', sector: 'Financial Services', industry: 'Payment Processing', qty: 10, avgCost: 480.00, weekHigh52: 530, weekLow52: 410, type: 'Stock', buyDate: '2025-10-05' },
      { symbol: 'MCO', name: "Moody's Corporation", sector: 'Financial Services', industry: 'Credit Ratings', qty: 8, avgCost: 450.00, weekHigh52: 510, weekLow52: 380, type: 'Stock', buyDate: '2026-02-01' },
      { symbol: 'MSFT', name: 'Microsoft Corp.', sector: 'Technology', industry: 'Software', qty: 10, avgCost: 415.00, weekHigh52: 470, weekLow52: 380, type: 'Stock', buyDate: '2025-07-22' },
      { symbol: 'GOOGL', name: 'Alphabet Inc.', sector: 'Technology', industry: 'Internet Services', qty: 10, avgCost: 180.00, weekHigh52: 210, weekLow52: 155, type: 'Stock', buyDate: '2025-11-01' },
      { symbol: 'UNP', name: 'Union Pacific Corp.', sector: 'Industrials', industry: 'Railroads', qty: 10, avgCost: 250.00, weekHigh52: 275, weekLow52: 215, type: 'Stock', buyDate: '2026-01-15' },
      { symbol: 'SPGI', name: 'S&P Global Inc.', sector: 'Financial Services', industry: 'Market Data', qty: 6, avgCost: 500.00, weekHigh52: 550, weekLow52: 430, type: 'Stock', buyDate: '2025-12-05' },
    ],
  },

  // ── soros: Contrarian — out-of-favor value, macro catalysts ──
  // Math: total cost $45,995, cash $54,005, equity $100,000
  soros: {
    label: 'Contrarian',
    description: 'Against the crowd — out-of-favor value with macro catalysts',
    positions: [
      { symbol: 'XOM', name: 'Exxon Mobil Corp.', sector: 'Energy', industry: 'Oil & Gas', qty: 50, avgCost: 112.00, weekHigh52: 135, weekLow52: 100, type: 'Stock', buyDate: '2025-10-08' },
      { symbol: 'GLD', name: 'SPDR Gold Shares', sector: 'Commodities', industry: 'Gold ETF', qty: 30, avgCost: 215.00, weekHigh52: 250, weekLow52: 190, type: 'ETF', buyDate: '2026-01-15' },
      { symbol: 'CVX', name: 'Chevron Corporation', sector: 'Energy', industry: 'Oil & Gas', qty: 25, avgCost: 155.00, weekHigh52: 175, weekLow52: 140, type: 'Stock', buyDate: '2025-09-20' },
      { symbol: 'SLB', name: 'Schlumberger Ltd.', sector: 'Energy', industry: 'Oil Services', qty: 50, avgCost: 48.00, weekHigh52: 58, weekLow52: 40, type: 'Stock', buyDate: '2025-11-10' },
      { symbol: 'FCX', name: 'Freeport-McMoRan Inc.', sector: 'Materials', industry: 'Copper Mining', qty: 50, avgCost: 42.00, weekHigh52: 55, weekLow52: 35, type: 'Stock', buyDate: '2026-02-20' },
      { symbol: 'NEM', name: 'Newmont Corporation', sector: 'Materials', industry: 'Gold Mining', qty: 35, avgCost: 48.00, weekHigh52: 60, weekLow52: 38, type: 'Stock', buyDate: '2025-12-01' },
      { symbol: 'DVN', name: 'Devon Energy Corp.', sector: 'Energy', industry: 'Oil & Gas', qty: 40, avgCost: 45.00, weekHigh52: 55, weekLow52: 38, type: 'Stock', buyDate: '2026-01-05' },
      { symbol: 'OXY', name: 'Occidental Petroleum', sector: 'Energy', industry: 'Oil & Gas', qty: 35, avgCost: 55.00, weekHigh52: 68, weekLow52: 48, type: 'Stock', buyDate: '2025-10-30' },
      { symbol: 'BHP', name: 'BHP Group Ltd.', sector: 'Materials', industry: 'Diversified Mining', qty: 25, avgCost: 58.00, weekHigh52: 68, weekLow52: 50, type: 'Stock', buyDate: '2025-08-15' },
      { symbol: 'KMI', name: 'Kinder Morgan Inc.', sector: 'Energy', industry: 'Pipelines', qty: 60, avgCost: 22.00, weekHigh52: 27, weekLow52: 19, type: 'Stock', buyDate: '2025-11-22' },
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
    // Buys (oldest → newest)
    { symbol: 'AAPL', qty: 30, side: 'buy', type: 'market', status: 'filled', filledPrice: 195.00, filledAt: new Date('2025-06-12T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'JNJ', qty: 25, side: 'buy', type: 'market', status: 'filled', filledPrice: 160.00, filledAt: new Date('2025-07-18T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'BRK.B', qty: 15, side: 'buy', type: 'market', status: 'filled', filledPrice: 420.00, filledAt: new Date('2025-08-15T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'JPM', qty: 25, side: 'buy', type: 'limit', status: 'filled', filledPrice: 210.00, filledAt: new Date('2025-09-03T14:30:00Z'), timeInForce: 'gtc' },
    { symbol: 'CVX', qty: 20, side: 'buy', type: 'market', status: 'filled', filledPrice: 155.00, filledAt: new Date('2025-10-08T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'KO', qty: 60, side: 'buy', type: 'limit', status: 'filled', filledPrice: 65.00, filledAt: new Date('2025-10-22T14:30:00Z'), timeInForce: 'gtc' },
    { symbol: 'PG', qty: 30, side: 'buy', type: 'market', status: 'filled', filledPrice: 170.00, filledAt: new Date('2025-11-05T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'WMT', qty: 25, side: 'buy', type: 'market', status: 'filled', filledPrice: 85.00, filledAt: new Date('2025-12-01T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'AXP', qty: 15, side: 'buy', type: 'limit', status: 'filled', filledPrice: 275.00, filledAt: new Date('2026-01-10T14:30:00Z'), timeInForce: 'gtc' },
    { symbol: 'BAC', qty: 40, side: 'buy', type: 'market', status: 'filled', filledPrice: 42.00, filledAt: new Date('2026-02-14T14:30:00Z'), timeInForce: 'day' },
    // Sells (partial profit-taking on specific holdings)
    { symbol: 'KO', qty: 15, side: 'sell', type: 'market', status: 'filled', filledPrice: 69.50, filledAt: new Date('2026-03-20T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'JPM', qty: 5, side: 'sell', type: 'limit', status: 'filled', filledPrice: 245.00, filledAt: new Date('2026-05-01T14:30:00Z'), timeInForce: 'gtc' },
  ],
  lynch: [
    { symbol: 'MSFT', qty: 12, side: 'buy', type: 'market', status: 'filled', filledPrice: 430.00, filledAt: new Date('2025-08-01T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'GOOGL', qty: 20, side: 'buy', type: 'market', status: 'filled', filledPrice: 175.00, filledAt: new Date('2025-09-05T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'UNH', qty: 5, side: 'buy', type: 'limit', status: 'filled', filledPrice: 560.00, filledAt: new Date('2025-09-20T14:30:00Z'), timeInForce: 'gtc' },
    { symbol: 'ADBE', qty: 10, side: 'buy', type: 'market', status: 'filled', filledPrice: 520.00, filledAt: new Date('2025-10-15T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'COST', qty: 8, side: 'buy', type: 'limit', status: 'filled', filledPrice: 880.00, filledAt: new Date('2025-11-14T14:30:00Z'), timeInForce: 'gtc' },
    { symbol: 'NFLX', qty: 8, side: 'buy', type: 'market', status: 'filled', filledPrice: 680.00, filledAt: new Date('2025-11-28T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'CRM', qty: 15, side: 'buy', type: 'market', status: 'filled', filledPrice: 290.00, filledAt: new Date('2025-12-03T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'AMZN', qty: 10, side: 'buy', type: 'limit', status: 'filled', filledPrice: 210.00, filledAt: new Date('2026-01-15T14:30:00Z'), timeInForce: 'gtc' },
    { symbol: 'META', qty: 10, side: 'buy', type: 'market', status: 'filled', filledPrice: 550.00, filledAt: new Date('2026-01-22T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'NOW', qty: 5, side: 'buy', type: 'market', status: 'filled', filledPrice: 850.00, filledAt: new Date('2026-02-05T14:30:00Z'), timeInForce: 'day' },
    // Sells
    { symbol: 'GOOGL', qty: 5, side: 'sell', type: 'market', status: 'filled', filledPrice: 195.00, filledAt: new Date('2026-03-15T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'NFLX', qty: 3, side: 'sell', type: 'limit', status: 'filled', filledPrice: 750.00, filledAt: new Date('2026-04-28T14:30:00Z'), timeInForce: 'gtc' },
  ],
  livermore: [
    { symbol: 'PLTR', qty: 100, side: 'buy', type: 'market', status: 'filled', filledPrice: 38.00, filledAt: new Date('2025-08-12T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'NVDA', qty: 40, side: 'buy', type: 'market', status: 'filled', filledPrice: 115.00, filledAt: new Date('2025-09-19T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'DDOG', qty: 15, side: 'buy', type: 'limit', status: 'filled', filledPrice: 130.00, filledAt: new Date('2025-10-01T14:30:00Z'), timeInForce: 'gtc' },
    { symbol: 'AMD', qty: 25, side: 'buy', type: 'market', status: 'filled', filledPrice: 160.00, filledAt: new Date('2025-10-20T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'AVGO', qty: 5, side: 'buy', type: 'limit', status: 'filled', filledPrice: 1850.00, filledAt: new Date('2025-11-08T14:30:00Z'), timeInForce: 'gtc' },
    { symbol: 'SNOW', qty: 12, side: 'buy', type: 'market', status: 'filled', filledPrice: 175.00, filledAt: new Date('2025-12-15T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'TSLA', qty: 20, side: 'buy', type: 'market', status: 'filled', filledPrice: 260.00, filledAt: new Date('2026-01-05T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'CRWD', qty: 8, side: 'buy', type: 'limit', status: 'filled', filledPrice: 340.00, filledAt: new Date('2026-01-08T14:30:00Z'), timeInForce: 'gtc' },
    { symbol: 'COIN', qty: 15, side: 'buy', type: 'market', status: 'filled', filledPrice: 220.00, filledAt: new Date('2026-01-30T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'NET', qty: 20, side: 'buy', type: 'market', status: 'filled', filledPrice: 115.00, filledAt: new Date('2026-02-10T14:30:00Z'), timeInForce: 'day' },
    // Sells (momentum profit-taking)
    { symbol: 'PLTR', qty: 30, side: 'sell', type: 'limit', status: 'filled', filledPrice: 65.00, filledAt: new Date('2026-04-05T14:30:00Z'), timeInForce: 'gtc' },
    { symbol: 'NVDA', qty: 10, side: 'sell', type: 'market', status: 'filled', filledPrice: 148.00, filledAt: new Date('2026-05-20T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'AMD', qty: 8, side: 'sell', type: 'market', status: 'filled', filledPrice: 185.00, filledAt: new Date('2026-06-10T14:30:00Z'), timeInForce: 'day' },
  ],
  munger: [
    { symbol: 'MSFT', qty: 10, side: 'buy', type: 'market', status: 'filled', filledPrice: 415.00, filledAt: new Date('2025-07-22T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'AAPL', qty: 20, side: 'buy', type: 'market', status: 'filled', filledPrice: 225.00, filledAt: new Date('2025-08-28T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'V', qty: 15, side: 'buy', type: 'limit', status: 'filled', filledPrice: 300.00, filledAt: new Date('2025-09-10T14:30:00Z'), timeInForce: 'gtc' },
    { symbol: 'MA', qty: 10, side: 'buy', type: 'market', status: 'filled', filledPrice: 480.00, filledAt: new Date('2025-10-05T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'GOOGL', qty: 10, side: 'buy', type: 'limit', status: 'filled', filledPrice: 180.00, filledAt: new Date('2025-11-01T14:30:00Z'), timeInForce: 'gtc' },
    { symbol: 'COST', qty: 6, side: 'buy', type: 'market', status: 'filled', filledPrice: 850.00, filledAt: new Date('2025-11-14T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'SPGI', qty: 6, side: 'buy', type: 'market', status: 'filled', filledPrice: 500.00, filledAt: new Date('2025-12-05T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'BRK.B', qty: 12, side: 'buy', type: 'limit', status: 'filled', filledPrice: 440.00, filledAt: new Date('2025-12-18T14:30:00Z'), timeInForce: 'gtc' },
    { symbol: 'UNP', qty: 10, side: 'buy', type: 'market', status: 'filled', filledPrice: 250.00, filledAt: new Date('2026-01-15T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'MCO', qty: 8, side: 'buy', type: 'limit', status: 'filled', filledPrice: 450.00, filledAt: new Date('2026-02-01T14:30:00Z'), timeInForce: 'gtc' },
    // Sells (rare — Munger rarely sells, but trims overvalued holdings)
    { symbol: 'AAPL', qty: 3, side: 'sell', type: 'limit', status: 'filled', filledPrice: 245.00, filledAt: new Date('2026-06-15T14:30:00Z'), timeInForce: 'gtc' },
  ],
  soros: [
    { symbol: 'BHP', qty: 25, side: 'buy', type: 'market', status: 'filled', filledPrice: 58.00, filledAt: new Date('2025-08-15T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'CVX', qty: 25, side: 'buy', type: 'market', status: 'filled', filledPrice: 155.00, filledAt: new Date('2025-09-20T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'XOM', qty: 50, side: 'buy', type: 'limit', status: 'filled', filledPrice: 112.00, filledAt: new Date('2025-10-08T14:30:00Z'), timeInForce: 'gtc' },
    { symbol: 'OXY', qty: 35, side: 'buy', type: 'market', status: 'filled', filledPrice: 55.00, filledAt: new Date('2025-10-30T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'SLB', qty: 50, side: 'buy', type: 'market', status: 'filled', filledPrice: 48.00, filledAt: new Date('2025-11-10T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'KMI', qty: 60, side: 'buy', type: 'limit', status: 'filled', filledPrice: 22.00, filledAt: new Date('2025-11-22T14:30:00Z'), timeInForce: 'gtc' },
    { symbol: 'NEM', qty: 35, side: 'buy', type: 'market', status: 'filled', filledPrice: 48.00, filledAt: new Date('2025-12-01T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'DVN', qty: 40, side: 'buy', type: 'market', status: 'filled', filledPrice: 45.00, filledAt: new Date('2026-01-05T14:30:00Z'), timeInForce: 'day' },
    { symbol: 'GLD', qty: 30, side: 'buy', type: 'limit', status: 'filled', filledPrice: 215.00, filledAt: new Date('2026-01-15T14:30:00Z'), timeInForce: 'gtc' },
    { symbol: 'FCX', qty: 50, side: 'buy', type: 'market', status: 'filled', filledPrice: 42.00, filledAt: new Date('2026-02-20T14:30:00Z'), timeInForce: 'day' },
    // Sells (contrarian exit on strength)
    { symbol: 'XOM', qty: 15, side: 'sell', type: 'limit', status: 'filled', filledPrice: 128.00, filledAt: new Date('2026-03-10T14:30:00Z'), timeInForce: 'gtc' },
    { symbol: 'OXY', qty: 10, side: 'sell', type: 'market', status: 'filled', filledPrice: 62.00, filledAt: new Date('2026-05-05T14:30:00Z'), timeInForce: 'day' },
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
  { symbol: 'AAPL', name: 'Apple Inc.', qty: 20, currentPrice: 238.00, avgCost: 225.00, marketValue: 4760.00, totalPnl: 260.00, totalPnlPct: 5.8, todayChange: 12.00, todayChangePct: 0.25, pctOfAccount: 4.8, sector: 'Technology' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', qty: 20, currentPrice: 180.00, avgCost: 175.00, marketValue: 3600.00, totalPnl: 100.00, totalPnlPct: 2.9, todayChange: 15.00, todayChangePct: 0.42, pctOfAccount: 3.6, sector: 'Technology' },
  { symbol: 'MSFT', name: 'Microsoft Corp.', qty: 12, currentPrice: 440.00, avgCost: 430.00, marketValue: 5280.00, totalPnl: 120.00, totalPnlPct: 2.3, todayChange: 18.00, todayChangePct: 0.34, pctOfAccount: 5.3, sector: 'Technology' },
  { symbol: 'COST', name: 'Costco Wholesale', qty: 8, currentPrice: 915.00, avgCost: 880.00, marketValue: 7320.00, totalPnl: 280.00, totalPnlPct: 4.0, todayChange: 24.00, todayChangePct: 0.33, pctOfAccount: 7.3, sector: 'Consumer Defensive' },
  { symbol: 'BRK.B', name: 'Berkshire Hathaway Inc.', qty: 15, currentPrice: 455.00, avgCost: 420.00, marketValue: 6825.00, totalPnl: 525.00, totalPnlPct: 8.3, todayChange: 22.50, todayChangePct: 0.33, pctOfAccount: 6.8, sector: 'Financial Services' },
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.', qty: 25, currentPrice: 248.00, avgCost: 210.00, marketValue: 6200.00, totalPnl: 950.00, totalPnlPct: 18.1, todayChange: 20.00, todayChangePct: 0.32, pctOfAccount: 6.2, sector: 'Financial Services' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', qty: 30, currentPrice: 138.00, avgCost: 115.00, marketValue: 4140.00, totalPnl: 690.00, totalPnlPct: 20.0, todayChange: 15.00, todayChangePct: 0.36, pctOfAccount: 4.1, sector: 'Technology' },
  { symbol: 'XOM', name: 'Exxon Mobil Corp.', qty: 35, currentPrice: 118.00, avgCost: 112.00, marketValue: 4130.00, totalPnl: 210.00, totalPnlPct: 5.4, todayChange: 10.50, todayChangePct: 0.25, pctOfAccount: 4.1, sector: 'Energy' },
  { symbol: 'JNJ', name: 'Johnson & Johnson', qty: 25, currentPrice: 165.00, avgCost: 160.00, marketValue: 4125.00, totalPnl: 125.00, totalPnlPct: 3.1, todayChange: 7.50, todayChangePct: 0.18, pctOfAccount: 4.1, sector: 'Healthcare' },
  { symbol: 'GLD', name: 'SPDR Gold Shares', qty: 25, currentPrice: 232.00, avgCost: 215.00, marketValue: 5800.00, totalPnl: 425.00, totalPnlPct: 7.9, todayChange: 20.00, todayChangePct: 0.43, pctOfAccount: 5.8, sector: 'Commodities' },
];
