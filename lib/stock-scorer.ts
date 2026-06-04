// ─── Stock Scorer ─────────────────────────────────────────────
// Scores any US stock across 5 dimensions → composite 0–100.
// Server-side — uses createServerClient for Supabase.

import { createServerClient } from '@/lib/supabase';
import { getAnalystData, getNewsSentiment } from '@/lib/external-data';

// ─── Interfaces ──────────────────────────────────────────────

export interface StockData {
  currentPrice: number;
  change1d: number;
  pe: number | null;
  epsGrowth: number | null;
  revenueGrowth: number | null;
  profitMargin: number | null;
  roe: number | null;
  debtToEquity: number | null;
  dividendYield: number | null;
  priceToBook: number | null;
  rsi14: number | null;
  priceVs50MA: number | null;
  priceVs200MA: number | null;
  trend: string;
  support: number | null;
  resistance: number | null;
  newsSentiment: string;
  sentimentScore: number;
  headlines: string[];
  analystConsensus: string | null;
  analystCount: number;
  targetMean: number | null;
  targetHigh: number | null;
  targetLow: number | null;
  institutionalOwnership: number | null;
  shortInterest: number | null;
}

export interface StockScore {
  symbol: string;
  company: string;
  sector: string;
  compositeScore: number;
  fundamentalScore: number;
  technicalScore: number;
  sentimentScore: number;
  analystScore: number;
  styleFitScore: number;
  conviction: 'high' | 'medium' | 'speculative';
  entryObservationLow: number | null;
  entryObservationHigh: number | null;
  data: StockData;
}

// ─── Investor Style Weights ──────────────────────────────────

const STYLE_WEIGHTS: Record<
  string,
  { fundamental: number; technical: number; sentiment: number; analyst: number; styleFit: number }
> = {
  lynch:   { fundamental: 0.35, technical: 0.20, sentiment: 0.15, analyst: 0.15, styleFit: 0.15 },
  buffett: { fundamental: 0.40, technical: 0.15, sentiment: 0.10, analyst: 0.20, styleFit: 0.15 },
  livermore: { fundamental: 0.15, technical: 0.40, sentiment: 0.20, analyst: 0.10, styleFit: 0.15 },
  munger:  { fundamental: 0.35, technical: 0.15, sentiment: 0.15, analyst: 0.20, styleFit: 0.15 },
  soros:   { fundamental: 0.20, technical: 0.30, sentiment: 0.25, analyst: 0.10, styleFit: 0.15 },
};

// ─── Technical Helpers ───────────────────────────────────────

function calculateRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.round(100 - 100 / (1 + rs));
}

function calculateMA(closes: number[], period: number): number {
  if (closes.length < period) return closes[closes.length - 1] || 0;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function determineTrend(
  price: number,
  ma50: number,
  ma200: number,
  rsi: number
): string {
  if (price > ma50 && price > ma200 && rsi > 55) return 'strong_up';
  if (price > ma50 && price > ma200) return 'up';
  if (price < ma50 && price < ma200 && rsi < 45) return 'strong_down';
  if (price < ma50 && price < ma200) return 'down';
  return 'sideways';
}

// ─── Scoring Helpers ─────────────────────────────────────────

function scoreFundamental(data: StockData, style: string): number {
  let score = 50;

  // PE ratio (lower is better for value, moderate for growth)
  if (data.pe !== null) {
    if (style === 'lynch' && data.pe < 20) score += 15;
    else if (style === 'buffett' && data.pe < 15) score += 15;
    else if (data.pe < 25) score += 10;
    else if (data.pe > 50) score -= 10;
  }

  // EPS growth
  if (data.epsGrowth !== null) {
    if (data.epsGrowth > 15) score += 15;
    else if (data.epsGrowth > 5) score += 8;
    else if (data.epsGrowth < 0) score -= 10;
  }

  // Revenue growth
  if (data.revenueGrowth !== null) {
    if (data.revenueGrowth > 12) score += 10;
    else if (data.revenueGrowth < 0) score -= 8;
  }

  // Profit margin
  if (data.profitMargin !== null) {
    if (data.profitMargin > 20) score += 8;
    else if (data.profitMargin < 3) score -= 5;
  }

  // ROE
  if (data.roe !== null) {
    if (data.roe > 15) score += 10;
    else if (data.roe < 5) score -= 5;
  }

  // Debt to equity
  if (data.debtToEquity !== null) {
    if (data.debtToEquity < 0.5) score += 5;
    else if (data.debtToEquity > 2) score -= 8;
  }

  return Math.max(0, Math.min(100, score));
}

function scoreTechnical(data: StockData, style: string): number {
  let score = 50;

  // RSI
  if (data.rsi14 !== null) {
    if (data.rsi14 >= 30 && data.rsi14 <= 70) score += 10;
    if (data.rsi14 < 30) score += 15; // Oversold opportunity
    if (data.rsi14 > 85) score -= 15; // Overbought
  }

  // Price vs moving averages
  if (data.priceVs50MA !== null) {
    if (data.priceVs50MA > 1.02) score += 8;
    else if (data.priceVs50MA < 0.95) score -= 8;
  }

  if (data.priceVs200MA !== null) {
    if (data.priceVs200MA > 1.05) score += 5;
    else if (data.priceVs200MA < 0.9) score -= 10;
  }

  // Trend bonus
  if (data.trend === 'strong_up') score += 15;
  else if (data.trend === 'up') score += 8;
  else if (data.trend === 'strong_down') score -= 15;
  else if (data.trend === 'down') score -= 8;

  // Momentum-oriented styles get RSI bonus
  if (style === 'livermore' || style === 'soros') {
    if (data.rsi14 !== null && data.rsi14 >= 55 && data.rsi14 <= 75) score += 10;
  }

  return Math.max(0, Math.min(100, score));
}

function scoreSentiment(data: StockData): number {
  let score = 50;

  if (data.sentimentScore > 0.3) score += 20;
  else if (data.sentimentScore > 0.1) score += 10;
  else if (data.sentimentScore < -0.2) score -= 15;

  // Headline count bonus (more coverage = more interest)
  if (data.headlines.length > 5) score += 5;

  return Math.max(0, Math.min(100, score));
}

function scoreAnalyst(data: StockData, currentPrice: number): number {
  let score = 50;

  // Consensus
  if (data.analystConsensus === 'Strong Buy') score += 20;
  else if (data.analystConsensus === 'Buy') score += 12;
  else if (data.analystConsensus === 'Sell') score -= 15;

  // Upside potential
  if (data.targetMean && currentPrice > 0) {
    const upside = (data.targetMean - currentPrice) / currentPrice;
    if (upside > 0.2) score += 15;
    else if (upside > 0.1) score += 8;
    else if (upside < -0.1) score -= 10;
  }

  // Analyst coverage bonus
  if (data.analystCount > 15) score += 5;
  else if (data.analystCount < 3) score -= 5;

  // Institutional ownership
  if (data.institutionalOwnership !== null) {
    if (data.institutionalOwnership > 70) score += 8;
    else if (data.institutionalOwnership < 30) score -= 5;
  }

  // Short interest (high = bearish)
  if (data.shortInterest !== null && data.shortInterest > 10) score -= 10;

  return Math.max(0, Math.min(100, score));
}

function scoreStyleFit(
  data: StockData,
  style: string,
  riskTolerance: string
): number {
  let score = 50;

  switch (style) {
    case 'buffett':
      // Strong moat, consistent earnings, low debt
      if (data.pe !== null && data.pe < 20) score += 10;
      if (data.roe !== null && data.roe > 12) score += 10;
      if (data.debtToEquity !== null && data.debtToEquity < 0.5) score += 10;
      if (data.dividendYield !== null && data.dividendYield > 1.5) score += 8;
      if (data.profitMargin !== null && data.profitMargin > 15) score += 8;
      break;

    case 'lynch':
      // Growth at reasonable price
      if (data.pe !== null && data.epsGrowth !== null) {
        const peg = data.pe / Math.max(data.epsGrowth, 1);
        if (peg < 1.5) score += 20;
        else if (peg < 2.5) score += 10;
        else score -= 10;
      }
      if (data.revenueGrowth !== null && data.revenueGrowth > 10) score += 12;
      if (data.profitMargin !== null && data.profitMargin > 10) score += 8;
      break;

    case 'livermore':
      // Momentum and trend following
      if (data.trend === 'strong_up') score += 20;
      else if (data.trend === 'up') score += 12;
      else if (data.trend === 'down' || data.trend === 'strong_down') score -= 15;
      if (data.rsi14 !== null && data.rsi14 > 55) score += 10;
      if (data.change1d > 2) score += 8;
      break;

    case 'munger':
      // Quality at fair price
      if (data.roe !== null && data.roe > 15) score += 15;
      if (data.profitMargin !== null && data.profitMargin > 18) score += 10;
      if (data.debtToEquity !== null && data.debtToEquity < 0.6) score += 10;
      if (data.pe !== null && data.pe < 25) score += 8;
      break;

    case 'soros':
      // Macro themes, volatility, reflexivity
      if (data.change1d !== 0) score += Math.min(10, Math.abs(data.change1d) * 2);
      if (data.headlines.length > 5) score += 8;
      if (data.shortInterest !== null && data.shortInterest > 5) score += 5; // Contrarian
      break;
  }

  // Risk tolerance adjustment
  if (riskTolerance === 'aggressive') {
    if (data.change1d !== 0) score += Math.min(10, Math.abs(data.change1d));
    if (data.rsi14 !== null && (data.rsi14 < 35 || data.rsi14 > 70)) score += 5;
  } else if (riskTolerance === 'conservative') {
    if (data.dividendYield !== null && data.dividendYield > 2) score += 10;
    if (data.pe !== null && data.pe > 30) score -= 10;
  }

  return Math.max(0, Math.min(100, score));
}

// ─── Main Scoring Function ───────────────────────────────────

export async function scoreStock(
  symbol: string,
  investorStyle: string,
  riskTolerance: string
): Promise<StockScore | null> {
  const supabase = createServerClient() as any;

  try {
    // Check cache
    const { data: cached } = await supabase
      .from('stock_analysis_cache')
      .select('*')
      .eq('symbol', symbol)
      .single();

    const techFresh =
      cached?.technicals_expires_at &&
      new Date(cached.technicals_expires_at) > new Date();
    const fundFresh =
      cached?.fundamentals_expires_at &&
      new Date(cached.fundamentals_expires_at) > new Date();
    const analystFresh =
      cached?.analyst_expires_at &&
      new Date(cached.analyst_expires_at) > new Date();

    const finnhubKey = process.env.FINNHUB_API_KEY;

    // Parallel fetch only what needs refreshing
    const [quote, metrics, candleData, newsData, analystData] =
      await Promise.all([
        !techFresh && finnhubKey
          ? fetch(
              `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${finnhubKey}`
            )
              .then((r) => r.json())
              .catch(() => null)
          : Promise.resolve(null),
        !fundFresh && finnhubKey
          ? fetch(
              `https://finnhub.io/api/v1/stock/metric?symbol=${symbol}&metric=all&token=${finnhubKey}`
            )
              .then((r) => r.json())
              .catch(() => null)
          : Promise.resolve(null),
        !techFresh && finnhubKey
          ? fetch(
              `https://finnhub.io/api/v1/stock/candle?symbol=${symbol}&resolution=D&count=60&token=${finnhubKey}`
            )
              .then((r) => r.json())
              .catch(() => null)
          : Promise.resolve(null),
        !fundFresh && finnhubKey
          ? fetch(
              `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${new Date(
                Date.now() - 7 * 86400000
              )
                .toISOString()
                .split('T')[0]}&to=${new Date()
                .toISOString()
                .split('T')[0]}&token=${finnhubKey}`
            )
              .then((r) => r.json())
              .catch(() => null)
          : Promise.resolve(null),
        !analystFresh
          ? getAnalystData(symbol)
          : Promise.resolve(null),
      ]);

    // Calculate technicals from candles
    let rsi14: number | null = cached?.rsi_14 || null;
    let priceVs50MA: number | null = cached?.price_vs_50ma || null;
    let priceVs200MA: number | null = cached?.price_vs_200ma || null;
    let trend = cached?.trend || 'sideways';
    let support: number | null = cached?.support_level || null;
    let resistance: number | null = cached?.resistance_level || null;

    if (candleData?.c && candleData.c.length > 0) {
      const closes: number[] = candleData.c;
      rsi14 = calculateRSI(closes);
      const ma50 = calculateMA(closes, 50);
      const ma200 = calculateMA(closes, Math.min(200, closes.length));
      const currentPrice = closes[closes.length - 1];
      priceVs50MA = ma50 > 0 ? currentPrice / ma50 : null;
      priceVs200MA = ma200 > 0 ? currentPrice / ma200 : null;
      trend = determineTrend(currentPrice, ma50, ma200, rsi14);
      support = Math.min(...closes.slice(-20));
      resistance = Math.max(...closes.slice(-20));
    }

    // Get news sentiment via FinBERT
    const headlines = Array.isArray(newsData)
      ? newsData.slice(0, 10).map((n: any) => n.headline)
      : [];

    const sentiment =
      headlines.length > 0
        ? await getNewsSentiment(symbol, headlines)
        : {
            overall: (cached?.news_sentiment || 'neutral') as
              | 'positive'
              | 'neutral'
              | 'negative',
            score: cached?.news_sentiment_score || 0,
            headlines: [],
          };

    // Build stock data object
    const m = metrics?.metric || {};

    const stockData: StockData = {
      currentPrice: quote?.c || 0,
      change1d: quote?.dp || 0,
      pe: m['peNormalizedAnnual'] || m['peTTM'] || cached?.pe || null,
      epsGrowth:
        m['epsGrowth3Y'] ||
        m['epsGrowthTTMYoy'] ||
        cached?.eps_growth ||
        null,
      revenueGrowth:
        m['revenueGrowth3Y'] ||
        m['revenueGrowthTTMYoy'] ||
        cached?.revenue_growth ||
        null,
      profitMargin:
        m['netProfitMarginAnnual'] || cached?.profit_margin || null,
      roe: m['roeTTM'] || cached?.roe || null,
      debtToEquity:
        m['totalDebt/totalEquityAnnual'] ||
        cached?.debt_to_equity ||
        null,
      dividendYield:
        m['dividendYieldIndicatedAnnual'] ||
        cached?.dividend_yield ||
        null,
      priceToBook: m['pbAnnual'] || cached?.price_to_book || null,
      rsi14,
      priceVs50MA,
      priceVs200MA,
      trend,
      support,
      resistance,
      newsSentiment: sentiment.overall,
      sentimentScore: sentiment.score,
      headlines,
      analystConsensus: analystData?.consensus || null,
      analystCount: analystData?.analystCount || 0,
      targetMean: analystData?.targetMean || null,
      targetHigh: analystData?.targetHigh || null,
      targetLow: analystData?.targetLow || null,
      institutionalOwnership:
        analystData?.institutionalOwnership || null,
      shortInterest: analystData?.shortInterest || null,
    };

    // Use investor style (default: buffett)
    const style = investorStyle?.toLowerCase() || 'buffett';
    const weights = STYLE_WEIGHTS[style] || STYLE_WEIGHTS.buffett;

    // Score each dimension
    const fundamentalScore = scoreFundamental(stockData, style);
    const technicalScore = scoreTechnical(stockData, style);
    const sentimentScore = scoreSentiment(stockData);
    const analystScore = scoreAnalyst(stockData, stockData.currentPrice);
    const styleFitScore = scoreStyleFit(stockData, style, riskTolerance);

    // Weighted composite
    const compositeScore = Math.round(
      fundamentalScore * weights.fundamental +
        technicalScore * weights.technical +
        sentimentScore * weights.sentiment +
        analystScore * weights.analyst +
        styleFitScore * weights.styleFit
    );

    // Conviction level
    let conviction: 'high' | 'medium' | 'speculative' = 'medium';
    if (compositeScore >= 75) conviction = 'high';
    else if (compositeScore < 45) conviction = 'speculative';

    // Cache the analysis results
    await supabase
      .from('stock_analysis_cache')
      .upsert({
        symbol,
        rsi_14: rsi14,
        price_vs_50ma: priceVs50MA,
        price_vs_200ma: priceVs200MA,
        trend,
        support_level: support,
        resistance_level: resistance,
        pe: stockData.pe,
        eps_growth: stockData.epsGrowth,
        revenue_growth: stockData.revenueGrowth,
        profit_margin: stockData.profitMargin,
        roe: stockData.roe,
        debt_to_equity: stockData.debtToEquity,
        dividend_yield: stockData.dividendYield,
        price_to_book: stockData.priceToBook,
        news_sentiment: sentiment.overall,
        news_sentiment_score: sentiment.score,
        composite_score: compositeScore,
        fundamentals_expires_at: new Date(
          Date.now() + 6 * 3600000
        ).toISOString(),
        technicals_expires_at: new Date(
          Date.now() + 3600000
        ).toISOString(),
      });

    return {
      symbol,
      company: symbol, // Can be enriched from external lookup
      sector: '', // Set by caller
      compositeScore,
      fundamentalScore,
      technicalScore,
      sentimentScore,
      analystScore,
      styleFitScore,
      conviction,
      entryObservationLow: support,
      entryObservationHigh: resistance,
      data: stockData,
    };
  } catch (err) {
    console.error(`Stock scorer error ${symbol}:`, err);
    return null;
  }
}
