// ─── External Data Sources ────────────────────────────────────
// Yahoo Finance (analyst data, price targets) and FinBERT (news sentiment).
// Uses stock_analysis_cache table for aggressive caching.
// Server-side only — uses createServerClient for Supabase access.

import { createServerClient } from '@/lib/supabase';

// ─── Interfaces ──────────────────────────────────────────────

export interface AnalystData {
  consensus: string;
  analystCount: number;
  targetMean: number;
  targetLow: number;
  targetHigh: number;
  institutionalOwnership: number;
  shortInterest: number;
}

export interface SentimentResult {
  overall: 'positive' | 'neutral' | 'negative';
  score: number; // -1 to 1
  headlines: string[];
}

// ─── Yahoo Finance (Analyst Data) ────────────────────────────

export async function getAnalystData(
  symbol: string
): Promise<AnalystData | null> {
  const supabase = createServerClient() as any;

  // Check cache first (24hr TTL)
  const { data: cached } = await supabase
    .from('stock_analysis_cache')
    .select(
      'analyst_consensus, analyst_count, ' +
        'price_target_mean, price_target_low, ' +
        'price_target_high, institutional_ownership, ' +
        'short_interest, analyst_expires_at'
    )
    .eq('symbol', symbol)
    .single();

  if (
    cached?.analyst_expires_at &&
    new Date(cached.analyst_expires_at) > new Date() &&
    cached.analyst_consensus
  ) {
    return {
      consensus: cached.analyst_consensus,
      analystCount: cached.analyst_count || 0,
      targetMean: cached.price_target_mean || 0,
      targetLow: cached.price_target_low || 0,
      targetHigh: cached.price_target_high || 0,
      institutionalOwnership: cached.institutional_ownership || 0,
      shortInterest: cached.short_interest || 0,
    };
  }

  try {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=recommendationTrend,financialData,defaultKeyStatistics`;

    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!response.ok) {
      console.warn(`Yahoo Finance ${symbol}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const result = data?.quoteSummary?.result?.[0];
    if (!result) return null;

    const trend = result.recommendationTrend?.trend?.[0];
    const financial = result.financialData;
    const keyStats = result.defaultKeyStatistics;

    // Calculate consensus from analyst breakdown
    const strongBuy = trend?.strongBuy || 0;
    const buy = trend?.buy || 0;
    const hold = trend?.hold || 0;
    const sell = trend?.sell || 0;
    const strongSell = trend?.strongSell || 0;
    const total = strongBuy + buy + hold + sell + strongSell;

    let consensus = 'Hold';
    if (total > 0) {
      const score =
        (strongBuy * 5 +
          buy * 4 +
          hold * 3 +
          sell * 2 +
          strongSell) /
        total;
      if (score >= 4.5) consensus = 'Strong Buy';
      else if (score >= 3.5) consensus = 'Buy';
      else if (score >= 2.5) consensus = 'Hold';
      else consensus = 'Sell';
    }

    const analystData: AnalystData = {
      consensus,
      analystCount: total,
      targetMean: financial?.targetMeanPrice?.raw || 0,
      targetLow: financial?.targetLowPrice?.raw || 0,
      targetHigh: financial?.targetHighPrice?.raw || 0,
      institutionalOwnership:
        keyStats?.heldPercentInstitutions?.raw || 0,
      shortInterest: keyStats?.shortPercentOfFloat?.raw || 0,
    };

    // Cache for 24 hours
    await supabase
      .from('stock_analysis_cache')
      .upsert({
        symbol,
        analyst_consensus: analystData.consensus,
        analyst_count: analystData.analystCount,
        price_target_mean: analystData.targetMean,
        price_target_low: analystData.targetLow,
        price_target_high: analystData.targetHigh,
        institutional_ownership: analystData.institutionalOwnership,
        short_interest: analystData.shortInterest,
        analyst_expires_at: new Date(
          Date.now() + 24 * 3600000
        ).toISOString(),
      });

    return analystData;
  } catch (err) {
    console.error(`Yahoo Finance error ${symbol}:`, err);
    return null;
  }
}

// ─── FinBERT Sentiment ───────────────────────────────────────

export async function getNewsSentiment(
  symbol: string,
  headlines: string[]
): Promise<SentimentResult> {
  if (!headlines.length) {
    return { overall: 'neutral', score: 0, headlines: [] };
  }

  const supabase = createServerClient() as any;

  // Check cache first (1hr TTL)
  const { data: cached } = await supabase
    .from('stock_analysis_cache')
    .select(
      'news_sentiment, news_sentiment_score, ' +
        'technicals_expires_at'
    )
    .eq('symbol', symbol)
    .single();

  if (
    cached?.technicals_expires_at &&
    new Date(cached.technicals_expires_at) > new Date() &&
    cached.news_sentiment
  ) {
    return {
      overall: cached.news_sentiment as
        | 'positive'
        | 'neutral'
        | 'negative',
      score: cached.news_sentiment_score || 0,
      headlines,
    };
  }

  try {
    const response = await fetch(
      'https://api-inference.huggingface.co/models/ProsusAI/finbert',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: headlines.slice(0, 5).join(' [SEP] '),
        }),
      }
    );

    if (!response.ok) {
      console.warn(`FinBERT ${symbol}: ${response.status}`);
      return { overall: 'neutral', score: 0, headlines };
    }

    const results = await response.json();

    let positiveScore = 0;
    let negativeScore = 0;

    // FinBERT returns array of [{label, score}]
    if (Array.isArray(results) && Array.isArray(results[0])) {
      results[0].forEach(
        (item: { label: string; score: number }) => {
          if (item.label === 'positive') positiveScore = item.score;
          if (item.label === 'negative') negativeScore = item.score;
        }
      );
    }

    const netScore = positiveScore - negativeScore;
    const overall =
      netScore > 0.1
        ? 'positive'
        : netScore < -0.1
          ? 'negative'
          : 'neutral';

    // Cache for 1 hour
    await supabase
      .from('stock_analysis_cache')
      .upsert({
        symbol,
        news_sentiment: overall,
        news_sentiment_score: netScore,
        recent_headlines: headlines.slice(0, 5),
        technicals_expires_at: new Date(
          Date.now() + 3600000
        ).toISOString(),
      });

    return { overall, score: netScore, headlines };
  } catch (err) {
    console.error('FinBERT error:', err);
    return { overall: 'neutral', score: 0, headlines };
  }
}
