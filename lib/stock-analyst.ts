// ─── Stock Analyst ────────────────────────────────────────────
// Deep fundamental, technical, and sentiment analysis per stock.
// Fetches 15-20 data points from Finnhub + market-data sources.
// Used by the AI Advisor to make data-backed stock recommendations.

import {
  getQuote,
  getCompanyProfile,
  getCandles,
} from '@/lib/market-data';
import type { Candle } from '@/lib/market-data';
import {
  getCompanyNews,
  getFinancialMetrics,
  getEarningsSurprises,
  getRecommendationTrends,
  getPriceTarget,
} from '@/lib/finnhub';
import type {
  FinnhubNewsItem,
  FinnhubMetrics,
} from '@/lib/finnhub';
import { finnhubIndustryToSector } from '@/lib/finnhub';

// ─── Types ────────────────────────────────────────────────────

export interface StockAnalysis {
  symbol: string;
  company: string;
  sector: string;
  // Fundamentals
  pe: number | null;
  epsGrowth: number | null;
  revenueGrowth: number | null;
  profitMargin: number | null;
  roe: number | null;
  debtToEquity: number | null;
  // Technicals
  rsi14: number | null;
  priceVs50MA: number | null; // ratio (price / 50MA)
  priceVs200MA: number | null;
  trend: 'strong_up' | 'up' | 'sideways' | 'down' | 'strong_down';
  // Valuation
  peVsSectorAvg: number | null; // ratio of stock PE to sector average PE
  priceToBook: number | null;
  // News & Sentiment
  newsSentiment: 'positive' | 'neutral' | 'negative';
  recentHeadlines: string[];
  // Dividend
  dividendYield: number | null;
  // Growth prospects
  earningsEstimate: string | null;
  analystRating: string | null;
  analystTargetMean: number | null;
  // Data quality
  dataPoints: number; // how many data points we actually got (max ~20)
}

// ─── Technical Analysis ──────────────────────────────────────

interface Technicals {
  rsi: number | null;
  priceVs50MA: number | null;
  priceVs200MA: number | null;
  trend: 'strong_up' | 'up' | 'sideways' | 'down' | 'strong_down';
}

function calculateRSI(candles: Candle[], period: number = 14): number | null {
  if (candles.length < period + 1) return null;

  const closes = candles.map(c => c.close);
  let gains = 0;
  let losses = 0;

  // First average
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  if (avgLoss === 0) return 100;

  // Wilder's smoothing for remaining periods
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change >= 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateSMA(candles: Candle[], period: number): number | null {
  if (candles.length < period) return null;
  const relevant = candles.slice(-period);
  const sum = relevant.reduce((s, c) => s + c.close, 0);
  return sum / period;
}

function calculateTechnicals(candles: Candle[], currentPrice: number): Technicals {
  const rsi = calculateRSI(candles, 14);
  const ma50 = calculateSMA(candles, 50);
  const ma200 = calculateSMA(candles, 200);
  const priceVs50MA = ma50 ? currentPrice / ma50 : null;
  const priceVs200MA = ma200 ? currentPrice / ma200 : null;

  // Determine trend
  let trend: Technicals['trend'] = 'sideways';
  if (priceVs50MA && priceVs200MA) {
    if (priceVs50MA > 1.02 && priceVs200MA > 1.02) trend = 'strong_up';
    else if (priceVs50MA > 1.0 && priceVs200MA > 1.0) trend = 'up';
    else if (priceVs50MA < 0.98 && priceVs200MA < 0.98) trend = 'strong_down';
    else if (priceVs50MA < 1.0 && priceVs200MA < 1.0) trend = 'down';
  } else if (priceVs50MA) {
    if (priceVs50MA > 1.02) trend = 'up';
    else if (priceVs50MA < 0.98) trend = 'down';
  }

  return { rsi, priceVs50MA, priceVs200MA, trend };
}

// ─── News Sentiment ──────────────────────────────────────────

interface SentimentResult {
  overall: 'positive' | 'neutral' | 'negative';
  headlines: string[];
  score: number; // -1 to 1
}

const POSITIVE_WORDS = [
  'beat', 'beats', 'raise', 'raises', 'raised', 'upgrade', 'upgraded',
  'strong', 'growth', 'record', 'surge', 'surged', 'boost', 'positive',
  'outperform', 'buyback', 'dividend', 'expansion', 'bullish', 'rally',
  'breakthrough', 'approval', 'approved', 'launch', 'partnership',
];

const NEGATIVE_WORDS = [
  'miss', 'misses', 'cut', 'cuts', 'lowered', 'downgrade', 'downgraded',
  'weak', 'decline', 'loss', 'layoff', 'layoffs', 'investigation',
  'fine', 'lawsuit', 'negative', 'underperform', 'sell-off', 'crash',
  'warning', 'recall', 'debt', 'bankruptcy', 'delisting', 'fraud',
];

function analyzeSentiment(news: FinnhubNewsItem[]): SentimentResult {
  if (!news || news.length === 0) {
    return { overall: 'neutral', headlines: [], score: 0 };
  }

  const headlines: string[] = [];
  let totalScore = 0;
  let scored = 0;

  for (const item of news) {
    headlines.push(item.headline);
    const text = (item.headline + ' ' + item.summary).toLowerCase();

    let itemScore = 0;
    for (const word of POSITIVE_WORDS) {
      if (text.includes(word)) itemScore += 0.15;
    }
    for (const word of NEGATIVE_WORDS) {
      if (text.includes(word)) itemScore -= 0.15;
    }

    // Clamp
    itemScore = Math.max(-1, Math.min(1, itemScore));

    if (itemScore !== 0) {
      totalScore += itemScore;
      scored++;
    }
  }

  const avgScore = scored > 0 ? totalScore / scored : 0;
  const overall: SentimentResult['overall'] =
    avgScore > 0.1 ? 'positive' : avgScore < -0.1 ? 'negative' : 'neutral';

  return {
    overall,
    headlines: headlines.slice(0, 5),
    score: parseFloat(avgScore.toFixed(2)),
  };
}

// ─── Sector Average PE (approximate reference data) ───────────

const SECTOR_AVG_PE: Record<string, number> = {
  'Technology': 28,
  'Financial Services': 14,
  'Healthcare': 18,
  'Consumer': 22,
  'Industrials': 20,
  'Energy': 12,
  'Utilities': 18,
  'Real Estate': 20,
  'Materials': 16,
  'Media & Entertainment': 22,
  'Communications': 22,
};

function getSectorAvgPE(sector: string): number {
  return SECTOR_AVG_PE[sector] || 20;
}

// ─── Main Analysis Function ──────────────────────────────────

/**
 * Deep analysis of a single stock.
 * Fetches fundamentals, technicals, news, earnings, and analyst data.
 * Gracefully degrades — missing data points become null, not errors.
 */
export async function analyzeStockForSector(
  symbol: string,
  sector: string,
  _investorStyle: string,
): Promise<StockAnalysis> {
  const sym = symbol.toUpperCase();
  let dataPoints = 0;

  // Fetch all data in parallel
  const [profile, quote, metrics, candles, news, earnings, recs, priceTarget] =
    await Promise.all([
      getCompanyProfile(sym),
      getQuote(sym),
      getFinancialMetrics(sym),
      getCandles(sym, 'D', undefined, undefined, 200),
      getCompanyNews(sym),
      getEarningsSurprises(sym),
      getRecommendationTrends(sym),
      getPriceTarget(sym),
    ]);

  // Track data quality
  if (quote) dataPoints += 6; // price, change, high, low, open, volume
  if (metrics) dataPoints += 9; // PE, growth, margins, ROE, etc.
  if (candles) dataPoints += 3; // RSI, MA50, MA200
  if (news?.length) dataPoints += 1;

  // Determine sector
  const resolvedSector = profile?.industry
    ? finnhubIndustryToSector(profile.industry) || sector
    : sector;

  // Compute technicals
  const technicals = candles && quote
    ? calculateTechnicals(candles, quote.price)
    : { rsi: null, priceVs50MA: null, priceVs200MA: null, trend: 'sideways' as const };

  // Compute sentiment
  const sentiment = analyzeSentiment(news || []);

  // Latest earnings estimate string
  const latestEarnings = earnings?.length
    ? earnings[0].estimate != null
      ? `Est $${earnings[0].estimate.toFixed(2)} (actual $${earnings[0].actual?.toFixed(2) ?? 'N/A'})`
      : null
    : null;

  // Analyst rating string
  let analystStr: string | null = null;
  if (recs?.length) {
    const latest = recs[0];
    const total = latest.strongBuy + latest.buy + latest.hold + latest.sell + latest.strongSell;
    if (total > 0) {
      const buyPct = ((latest.strongBuy + latest.buy) / total * 100).toFixed(0);
      analystStr = `${buyPct}% Buy (${latest.strongBuy}SB/${latest.buy}B/${latest.hold}H/${latest.sell}S/${latest.strongSell}SS)`;
    }
  }

  const pe = metrics?.pe ?? null;
  const sectorAvgPE = getSectorAvgPE(resolvedSector);
  const peVsSectorAvg = pe && sectorAvgPE > 0 ? pe / sectorAvgPE : null;

  return {
    symbol: sym,
    company: profile?.name || sym,
    sector: resolvedSector,
    // Fundamentals
    pe,
    epsGrowth: metrics?.epsGrowthTTM ?? null,
    revenueGrowth: metrics?.revenueGrowthTTM ?? null,
    profitMargin: metrics?.netProfitMargin ?? null,
    roe: metrics?.roe ?? null,
    debtToEquity: metrics?.debtToEquity ?? null,
    // Technicals
    rsi14: technicals.rsi,
    priceVs50MA: technicals.priceVs50MA,
    priceVs200MA: technicals.priceVs200MA,
    trend: technicals.trend,
    // Valuation
    peVsSectorAvg,
    priceToBook: metrics?.priceToBook ?? null,
    // News
    newsSentiment: sentiment.overall,
    recentHeadlines: sentiment.headlines,
    // Dividend
    dividendYield: metrics?.dividendYield ?? null,
    // Growth prospects
    earningsEstimate: latestEarnings,
    analystRating: analystStr,
    analystTargetMean: priceTarget?.targetMean ?? null,
    // Data quality
    dataPoints,
  };
}

// ─── Style-Based Stock Ranking ────────────────────────────────

type StyleKey = 'lynch' | 'buffett' | 'livermore' | 'soros' | 'munger';

/**
 * Rank stocks based on investor style.
 * Each style weights different factors:
 * - lynch: EPS growth, revenue growth, momentum, analyst upgrades
 * - buffett: PE vs sector, ROE, debt/equity, margin of safety
 * - livermore: RSI, trend, price vs 50MA, volume/surge
 * - munger: dividend yield, ROE, sector stability, payout safety
 * - soros: macro positioning, trend, valuation, diversification
 */
export function rankStocksForStyle(
  stocks: StockAnalysis[],
  style: string,
): StockAnalysis[] {
  const scored = stocks.map(stock => {
    let score = 0;
    const s = style.toLowerCase();

    if (s === 'lynch' || s === 'growth') {
      // Growth: EPS growth (2x weight), revenue growth, momentum, sentiment
      score += (stock.epsGrowth ?? 0) * 2 * 10;
      score += (stock.revenueGrowth ?? 0) * 10;
      score += stock.trend === 'strong_up' ? 10 : stock.trend === 'up' ? 5 : 0;
      score += stock.newsSentiment === 'positive' ? 5 : 0;
      // Penalize high PE (PG) relative to sector for growth picks
      if (stock.peVsSectorAvg && stock.peVsSectorAvg > 1.5) score -= 3;
    } else if (s === 'buffett' || s === 'value') {
      // Value: PE < sector average, high ROE, low debt, dividend
      score += stock.peVsSectorAvg && stock.peVsSectorAvg < 0.9 ? 10 : 0;
      score += (stock.roe ?? 0) / 5;
      score += stock.debtToEquity && stock.debtToEquity < 1 ? 5 : 0;
      score += stock.dividendYield ? Math.min((stock.dividendYield / 2) * 10, 10) : 0;
    } else if (s === 'livermore' || s === 'momentum') {
      // Momentum: strong trend, RSI 50-70, above MAs
      score += stock.trend === 'strong_up' ? 15 : stock.trend === 'up' ? 8 : 0;
      score += stock.rsi14 && stock.rsi14 > 50 && stock.rsi14 < 70 ? 10 : 0;
      score += stock.priceVs50MA && stock.priceVs50MA > 1.02 ? 10 : 0;
      score += stock.newsSentiment === 'positive' ? 3 : 0;
      // Penalize overbought (RSI > 75)
      if (stock.rsi14 && stock.rsi14 > 75) score -= 8;
    } else if (s === 'munger' || s === 'dividend') {
      // Dividend: yield, ROE, stability (not strong_down)
      score += stock.dividendYield ? Math.min(stock.dividendYield * 5, 15) : 0;
      score += (stock.roe ?? 0) / 5;
      score += stock.trend !== 'strong_down' && stock.trend !== 'down' ? 5 : 0;
      score += stock.debtToEquity && stock.debtToEquity < 1.5 ? 3 : 0;
    } else if (s === 'soros' || s === 'macro') {
      // Macro: trend alignment, valuation, diversification role
      score += stock.trend === 'strong_up' ? 10 : stock.trend === 'up' ? 5 : 0;
      score += stock.peVsSectorAvg && stock.peVsSectorAvg < 1.0 ? 5 : 0;
      score += stock.debtToEquity && stock.debtToEquity < 1.0 ? 5 : 0;
      // Favor lower beta for defensive positioning
    }

    return { stock, score };
  });

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.stock);
}

// ─── Formatting ──────────────────────────────────────────────

/**
 * Format a single analysis as a concise line for the AI context.
 */
export function formatStockForContext(a: StockAnalysis, styleName: string): string {
  const parts: string[] = [];

  // Price & PE
  if (a.pe != null) {
    parts.push(`PE ${a.pe.toFixed(1)}`);
  }

  // Growth
  if (a.epsGrowth != null) {
    parts.push(`EPS growth ${a.epsGrowth >= 0 ? '+' : ''}${a.epsGrowth.toFixed(1)}%`);
  }
  if (a.revenueGrowth != null) {
    parts.push(`Rev growth ${a.revenueGrowth >= 0 ? '+' : ''}${a.revenueGrowth.toFixed(1)}%`);
  }

  // ROE
  if (a.roe != null) {
    parts.push(`ROE ${a.roe.toFixed(1)}%`);
  }

  // Dividend
  if (a.dividendYield != null) {
    parts.push(`Div ${a.dividendYield.toFixed(1)}%`);
  }

  // Technicals
  if (a.rsi14 != null) {
    parts.push(`RSI ${a.rsi14.toFixed(0)}`);
  }

  const trendEmoji = {
    strong_up: '▲▲',
    up: '▲',
    sideways: '→',
    down: '▼',
    strong_down: '▼▼',
  };
  parts.push(trendEmoji[a.trend]);

  // Sentiment
  if (a.newsSentiment !== 'neutral') {
    parts.push(`News: ${a.newsSentiment}`);
  }

  // Analyst
  if (a.analystRating) {
    parts.push(a.analystRating);
  }

  const body = parts.join(', ');
  return `  ${a.symbol}: ${body} → ${styleName}`;
}
