// ============================================================
// Decision Engine — generates per-style stock recommendations
// ============================================================

export interface StockData {
  symbol: string;
  currentPrice: number;
  entryPrice: number;
  // Fundamentals
  pe?: number;
  pb?: number; // Price-to-Book
  fcfYield?: number; // Free cash flow yield (%)
  revenueGrowth?: number; // YoY revenue growth (%)
  earningsGrowth?: number; // YoY earnings growth (%)
  payoutRatio?: number; // Dividend payout ratio (%)
  dividendYield?: number; // Dividend yield (%)
  dividendGrowth?: number; // Annual dividend growth (%)
  roe?: number; // Return on equity (%)
  roic?: number; // Return on invested capital (%)
  marketCap?: number; // In billions
  // Technicals
  price50ma?: number;
  price200ma?: number;
  rsi?: number; // RSI (0-100)
  macd?: number; // MACD value
  volume?: number; // Current volume
  avgVolume?: number; // Average volume
  week52High?: number;
  week52Low?: number;
  sector?: string;
}

export interface RecommendationResult {
  recommendation: 'BUY_MORE' | 'HOLD' | 'SELL';
  confidence: number; // 0-1
  reasoning: string;
  keyFactors: string[];
  risks: string[];
}

import type { InvestorStyle } from '@/types';

export type AllStylesResult = Record<InvestorStyle, RecommendationResult>;

// ─── HELPERS ────────────────────────────────────────────────

function clampConfidence(score: number, max: number): number {
  return Math.round(Math.min(Math.abs(score) / max, 1.0) * 100) / 100;
}

// ============================================================
// BUFFETT — VALUE HUNTER
// ============================================================

export function analyzeBuffett(stock: StockData): RecommendationResult {
  const factors: string[] = [];
  let score = 0;
  const maxScore = 100;

  // P/B < 1.5 excellent
  if (stock.pb !== undefined) {
    if (stock.pb < 1.5) {
      factors.push(`P/B ratio: ${stock.pb.toFixed(2)} (excellent value)`);
      score += 25;
    } else if (stock.pb < 2.0) {
      factors.push(`P/B ratio: ${stock.pb.toFixed(2)} (fair value)`);
      score += 15;
    } else {
      factors.push(`P/B ratio: ${stock.pb.toFixed(2)} (premium valuation)`);
      score -= 10;
    }
  }

  // FCF yield > 5%
  if (stock.fcfYield !== undefined) {
    if (stock.fcfYield > 5) {
      factors.push(`FCF yield: ${stock.fcfYield.toFixed(2)}% (strong cash generation)`);
      score += 25;
    } else if (stock.fcfYield > 3) {
      factors.push(`FCF yield: ${stock.fcfYield.toFixed(2)}% (solid cash flow)`);
      score += 15;
    } else {
      factors.push(`FCF yield: ${stock.fcfYield.toFixed(2)}% (weak cash generation)`);
      score -= 10;
    }
  }

  // Dividend: yielding + growing
  if (stock.dividendYield !== undefined && stock.dividendGrowth !== undefined) {
    if (stock.dividendYield > 2 && stock.dividendGrowth > 3) {
      factors.push(`Dividend: ${stock.dividendYield.toFixed(2)}% yield, ${stock.dividendGrowth.toFixed(1)}% growth`);
      score += 20;
    } else if (stock.dividendYield > 1.5) {
      factors.push(`Dividend: ${stock.dividendYield.toFixed(2)}% yield`);
      score += 10;
    }
  }

  // ROE > 12%
  if (stock.roe !== undefined && stock.roe > 12) {
    factors.push(`ROE: ${stock.roe.toFixed(1)}% (strong profitability)`);
    score += 15;
  }

  // P/E check (avoid >25)
  if (stock.pe !== undefined) {
    if (stock.pe > 25) {
      factors.push(`P/E: ${stock.pe.toFixed(1)} (premium valuation)`);
      score -= 15;
    } else if (stock.pe < 15) {
      factors.push(`P/E: ${stock.pe.toFixed(1)} (attractive valuation)`);
      score += 10;
    }
  }

  let recommendation: 'BUY_MORE' | 'HOLD' | 'SELL';
  let reasoning: string;

  if (score >= 70) {
    recommendation = 'BUY_MORE';
    reasoning = 'Quality business trading at attractive valuation. Characteristics align well with value investing principles.';
  } else if (score >= 40) {
    recommendation = 'HOLD';
    reasoning = 'Fair valuation and solid fundamentals. Hold current position; not an urgent buy.';
  } else {
    recommendation = 'SELL';
    reasoning = 'Either overvalued or lacking quality fundamentals. Consider trimming position.';
  }

  const risks: string[] = [];
  if (stock.pe && stock.pe > 20) risks.push('Valuation premium to market');
  if (stock.pb && stock.pb > 2) risks.push('Premium price-to-book ratio');
  if (stock.fcfYield && stock.fcfYield < 2) risks.push('Weak free cash flow generation');

  return { recommendation, confidence: clampConfidence(score, maxScore), reasoning, keyFactors: factors, risks };
}

// ============================================================
// LYNCH — GROWTH CHASER
// ============================================================

export function analyzeLynch(stock: StockData): RecommendationResult {
  const factors: string[] = [];
  let score = 0;
  const maxScore = 100;

  // Revenue growth > 15%
  if (stock.revenueGrowth !== undefined) {
    if (stock.revenueGrowth > 25) {
      factors.push(`Revenue growth: ${stock.revenueGrowth.toFixed(1)}% (excellent)`);
      score += 30;
    } else if (stock.revenueGrowth > 15) {
      factors.push(`Revenue growth: ${stock.revenueGrowth.toFixed(1)}% (solid)`);
      score += 20;
    } else if (stock.revenueGrowth > 5) {
      factors.push(`Revenue growth: ${stock.revenueGrowth.toFixed(1)}% (moderate)`);
      score += 10;
    } else {
      factors.push(`Revenue growth: ${stock.revenueGrowth.toFixed(1)}% (slowing)`);
      score -= 10;
    }
  }

  // P/E vs growth rate (PEG-like)
  if (stock.pe !== undefined && stock.revenueGrowth !== undefined) {
    const peToGrowth = stock.pe / stock.revenueGrowth;
    if (peToGrowth < 1.5) {
      factors.push(`P/E/Growth: ${peToGrowth.toFixed(2)} (undervalued relative to growth)`);
      score += 25;
    } else if (peToGrowth < 2.0) {
      factors.push(`P/E/Growth: ${peToGrowth.toFixed(2)} (fair value)`);
      score += 15;
    } else {
      factors.push(`P/E/Growth: ${peToGrowth.toFixed(2)} (overvalued relative to growth)`);
      score -= 15;
    }
  }

  // Market cap sweet spot < $100B
  if (stock.marketCap !== undefined) {
    if (stock.marketCap < 100) {
      factors.push(`Market cap: $${stock.marketCap.toFixed(0)}B (ideal size for growth)`);
      score += 10;
    } else if (stock.marketCap > 500) {
      factors.push(`Market cap: $${stock.marketCap.toFixed(0)}B (too mature)`);
      score -= 10;
    }
  }

  // Earnings growth > 10%
  if (stock.earningsGrowth !== undefined && stock.earningsGrowth > 10) {
    factors.push(`Earnings growth: ${stock.earningsGrowth.toFixed(1)}%`);
    score += 15;
  }

  let recommendation: 'BUY_MORE' | 'HOLD' | 'SELL';
  let reasoning: string;

  if (score >= 70) {
    recommendation = 'BUY_MORE';
    reasoning = 'Strong growth at reasonable valuation. Company in growth sweet spot.';
  } else if (score >= 40) {
    recommendation = 'HOLD';
    reasoning = 'Reasonable growth profile and valuation. Monitor for inflection points.';
  } else {
    recommendation = 'SELL';
    reasoning = 'Growth slowing or valuation stretched. Consider rotation to better opportunities.';
  }

  const risks: string[] = [];
  if (stock.revenueGrowth && stock.revenueGrowth < 10) risks.push('Growth rate slowing below target');
  if (stock.pe && stock.revenueGrowth && stock.pe > stock.revenueGrowth * 2) risks.push('P/E significantly above growth rate');
  if (stock.marketCap && stock.marketCap > 300) risks.push('Company becoming too large');

  return { recommendation, confidence: clampConfidence(score, maxScore), reasoning, keyFactors: factors, risks };
}

// ============================================================
// LIVERMORE — MOMENTUM RIDER
// ============================================================

export function analyzeLivermore(stock: StockData): RecommendationResult {
  const factors: string[] = [];
  let score = 0;
  const maxScore = 100;

  // Price vs 200-day MA (above = uptrend)
  if (stock.currentPrice !== undefined && stock.price200ma !== undefined) {
    const pctAbove = ((stock.currentPrice - stock.price200ma) / stock.price200ma) * 100;
    if (stock.currentPrice > stock.price200ma) {
      factors.push(`Price above 200-day MA: +${pctAbove.toFixed(1)}% (uptrend)`);
      score += 25;
    } else {
      factors.push(`Price below 200-day MA (downtrend)`);
      score -= 25;
    }
  }

  // Price vs 50-day MA (shorter trend confirmation)
  if (stock.currentPrice !== undefined && stock.price50ma !== undefined) {
    const pctAbove50 = ((stock.currentPrice - stock.price50ma) / stock.price50ma) * 100;
    if (stock.currentPrice > stock.price50ma) {
      factors.push(`Price above 50-day MA: +${pctAbove50.toFixed(1)}% (short-term bullish)`);
      score += 15;
    } else {
      score -= 10;
    }
  }

  // Proximity to 52-week high
  if (stock.currentPrice !== undefined && stock.week52High !== undefined) {
    const pctFromHigh = ((stock.week52High - stock.currentPrice) / stock.week52High) * 100;
    if (pctFromHigh < 5) {
      factors.push(`Near 52-week high: ${pctFromHigh.toFixed(1)}% away`);
      score += 20;
    } else if (pctFromHigh < 15) {
      factors.push(`Approaching 52-week high: ${pctFromHigh.toFixed(1)}% away`);
      score += 10;
    }
  }

  // Volume confirmation
  if (stock.volume !== undefined && stock.avgVolume !== undefined) {
    const volumeRatio = stock.volume / stock.avgVolume;
    if (volumeRatio > 1.5) {
      factors.push(`Volume spiking: ${volumeRatio.toFixed(2)}x average`);
      score += 20;
    } else if (volumeRatio < 0.7) {
      factors.push(`Volume declining: ${volumeRatio.toFixed(2)}x average`);
      score -= 15;
    }
  }

  // RSI (50-70 ideal momentum, avoid >80)
  if (stock.rsi !== undefined) {
    if (stock.rsi >= 50 && stock.rsi <= 70) {
      factors.push(`RSI: ${stock.rsi.toFixed(0)} (momentum building)`);
      score += 15;
    } else if (stock.rsi > 80) {
      factors.push(`RSI: ${stock.rsi.toFixed(0)} (overbought — exit signal)`);
      score -= 20;
    } else if (stock.rsi < 30) {
      factors.push(`RSI: ${stock.rsi.toFixed(0)} (oversold)`);
      score -= 10;
    }
  }

  // MACD confirmation
  if (stock.macd !== undefined) {
    if (stock.macd > 0) {
      factors.push(`MACD: positive (bullish momentum)`);
      score += 10;
    } else {
      factors.push(`MACD: negative (bearish momentum)`);
      score -= 10;
    }
  }

  let recommendation: 'BUY_MORE' | 'HOLD' | 'SELL';
  let reasoning: string;

  if (score >= 70) {
    recommendation = 'BUY_MORE';
    reasoning = 'Strong uptrend with volume confirmation. Momentum building across multiple timeframes.';
  } else if (score >= 30) {
    recommendation = 'HOLD';
    reasoning = 'Trend intact but not at ideal entry. Monitor for breakthrough or reversal.';
  } else {
    recommendation = 'SELL';
    reasoning = 'Trend breaking or momentum failing. Exit position.';
  }

  const risks: string[] = [];
  if (stock.rsi && stock.rsi > 75) risks.push('Overbought condition — pullback likely');
  if (stock.currentPrice && stock.price200ma && stock.currentPrice < stock.price200ma) risks.push('Price below key moving average');
  if (stock.volume && stock.avgVolume && stock.volume < stock.avgVolume * 0.8) risks.push('Volume declining — weak conviction');

  return { recommendation, confidence: clampConfidence(score, maxScore), reasoning, keyFactors: factors, risks };
}

// ============================================================
// SOROS — MACRO STRATEGIST
// ============================================================

export function analyzeSoros(stock: StockData): RecommendationResult {
  const factors: string[] = [];
  let score = 50; // Start neutral — macro context is external
  const maxScore = 100;

  // Sector matters for macro positioning
  if (stock.sector) {
    factors.push(`Sector: ${stock.sector}`);

    // Defensive sectors get mild favor (macro uncertainty hedge)
    const defensiveSectors = ['Utilities', 'Consumer Staples', 'Healthcare'];
    const cyclicalSectors = ['Technology', 'Consumer Discretionary', 'Financial Services', 'Industrials'];

    if (defensiveSectors.includes(stock.sector)) {
      factors.push('Defensive sector — resilient to macro shocks');
      score += 10;
    } else if (cyclicalSectors.includes(stock.sector)) {
      factors.push('Cyclical sector — sensitive to economic regime');
      score += 0; // Neutral — depends on actual macro backdrop
    }
  }

  // Growth rate indicates economic sensitivity
  if (stock.revenueGrowth !== undefined) {
    if (stock.revenueGrowth > 20) {
      factors.push(`Growth-oriented business (sensitive to expansion)`);
      score += 15; // Good in growth regimes
    } else if (stock.revenueGrowth < 5) {
      factors.push(`Defensive business (resistant to slowdown)`);
      score += 10; // Good in downturn
    }
  }

  // P/E context (macro: high P/E means vulnerable to rate changes)
  if (stock.pe !== undefined) {
    if (stock.pe > 30) {
      factors.push(`High P/E: ${stock.pe.toFixed(1)} (rate-sensitive)`);
      score -= 10; // Vulnerable when rates rise
    } else if (stock.pe < 12) {
      factors.push(`Low P/E: ${stock.pe.toFixed(1)} (value rotation candidate)`);
      score += 10;
    }
  }

  // Dividend yield — income stability in uncertain macro
  if (stock.dividendYield !== undefined && stock.dividendYield > 2.5) {
    factors.push(`Income stability: ${stock.dividendYield.toFixed(2)}% yield`);
    score += 10;
  }

  // Market cap — large caps safer in macro turbulence
  if (stock.marketCap !== undefined) {
    if (stock.marketCap > 200) {
      factors.push(`Large cap: $${stock.marketCap.toFixed(0)}B (macro stability)`);
      score += 10;
    } else if (stock.marketCap < 50 && stock.marketCap > 0) {
      factors.push(`Mid/small cap: $${stock.marketCap.toFixed(0)}B (higher beta to macro)`);
      score -= 5;
    }
  }

  // RSI context — entry timing in macro cycles
  if (stock.rsi !== undefined) {
    if (stock.rsi < 40) {
      factors.push(`RSI: ${stock.rsi.toFixed(0)} (oversold — contrarian entry)`);
      score += 10;
    } else if (stock.rsi > 75) {
      factors.push(`RSI: ${stock.rsi.toFixed(0)} (overbought — trim signal)`);
      score -= 10;
    }
  }

  let recommendation: 'BUY_MORE' | 'HOLD' | 'SELL';
  let reasoning: string;

  if (score >= 70) {
    recommendation = 'BUY_MORE';
    reasoning = 'Position benefits from current macro regime. Defensive characteristics or growth in expansion.';
  } else if (score >= 40) {
    recommendation = 'HOLD';
    reasoning = 'Mixed macro signals. Maintain exposure unless regime clearly shifts.';
  } else {
    recommendation = 'SELL';
    reasoning = 'Headwinds from macro regime. Consider reducing exposure to reposition for changing conditions.';
  }

  const risks: string[] = [];
  if (stock.pe && stock.pe > 28) risks.push('Vulnerable to rate hikes');
  if (stock.marketCap && stock.marketCap < 30 && stock.marketCap > 0) risks.push('Higher volatility in macro shifts');
  if (stock.sector && ['Technology', 'Consumer Discretionary'].includes(stock.sector)) risks.push('Cyclical sector — sensitive to Fed policy');

  return { recommendation, confidence: clampConfidence(score, maxScore), reasoning, keyFactors: factors, risks };
}

// ============================================================
// MUNGER — QUALITY COMPOUNDER
// ============================================================

export function analyzeMunger(stock: StockData): RecommendationResult {
  const factors: string[] = [];
  let score = 0;
  const maxScore = 100;

  // ROIC — quality metric (Munger's favorite)
  if (stock.roic !== undefined) {
    if (stock.roic > 15) {
      factors.push(`ROIC: ${stock.roic.toFixed(1)}% (exceptional capital efficiency)`);
      score += 30;
    } else if (stock.roic > 10) {
      factors.push(`ROIC: ${stock.roic.toFixed(1)}% (solid capital returns)`);
      score += 20;
    } else if (stock.roic > 5) {
      factors.push(`ROIC: ${stock.roic.toFixed(1)}% (adequate)`);
      score += 5;
    } else {
      factors.push(`ROIC: ${stock.roic.toFixed(1)}% (below cost of capital)`);
      score -= 15;
    }
  }

  // ROE as secondary quality check
  if (stock.roe !== undefined && stock.roe > 12) {
    factors.push(`ROE: ${stock.roe.toFixed(1)}% (strong returns)`);
    score += 15;
  }

  // Earnings growth consistency (5-7% annual sustained)
  if (stock.earningsGrowth !== undefined) {
    if (stock.earningsGrowth >= 5 && stock.earningsGrowth <= 15) {
      factors.push(`Earnings growth: ${stock.earningsGrowth.toFixed(1)}% (consistent, sustainable)`);
      score += 20;
    } else if (stock.earningsGrowth > 15) {
      factors.push(`Earnings growth: ${stock.earningsGrowth.toFixed(1)}% (aggressive — sustainability risk)`);
      score += 5;
    } else {
      factors.push(`Earnings growth: ${stock.earningsGrowth.toFixed(1)}% (stagnating)`);
      score -= 10;
    }
  }

  // Dividend growth (5-7% annually = compounding machine)
  if (stock.dividendGrowth !== undefined) {
    if (stock.dividendGrowth >= 5 && stock.dividendGrowth <= 10) {
      factors.push(`Dividend growth: ${stock.dividendGrowth.toFixed(1)}%/yr (compounding reliably)`);
      score += 20;
    } else if (stock.dividendGrowth > 10) {
      factors.push(`Dividend growth: ${stock.dividendGrowth.toFixed(1)}%/yr (aggressive — may not sustain)`);
      score += 5;
    }
  }

  // P/E discipline — don't overpay
  if (stock.pe !== undefined) {
    if (stock.pe > 30) {
      factors.push(`P/E: ${stock.pe.toFixed(1)} (expensive — wait for better entry)`);
      score -= 20;
    } else if (stock.pe < 18) {
      factors.push(`P/E: ${stock.pe.toFixed(1)} (reasonable entry)`);
      score += 10;
    }
  }

  // FCF yield — real cash generation matters
  if (stock.fcfYield !== undefined) {
    if (stock.fcfYield > 4) {
      factors.push(`FCF yield: ${stock.fcfYield.toFixed(2)}% (strong cash compounder)`);
      score += 15;
    } else if (stock.fcfYield < 1) {
      factors.push(`FCF yield: ${stock.fcfYield.toFixed(2)}% (weak — low margin of safety)`);
      score -= 10;
    }
  }

  let recommendation: 'BUY_MORE' | 'HOLD' | 'SELL';
  let reasoning: string;

  if (score >= 70) {
    recommendation = 'BUY_MORE';
    reasoning = 'High-quality compounder with durable competitive advantages. Excellent capital allocation.';
  } else if (score >= 40) {
    recommendation = 'HOLD';
    reasoning = 'Decent quality business. Hold and let compounding work; look for better entries on dips.';
  } else {
    recommendation = 'SELL';
    reasoning = 'Lacks the quality characteristics of a long-term compounder. Better capital allocation opportunities exist.';
  }

  const risks: string[] = [];
  if (stock.roic !== undefined && stock.roic < 7) risks.push('Returns near or below cost of capital');
  if (stock.pe !== undefined && stock.pe > 30) risks.push('Significant overvaluation');
  if (stock.dividendGrowth !== undefined && stock.dividendGrowth < 3) risks.push('Dividend not growing — weak compounding signal');

  return { recommendation, confidence: clampConfidence(score, maxScore), reasoning, keyFactors: factors, risks };
}

// ============================================================
// COMBINED — run all 5 styles
// ============================================================

export function analyzeAllStyles(stock: StockData): AllStylesResult {
  return {
    buffett: analyzeBuffett(stock),
    lynch: analyzeLynch(stock),
    livermore: analyzeLivermore(stock),
    soros: analyzeSoros(stock),
    munger: analyzeMunger(stock),
  };
}
