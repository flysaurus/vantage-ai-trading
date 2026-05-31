// ─── AI Context Builder ────────────────────────────────────────
// Builds a rich, cached data context for every AI call.
// Grounds the AI in real portfolio + market data — no hallucination.
//
// Cache: Supabase market_cache table, key "ai-context:{userId}", 5-min TTL.
// Server-side only — uses process.env keys for Alpaca, Finnhub, Supabase.

import { createServerClient } from '@/lib/supabase';
import { getBrokerContext, makeAlpacaRequest } from '@/lib/broker-service';
import { getConnectionStatus } from '@/lib/vault';
import { getDemoAccount } from '@/lib/demo-data';
import {
  getQuote,
  getCompanyProfile,
  getFundamentals,
  getCandles,
} from '@/lib/market-data';
import type { Quote, CompanyProfile, FundamentalMetrics, Candle } from '@/lib/market-data';
import { industryToSector } from '@/lib/sectors';

// ─── Public Interfaces ───────────────────────────────────────

export interface PortfolioContext {
  totalValue: number;
  buyingPower: number;
  cash: number;
  todayPnL: number;
  todayPnLPercent: number;
  totalPnL: number;
  totalPnLPercent: number;
  positions: PositionContext[];
  sectorBreakdown: SectorBreakdown[];
  topHolding: string;
  topHoldingPercent: number;
  concentrationRisk: boolean; // any position > 15%
  sectorRisk: boolean; // any sector > 40%
}

export interface PositionContext {
  symbol: string;
  companyName: string;
  sector: string;
  shares: number;
  currentPrice: number;
  marketValue: number;
  portfolioPercent: number;
  costBasis: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  pe: number | null;
  eps: number | null;
  week52High: number;
  week52Low: number;
  percentFrom52High: number;
  recentTrend: 'up' | 'down' | 'sideways';
  newsSentiment: 'positive' | 'negative' | 'neutral';
  upcomingEarnings: string | null;
}

export interface SectorBreakdown {
  sector: string;
  percent: number;
  value: number;
  aboveLimit: boolean;
}

export interface MarketContext {
  date: string;
  marketStatus: 'open' | 'closed';
  recentNews: Array<{ headline: string; sentiment: string }>;
  spyChange: number | null;
  qqqChange: number | null;
}

export interface TaxContext {
  ytdRealizedGains: number;
  ytdRealizedLosses: number;
  netPosition: number;
  harvestablePositions: Array<{
    symbol: string;
    unrealizedLoss: number;
    estimatedTaxSaving: number;
    washSaleSafe: boolean;
  }>;
  taxYear: number;
}

export interface AIContext {
  portfolio: PortfolioContext;
  market: MarketContext;
  tax: TaxContext;
  investorStyle: string;
  isDemo: boolean;
  savedTargetAllocations: Array<{ symbol: string; targetPercent: number }> | null;
  timestamp: string;
}

// ─── Constants ───────────────────────────────────────────────

const FINNHUB_BASE = 'https://finnhub.io/api/v1';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_VERSION = 3; // bump to invalidate stale caches on deploy
const POSITION_CONCENTRATION_LIMIT = 0.15; // 15%
const SECTOR_CONCENTRATION_LIMIT = 0.40; // 40%
const TREND_THRESHOLD = 0.02; // 2%
const EARNINGS_LOOKAHEAD_DAYS = 30;
const ESTIMATED_TAX_RATE = 0.24; // 24% marginal rate
const MAX_NEWS_ITEMS = 5;
const TIMEOUT_MS = 8000;

// ─── Helpers ─────────────────────────────────────────────────

function finnhubKey(): string | null {
  return process.env.FINNHUB_IO_API_KEY || null;
}

/** Get NY market status: open = Mon-Fri 9:30 AM – 4:00 PM ET. */
function getMarketStatus(): 'open' | 'closed' {
  try {
    const now = new Date();
    // Format in ET timezone
    const etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
    const etDate = new Date(etStr);
    const day = etDate.getDay();
    const hours = etDate.getHours();
    const minutes = etDate.getMinutes();

    if (day === 0 || day === 6) return 'closed';

    const totalMinutes = hours * 60 + minutes;
    if (totalMinutes >= 9 * 60 + 30 && totalMinutes < 16 * 60) {
      return 'open';
    }
    return 'closed';
  } catch {
    // Fallback: assume closed
    return 'closed';
  }
}

/** Sentiment classification by simple keyword matching. */
function keywordSentiment(text: string): 'positive' | 'negative' | 'neutral' {
  const lower = text.toLowerCase();
  const positiveWords = [
    'beat', 'surge', 'surged', 'rally', 'bull', 'bullish', 'upgrade', 'upgraded',
    'outperform', 'strong', 'growth', 'profit', 'record', 'gain', 'gains', 'boost',
    'raised', 'rise', 'rises', 'rising', 'jump', 'jumped', 'soar', 'soared',
  ];
  const negativeWords = [
    'miss', 'missed', 'plunge', 'plunged', 'crash', 'crashed', 'bear', 'bearish',
    'downgrade', 'downgraded', 'underperform', 'weak', 'decline', 'declines',
    'loss', 'losses', 'cut', 'cuts', 'fall', 'fell', 'fallen', 'drop', 'dropped',
    'warn', 'warning', 'layoff', 'layoffs', 'probe', 'investigation', 'lawsuit',
    'fine', 'penalty', 'debt', 'bankruptcy',
  ];

  let posScore = 0;
  let negScore = 0;

  for (const w of positiveWords) {
    if (lower.includes(w)) posScore++;
  }
  for (const w of negativeWords) {
    if (lower.includes(w)) negScore++;
  }

  if (posScore > negScore) return 'positive';
  if (negScore > posScore) return 'negative';
  return 'neutral';
}

/** Determine 4-week trend from daily candles. */
function computeTrend(candles: Candle[]): 'up' | 'down' | 'sideways' {
  if (candles.length < 10) return 'sideways';

  // Latest close vs close from ~2 weeks ago
  const latest = candles[candles.length - 1].close;
  const midPoint = candles[Math.max(0, candles.length - 10)].close;

  if (midPoint === 0) return 'sideways';

  const pctChange = (latest - midPoint) / midPoint;

  if (pctChange > TREND_THRESHOLD) return 'up';
  if (pctChange < -TREND_THRESHOLD) return 'down';
  return 'sideways';
}

/**
 * Fetch recent market news from Finnhub.
 * Returns empty array on failure.
 */
async function fetchNews(): Promise<Array<{ headline: string; sentiment: string }>> {
  const key = finnhubKey();
  if (!key) return [];

  try {
    const res = await fetch(
      `${FINNHUB_BASE}/news?category=general&token=${key}`,
      { signal: AbortSignal.timeout(TIMEOUT_MS) }
    );
    if (!res.ok) return [];
    const data: Array<{ headline: string; summary: string; datetime: number; category: string }> = await res.json();
    if (!Array.isArray(data)) return [];

    return data.slice(0, MAX_NEWS_ITEMS).map((item) => ({
      headline: item.headline || '',
      sentiment: keywordSentiment((item.headline || '') + ' ' + (item.summary || '')),
    }));
  } catch {
    return [];
  }
}

/**
 * Fetch upcoming earnings for symbols within the next N days from Finnhub.
 * Returns a map of symbol → nearest earnings date string.
 */
async function fetchUpcomingEarnings(
  symbols: string[],
  timeoutMs = TIMEOUT_MS
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  const key = finnhubKey();
  if (!key || symbols.length === 0) return results;

  const now = new Date();
  const from = now.toISOString().split('T')[0];
  const toDate = new Date(now.getTime() + EARNINGS_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
  const to = toDate.toISOString().split('T')[0];

  try {
    const res = await fetch(
      `${FINNHUB_BASE}/calendar/earnings?from=${from}&to=${to}&token=${key}`,
      { signal: AbortSignal.timeout(timeoutMs) }
    );
    if (!res.ok) return results;

    const data = await res.json();
    const events = data?.earningsCalendar || [];
    const symbolSet = new Set(symbols.map((s) => s.toUpperCase()));

    for (const event of events) {
      if (symbolSet.has(event.symbol?.toUpperCase()) && event.date) {
        if (!results.has(event.symbol.toUpperCase())) {
          results.set(event.symbol.toUpperCase(), event.date);
        }
      }
    }
  } catch {
    // swallow
  }

  return results;
}

/** Format a dollar number. */
function fmtDollar(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

// ═══════════════════════════════════════════════════════════════
// CACHE LAYER
// ═══════════════════════════════════════════════════════════════

async function getCachedContext(userId: string): Promise<AIContext | null> {
  try {
    const supabase = createServerClient();
    const cacheKey = `ai-context:v${CACHE_VERSION}:${userId}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('market_cache')
      .select('data, expires_at')
      .eq('symbol', cacheKey)
      .single();

    if (error || !data) return null;

    const expires = new Date(data.expires_at as string).getTime();
    if (Date.now() > expires) return null;

    return data.data as AIContext;
  } catch {
    return null;
  }
}

async function setCachedContext(userId: string, context: AIContext): Promise<void> {
  try {
    const supabase = createServerClient();
    const cacheKey = `ai-context:v${CACHE_VERSION}:${userId}`;
    const expiresAt = new Date(Date.now() + CACHE_TTL_MS).toISOString();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('market_cache')
      .upsert(
        {
          symbol: cacheKey,
          data: context as unknown as Record<string, unknown>,
          cached_at: new Date().toISOString(),
          expires_at: expiresAt,
        },
        { onConflict: 'symbol' }
      );
  } catch {
    // Cache write failure is non-critical
  }
}

// ═══════════════════════════════════════════════════════════════
// PORTFOLIO CONTEXT
// ═══════════════════════════════════════════════════════════════

/**
 * Build portfolio context from Vantage demo data + live market prices.
 * This matches exactly what the user sees in the app when no broker is connected.
 */
async function buildDemoPortfolioContext(userId: string): Promise<PortfolioContext> {
  const emptyPortfolio: PortfolioContext = {
    totalValue: 0, buyingPower: 0, cash: 0,
    todayPnL: 0, todayPnLPercent: 0, totalPnL: 0, totalPnLPercent: 0,
    positions: [], sectorBreakdown: [], topHolding: '', topHoldingPercent: 0,
    concentrationRisk: false, sectorRisk: false,
  };

  try {
    // Get user's investor style
    const supabase = createServerClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: userData } = await (supabase as any)
      .from('users')
      .select('investor_style')
      .eq('id', userId)
      .single();
    const style = (userData?.investor_style || 'buffett') as import('@/types').InvestorStyle;

    // Get demo position symbols and fetch live market prices
    const { getDemoSymbols } = await import('@/lib/demo-data');
    const symbols = getDemoSymbols(style);
    if (symbols.length === 0) return emptyPortfolio;

    // Fetch live quotes for all demo symbols
    const quoteResults = await Promise.all(
      symbols.map((s) => getQuote(s).catch(() => null))
    );

    // Build price map for getDemoAccount
    const prices: Record<string, { price: number; change: number; changePercent: number; previousClose: number }> = {};
    for (let i = 0; i < symbols.length; i++) {
      const q = quoteResults[i];
      if (q) {
        prices[symbols[i]] = {
          price: q.price,
          change: q.changePercent ? q.price * q.changePercent / 100 : 0,
          changePercent: q.changePercent || 0,
          previousClose: q.price - (q.changePercent ? q.price * q.changePercent / 100 : 0),
        };
      }
    }

    // Build demo account using the same function the frontend uses
    const demoAccount = getDemoAccount(style, prices);
    if (!demoAccount || demoAccount.positions.length === 0) return emptyPortfolio;

    const totalValue = demoAccount.equity;
    const symbolsAll = demoAccount.positions.map((p) => p.symbol.toUpperCase());
    console.log('[AIContext] Demo portfolio built:', symbolsAll.length, 'positions:', symbolsAll.join(', '), 'value:', totalValue);

    // Fetch enrichment data in parallel (same as real portfolio path)
    const [earningsMap, profiles, fundamentalsArr, candlesArr] = await Promise.all([
      fetchUpcomingEarnings(symbolsAll).catch(() => new Map<string, string>()),
      Promise.all(symbolsAll.map((s) => getCompanyProfile(s).catch(() => null))).catch(() => [] as (CompanyProfile | null)[]),
      Promise.all(symbolsAll.map((s) => getFundamentals(s).catch(() => null))).catch(() => [] as (FundamentalMetrics | null)[]),
      Promise.all(
        symbolsAll.map((s) => {
          const now = Math.floor(Date.now() / 1000);
          return getCandles(s, 'D', now - 28 * 24 * 60 * 60, now, 30).catch(() => null);
        })
      ).catch(() => [] as (Candle[] | null)[]),
    ]);

    // Build enriched position contexts
    const positionContexts: PositionContext[] = [];
    for (let i = 0; i < demoAccount.positions.length; i++) {
      const pos = demoAccount.positions[i];
      const sym = symbolsAll[i];
      const profile = i < (profiles?.length || 0) ? profiles?.[i] ?? null : null;
      const fundamentals = i < (fundamentalsArr?.length || 0) ? fundamentalsArr?.[i] ?? null : null;
      const candles = i < (candlesArr?.length || 0) ? candlesArr?.[i] ?? null : null;

      // Sector from profile industry or fallback to position's sector
      let sector = pos.sector || 'Unknown';
      if (profile?.industry) {
        const mapped = industryToSector(profile.industry);
        if (mapped) sector = mapped;
      }

      const recentTrend = candles ? computeTrend(candles) : 'sideways';
      let newsSentiment: 'positive' | 'negative' | 'neutral' = 'neutral';
      if (candles && candles.length >= 5) {
        if (recentTrend === 'up') newsSentiment = 'positive';
        else if (recentTrend === 'down') newsSentiment = 'negative';
      }

      const week52High = fundamentals?.high52w ?? 0;
      const week52Low = fundamentals?.low52w ?? 0;
      const percentFrom52High = week52High > 0 ? ((pos.currentPrice - week52High) / week52High) * 100 : 0;

      positionContexts.push({
        symbol: sym,
        companyName: profile?.name || pos.name || sym,
        sector,
        shares: pos.qty,
        currentPrice: pos.currentPrice,
        marketValue: pos.marketValue,
        portfolioPercent: pos.portfolioPercent,
        costBasis: pos.avgCost * pos.qty,
        unrealizedPnL: pos.totalPnl,
        unrealizedPnLPercent: pos.totalPnlPercent,
        pe: fundamentals?.pe ?? null,
        eps: fundamentals?.eps ?? null,
        week52High,
        week52Low,
        percentFrom52High,
        recentTrend,
        newsSentiment,
        upcomingEarnings: earningsMap.get(sym) || null,
      });
    }

    // Sector breakdown
    const sectorMap = new Map<string, number>();
    for (const pc of positionContexts) {
      sectorMap.set(pc.sector, (sectorMap.get(pc.sector) || 0) + pc.marketValue);
    }
    const sectorBreakdown: SectorBreakdown[] = [];
    for (const [sector, value] of sectorMap) {
      const percent = totalValue > 0 ? (value / totalValue) * 100 : 0;
      sectorBreakdown.push({ sector, percent, value, aboveLimit: percent > SECTOR_CONCENTRATION_LIMIT * 100 });
    }
    sectorBreakdown.sort((a, b) => b.value - a.value);

    // Risk flags
    let topHolding = '', topHoldingPercent = 0, concentrationRisk = false;
    for (const pc of positionContexts) {
      if (pc.portfolioPercent > POSITION_CONCENTRATION_LIMIT * 100) concentrationRisk = true;
      if (pc.portfolioPercent > topHoldingPercent) { topHoldingPercent = pc.portfolioPercent; topHolding = pc.symbol; }
    }
    const sectorRisk = sectorBreakdown.some((sb) => sb.percent > SECTOR_CONCENTRATION_LIMIT * 100);

    return {
      totalValue,
      buyingPower: demoAccount.buyingPower,
      cash: demoAccount.cash,
      todayPnL: demoAccount.dayPnl,
      todayPnLPercent: demoAccount.dayPnlPercent,
      totalPnL: demoAccount.totalPnl,
      totalPnLPercent: demoAccount.totalPnlPercent,
      positions: positionContexts,
      sectorBreakdown,
      topHolding,
      topHoldingPercent,
      concentrationRisk,
      sectorRisk,
    };
  } catch {
    return emptyPortfolio;
  }
}

/** Returns both the portfolio context and whether we're in demo mode. */
export async function checkIsDemo(userId: string): Promise<boolean> {
  try {
    const status = await getConnectionStatus(userId);
    return !status.connected;
  } catch {
    return true; // default to demo on vault error
  }
}

async function buildPortfolioContext(userId: string): Promise<PortfolioContext> {
  // ── Check broker connection via broker-service ──
  let isDemo = true;
  try {
    const ctx = await getBrokerContext(userId);
    isDemo = ctx.isDemo || !ctx.credentials || ctx.provider !== 'alpaca';
  } catch {
    isDemo = true;
  }

  if (isDemo) {
    console.log('[AIContext] Using DEMO portfolio for user', userId.slice(0, 8));
    return buildDemoPortfolioContext(userId);
  }

  // ── Real broker: use Alpaca data via broker-service ──
  const emptyPortfolio: PortfolioContext = {
    totalValue: 0,
    buyingPower: 0,
    cash: 0,
    todayPnL: 0,
    todayPnLPercent: 0,
    totalPnL: 0,
    totalPnLPercent: 0,
    positions: [],
    sectorBreakdown: [],
    topHolding: '',
    topHoldingPercent: 0,
    concentrationRisk: false,
    sectorRisk: false,
  };

  try {
    // Fetch account and positions from Alpaca in parallel via broker-service
    const ctx = await getBrokerContext(userId);
    if (ctx.isDemo || !ctx.credentials) return emptyPortfolio;

    const [rawAccount, rawPositions] = await Promise.all([
      makeAlpacaRequest('/v2/account', ctx.credentials).catch(() => null),
      makeAlpacaRequest('/v2/positions', ctx.credentials).catch(() => [] as Array<{
        symbol: string;
        qty: string;
        avg_entry_price: string;
        market_value: string;
        cost_basis: string;
        current_price: string;
        unrealized_pl: string;
        unrealized_plpc: string;
        change_today: string;
        exchange: string;
      }>),
    ]);

    if (!rawAccount) return emptyPortfolio;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const account = rawAccount as Record<string, any>;
    const equity = parseFloat(String(account.equity ?? 0));
    const lastEquity = parseFloat(String(account.last_equity ?? 0));
    const cash = parseFloat(String(account.cash ?? 0));
    const buyingPower = parseFloat(String(account.buying_power ?? 0));
    const dayPnl = parseFloat(String(account.equity ?? 0)) - parseFloat(String(account.last_equity ?? 0));
    const dayPnlPercent = lastEquity > 0 ? (dayPnl / lastEquity) * 100 : 0;

    // Try to get total PnL from positions or account
    const positions = Array.isArray(rawPositions) ? rawPositions : [];
    console.log('[AIContext] Using REAL broker (Alpaca) for user', userId.slice(0, 8), '- positions:', positions.length);
    const totalUnrealizedPl = positions.reduce(
      (sum, p) => sum + parseFloat(String(p.unrealized_pl ?? 0)),
      0
    );

    const totalValue = equity || 0;

    // ── Build PositionContexts ──
    const symbols = positions.map((p) => String(p.symbol).toUpperCase());

    // Fetch market data in parallel
    const [earningsMap, quotes, profiles, fundamentalsArr, candlesArr] = await Promise.all([
      fetchUpcomingEarnings(symbols).catch(() => new Map<string, string>()),
      // Quotes: fetch individually via getQuote (market-data fallback chain)
      Promise.all(symbols.map((s) => getQuote(s).catch(() => null))).catch(() => [] as (Quote | null)[]),
      // Profiles
      Promise.all(symbols.map((s) => getCompanyProfile(s).catch(() => null))).catch(() => [] as (CompanyProfile | null)[]),
      // Fundamentals
      Promise.all(symbols.map((s) => getFundamentals(s).catch(() => null))).catch(() => [] as (FundamentalMetrics | null)[]),
      // Candles: 4 weeks of daily data
      Promise.all(
        symbols.map((s) => {
          const now = Math.floor(Date.now() / 1000);
          const fourWeeksAgo = now - 28 * 24 * 60 * 60;
          return getCandles(s, 'D', fourWeeksAgo, now, 30).catch(() => null);
        })
      ).catch(() => [] as (Candle[] | null)[]),
    ]);

    const positionContexts: PositionContext[] = [];

    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      const sym = symbols[i];
      const qty = parseFloat(String(p.qty ?? 0));
      const mktValue = parseFloat(String(p.market_value ?? 0));
      const costBasisVal = parseFloat(String(p.cost_basis ?? 0));
      const unrealizedPl = parseFloat(String(p.unrealized_pl ?? 0));
      const unrealizedPlpc = parseFloat(String(p.unrealized_plpc ?? 0));
      const currentPrice = parseFloat(String(p.current_price ?? 0));
      const avgCost = parseFloat(String(p.avg_entry_price ?? 0));

      const quote = i < (quotes?.length || 0) ? quotes?.[i] ?? null : null;
      const profile = i < (profiles?.length || 0) ? profiles?.[i] ?? null : null;
      const fundamentals = i < (fundamentalsArr?.length || 0) ? fundamentalsArr?.[i] ?? null : null;
      const candles = i < (candlesArr?.length || 0) ? candlesArr?.[i] ?? null : null;

      // Sector from profile industry
      let sector = 'Unknown';
      if (profile?.industry) {
        const mapped = industryToSector(profile.industry);
        if (mapped) sector = mapped;
      }

      // Use quote price if available and more recent
      const price = quote?.price && quote.price > 0 ? quote.price : currentPrice;
      const marketValue = mktValue || qty * price;

      // 52-week data
      const week52High = fundamentals?.high52w ?? quote?.high52w ?? 0;
      const week52Low = fundamentals?.low52w ?? quote?.low52w ?? 0;
      const percentFrom52High = week52High > 0 ? ((price - week52High) / week52High) * 100 : 0;

      // Trend
      const recentTrend = candles ? computeTrend(candles) : 'sideways';

      // News sentiment — derived from recent trend as proxy
      let newsSentiment: 'positive' | 'negative' | 'neutral' = 'neutral';
      if (!candles || candles.length < 5) {
        newsSentiment = 'neutral';
      } else {
        // Use recent trend as proxy for sentiment
        if (recentTrend === 'up') newsSentiment = 'positive';
        else if (recentTrend === 'down') newsSentiment = 'negative';
        else newsSentiment = 'neutral';
      }

      positionContexts.push({
        symbol: sym,
        companyName: profile?.name || sym,
        sector,
        shares: qty,
        currentPrice: price,
        marketValue,
        portfolioPercent: totalValue > 0 ? (marketValue / totalValue) * 100 : 0,
        costBasis: costBasisVal || avgCost * qty,
        unrealizedPnL: unrealizedPl,
        unrealizedPnLPercent: unrealizedPlpc * 100,
        pe: fundamentals?.pe ?? null,
        eps: fundamentals?.eps ?? null,
        week52High,
        week52Low,
        percentFrom52High,
        recentTrend,
        newsSentiment,
        upcomingEarnings: earningsMap.get(sym) || null,
      });
    }

    // ── Sector Breakdown ──
    const sectorMap = new Map<string, number>();
    for (const pc of positionContexts) {
      const existing = sectorMap.get(pc.sector) || 0;
      sectorMap.set(pc.sector, existing + pc.marketValue);
    }

    const sectorBreakdown: SectorBreakdown[] = [];
    for (const [sector, value] of sectorMap) {
      const percent = totalValue > 0 ? (value / totalValue) * 100 : 0;
      sectorBreakdown.push({
        sector,
        percent,
        value,
        aboveLimit: percent > SECTOR_CONCENTRATION_LIMIT * 100,
      });
    }
    // Sort by value descending
    sectorBreakdown.sort((a, b) => b.value - a.value);

    // ── Concentration risk ──
    let topHolding = '';
    let topHoldingPercent = 0;
    let concentrationRisk = false;

    for (const pc of positionContexts) {
      if (pc.portfolioPercent > POSITION_CONCENTRATION_LIMIT * 100) {
        concentrationRisk = true;
      }
      if (pc.portfolioPercent > topHoldingPercent) {
        topHoldingPercent = pc.portfolioPercent;
        topHolding = pc.symbol;
      }
    }

    const sectorRisk = sectorBreakdown.some(
      (sb) => sb.percent > SECTOR_CONCENTRATION_LIMIT * 100
    );

    return {
      totalValue,
      buyingPower,
      cash,
      todayPnL: dayPnl,
      todayPnLPercent: dayPnlPercent,
      totalPnL: totalUnrealizedPl,
      totalPnLPercent: totalValue > 0 ? (totalUnrealizedPl / (totalValue - totalUnrealizedPl)) * 100 : 0,
      positions: positionContexts,
      sectorBreakdown,
      topHolding,
      topHoldingPercent,
      concentrationRisk,
      sectorRisk,
    };
  } catch {
    return emptyPortfolio;
  }
}

// ═══════════════════════════════════════════════════════════════
// MARKET CONTEXT
// ═══════════════════════════════════════════════════════════════

async function buildMarketContext(): Promise<MarketContext> {
  const empty: MarketContext = {
    date: new Date().toISOString(),
    marketStatus: getMarketStatus(),
    recentNews: [],
    spyChange: null,
    qqqChange: null,
  };

  try {
    const [news, spyQuote, qqqQuote] = await Promise.all([
      fetchNews().catch(() => [] as Array<{ headline: string; sentiment: string }>),
      getQuote('SPY').catch(() => null),
      getQuote('QQQ').catch(() => null),
    ]);

    return {
      date: new Date().toISOString(),
      marketStatus: getMarketStatus(),
      recentNews: news,
      spyChange: spyQuote?.changePercent ?? null,
      qqqChange: qqqQuote?.changePercent ?? null,
    };
  } catch {
    return empty;
  }
}

// ═══════════════════════════════════════════════════════════════
// TAX CONTEXT
// ═══════════════════════════════════════════════════════════════

async function buildTaxContext(userId: string): Promise<TaxContext> {
  const currentYear = new Date().getFullYear();
  const empty: TaxContext = {
    ytdRealizedGains: 0,
    ytdRealizedLosses: 0,
    netPosition: 0,
    harvestablePositions: [],
    taxYear: currentYear,
  };

  // ── Check broker connection via broker-service ──
  try {
    const ctx = await getBrokerContext(userId);
    if (ctx.isDemo || !ctx.credentials || ctx.provider !== 'alpaca') return empty;
  } catch {
    return empty;
  }

  try {
    const supabase = createServerClient();
    const yearStart = new Date(`${currentYear}-01-01T00:00:00Z`).toISOString();

    // Fetch all sell trades for current year
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: sellTrades, error } = await (supabase as any)
      .from('trade_history')
      .select('symbol, side, qty, filled_price, total_value, created_at, executed_at')
      .eq('user_id', userId)
      .eq('side', 'sell')
      .gte('created_at', yearStart)
      .order('created_at', { ascending: false });

    if (error || !sellTrades) return empty;

    let ytdRealizedGains = 0;
    let ytdRealizedLosses = 0;

    for (const trade of sellTrades) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t = trade as any;
      const total = t.total_value ?? (t.filled_price ?? 0) * (t.qty ?? 0);
      // Estimate gain/loss: buy price ≈ not available directly, approximate from total_value
      if (total > 0) {
        ytdRealizedGains += total;
      } else if (total < 0) {
        ytdRealizedLosses += Math.abs(total);
      }
    }

    // More accurate: compute proceeds from filled_price * qty
    let proceeds = 0;
    for (const trade of sellTrades) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t = trade as any;
      const price: number = t.filled_price ?? 0;
      const qty: number = t.qty ?? 0;
      proceeds += price * qty;
    }
    ytdRealizedGains = proceeds;
    ytdRealizedLosses = 0;

    // ── Harvestable positions (unrealized losses) ──
    // Fetch current positions from Alpaca via broker-service
    let harvestablePositions: TaxContext['harvestablePositions'] = [];

    try {
      const ctx = await getBrokerContext(userId);
      if (ctx.isDemo || !ctx.credentials) return empty;

      const rawPositions = await makeAlpacaRequest('/v2/positions', ctx.credentials).catch(() => [] as Array<{
        symbol: string;
        unrealized_pl: string;
      }>);
      const positions = Array.isArray(rawPositions) ? rawPositions : [];

      // Also check recent buy trades for wash sale risk (30 days)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: recentBuys } = await (supabase as any)
        .from('trade_history')
        .select('symbol')
        .eq('user_id', userId)
        .eq('side', 'buy')
        .gte('created_at', thirtyDaysAgo);

      const washSaleSymbols = new Set(
        (recentBuys || []).map((t: any) => String(t.symbol).toUpperCase())
      );

      for (const pos of positions) {
        const unrealizedPl = parseFloat(String(pos.unrealized_pl ?? 0));
        if (unrealizedPl < 0) {
          const sym = String(pos.symbol).toUpperCase();
          harvestablePositions.push({
            symbol: sym,
            unrealizedLoss: Math.abs(unrealizedPl),
            estimatedTaxSaving: Math.abs(unrealizedPl) * ESTIMATED_TAX_RATE,
            washSaleSafe: !washSaleSymbols.has(sym),
          });
        }
      }

      // Sort by largest loss first
      harvestablePositions.sort((a, b) => b.unrealizedLoss - a.unrealizedLoss);
    } catch {
      harvestablePositions = [];
    }

    return {
      ytdRealizedGains,
      ytdRealizedLosses,
      netPosition: ytdRealizedGains - ytdRealizedLosses,
      harvestablePositions,
      taxYear: currentYear,
    };
  } catch {
    return empty;
  }
}

// ═══════════════════════════════════════════════════════════════
// INVESTOR STYLE & TARGET ALLOCATIONS
// ═══════════════════════════════════════════════════════════════

async function fetchUserProfile(
  userId: string
): Promise<{
  investorStyle: string;
  savedTargetAllocations: Array<{ symbol: string; targetPercent: number }> | null;
}> {
  let investorStyle = 'buffett'; // default
  let savedTargetAllocations: Array<{ symbol: string; targetPercent: number }> | null = null;

  try {
    const supabase = createServerClient();

    // Fetch user's investor style
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: userData } = await (supabase as any)
      .from('users')
      .select('investor_style')
      .eq('id', userId)
      .single();

    if (userData?.investor_style) {
      investorStyle = userData.investor_style;
    }

    // Fetch target allocations from strategies
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: strategies } = await (supabase as any)
      .from('strategies')
      .select('target_allocation')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (strategies && strategies.length > 0 && strategies[0].target_allocation) {
      const alloc = strategies[0].target_allocation as Record<string, number>;
      savedTargetAllocations = Object.entries(alloc).map(([symbol, targetPercent]) => ({
        symbol,
        targetPercent: targetPercent * 100, // store as percentage
      }));
    }
  } catch {
    // defaults
  }

  return { investorStyle, savedTargetAllocations };
}

// ═══════════════════════════════════════════════════════════════
// MAIN EXPORT: buildAIContext
// ═══════════════════════════════════════════════════════════════

/**
 * Build a complete AI context object for the given user.
 * Checks cache first (5-minute TTL). Never throws — returns minimal
 * context on any failure so the AI always has grounding, even if stale.
 */
export async function buildAIContext(userId: string): Promise<AIContext> {
  // 1. Check cache
  try {
    const cached = await getCachedContext(userId);
    if (cached) {
      console.log('[AIContext] Cache HIT for user', userId.slice(0, 8), '- positions:', cached.portfolio?.positions?.length);
      // Still refresh market status since it's time-sensitive
      cached.market.marketStatus = getMarketStatus();
      return cached;
    }
    console.log('[AIContext] Cache MISS for user', userId.slice(0, 8), '- building fresh');
  } catch {
    // Cache failure → proceed to build fresh
    console.log('[AIContext] Cache LOOKUP FAILED for user', userId.slice(0, 8), '- building fresh');
  }

  // 2. Build fresh context — all blocks are safe-guarded
  const [portfolio, market, tax, profile] = await Promise.all([
    buildPortfolioContext(userId),
    buildMarketContext(),
    buildTaxContext(userId),
    fetchUserProfile(userId),
  ]);

  // Determine if we're in demo mode
  let isDemo = true;
  try {
    const status = await getConnectionStatus(userId);
    isDemo = !status.connected;
  } catch {
    isDemo = true;
  }

  const context: AIContext = {
    portfolio,
    market,
    tax,
    investorStyle: profile.investorStyle,
    isDemo,
    savedTargetAllocations: profile.savedTargetAllocations,
    timestamp: new Date().toISOString(),
  };

  // 3. Cache for next call (fire and forget)
  setCachedContext(userId, context).catch(() => {});

  return context;
}

// ═══════════════════════════════════════════════════════════════
// FORMAT PROMPT HELPER
// ═══════════════════════════════════════════════════════════════

/**
 * Convert an AIContext into a clean text summary for injection
 * into the AI system prompt. Follows the Vantage prompt format spec.
 */
export function formatContextForPrompt(context: AIContext): string {
  const { portfolio, market, tax } = context;
  const lines: string[] = [];

  // ── Portfolio Summary ──
  lines.push('Portfolio Summary:');
  const todaySign = portfolio.todayPnLPercent >= 0 ? '+' : '';
  const totalSign = portfolio.totalPnLPercent >= 0 ? '+' : '';
  lines.push(
    `Total Value: ${fmtDollar(portfolio.totalValue)} | Today: ${todaySign}${portfolio.todayPnLPercent.toFixed(2)}% | Total P&L: ${totalSign}${portfolio.totalPnLPercent.toFixed(2)}%`
  );
  lines.push(`Buying Power: ${fmtDollar(portfolio.buyingPower)} | Cash: ${fmtDollar(portfolio.cash)}`);
  lines.push('');

  // ── Positions ──
  if (portfolio.positions.length > 0) {
    lines.push('Positions:');
    for (const pos of portfolio.positions) {
      const peStr = pos.pe != null ? pos.pe.toFixed(1) : 'N/A';
      const epsStr = pos.eps != null ? `$${pos.eps.toFixed(2)}` : 'N/A';
      const trendStr = pos.recentTrend.charAt(0).toUpperCase() + pos.recentTrend.slice(1);
      const sentStr = pos.newsSentiment.charAt(0).toUpperCase() + pos.newsSentiment.slice(1);
      const earningsStr = pos.upcomingEarnings ? ` | Earnings: ${pos.upcomingEarnings}` : '';
      lines.push(
        `- ${pos.symbol}: ${pos.portfolioPercent.toFixed(1)}% (${fmtDollar(pos.marketValue)}) | PE: ${peStr} | EPS: ${epsStr} | Trend: ${trendStr} | Sentiment: ${sentStr}${earningsStr}`
      );
    }
    lines.push('');
  }

  // ── Sector Exposure ──
  if (portfolio.sectorBreakdown.length > 0) {
    lines.push('Sector Exposure:');
    for (const sb of portfolio.sectorBreakdown) {
      const warning = sb.aboveLimit ? ' ⚠️ ABOVE 40% LIMIT' : '';
      lines.push(`- ${sb.sector}: ${sb.percent.toFixed(1)}%${warning}`);
    }
    lines.push('');
  }

  // ── Risk Flags ──
  const riskFlags: string[] = [];
  if (portfolio.concentrationRisk) {
    for (const pos of portfolio.positions) {
      if (pos.portfolioPercent > 15) {
        riskFlags.push(
          `⚠️ ${pos.symbol} concentration: ${pos.portfolioPercent.toFixed(1)}% (limit: 15%)`
        );
      }
    }
  }
  if (portfolio.sectorRisk) {
    for (const sb of portfolio.sectorBreakdown) {
      if (sb.aboveLimit) {
        riskFlags.push(
          `⚠️ ${sb.sector} sector: ${sb.percent.toFixed(1)}% (limit: 40%)`
        );
      }
    }
  }
  if (riskFlags.length > 0) {
    lines.push('Risk Flags:');
    lines.push(...riskFlags);
    lines.push('');
  }

  // ── Market Context ──
  lines.push('Market Context:');
  const spyStr = market.spyChange != null ? `${market.spyChange >= 0 ? '+' : ''}${market.spyChange.toFixed(2)}%` : 'N/A';
  const qqqStr = market.qqqChange != null ? `${market.qqqChange >= 0 ? '+' : ''}${market.qqqChange.toFixed(2)}%` : 'N/A';
  lines.push(`SPY: ${spyStr} | QQQ: ${qqqStr}`);

  const sentimentSummary =
    market.recentNews.length > 0
      ? (() => {
          const counts: Record<string, number> = { positive: 0, negative: 0, neutral: 0 };
          for (const n of market.recentNews) {
            counts[n.sentiment] = (counts[n.sentiment] || 0) + 1;
          }
          if (counts.positive > counts.negative) return 'Mostly positive';
          if (counts.negative > counts.positive) return 'Mostly negative';
          return 'Mixed/neutral';
        })()
      : 'No recent news';
  lines.push(`Recent news sentiment: ${sentimentSummary}`);
  lines.push('');

  // ── Tax Context ──
  lines.push(`Tax Context (${tax.taxYear}):`);
  lines.push(`YTD Realized Gains: ${fmtDollar(tax.ytdRealizedGains)}`);
  lines.push(`YTD Realized Losses: ${fmtDollar(tax.ytdRealizedLosses)}`);
  const totalHarvestable = tax.harvestablePositions.reduce(
    (sum, hp) => sum + hp.unrealizedLoss,
    0
  );
  lines.push(`Harvestable Losses: ${fmtDollar(totalHarvestable)}`);
  lines.push('');

  // ── Investor Style ──
  lines.push(`Investor Style: ${context.investorStyle}`);

  // ── Target Allocations ──
  if (context.savedTargetAllocations && context.savedTargetAllocations.length > 0) {
    const allocStr = context.savedTargetAllocations
      .map((a) => `${a.symbol}: ${a.targetPercent.toFixed(1)}%`)
      .join(', ');
    lines.push(`Saved Target Allocations: ${allocStr}`);
  } else {
    lines.push('Saved Target Allocations: None');
  }

  return lines.join('\n');
}
