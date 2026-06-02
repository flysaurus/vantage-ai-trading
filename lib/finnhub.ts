// ─── Finnhub API Client ───────────────────────────────────────
// Wraps Finnhub.io REST API calls (free tier: 60 req/min).
// API key from FINNHUB_IO_API_KEY env var.

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

function getToken(): string {
  const key = process.env.FINNHUB_IO_API_KEY;
  if (!key) throw new Error('FINNHUB_IO_API_KEY not configured');
  return key;
}

export interface FinnhubProfile {
  ticker: string;
  name: string;
  finnhubIndustry: string;
  marketCapitalization: number | null;
  exchange: string;
  logo: string;
  country: string;
  currency: string;
  ipo: string;
  phone: string;
  weburl: string;
  shareOutstanding: number | null;
}

/**
 * Fetch company profile from Finnhub.
 * Free tier: 60 calls/min. Returns null on error/not found.
 */
export async function getCompanyProfile(symbol: string): Promise<FinnhubProfile | null> {
  const token = getToken();
  try {
    const res = await fetch(
      `${FINNHUB_BASE}/stock/profile2?symbol=${encodeURIComponent(symbol.toUpperCase())}&token=${token}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    // Finnhub returns empty object or no ticker on unknown symbols
    if (!data || !data.ticker) return null;
    return {
      ticker: data.ticker,
      name: data.name || '',
      finnhubIndustry: data.finnhubIndustry || '',
      marketCapitalization: data.marketCapitalization != null ? data.marketCapitalization * 1e6 : null,
      exchange: data.exchange || '',
      logo: data.logo || '',
      country: data.country || '',
      currency: data.currency || '',
      ipo: data.ipo || '',
      phone: data.phone || '',
      weburl: data.weburl || '',
      shareOutstanding: data.shareOutstanding != null ? data.shareOutstanding * 1e6 : null,
    };
  } catch {
    return null;
  }
}

/**
 * Map Finnhub's finnhubIndustry string to our 12-sector classification.
 * Finnhub uses GICS-based industry names.
 */
export function finnhubIndustryToSector(finnhubIndustry: string): string | null {
  // Normalize
  const fi = finnhubIndustry.trim();

  // ETF detection
  if (fi === 'N/A' || fi === 'ETF' || fi === '' || fi.toLowerCase().includes('exchange traded')) return 'ETF';

  // Direct GICS sector matches
  if (fi === 'Technology' || fi.includes('Software') || fi.includes('Semiconductor') || fi.includes('IT Services')) return 'Technology';
  if (fi === 'Financial Services' || fi.includes('Bank') || fi.includes('Insurance') || fi.includes('Capital Markets') || fi.includes('Mortgage')) return 'Financial Services';
  if (fi === 'Healthcare' || fi.includes('Biotech') || fi.includes('Pharma') || fi.includes('Medical') || fi.includes('Drug')) return 'Healthcare';
  if (fi === 'Consumer Cyclical' || fi.includes('Retail') || fi.includes('Auto') || fi.includes('Restaurant') || fi.includes('Leisure') || fi.includes('Apparel') || fi.includes('Lodging')) return 'Consumer';
  if (fi === 'Consumer Defensive' || fi.includes('Beverage') || fi.includes('Food') || fi.includes('Tobacco') || fi.includes('Household')) return 'Consumer';
  if (fi === 'Industrials' || fi.includes('Industrial') || fi.includes('Aerospace') || fi.includes('Rail') || fi.includes('Machinery') || fi.includes('Construction') || fi.includes('Logistics') || fi.includes('Freight')) return 'Industrials';
  if (fi === 'Energy' || fi.includes('Oil') || fi.includes('Gas') || fi.includes('Coal')) return 'Energy';
  if (fi === 'Utilities' || fi.includes('Water') || fi.includes('Power')) return 'Utilities';
  if (fi === 'Real Estate' || fi.includes('REIT') || fi.includes('Realty')) return 'Real Estate';
  if (fi === 'Basic Materials' || fi.includes('Chemical') || fi.includes('Metal') || fi.includes('Mining') || fi.includes('Steel') || fi.includes('Gold') || fi.includes('Copper') || fi.includes('Lumber')) return 'Materials';
  if (fi === 'Communication Services' || fi.includes('Telecom') || fi.includes('Media') || fi.includes('Entertainment') || fi.includes('Publishing') || fi.includes('Advertising')) return 'Media & Entertainment';

  return null;
}

// ─── Finnhub News ─────────────────────────────────────────────

export interface FinnhubNewsItem {
  category: string;
  datetime: number;
  headline: string;
  id: number;
  image: string;
  related: string;
  source: string;
  summary: string;
  url: string;
}

/**
 * Fetch company news for a symbol (last 7 days, up to 10 articles).
 * Free tier: included in 60 req/min.
 */
export async function getCompanyNews(symbol: string, fromDate?: string, toDate?: string): Promise<FinnhubNewsItem[]> {
  const token = getToken();
  const from = fromDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const to = toDate || new Date().toISOString().slice(0, 10);
  try {
    const res = await fetch(
      `${FINNHUB_BASE}/company-news?symbol=${encodeURIComponent(symbol.toUpperCase())}&from=${from}&to=${to}&token=${token}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.slice(0, 10);
  } catch {
    return [];
  }
}

// ─── Finnhub Financial Metrics ────────────────────────────────

export interface FinnhubMetrics {
  pe: number | null;
  epsGrowthTTM: number | null;
  revenueGrowthTTM: number | null;
  revenueGrowth3Y: number | null;
  grossMargin: number | null;
  netProfitMargin: number | null;
  roe: number | null;
  roa: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  priceToBook: number | null;
  dividendYield: number | null;
  beta: number | null;
  marketCap: number | null;
}

/**
 * Fetch detailed financial metrics from Finnhub.
 * Maps the flat `metric` object into our typed interface.
 */
export async function getFinancialMetrics(symbol: string): Promise<FinnhubMetrics | null> {
  const token = getToken();
  try {
    const res = await fetch(
      `${FINNHUB_BASE}/stock/metric?symbol=${encodeURIComponent(symbol.toUpperCase())}&metric=all&token=${token}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const m = data?.metric;
    if (!m) return null;
    return {
      pe: m.peBasicExclExtraTTM ?? m.peTTM ?? null,
      epsGrowthTTM: m.epsGrowthTTMYoy ?? null,
      revenueGrowthTTM: m.revenueGrowthTTMYoy ?? null,
      revenueGrowth3Y: m.revenueGrowth3Y ?? null,
      grossMargin: m.grossMarginTTM ?? null,
      netProfitMargin: m.netProfitMarginTTM ?? m.netProfitMarginAnnual ?? null,
      roe: m.roeTTM ?? m.roeAnnual ?? null,
      roa: m.roaTTM ?? m.roaAnnual ?? null,
      debtToEquity: m.totalDebtTotalEquityAnnual ?? m.totalDebtTotalEquityQuarterly ?? null,
      currentRatio: m.currentRatioAnnual ?? m.currentRatioQuarterly ?? null,
      priceToBook: m.pbAnnual ?? m.pbQuarterly ?? null,
      dividendYield: m.dividendYieldIndicatedAnnual ?? null,
      beta: m.beta ?? null,
      marketCap: m.marketCapitalization != null ? m.marketCapitalization * 1e6 : null,
    };
  } catch {
    return null;
  }
}

// ─── Finnhub Earnings ─────────────────────────────────────────

export interface FinnhubEarnings {
  period: string;
  actual: number | null;
  estimate: number | null;
  surprise: number | null;
  surprisePercent: number | null;
}

/**
 * Fetch recent earnings surprises (last 4 quarters).
 */
export async function getEarningsSurprises(symbol: string): Promise<FinnhubEarnings[]> {
  const token = getToken();
  try {
    const res = await fetch(
      `${FINNHUB_BASE}/stock/earnings?symbol=${encodeURIComponent(symbol.toUpperCase())}&token=${token}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.slice(0, 4).map((e: any) => ({
      period: e.period || '',
      actual: e.actual ?? null,
      estimate: e.estimate ?? null,
      surprise: e.surprise ?? null,
      surprisePercent: e.surprisePercent ?? null,
    }));
  } catch {
    return [];
  }
}

// ─── Finnhub Recommendation Trends ────────────────────────────

export interface FinnhubRecommendation {
  period: string;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
}

/**
 * Fetch analyst recommendation trends.
 */
export async function getRecommendationTrends(symbol: string): Promise<FinnhubRecommendation[]> {
  const token = getToken();
  try {
    const res = await fetch(
      `${FINNHUB_BASE}/stock/recommendation?symbol=${encodeURIComponent(symbol.toUpperCase())}&token=${token}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.slice(0, 4);
  } catch {
    return [];
  }
}

// ─── Finnhub Price Target ─────────────────────────────────────

export interface FinnhubPriceTarget {
  symbol: string;
  targetHigh: number | null;
  targetLow: number | null;
  targetMean: number | null;
  targetMedian: number | null;
  lastUpdated: string;
}

/**
 * Fetch analyst price targets.
 */
export async function getPriceTarget(symbol: string): Promise<FinnhubPriceTarget | null> {
  const token = getToken();
  try {
    const res = await fetch(
      `${FINNHUB_BASE}/stock/price-target?symbol=${encodeURIComponent(symbol.toUpperCase())}&token=${token}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data) return null;
    return {
      symbol: data.symbol || symbol.toUpperCase(),
      targetHigh: data.targetHigh ?? null,
      targetLow: data.targetLow ?? null,
      targetMean: data.targetMean ?? null,
      targetMedian: data.targetMedian ?? null,
      lastUpdated: data.lastUpdated || '',
    };
  } catch {
    return null;
  }
}
