import Anthropic from '@anthropic-ai/sdk'
import { VANTAGE_SYSTEM_PROMPT, ALERTS_SYSTEM_PROMPT } from '@/lib/ai-system-prompt'
import { withFallback, stageLog, createTimeoutBudget, startStage, endStage } from '@/lib/ai/resilience'
import { resolveSymbol } from '@/lib/tools/resolve-symbol'
import type { SystemBlock } from '@/lib/ai-provider'
import { CHAT_SAFETY_BLOCKS } from '@/lib/ai/shared-safety-blocks';
import { buildUserProfileContext } from '@/lib/ai/userProfile'
import type { UserProfile } from '@/lib/ai/userProfile'
import { checkUsageLimit, incrementUsage, getLocalDateFromTimezone, checkAbuseCooldown } from '@/lib/ai-guard'
import { getOptionalUserId } from '@/lib/auth/get-server-user'
import { getActiveFacts, writeFact, formatFactsForPrompt } from '@/lib/ai/facts'
import { getBatchQuotes } from '@/lib/market-data'
import { createServerClient } from '@/lib/supabase'
import {
  validateRecommendations,
  buildRetryPrompt,
  extractBudget,
  type ValidationFailure,
} from '@/lib/validate-recommendations'
import {
  validateRecommendationMarkers,
  loadSymbolCache,
  NOT_TICKERS,
  FOREIGN_EXCHANGE_SUFFIXES,
  NOT_COMPANIES,
  FILTERED_COMMON_WORDS,
  isFilteredCommonWord,
} from '@/lib/symbol-resolution'
import { getStyleScreeningDefaults } from '@/lib/investor-style-defaults'
import {
  classifyIntent,
} from '@/lib/ai/manager'
import { validateResponse } from '@/lib/ai/validator'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  defaultHeaders: {
    'anthropic-beta': 'prompt-caching-2024-07-31',
  },
})
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY
const SEARXNG_URL = process.env.SEARXNG_URL || 'http://localhost:8888'

// ─── Ticker extraction (filters from shared symbol-resolution module) ──
function extractTickers(text: string): string[] {
  // Match: $SPCX, SPCX (2-5 uppercase letters, standalone)
  const matches = text.match(/\$?\b([A-Z]{2,5})\b/g);
  if (!matches) {
    // Try single-letter tickers: only when explicitly in stock context
    // e.g., "F stock", "C price quote", "T shares"
    const singleLetter = text.match(/\$?\b([A-Z])\b\s*(?:stocks|shares|stock|share|price|quote|trading|ticker)\b/gi);
    if (singleLetter) {
      return [...new Set(singleLetter.map(t => t.replace(/[$\s]+.*$/g, '').toUpperCase()).filter(t => t.length === 1 && /^[A-Z]$/.test(t) && !NOT_TICKERS.has(t)))];
    }
    return [];
  }
  const tickers = matches
    .map(t => t.replace('$', '').toUpperCase())
    .filter(t => !NOT_TICKERS.has(t));
  return [...new Set(tickers)]; // deduplicate
}

// ─── Stock price intent detection ──
const PRICE_QUERY_PATTERNS = [
  /\b(?:stock|share|price|trading|quote|ticker|IPO|valuation)\s+(?:price|of|for|at|is|now|today|right|currently)/i,
  /\b(?:how\s+much|what(?:'s|\s+is)\s+the)\s+(?:price|stock|share|value|valuation|quote|worth)/i,
  /\b(?:current|live|real.time|latest)\s+(?:price|stock|share|quote)/i,
  /\b(?:is|are)\s+\w+\s+(?:public|listed|trading|IPO)/i,
  /\b(?:what|how)\s+\w+\s+(?:trading|worth|cost|priced)\s*(?:at|right|now|today|\?)/i,
  /\b(?:market\s+cap|marketcap|mkt\s+cap)\b/i,
  /\b(?:what|how)(?:'s|\s+is|\s+are)\s+\w+\s*(?:at|going for|priced|now|right now|today)\b/i,
  /\$(?:[A-Z]{2,5})\b/,  // $SPCX pattern — almost certainly asking about a stock
  /\bprice\s+(?:of|for|on|check|target)\b/i,
  /\b(?:buy|sell|invest\s+in)\s+\w+\s+(?:stock|share)/i,
];

function hasStockPriceIntent(text: string): boolean {
  return PRICE_QUERY_PATTERNS.some(p => p.test(text));
}

function extractSearchTerm(text: string): string | null {
  // Strategy: extract proper nouns (capitalized words) and known company suffixes
  // Remove question marks, strip ticker symbols
  const cleaned = text
    .replace(/\$[A-Z]{1,5}/g, '')  // remove $TICKER
    .replace(/\b[A-Z]{2,5}\b/g, '') // remove bare TICKER
    .replace(/[?.!,]/g, '')
    .trim();
  
  // Try: multi-word capitalized phrases (e.g., "Berkshire Hathaway", "Procter & Gamble")
  const multiWord = cleaned.match(/\b([A-Z][a-z]+(?:\s+(?:of|the|de|van|von|del|&|and)\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g);
  if (multiWord) {
    // Pick the longest match — most likely to be a company name
    const longest = multiWord.reduce((a, b) => b.length > a.length ? b : a);
    if (!isFilteredCommonWord(longest)) return longest;
  }
  
  // Try: ALL capitalized words, skip filtered ones, pick the first real name
  const allCapWords = cleaned.match(/\b([A-Z][a-z]{2,})\b/g);
  if (allCapWords) {
    for (const word of allCapWords) {
      if (!isFilteredCommonWord(word)) return word;
    }
  }
  
  return null;
}

// NOTE: fillMissingMarkers() was removed — buttons now ONLY generated from
// explicit [RECOMMEND:SYMBOL:BUY:$AMOUNT] markers in the AI response text.
// Prose-scanning heuristics were the root cause of ghost tickers (exchange
// suffixes like DE/MX/SN), contradictory buttons (SPY when VOO is recommended),
// and duplicate positions across foreign exchange listings.


function extractCompanyNames(text: string): string[] {
  const names = new Set<string>()
  if (!text) return []
  // Pattern: 2-3 word capitalized phrases ("Eli Lilly", "Novo Nordisk", "Goldman Sachs")
  const multiWord = text.match(/\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){1,2})\b/g)
  if (multiWord) {
    for (const m of multiWord) {
      if (!NOT_COMPANIES.has(m.toUpperCase()) && !FILTERED_COMMON_WORDS.test(m) && m.length > 5) {
        names.add(m)
      }
    }
  }
  // Pattern: company name followed by ticker in parens — "Eli Lilly and Company (LLY)"
  const tickerPattern = text.matchAll(/([A-Z][a-z]{2,}(?:\s+(?:of|the|de|van|von|del|&|and)\s+)?[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)\s*\(([A-Z]{1,5})\)/g)
  for (const m of tickerPattern) {
    if (!NOT_COMPANIES.has(m[1].toUpperCase())) names.add(m[1])
  }
  // Pattern: standalone capitalized words (single-word company names: "Pfizer", "Amgen")
  const singleWord = text.match(/\b([A-Z][a-z]{3,})\b/g)
  if (singleWord) {
    for (const m of singleWord) {
      if (!NOT_COMPANIES.has(m.toUpperCase()) && !FILTERED_COMMON_WORDS.test(m) && m.length > 4) {
        names.add(m)
      }
    }
  }
  return [...names].slice(0, 15)
}

/** Resolve a company name to its US ticker via Finnhub search (fast Phase 1 only). */
async function resolveOneFast(name: string): Promise<{ symbol: string; name: string } | null> {
  const key = process.env.FINNHUB_IO_API_KEY
  if (!key) return null
  try {
    const res = await fetch(`https://finnhub.io/api/v1/search?q=${encodeURIComponent(name)}&token=${key}`)
    if (!res.ok) return null
    const data = await res.json()
    if (data.result?.length > 0) {
      // Prefer US-exchange results
      const usResult = data.result.find((r: any) =>
        /^(NASDAQ|NYSE|AMEX|OTC|BATS|IEX)\b/i.test(r.exchange || '') &&
        /^[A-Z]{1,5}(\.[A-Z])?$/.test(r.symbol)
      )
      if (usResult) return { symbol: usResult.symbol, name: usResult.description }
      // Fallback: first result with valid US ticker format
      const valid = data.result.find((r: any) => /^[A-Z]{1,5}(\.[A-Z])?$/.test(r.symbol))
      if (valid) return { symbol: valid.symbol, name: valid.description }
    }
    return null
  } catch { return null }
}

/** Pre-resolve company names to ticker symbols before the Anthropic call.
 *  Prevents the tool loop from burning turns on one-by-one resolveSymbol calls. */
async function preResolveTickers(
  userMessage: string,
  searchContext: string
): Promise<Array<{ name: string; symbol: string }>> {
  const fromSearch = extractCompanyNames(searchContext || '')
  const fromUser = extractCompanyNames(userMessage)
  // Deduplicate, sort longest-first (more specific names first)
  const seen = new Set<string>()
  const unique = [...fromSearch, ...fromUser].filter(n => {
    const upper = n.toUpperCase()
    if (seen.has(upper)) return false
    seen.add(upper)
    return true
  }).sort((a, b) => b.length - a.length).slice(0, 10)

  if (unique.length === 0) return []

  console.log(`[chat] 🔍 Pre-resolving ${unique.length} company names: ${unique.join(', ')}`)

  const BATCH_SIZE = 5
  const resolved: Array<{ name: string; symbol: string }> = []
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE)
    const results = await Promise.all(batch.map(async (name) => {
      const r = await resolveOneFast(name)
      return r ? { name, symbol: r.symbol } : null
    }))
    for (const r of results) { if (r) resolved.push(r) }
    if (i + BATCH_SIZE < unique.length) await new Promise(r => setTimeout(r, 200))
  }

  if (resolved.length > 0) {
    console.log(`[chat] ✅ Pre-resolved: ${resolved.map(r => `${r.name}→${r.symbol}`).join(', ')}`)
  }
  return resolved
}

// ─── Stage 0: DeepSeek Screening ───
async function screenMessage(userMessage: string): Promise<{
  needsSearch: boolean
  searchQuery: string | null
  queryType: 'portfolio' | 'market_research' | 'general_finance'
}> {
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        max_tokens: 100,
        messages: [{
          role: 'user',
          content: `Classify this finance question. Reply with JSON only:
{
  "needsSearch": true/false,
  "searchQuery": "optimized search query" or null,
  "queryType": "portfolio" or "market_research" or "general_finance"
}

needsSearch = true if question needs current data:
- IPO news, recent valuations, current events
- Company news from last 6 months
- Recent earnings, analyst ratings
- Anything time-sensitive

needsSearch = false if:
- Portfolio analysis (data provided in context)
- General investing concepts
- Historical analysis

Question: "${userMessage}"`
        }]
      })
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('[chat] DeepSeek screening HTTP', res.status, errText.slice(0, 200));
      // Fail open → search anyway
      return { needsSearch: true, searchQuery: userMessage.slice(0, 200), queryType: 'market_research' as const };
    }

    const data = await res.json()
    let raw = data.choices?.[0]?.message?.content || '';
    // DeepSeek sometimes wraps JSON in markdown code fences even with response_format
    raw = raw.replace(/```(?:json)?\s*\n?/g, '').trim();
    return JSON.parse(raw)
  } catch (e) {
    console.error('[chat] DeepSeek screening failed:', e);
    // DEFAULT TO SEARCH — safer to search unnecessarily than to miss current data
    // Claude's training cutoff means it will hallucinate dates for recent events without search.
    return { needsSearch: true, searchQuery: userMessage.slice(0, 200), queryType: 'market_research' as const };
  }
}

// ─── Stage 1: SearXNG Web Search ───
async function searchWeb(query: string): Promise<string> {
  try {
    const res = await fetch(
      `${SEARXNG_URL}/search?q=${encodeURIComponent(query)}&format=json&categories=general,news&language=en`
    )
    const data = await res.json()

    // Take top 3 results
    const results = (data.results || []).slice(0, 3)
    if (results.length === 0) return ''

    return `
CURRENT WEB SEARCH RESULTS for "${query}":
${results.map((r: any, i: number) => `
[${i + 1}] ${r.title}
${r.content || r.snippet || ''}
Source: ${r.url}
`).join('\n')}
Use these results to answer with current information.
IMPORTANT: Cross-check any dates found in these results against the authoritative current date provided in the context section above. If a search result mentions a date that doesn't align with the real current date, the search result may be stale — do not confidently assert its date as current.

CRITICAL: When search results are present, trust them OVER your training data for factual questions about IPOs, current stock prices, recent events, and company status. Your training data may be outdated — the search results are authoritative. Never contradict search results with training-data claims.

DO NOT mention that you searched, found, or looked up this information. State findings directly and attribute to real sources (names, firms, publications) — never say "search results show" or "according to my search."`
  } catch (e) {
    console.error('Search error:', e)
    return ''
  }
}

// ─── Budget Gate: Portfolio Generation Reconciliation ───
// Extracts the user's requested budget from their message and compares
// it against the AI-generated portfolio total. Rejects anything outside ±2%.

interface BudgetGateResult {
  hasViolation: boolean;
  requestedBudget: number | null;
  responseTotal: number | null;
  deviationPercent: number | null;
  message: string | null;
}

/** Extract a dollar budget from the user's message. */
function extractRequestedBudget(message: string): number | null {
  // Match: "$500 portfolio", "$500 basket", "$500 worth", "$500 in stocks", etc.
  const dollarMatch = message.match(/\$([\d,]+(?:\.\d+)?)\s*(?:portfolio|basket|worth|in|of|budget|total|invest|allocate|spend|split|across|each|pick|choose|buy|build)/i);
  if (dollarMatch) return parseFloat(dollarMatch[1].replace(/,/g, ''));

  // Match: "500 dollar portfolio", "500 portfolio", "500 budget"
  const numMatch = message.match(/([\d,]+(?:\.\d+)?)\s*(?:dollar|portfolio|basket|budget)\b/i);
  if (numMatch) return parseFloat(numMatch[1].replace(/,/g, ''));

  // Match bare $N in context: "$500", "$1,000"
  const bareDollar = message.match(/\$([\d,]+(?:\\.\d+)?)\b/);
  if (bareDollar) {
    const val = parseFloat(bareDollar[1].replace(/,/g, ''));
    // Only consider it a budget if it's a round number ≥ $50 (avoids "$12.50 earnings")
    if (val >= 50 && val % 10 === 0) return val;
  }

  return null;
}

/** Extract total(s) from [PORTFOLIO:{...}] blocks in the AI's response.
 *  PORTFOLIO blocks are authoritative — prose is never parsed for numbers.
 *  Returns the first block's total, or null if no blocks found.
 *  For multi-strategy, each block's total is independently validated upstream. */
function extractResponseTotal(response: string): number | null {
  const blocks = parsePortfolioBlocks(response);
  if (blocks.length === 0) return null;
  // Return the first block's total (for single-block responses)
  // Multi-strategy validation happens in validatePortfolioBlocks
  return blocks[0].total;
}

// ─── Checklist event helper ───
function sendChecklist(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  stage: string,
  status: 'in_progress' | 'done' | 'failed' | 'skipped',
  detail?: string
) {
  controller.enqueue(
    encoder.encode(`data: ${JSON.stringify({ checklist: { stage, status, detail } })}\n\n`)
  );
}

/** Extract screening criteria from a natural-language user message. */
function extractScreeningCriteria(message: string): Record<string, any> | null {
  const criteria: Record<string, any> = {};
  const m = message.toLowerCase();

  // Sector mapping
  const sectorMap: Record<string, string> = {
    tech: 'technology', technology: 'technology', software: 'technology', ai: 'technology',
    health: 'healthcare', healthcare: 'healthcare', pharma: 'healthcare', biotech: 'healthcare', medical: 'healthcare',
    finance: 'financial_services', financial: 'financial_services', banking: 'financial_services', banks: 'financial_services',
    energy: 'energy', oil: 'energy', gas: 'energy', renewable: 'energy', solar: 'energy',
    consumer: 'consumer_cyclical', retail: 'consumer_cyclical',
    industrial: 'industrials', industrials: 'industrials', manufacturing: 'industrials', aerospace: 'industrials', defense: 'industrials',
    materials: 'basic_materials', basic_materials: 'basic_materials', mining: 'basic_materials', minerals: 'basic_materials', metals: 'basic_materials',
    real_estate: 'real_estate', reit: 'real_estate', property: 'real_estate',
    utilities: 'utilities', utility: 'utilities',
    communication: 'communication_services', telecom: 'communication_services', media: 'communication_services',
  };
  for (const [keyword, sector] of Object.entries(sectorMap)) {
    if (m.includes(keyword)) { criteria.sector = sector; break; }
  }

  // Market cap: "under $10B", ">$50B", "market cap > N billion", "mid-cap", "large-cap", "small-cap"
  const mktCapBillion = m.match(/(?:market\s*cap|mkt\s*cap|cap)\s*(?:>|>=|over|above|at least)\s*\$?(\d+(?:\.\d+)?)\s*(?:b|bn|billion)/i);
  const mktCapUnder = m.match(/(?:market\s*cap|mkt\s*cap|cap)\s*(?:<|<=|under|below|less than|at most)\s*\$?(\d+(?:\.\d+)?)\s*(?:b|bn|billion)/i);
  if (mktCapBillion) criteria.market_cap_min = Math.round(parseFloat(mktCapBillion[1]) * 1_000_000_000);
  if (mktCapUnder) criteria.market_cap_max = Math.round(parseFloat(mktCapUnder[1]) * 1_000_000_000);
  if (m.includes('large-cap') || m.includes('large cap')) { criteria.market_cap_min = 10_000_000_000; }
  if (m.includes('mid-cap') || m.includes('mid cap')) { criteria.market_cap_min = 2_000_000_000; criteria.market_cap_max = 10_000_000_000; }
  if (m.includes('small-cap') || m.includes('small cap')) { criteria.market_cap_max = 2_000_000_000; }

  // PE: "P/E under 30", "PE < 25"
  const peMatch = m.match(/(?:p\/?e|pe)\s*(?:<|<=|under|below|less than|max)\s*(\d+(?:\.\d+)?)/i);
  if (peMatch) criteria.pe_max = parseFloat(peMatch[1]);

  // Growth: "growth > 15%", "EPS growth over 10%"
  const growthMatch = m.match(/(?:growth|eps\s*growth)\s*(?:>|>=|over|above|at least|min)\s*(\d+(?:\.\d+)?)\s*%/i);
  if (growthMatch) criteria.min_growth_rate = parseFloat(growthMatch[1]) / 100;

  // Volume: "volume > 1M"
  const volMatch = m.match(/volume\s*(?:>|>=|over|above)\s*(\d+(?:\.\d+)?)\s*(?:m|mil|million)/i);
  if (volMatch) criteria.volume_min = Math.round(parseFloat(volMatch[1]) * 1_000_000);

  return Object.keys(criteria).length > 0 ? criteria : null;
}

/**
 * Extract MULTI-SECTOR screening criteria — collects ALL detected sectors
 * instead of just the first match. Each sector gets its own criteria object
 * with shared filters (PE, growth, market cap, volume, style defaults) applied.
 *
 * Returns null when no sectors are detected at all (single-pool fallback).
 * Returns an array with one entry for single-sector requests (degrades to
 * current single-pool behavior). Returns 2+ entries for multi-sector requests. 
 */
function extractMultiSectorCriteria(
  message: string,
  styleDefaults?: Record<string, any>
): Array<{ criteria: Record<string, any>; label: string }> | null {
  const m = message.toLowerCase();

  // Sector mapping — same as extractScreeningCriteria
  const sectorMap: Record<string, string> = {
    tech: 'technology', technology: 'technology', software: 'technology', ai: 'technology',
    health: 'healthcare', healthcare: 'healthcare', pharma: 'healthcare', biotech: 'healthcare', medical: 'healthcare',
    finance: 'financial_services', financial: 'financial_services', banking: 'financial_services', banks: 'financial_services',
    energy: 'energy', oil: 'energy', gas: 'energy', renewable: 'energy', solar: 'energy',
    consumer: 'consumer_cyclical', retail: 'consumer_cyclical',
    industrial: 'industrials', industrials: 'industrials', manufacturing: 'industrials', aerospace: 'industrials', defense: 'industrials',
    materials: 'basic_materials', basic_materials: 'basic_materials', mining: 'basic_materials', minerals: 'basic_materials', metals: 'basic_materials',
    real_estate: 'real_estate', reit: 'real_estate', property: 'real_estate',
    utilities: 'utilities', utility: 'utilities',
    communication: 'communication_services', telecom: 'communication_services', media: 'communication_services',
  };

  // Collect all sector matches (deduped by sector value, preserving order)
  const seen = new Set<string>();
  const sectors: Array<{ sector: string; keyword: string }> = [];
  for (const [keyword, sector] of Object.entries(sectorMap)) {
    if (m.includes(keyword) && !seen.has(sector)) {
      seen.add(sector);
      sectors.push({ sector, keyword });
    }
  }

  if (sectors.length === 0) return null;

  // Shared criteria — same extraction logic as extractScreeningCriteria
  const shared: Record<string, any> = {};

  // Market cap
  const mktCapBillion = m.match(/(?:market\s*cap|mkt\s*cap|cap)\s*(?:>|>=|over|above|at least)\s*\$?(\d+(?:\.\d+)?)\s*(?:b|bn|billion)/i);
  const mktCapUnder = m.match(/(?:market\s*cap|mkt\s*cap|cap)\s*(?:<|<=|under|below|less than|at most)\s*\$?(\d+(?:\.\d+)?)\s*(?:b|bn|billion)/i);
  if (mktCapBillion) shared.market_cap_min = Math.round(parseFloat(mktCapBillion[1]) * 1_000_000_000);
  if (mktCapUnder) shared.market_cap_max = Math.round(parseFloat(mktCapUnder[1]) * 1_000_000_000);
  if (m.includes('large-cap') || m.includes('large cap')) { shared.market_cap_min = 10_000_000_000; }
  if (m.includes('mid-cap') || m.includes('mid cap')) { shared.market_cap_min = 2_000_000_000; shared.market_cap_max = 10_000_000_000; }
  if (m.includes('small-cap') || m.includes('small cap')) { shared.market_cap_max = 2_000_000_000; }

  // PE
  const peMatch = m.match(/(?:p\/?e|pe)\s*(?:<|<=|under|below|less than|max)\s*(\d+(?:\.\d+)?)/i);
  if (peMatch) shared.pe_max = parseFloat(peMatch[1]);

  // Growth
  const growthMatch = m.match(/(?:growth|eps\s*growth)\s*(?:>|>=|over|above|at least|min)\s*(\d+(?:\.\d+)?)\s*%/i);
  if (growthMatch) shared.min_growth_rate = parseFloat(growthMatch[1]) / 100;

  // Volume
  const volMatch = m.match(/volume\s*(?:>|>=|over|above)\s*(\d+(?:\.\d+)?)\s*(?:m|mil|million)/i);
  if (volMatch) shared.volume_min = Math.round(parseFloat(volMatch[1]) * 1_000_000);

  // Apply style defaults as base, then shared criteria override
  const defaults = styleDefaults || {};

  const labelMap: Record<string, string> = {
    technology: 'Technology', healthcare: 'Healthcare', financial_services: 'Financials',
    energy: 'Energy', consumer_cyclical: 'Consumer Cyclical', industrials: 'Industrials',
    basic_materials: 'Basic Materials', real_estate: 'Real Estate', utilities: 'Utilities',
    communication_services: 'Communication Services',
  };

  return sectors.map(({ sector }) => ({
    label: labelMap[sector] || sector.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    criteria: { ...defaults, ...shared, sector },
  }));
}


async function runScreening(criteria: Record<string, any>): Promise<{ results: any[]; provider: string; error?: string }> {
  try {
    const res = await fetch('http://127.0.0.1:8766/screen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...criteria, limit: 30 }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { results: [], provider: 'error', error: `HTTP ${res.status}` };
    return await res.json();
  } catch (e: any) {
    return { results: [], provider: 'error', error: e.message };
  }
}

/** Format screening results as context for the AI system prompt. */
function formatScreeningContext(results: any[], criteria: Record<string, any>, count: number): string {
  if (!results || results.length === 0) {
    const critDesc = Object.entries(criteria)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    return `\nSCREENED UNIVERSE: No US-listed candidates matched criteria (${critDesc}). ` +
      `You MUST say so honestly (e.g., "Only 0 matches for those criteria — want me to widen?") ` +
      `and offer to relax the filters. Do NOT substitute familiar tickers from memory.`;
  }

  // Sort by market_cap descending so top matches are the biggest/most relevant
  const sorted = [...results].sort((a, b) => (b.market_cap || 0) - (a.market_cap || 0));
  const tickers = sorted.map((r: any) => r.symbol).join(', ');
  const summary = sorted.slice(0, 5).map((r: any) => {
    const parts = [`${r.symbol} (${r.name || '?'})`];
    if (r.market_cap) parts.push(`MCap:$${(r.market_cap/1e9).toFixed(1)}B`);
    if (r.pe_forward) parts.push(`PE:${r.pe_forward.toFixed(1)}`);
    if (r.eps_growth_5y != null) parts.push(`Grow:${(r.eps_growth_5y*100).toFixed(0)}%`);
    if (r.sector) parts.push(`Sector:${r.sector}`);
    return parts.join(' ');
  }).join('; ');

  return `\nSCREENED UNIVERSE: ${count} US-listed candidates from real-time screening.\n` +
    `Available tickers: ${tickers}\n` +
    `Top matches: ${summary}\n` +
    `You MUST build your portfolio ONLY from these screened candidates. ` +
    `If you need a ticker not in this list, say so — don't substitute from memory.\n` +
    `\n🏷️ STYLE CLASSIFICATION: When building allocation buckets (growth, value, momentum, core), ` +
    `classify candidates using their PE and growth metrics FROM THE SCREENED DATA ABOVE — ` +
    `not from your training data. Low PE (<20) + solid earnings = Value. High growth rate (>15%) + ` +
    `reasonable PE = Growth. High growth + high volume + strong recent price action = Momentum. ` +
    `A stock classified as \"growth\" must be backed by the screener data (PE, growth rate) shown above. ` +
    `NEVER place a high-PE (>30) stock in a Value bucket, or a low-growth stock in a Growth bucket. ` +
    `If a screened candidate doesn't fit any style bucket cleanly, put it in Core or skip it.`;
}

/** Format MULTI-SECTOR screening results — one labeled candidate pool per sector.
 *  The system prompt instructs the model to build each sector/bucket's allocation
 *  ONLY from its matching labeled pool — never cross-allocate (no tech stocks in
 *  healthcare bucket).  This produces genuinely varied prose because each bucket
 *  has completely different underlying data, not one merged universe. */
function formatMultiSectorContext(
  pools: Array<{ label: string; results: any[]; count: number }>
): string {
  if (pools.length === 0) return '';

  const sections = pools.map(pool => {
    if (!pool.results || pool.results.length === 0) {
      return `### ${pool.label.toUpperCase()} CANDIDATES (0 matches)\n` +
        `⚠️ No candidates matched in this sector. Skip this bucket entirely ` +
        `and tell the user explicitly that ${pool.label} returned 0 results with ` +
        `these criteria. Do NOT fabricate tickers.`;
    }

    const sorted = [...pool.results].sort((a: any, b: any) => (b.market_cap || 0) - (a.market_cap || 0));
    const tickers = sorted.map((r: any) => r.symbol).join(', ');
    const summary = sorted.slice(0, 5).map((r: any) => {
      const parts = [`${r.symbol} (${r.name || '?'})`];
      if (r.market_cap) parts.push(`MCap:$${(r.market_cap/1e9).toFixed(1)}B`);
      if (r.pe_forward) parts.push(`PE:${r.pe_forward.toFixed(1)}`);
      if (r.eps_growth_5y != null) parts.push(`Grow:${(r.eps_growth_5y*100).toFixed(0)}%`);
      if (r.sector) parts.push(`Sector:${r.sector}`);
      return parts.join(' ');
    }).join('; ');

    return `### ${pool.label.toUpperCase()} CANDIDATES (${pool.count})\n` +
      `Available: ${tickers}\n` +
      `Top: ${summary}`;
  });

  return `\n─── PER-SECTOR SCREENED UNIVERSES ───\n` +
    `⚠️ CRITICAL: Build each sector's allocation ONLY from its own labeled candidate pool below. ` +
    `NEVER cross-allocate — a tech candidate goes ONLY in the technology bucket, ` +
    `a healthcare candidate goes ONLY in the healthcare bucket. ` +
    `If a pool has 0 candidates, skip that bucket entirely and tell the user.\n` +
    `\n🏷️ STYLE CLASSIFICATION: When building allocation buckets within a sector ` +
    `(growth, value, momentum, core), classify candidates using their PE and growth ` +
    `metrics FROM THE SCREENED DATA above. Low PE (<20) + solid earnings → Value. ` +
    `High growth rate (>15%) + reasonable PE → Growth. High growth + strong price ` +
    `action → Momentum. NEVER place a high-PE stock in Value or a low-growth stock ` +
    `in Growth. Use the screener-provided PE/growth data — not training data.\n\n` +
    sections.join('\n\n') +
    `\n\n─── END SCREENED UNIVERSES ───`;
}

/** Validate portfolio totals against requested budget (exact match).
 *  Accepts an optional pre-computed budget from conversation history.
 *  When provided, skips the greedy extractRequestedBudget() which would
 *  incorrectly pick incremental amounts ($240) from clarifying answers. */
function validateBudgetGate(userMessage: string, aiResponse: string, contextBudget?: number | null): BudgetGateResult {
  // Use pre-computed budget from conversation history when available.
  // When contextBudget is null, NO budget was found anywhere in the
  // conversation — don't fall back to extractRequestedBudget() which
  // uses greedy bareDollar matching that picks up incremental amounts
  // like $1,000 from "add $1,000 to this" instead of the real portfolio total.
  const requestedBudget = contextBudget ?? null;
  if (!requestedBudget) {
    return { hasViolation: false, requestedBudget: null, responseTotal: null, deviationPercent: null, message: null };
  }

  const responseTotal = extractResponseTotal(aiResponse);
  if (!responseTotal) {
    // Can't determine total — no violation to report (false positive avoidance)
    return { hasViolation: false, requestedBudget, responseTotal: null, deviationPercent: null, message: null };
  }

  const deviationPercent = ((responseTotal - requestedBudget) / requestedBudget) * 100;
  if (responseTotal === requestedBudget) {
    return { hasViolation: false, requestedBudget, responseTotal, deviationPercent, message: null };
  }

  const direction = responseTotal > requestedBudget ? 'exceeds' : 'falls short of';
  const message = `⚠️ Budget mismatch: You requested a $${requestedBudget.toLocaleString()} portfolio, but the generated allocation totals $${responseTotal.toLocaleString()} (${deviationPercent >= 0 ? '+' : ''}${deviationPercent.toFixed(1)}% ${direction} your budget by ${Math.abs(deviationPercent).toFixed(1)}% — must match exactly). The AI may need to regenerate this with tighter constraints.`;

  return {
    hasViolation: true,
    requestedBudget,
    responseTotal,
    deviationPercent,
    message,
  };
}

// ─── PORTFOLIO Block Types ───────────────────────────

import { type PortfolioBlock, type PortfolioPosition } from '@/lib/portfolio-types';
import { parsePortfolioBlocks } from '@/lib/portfolio-blocks';

export { type PortfolioBlock, type PortfolioPosition };
export { parsePortfolioBlocks };

/**
 * Validate all [PORTFOLIO:{...}] blocks for internal consistency and
 * cross-check against [RECOMMEND:...] markers. PORTFOLIO blocks are the
 * authoritative source of truth — prose is NEVER parsed for numbers.
 *
 * Returns null if all blocks valid, or an error string describing the first failure.
 */
export function validatePortfolioBlocks(response: string, requestedBudget?: number | null): string | null {
  const blocks = parsePortfolioBlocks(response);

  // No PORTFOLIO blocks — caller should fall through to remaining prose checks
  if (blocks.length === 0) return null;

  const isMultiBlock = blocks.length > 1;

  // ── Check for parse errors ──
  for (const block of blocks) {
    if (block.parseError) {
      return `[PORTFOLIO:...] block parse error: ${block.parseError}. Use the exact format: [PORTFOLIO:{"total":10000,"positions":[{"symbol":"QQQ","amount":3000}]}]`;
    }
  }

  // ── Validate each block's internal consistency ──
  for (const block of blocks) {
    const label = block.strategy ? `"${block.strategy}" ` : '';

    // total must be a positive number
    if (typeof block.total !== 'number' || isNaN(block.total) || block.total <= 0) {
      return `[PORTFOLIO:...] ${label}block has invalid total: ${JSON.stringify(block.total)}. Total must be a positive integer.`;
    }

    // positions must be a non-empty array
    if (!Array.isArray(block.positions) || block.positions.length === 0) {
      return `[PORTFOLIO:...] ${label}block has missing or empty positions array. Include at least one {symbol, amount} object.`;
    }

    // Each position must have symbol and amount
    for (const pos of block.positions) {
      if (!pos.symbol || typeof pos.symbol !== 'string') {
        return `[PORTFOLIO:...] ${label}block has a position with missing or invalid symbol: ${JSON.stringify(pos)}`;
      }
      if (typeof pos.amount !== 'number' || isNaN(pos.amount) || pos.amount <= 0) {
        return `[PORTFOLIO:...] ${label}block position "${pos.symbol}" has invalid amount: ${pos.amount}. Amount must be a positive number.`;
      }
    }

    // Sum of position amounts must equal total
    const sum = block.positions.reduce((acc, p) => acc + p.amount, 0);
    if (Math.abs(sum - block.total) > 0.01) {
      return `[PORTFOLIO:...] ${label}block position sum ($${sum.toLocaleString()}) does not match total ($${block.total.toLocaleString()}). Adjust positions or total so they match exactly.`;
    }

    // No duplicate symbols within a block
    const symbols = block.positions.map(p => p.symbol.toUpperCase());
    const seen = new Set<string>();
    for (const sym of symbols) {
      if (seen.has(sym)) {
        return `[PORTFOLIO:...] ${label}block has duplicate symbol "${sym}". Each symbol may appear only once per block.`;
      }
      seen.add(sym);
    }
  }

  // ── Multi-strategy per-block budget check ──
  // Each block independently totals to the user's requested budget.
  // Skip this check if no budget is available (single-block responses handle it downstream).
  if (isMultiBlock && requestedBudget && requestedBudget > 0) {
    for (const block of blocks) {
      if (Math.abs(block.total - requestedBudget) > 0.01) {
        const label = block.strategy ? `"${block.strategy}" ` : '';
        return `[PORTFOLIO:...] ${label}block total ($${block.total.toLocaleString()}) does not match requested budget ($${requestedBudget.toLocaleString()}). In a multi-strategy response, every strategy must use the full requested budget.`;
      }
    }
  }

  // ── Cross-check with RECOMMEND markers ──
  // Supports both BUY and SELL markers. BUY markers describe new positions
  // (amount = PORTFOLIO position amount). SELL markers describe trim/reduce
  // operations on existing holdings (amount = sell amount, NOT the PORTFOLIO
  // position amount which reflects the post-trim holding).
  const hasBuyMarkers = /\[RECOMMEND:[A-Z]{1,5}(?:\.[A-Z]{1,2})?:BUY:\$?[\d,]+/i.test(response);
  const hasSellMarkers = /\[RECOMMEND:[A-Z]{1,5}(?:\.[A-Z]{1,2})?:SELL:\$?[\d,]+/i.test(response);
  if (!hasBuyMarkers && !hasSellMarkers) {
    // No RECOMMEND markers at all — but PORTFOLIO blocks exist and are valid.
    // This is a warning situation: the blocks define positions, but there are
    // no trade buttons. Graceful degradation — not a rejection.
    console.log('[validatePortfolioBlocks] ⚠️ PORTFOLIO blocks present but no RECOMMEND markers — trade buttons will be missing');
    return null;
  }

  // ── Extract BUY markers (amount = PORTFOLIO position amount) ──
  const buyPairs: { symbol: string; amount: number }[] = [];
  const seenMarkers = new Set<string>();
  const buyRe = /\[RECOMMEND:([A-Z]{1,5}(?:\.[A-Z]{1,2})?):BUY:\$?([\d,]+(?:\.[\d]+)?)\]/gi;
  let mkMatch: RegExpExecArray | null;
  while ((mkMatch = buyRe.exec(response)) !== null) {
    const raw = mkMatch[0];
    if (seenMarkers.has(raw)) continue;
    seenMarkers.add(raw);
    const rawSymbol = mkMatch[1].toUpperCase();
    const amount = parseFloat(mkMatch[2].replace(/,/g, ''));
    const dotIdx = rawSymbol.lastIndexOf('.');
    const suffix = dotIdx >= 0 ? rawSymbol.slice(dotIdx + 1) : '';
    const cleanSymbol = suffix.length >= 2 && suffix.length <= 3 ? rawSymbol.slice(0, dotIdx) : rawSymbol;
    if (FOREIGN_EXCHANGE_SUFFIXES.has(suffix.toUpperCase())) continue;
    buyPairs.push({ symbol: cleanSymbol, amount });
  }

  // ── Extract SELL markers (amount = how much to sell, not PORTFOLIO position amount) ──
  const sellSymbols = new Set<string>();
  const sellRe = /\[RECOMMEND:([A-Z]{1,5}(?:\.[A-Z]{1,2})?):SELL(?::\$?[\d,]+(?:\.[\d]+)?)?\]/gi;
  while ((mkMatch = sellRe.exec(response)) !== null) {
    const raw = mkMatch[0];
    if (seenMarkers.has(raw)) continue;
    seenMarkers.add(raw);
    const rawSymbol = mkMatch[1].toUpperCase();
    const dotIdx = rawSymbol.lastIndexOf('.');
    const suffix = dotIdx >= 0 ? rawSymbol.slice(dotIdx + 1) : '';
    const cleanSymbol = suffix.length >= 2 && suffix.length <= 3 ? rawSymbol.slice(0, dotIdx) : rawSymbol;
    if (FOREIGN_EXCHANGE_SUFFIXES.has(suffix.toUpperCase())) continue;
    sellSymbols.add(cleanSymbol);
  }

  // Build a lookup: symbol → set of BUY amounts
  const buyBySymbol = new Map<string, Set<number>>();
  for (const pair of buyPairs) {
    if (!buyBySymbol.has(pair.symbol)) {
      buyBySymbol.set(pair.symbol, new Set());
    }
    buyBySymbol.get(pair.symbol)!.add(pair.amount);
  }

  // ── Validate all PORTFOLIO positions against RECOMMEND markers ──
  const allPortfolioPositions = blocks.flatMap((b, bi) =>
    b.positions.map(p => ({ ...p, blockIndex: bi, strategy: b.strategy }))
  );
  for (const pos of allPortfolioPositions) {
    const sym = pos.symbol.toUpperCase();

    // Check BUY markers first (new money being deployed into this position)
    const buyAmounts = buyBySymbol.get(sym);

    // Check SELL markers (existing position being trimmed — still appears in PORTFOLIO)
    const hasSellMarker = sellSymbols.has(sym);

    if ((!buyAmounts || buyAmounts.size === 0) && !hasSellMarker) {
      return `[PORTFOLIO:...] position "${pos.symbol}" has no matching [RECOMMEND:${pos.symbol}:BUY:$${pos.amount}] or [RECOMMEND:${pos.symbol}:SELL] marker. Every portfolio position MUST have a corresponding RECOMMEND marker.`;
    }

    // Contradiction check: same symbol with both BUY and SELL markers
    if (buyAmounts && buyAmounts.size > 0 && hasSellMarker) {
      return `[PORTFOLIO:...] position "${pos.symbol}" has BOTH a BUY and SELL marker — this is contradictory. If you're trimming this position, use SELL only. The PORTFOLIO block should show the post-trim holding amount.`;
    }

    // For BUY-matched positions: strict amount check (single-block only)
    if (buyAmounts && buyAmounts.size > 0 && !isMultiBlock) {
      if (!buyAmounts.has(pos.amount)) {
        const recList = [...buyAmounts].map(a => `$${a.toLocaleString()}`).join(', ');
        return `[PORTFOLIO:...] position "${pos.symbol}" amount mismatch: PORTFOLIO says $${pos.amount.toLocaleString()} but RECOMMEND:BUY marker says ${recList}. Amounts must match exactly.`;
      }
    }

    // For SELL-matched positions: skip amount check — the SELL amount describes
    // how much to sell, and the PORTFOLIO amount is the post-trim holding.
    // These are by definition different numbers and cannot be compared.
  }

  return null; // All blocks valid
}

/**
 * Detect AI response incoherence.
 *
 * PORTFOLIO blocks are the authoritative source — if present and valid,
 * prose scanning is skipped entirely. If no PORTFOLIO blocks exist,
 * fall through to remaining prose checks (internal monologue, duplicate
 * SUMMARY_TLDR, prose questions outside CLARIFY).
 *
 * Returns a detail string if incoherence is detected, null if clean.
 */
export function detectResponseIncoherence(response: string, requestedBudget?: number | null): string | null {
  // ── PRIMARY: PORTFOLIO block validation (replaces Patterns 1-3 and 6) ──
  // If PORTFOLIO blocks are present, they are the ONLY source of truth.
  // Prose is authoritative only when no PORTFOLIO blocks exist.
  const portfolioResult = validatePortfolioBlocks(response, requestedBudget);
  const hasPortfolioBlocks = parsePortfolioBlocks(response).length > 0;
  if (hasPortfolioBlocks) {
    if (portfolioResult !== null) return portfolioResult;
    // PORTFOLIO blocks present and valid — skip all prose scanning below.
    return null;
  }

  // ── Pattern 4 (reduced): Internal monologue leaking ──
  // Only catch the most egregious phrases — PORTFOLIO blocks handle the rest.
  const internalPhrases = [
    /confirmed\s+tickers/i,
    /all\s+buttons\s+are\s+live/i,
  ];
  for (const phrase of internalPhrases) {
    if (phrase.test(response)) {
      return `Internal tool monologue leaking into user-facing text: matched "${phrase.source}". Regenerate without internal commentary.`;
    }
  }

  // ── Pattern 5: "[SUMMARY_TLDR:" appearing twice ──
  const tldrCount = (response.match(/\[SUMMARY_TLDR:/gi) || []).length;
  if (tldrCount >= 2) {
    return `Two [SUMMARY_TLDR:...] markers found — indicates two separate recommendation blocks. Regenerate one coherent response.`;
  }

  // ── Pattern 7: Prose questions outside [CLARIFY:...] blocks ──
  // The contract: every question MUST be wrapped in a [CLARIFY:{...}] block.
  // Questions in plain prose, bold text, or numbered lists outside CLARIFY blocks
  // are invisible to the UI (no chips render) and should be rejected. Same class
  // of incoherence as Pattern 6 — describes a decision point without the required
  // structured tag. Same retry cap, same graceful-failure mechanism.
  //
  // Strip all [CLARIFY:...] blocks first (bracket-counting for nested JSON),
  // then check if the remaining text contains questions.
  let strippedForClarifyCheck = '';
  let clarifyIdx = 0;
  while (clarifyIdx < response.length) {
    const clarifyStart = response.indexOf('[CLARIFY:', clarifyIdx);
    if (clarifyStart === -1) {
      strippedForClarifyCheck += response.slice(clarifyIdx);
      break;
    }
    strippedForClarifyCheck += response.slice(clarifyIdx, clarifyStart);
    // Bracket-count to find the matching ] (handle nested { and } in JSON)
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    let pos = clarifyStart + 1; // skip opening [
    for (; pos < response.length; pos++) {
      const ch = response[pos];
      if (escapeNext) { escapeNext = false; continue; }
      if (ch === '\\') { escapeNext = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') { depth++; continue; }
      if (ch === '}') { if (depth > 0) depth--; continue; }
      if (ch === ']' && depth === 0) break;
    }
    clarifyIdx = pos + 1; // skip past closing ]
  }
  // 7a: Check for question marks in the stripped text (outside CLARIFY blocks)
  // Ignore ? that appears in URLs (preceded by http or followed by =)
  const qCheckText = strippedForClarifyCheck.replace(/https?:\/\/\S+/g, ''); // strip URLs
  const qMarkMatch = qCheckText.match(/\?/);
  if (qMarkMatch) {
    // ── Trailing sign-off tolerance ──
    // If the response has valid [RECOMMEND:...] markers AND the question mark
    // appears in trailing prose (after all markers, in the last paragraph),
    // treat it as a conversational sign-off ("Ready to scale this in?") rather
    // than a missing CLARIFY block. The portfolio is complete — don't reject it.
    const hasRecommendMarkersForQ = /\[RECOMMEND:[A-Z]{1,5}(?:\.[A-Z]{1,2})?:(BUY|SELL)/i.test(response);
    if (hasRecommendMarkersForQ) {
      const lastMarkerIdx = response.lastIndexOf('[RECOMMEND:');
      if (lastMarkerIdx >= 0) {
        // Find the end of the last marker
        const markerEndBracket = response.indexOf(']', lastMarkerIdx);
        const afterMarkers = markerEndBracket >= 0 ? response.slice(markerEndBracket + 1) : '';
        // Check if the ONLY question mark in the response is in trailing prose
        // (after all markers, within the last sentence/paragraph)
        const qInAfterMarkers = afterMarkers.indexOf('?');
        if (qInAfterMarkers >= 0 && qInAfterMarkers < 250) {
          // Verify no question mark appears BEFORE the markers (mid-response question)
          const beforeMarkers = response.slice(0, lastMarkerIdx);
          // Strip [CLARIFY:...] blocks from beforeMarkers too
          let bmStripped = '';
          let bmIdx = 0;
          while (bmIdx < beforeMarkers.length) {
            const cs = beforeMarkers.indexOf('[CLARIFY:', bmIdx);
            if (cs === -1) { bmStripped += beforeMarkers.slice(bmIdx); break; }
            bmStripped += beforeMarkers.slice(bmIdx, cs);
            let depth = 0, inStr = false, esc = false;
            let p = cs + 1;
            for (; p < beforeMarkers.length; p++) {
              const ch = beforeMarkers[p];
              if (esc) { esc = false; continue; }
              if (ch === '\\') { esc = true; continue; }
              if (ch === '"') { inStr = !inStr; continue; }
              if (inStr) continue;
              if (ch === '{') { depth++; continue; }
              if (ch === '}') { if (depth > 0) depth--; continue; }
              if (ch === ']' && depth === 0) break;
            }
            bmIdx = p + 1;
          }
          const hasQBeforeMarkers = /\?/.test(bmStripped.replace(/https?:\/\/\S+/g, ''));
          if (!hasQBeforeMarkers) {
            // Only trailing sign-off — tolerate it. Caller will strip it from output.
            console.log('[chat] Tolerating trailing sign-off question (portfolio markers present)');
            return null;
          }
        }
      }
    }
    // Extract surrounding context for the error detail
    const qIdx = qMarkMatch.index!;
    const context = qCheckText.slice(Math.max(0, qIdx - 40), Math.min(qCheckText.length, qIdx + 40)).replace(/\n/g, ' ').trim();
    return `Prose question detected outside [CLARIFY:...] block: "${context}". All questions MUST use the [CLARIFY:{"question":"...","options":[...]}] format. Rewrite the question as a CLARIFY block, or if no question was intended, rephrase without the question mark.`;
  }
  // 7b: "X or Y or Z" alternative presentations without a question mark
  // The AI lists alternatives with "or" as a prose decision point — e.g.,
  // "You could deploy fresh cash, rebalance, or replace ADBE" — instead of
  // wrapping it in a structured [CLARIFY:...] block. These are invisible to
  // the UI (no chips render) and violate the one-format contract.
  const altCheckText = strippedForClarifyCheck.replace(/https?:\/\/\S+/g, '');
  // Two sub-patterns catch alternative presentations while avoiding false
  // positives on normal financial prose like "NVDA could rally or pull back":
  //   (a) Comma-separated list + "or" last item: "X, Y, or Z"
  //   (b) 2+ "or" connectors (3+ alternatives): "X or Y or Z"
  // Both require a decision-word within 250 chars. Single-"or" conditional
  // prose ("could drop 5% or 10%") is excluded — these are analysis, not
  // user-facing choice prompts.
  const altPattern = /(?:choose|pick|select|want|prefer|let me know|tell me|would you|should i|do you|could|can|may)\s.{10,250}?(?:,.{2,80},|\bor\s.{10,150}?\bor\s)/i;
  const altMatch = altCheckText.match(altPattern);
  if (altMatch) {
    const context = altMatch[0].slice(0, 120).replace(/\n/g, ' ').trim();
    return `Decision alternatives presented outside [CLARIFY:...] block: "${context}...". Use [CLARIFY:{"question":"...","options":["A","B","C"]}] format instead of listing alternatives in prose.`;
  }

  return null;
}

/**
 * Strip trailing conversational sign-off questions from a response that has
 * valid [RECOMMEND:...] markers. Haiku often appends "Ready to scale this in?",
 * "Sound good?", "Want me to adjust anything?" after a complete portfolio.
 * These are harmless conversational noise — don't reject the portfolio over it.
 */
export function stripTrailingQuestions(text: string): string {
  // Only strip if there are RECOMMEND markers (portfolio response)
  if (!/\[RECOMMEND:[A-Z]{1,5}(?:\.[A-Z]{1,2})?:(BUY|SELL)/i.test(text)) return text;

  // Find the last RECOMMEND marker position
  const lastMarkerIdx = text.lastIndexOf('[RECOMMEND:');
  if (lastMarkerIdx < 0) return text;
  const markerEndBracket = text.indexOf(']', lastMarkerIdx);
  if (markerEndBracket < 0) return text;

  const afterMarkers = text.slice(markerEndBracket + 1);
  const qIdx = afterMarkers.indexOf('?');
  if (qIdx < 0 || qIdx > 300) return text; // No question or too far from markers

  // Find the start of the sentence containing the question mark
  const beforeQ = afterMarkers.slice(0, qIdx);
  // Walk back to find sentence start (period+space, newline, or start of after-markers)
  let sentenceStart = 0;
  for (let i = beforeQ.length - 1; i >= 0; i--) {
    if (beforeQ[i] === '\n') { sentenceStart = i + 1; break; }
    if (beforeQ[i] === '.' && (i + 1 >= beforeQ.length || beforeQ[i + 1] === ' ')) {
      sentenceStart = i + 1;
      break;
    }
  }

  // Find the end of the question (next newline or end of text)
  let questionEnd = afterMarkers.indexOf('\n', qIdx);
  if (questionEnd < 0) questionEnd = afterMarkers.length;
  // Include trailing newline if present
  if (questionEnd < afterMarkers.length && afterMarkers[questionEnd] === '\n') questionEnd++;

  // Build cleaned text: everything before the trailing question sentence
  const before = text.slice(0, markerEndBracket + 1);
  const afterBeforeQ = afterMarkers.slice(0, sentenceStart);
  const afterQ = afterMarkers.slice(questionEnd);

  const cleaned = before + afterBeforeQ + afterQ;
  // Clean up double newlines and trailing whitespace
  return cleaned.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Parse incremental top-ups like "add $1,000", "add another 1000", "put in $500 more".
 * Module-level to avoid block-scoped function TDZ in Vercel's serverless webpack bundler.
 */
function extractIncrementalAdd(message: string): number | null {
  // Match: "add $X", "add another $X", "add X", "put $X more", "add additional $X"
  const patterns = [
    /add\s+(?:another\s+)?(?:additional\s+)?\$?([\d,]+(?:\.[\d]{2})?)\s*(?:more|to\s+this|to\s+it|to\s+the\s+portfolio)?/i,
    /put\s+(?:in\s+)?\$?([\d,]+(?:\.[\d]{2})?)\s*(?:more|additional)/i,
  ]
  for (const p of patterns) {
    const m = message.match(p)
    if (m) {
      const val = parseFloat(m[1].replace(/,/g, ''))
      if (!isNaN(val) && val >= 50 && val <= 100000) return val
    }
  }
  // Bare dollar mention that looks like an addition (not a full portfolio build)
  const bareAdd = message.match(/add\s+(?:another\s+)?\$?([\d,]+)\b/i)
  if (bareAdd) {
    const val = parseFloat(bareAdd[1].replace(/,/g, ''))
    if (!isNaN(val) && val >= 50 && val <= 100000) return val
  }
  return null
}

/**
 * Walk backward through user messages to find the original portfolio budget
 * AND accumulate any incremental top-ups along the way.
 *
 * Example: "build a $2000 portfolio" → "add $1000 to this" → "add another 1000"
 *   → finds base $2,000 + $1,000 (msg 2) + $1,000 (msg 3) = $4,000
 */
function extractBudgetFromHistory(messages: Array<{ role: string; content: string }>): number | null {
  let baseBudget: number | null = null
  let incrementalTotal = 0

  // ── Direct buy/sell detection ──
  // When the most recent user message is an explicit "buy $X of Y" or
  // "sell N shares of Z", use $X as the budget for THIS turn — ignoring
  // any previous portfolio budget. This prevents "buy $10 of AAPL" from
  // being validated against a $5,000 portfolio budget from earlier in the chat.
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  if (lastUserMsg) {
    // Pattern A: "buy $X of Y", "sell $X worth of Z", "add $X in ABC"
    const directBuyA = lastUserMsg.content.match(
      /(?:buy|sell|add)\s+\$?([\d,]+(?:\.[\d]{2})?)\s*(?:of|worth|in)\s+([a-z]{1,5})/i
    );
    // Pattern B: "buy XYZ for $X", "add ABC at $X"
    const directBuyB = lastUserMsg.content.match(
      /(?:buy|sell|add)\s+([a-z]{1,5})\s+(?:for|at)\s+\$?([\d,]+(?:\.[\d]{2})?)/i
    );
    // Pattern C: "$X (as stated)", bare "$X" after CLARIFY about amount
    // Also catches "10", "$10", "10 dollars"
    const directBuyC = lastUserMsg.content.match(
      /^\s*\$?([\d,]+(?:\.[\d]{2})?)\s*(?:\(?as\s+stated\)?|dollars?|bucks?)?\s*$/i
    );
    const dollarAmount =
      directBuyA?.[1] ||
      directBuyB?.[2] ||
      directBuyC?.[1] ||
      null;
    if (dollarAmount) {
      const val = parseFloat(dollarAmount.replace(/,/g, ''));
      if (!isNaN(val) && val >= 5 && val <= 500000) {
        console.log(`[chat] Direct buy detected: budget=$${val} ("${lastUserMsg.content.trim().slice(0, 80)}")`);
        return val;
      }
    }
  }
  // ── End direct buy detection ──

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== 'user') continue

    // Check for incremental addition first — these don't reset the base
    const addition = extractIncrementalAdd(msg.content)
    if (addition !== null) {
      incrementalTotal += addition
      continue // this was purely an addition, not a new budget request
    }

    // Check for base portfolio budget
    const budget = extractBudget(msg.content)
    if (budget !== null) {
      baseBudget = budget
      break // found the original budget, stop walking
    }
  }

  if (baseBudget === null) return null
  const total = baseBudget + incrementalTotal
  console.log(`[chat] Budget from history: base=$${baseBudget} + incremental=$${incrementalTotal} = $${total}`)
  return total
}

/**
 * Extract sector keywords from the FULL conversation history (not just last message).
 * This prevents CLARIFY follow-ups like "widen filters" from losing the original
 * sector context (e.g., "healthcare") that was in the first user message.
 *
 * Returns null if no sector keywords found anywhere in the conversation.
 */
function extractSectorsFromHistory(
  messages: Array<{ role: string; content: string }>,
): string[] | null {
  const sectorMap: Record<string, string> = {
    tech: 'technology', technology: 'technology', software: 'technology', ai: 'technology',
    health: 'healthcare', healthcare: 'healthcare', pharma: 'healthcare', biotech: 'healthcare', medical: 'healthcare',
    finance: 'financial_services', financial: 'financial_services', banking: 'financial_services', banks: 'financial_services',
    energy: 'energy', oil: 'energy', gas: 'energy', renewable: 'energy', solar: 'energy',
    consumer: 'consumer_cyclical', retail: 'consumer_cyclical',
    industrial: 'industrials', industrials: 'industrials', manufacturing: 'industrials', aerospace: 'industrials', defense: 'industrials',
    materials: 'basic_materials', basic_materials: 'basic_materials', mining: 'basic_materials', minerals: 'basic_materials', metals: 'basic_materials',
    real_estate: 'real_estate', reit: 'real_estate', property: 'real_estate',
    utilities: 'utilities', utility: 'utilities',
    communication: 'communication_services', telecom: 'communication_services', media: 'communication_services',
  };

  // Walk backward through user messages, collect ALL sectors mentioned anywhere
  const seen = new Set<string>();
  const sectors: string[] = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'user') continue;
    const m = msg.content.toLowerCase();

    for (const [keyword, sector] of Object.entries(sectorMap)) {
      if (m.includes(keyword) && !seen.has(sector)) {
        seen.add(sector);
        sectors.unshift(sector); // preserve original order
      }
    }

    // Once we've found a budget-bearing message, stop scanning further back.
    // The sectors in/after the budget message are the relevant ones.
    if (extractBudget(msg.content) !== null && sectors.length > 0) {
      break;
    }
  }

  return sectors.length > 0 ? sectors : null;
}

/**
 * Detects if the user is asking to widen/relax screening criteria (from a CLARIFY follow-up).
 * Returns relaxed criteria overrides: removes PE cap, lowers growth floor, lowers mkt cap floor.
 */
function detectWidenRequest(messages: Array<{ role: string; content: string }>): boolean {
  // Check the last user message for widen/relax signals
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUser) return false;
  const m = lastUser.content.toLowerCase();
  const widenRe = new RegExp('widen|relax|loosen|drop.*filter|remove.*filter|expand|broaden|any (p/e|price)|all candidates', 'i');
  return widenRe.test(m);
}

/**
 * Apply criteria relaxation for "widen filters" follow-up.
 * Drops PE cap, lowers growth floor to 0, removes min market cap.
 */
function relaxCriteria(criteria: Record<string, any>): Record<string, any> {
  const relaxed = { ...criteria };
  delete relaxed.pe_max;         // Accept any P/E ratio
  delete relaxed.min_growth_rate; // Accept any growth rate
  relaxed.market_cap_min = Math.min(relaxed.market_cap_min || 500_000_000, 500_000_000); // Lower mkt cap floor
  console.log('[chat] 🔍 Criteria relaxed for widen request:', JSON.stringify(relaxed));
  return relaxed;
}

// ── Foreign exchange suffixes (from shared symbol-resolution module) ──

/**
 * Strip known foreign exchange suffixes from RECOMMEND markers.
 * The AI sometimes hallucinates tickers like JNJ.DE, PFE.MX, NVDA.VI
 * despite explicit system-prompt forbidding. This sanitizer catches those
 * BEFORE validation runs, so the response passes instead of being rejected.
 */
function stripForeignSuffixes(text: string): string {
  return text.replace(
    /\[RECOMMEND:([A-Z]{1,5})\.([A-Z]{1,3}):([A-Z]+):(\$?\d*)\]/g,
    (match, symbol: string, suffix: string, action: string, amount: string) => {
      if (FOREIGN_EXCHANGE_SUFFIXES.has(suffix.toUpperCase())) {
        if (/^[A-Z]{2,5}$/.test(symbol)) {
          console.warn(`[chat] 🔧 Stripped foreign suffix "${suffix}" from "${symbol}.${suffix}" → "${symbol}"`);
          return `[RECOMMEND:${symbol}:${action}:${amount}]`;
        }
      }
      return match;
    }
  );
}

// ─── POST Handler ───
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { messages, portfolioContext, additionalContext, mode, timezone, retryAttempt: retryAttemptRaw, validationFailures: retryFailuresRaw } = body
    const retryAttempt: number = typeof retryAttemptRaw === 'number' ? retryAttemptRaw : 0;
    const retryFailures: ValidationFailure[] | undefined = Array.isArray(retryFailuresRaw) ? retryFailuresRaw : undefined;

    // ── Usage limit check (type depends on mode) ──
    const userId = await getOptionalUserId();
    
    // Request tracing — makes it easy to isolate specific failures in Vercel logs
    const lastMsg = messages?.[messages.length - 1]?.content;
    const lastMsgPreview = typeof lastMsg === 'string' ? lastMsg.slice(0, 80) : '[non-text]';
    console.log(`[chat] ===> REQUEST user=${userId?.slice(0,8) || 'anon'} retry=${retryAttempt} msg="${lastMsgPreview}"`);
    
    const usageType = mode === 'deep' ? 'deepAnalysis' : 'message';
    // Compute user's local date from their timezone (not server UTC)
    const localDate = getLocalDateFromTimezone(timezone);
    if (userId && userId !== 'anonymous') {
      const usageCheck = await checkUsageLimit(userId, usageType, localDate, timezone);
      if (!usageCheck.allowed) {
        return Response.json(
          {
            error: usageCheck.reason || 'Daily limit reached',
            remaining: usageCheck.remaining,
            resetsIn: usageCheck.resetsIn,
            type: usageType,
          },
          { status: 429 }
        );
      }

      // ── Abuse protection: consecutive validation failure cooldown ──
      // Independent of daily quota. Caps rapid-fire rejected requests.
      const abuseCheck = await checkAbuseCooldown(userId);
      if (abuseCheck.blocked) {
        return Response.json(
          {
            error: `Too many failed attempts — cooldown active`,
            reason: `Please wait ${abuseCheck.cooldownSeconds}s before trying again.`,
            resetsIn: `${abuseCheck.cooldownSeconds}s`,
            type: 'abuse_cooldown',
          },
          { status: 429 }
        );
      }
    }

    // Build user profile context from request
    const profile: UserProfile = {
      investorStyle: body.investorStyle || 'Lynch',
      riskTolerance: body.riskTolerance || 'Moderate',
      name: body.name || 'M',
      timezone: timezone || 'America/New_York',
    }
    const profileContext = buildUserProfileContext(profile)

    // Finance guard — check last user message
    const lastMessage: string = messages[messages.length - 1]?.content || ''
    const nonFinancePatterns = [
      /^(tell me a joke|write me a poem|what's the weather|recipe for|how to cook|sports score|movie recommendation)/i
    ]
    if (nonFinancePatterns.some(p => p.test(lastMessage))) {
      return Response.json({
        content: "I specialize exclusively in portfolio analysis and market intelligence. What would you like to know about your portfolio or the markets?"
      })
    }

    const systemPrompt = mode === 'alerts'
      ? ALERTS_SYSTEM_PROMPT
      : VANTAGE_SYSTEM_PROMPT

    // ── Manager / Triager (Phase 2): classify intent ──
    const classification = classifyIntent(lastMessage);
    console.log(`[chat] ===> MANAGER intent=${classification.intent} confidence=${classification.confidence.toFixed(2)} sectors=[${classification.mentionedSectors.join(',') || 'none'}] tickers=[${classification.mentionedTickers.join(',') || 'none'}]${classification.needsClarify ? ' CLARIFY_NEEDED:' + classification.clarifyReason : ''}`);

    // ── Deviation facts: inject history so AI knows not to repeat ──
    let deviationContext = '';
    try {
      if (userId && userId !== 'anonymous') {
        const facts = await getActiveFacts(userId);
        const devFacts = facts.filter((f: any) => f.subject?.startsWith?.('user_style_deviation:') ?? false);
        if (devFacts.length > 0) {
          deviationContext = `
DEVIATION HISTORY (style deviations previously discussed):
${devFacts.map((f: any, i: number) => `${i + 1}. ${f.claim} (${f.confidence}, ${new Date(f.created_at).toLocaleDateString()})`).join('\n')}

If there are ${devFacts.length >= 2 ? `${devFacts.length} deviations in similar categories` : 'a deviation'} above, apply Rule 5: soften or skip the acknowledgment.
`;
        }
      }
    } catch (e) {
      console.error('[chat] deviation facts fetch error:', e);
    }

    // Stage 1: DeepSeek screening
    const screening = await screenMessage(lastMessage)

    // Stage 2: Search if needed
    let searchContext = ''
    if (screening.needsSearch && screening.searchQuery) {
      searchContext = await searchWeb(screening.searchQuery)
    }

    // ── Live market data: extract tickers from user message + search results → Finnhub ──
    let liveMarketContext = ''
    // Primary: explicit tickers in user message ($SPCX, AAPL)
    let tickers = extractTickers(lastMessage)
    // Secondary: extract tickers from search result titles (handles company names like SpaceX→SPCX)
    if (searchContext) {
      const searchTickers = extractTickers(searchContext)
      tickers = [...new Set([...tickers, ...searchTickers])]
    }
    // Tertiary: Finnhub search to resolve company names (e.g., "Tesla" → TSLA, "Google" → GOOGL)
    // No intent gate — if extractSearchTerm() found a proper noun, it's worth a lookup.
    if (tickers.length === 0) {
      const searchTerm = extractSearchTerm(lastMessage)
      if (searchTerm) {
        try {
          const fRes = await fetch(
            `https://finnhub.io/api/v1/search?q=${encodeURIComponent(searchTerm)}&token=${process.env.FINNHUB_IO_API_KEY}`
          )
          if (fRes.ok) {
            const fData = await fRes.json()
            if (fData.result?.length > 0) {
              tickers = fData.result.slice(0, 2).map((r: any) => r.symbol)
              console.log('[chat] Finnhub search resolved:', searchTerm, '→', tickers)
            }
          }
        } catch (e) {
          console.error('[chat] Finnhub search error:', e)
        }
      }
    }

    // ── GUARDRAIL: Filter to US-listed tickers only ──
    // Any ticker extracted from search results or user message must be verified
    // against the Finnhub US symbol cache before the model sees live data for it.
    // This is the pre-generation filter — the model should never see foreign-listed
    // symbols in live market data.
    if (tickers.length > 0) {
      try {
        const usSymbols = await loadSymbolCache()
        if (usSymbols.size > 0) {
          const foreignFiltered: string[] = []
          tickers = tickers.filter(t => {
            const upper = t.toUpperCase()
            if (upper.includes('.') || !/^[A-Z]{1,5}$/.test(upper)) {
              foreignFiltered.push(t)
              return false // not even a valid US ticker format
            }
            const isUS = usSymbols.has(upper)
            if (!isUS) foreignFiltered.push(t)
            return isUS
          })
          if (foreignFiltered.length > 0) {
            console.log(`[chat] 🛡️ US-only filter: removed ${foreignFiltered.length} non-US ticker(s): ${foreignFiltered.join(', ')}`)
          }
          if (tickers.length === 0) {
            console.log('[chat] 🛡️ US-only filter: NO US-traded tickers found for this query — model will receive empty live data')
          }
        }
      } catch (e) {
        console.error('[chat] US-only filter error (failing open):', e)
        // Fail open — let the validator catch foreign markers downstream
      }
    }

    if (tickers.length > 0) {
      try {
        const quotes = await getBatchQuotes(tickers)
        if (quotes.size > 0) {
          const quoteLines: string[] = []
          for (const [symbol, q] of quotes) {
            if (q && q.price > 0) {
              const sign = q.change >= 0 ? '+' : ''
              quoteLines.push(
                `${symbol}: $${q.price.toFixed(2)} | ` +
                `${sign}$${q.change.toFixed(2)} (${sign}${q.changePercent.toFixed(1)}%) | ` +
                `Day: $${q.low?.toFixed(2)}–$${q.high?.toFixed(2)} | ` +
                `Prev close: $${q.previousClose?.toFixed(2)} | ` +
                `Source: ${q.source}`
              )
            }
          }
          if (quoteLines.length > 0) {
            liveMarketContext = `
📡 LIVE MARKET DATA (real-time via Finnhub — AUTHORITATIVE):
${quoteLines.join('\n')}

CRITICAL: Use these live prices for any current-price questions. They override both training data AND web search results for current stock prices. Web search results may contain additional context (news, IPO dates, analysis) but the PRICES above are real-time and authoritative.
`
          }
        }
      } catch (e) {
        console.error('[chat] Live market data fetch error:', e)
        // Non-fatal — continue with search results only
      }
    }

    // ── Baseline market context: always include major index ETFs ──
    // If no tickers were extracted from user message, the AI has ZERO
    // awareness of today's market. A question like "what happened today?"
    // would get a training-data answer from 2024. Include SPY/QQQ/DIA/IWM/VIX
    // as a floor so the AI always knows which way the wind is blowing.
    if (!liveMarketContext) {
      try {
        const baselineSymbols = ['SPY', 'QQQ', 'DIA', 'IWM', 'VIX']
        const baselineQuotes = await getBatchQuotes(baselineSymbols)
        if (baselineQuotes.size > 0) {
          const lines: string[] = []
          const names: Record<string, string> = { SPY: 'S&P 500', QQQ: 'Nasdaq', DIA: 'Dow', IWM: 'Russell 2000', VIX: 'Volatility' }
          for (const [sym, q] of baselineQuotes) {
            if (q && q.price > 0) {
              const sign = q.change >= 0 ? '+' : ''
              lines.push(
                `${sym} (${names[sym] || 'ETF'}): $${q.price.toFixed(2)} | ` +
                `${sign}$${q.change.toFixed(2)} (${sign}${q.changePercent.toFixed(1)}%) | ` +
                `Day: $${q.low?.toFixed(2)}–$${q.high?.toFixed(2)}`
              )
            }
          }
          if (lines.length > 0) {
            liveMarketContext = `
📡 MARKET SNAPSHOT (real-time — baseline indices):
${lines.join('\n')}

Use these for any market-direction questions ("how are markets today?", "any sell-off?", etc). When the user asks about specific stocks, these index moves provide the macro context.
`
          }
        }
      } catch (e) {
        console.error('[chat] Baseline market data error:', e)
      }
    }

    // ── Pre-flight symbol resolution: resolve company names from search results
    // BEFORE the Anthropic call. This prevents the model from burning tool-loop
    // turns on one-by-one resolveSymbol calls (the #1 cause of cut-off responses).
    let preResolvedContext = ''
    let preResolvedCount = 0
    try {
      const preResolved = await preResolveTickers(lastMessage, searchContext)
      preResolvedCount = preResolved.length
      if (preResolved.length > 0) {
        preResolvedContext = '\n🏷️ PRE-RESOLVED TICKER MAPPINGS (use these directly — DO NOT call resolveSymbol for names listed here):\n' +
          preResolved.map(r => `  ${r.name} → ${r.symbol}`).join('\n') +
          '\n\nOnly call resolveSymbol if you need a company NOT listed above.'
      }
    } catch (e) {
      console.error('[chat] Pre-resolution error (non-fatal):', e)
    }

    // ── Prompt Caching: static instructions cached, dynamic context not ──
    // CRITICAL: Inject authoritative server date — models do NOT know the real date
    const currentDate = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: timezone || 'America/New_York',
    });
    const dateContext = `\nAUTHORITATIVE CURRENT DATE: ${currentDate} (in user's timezone). Treat this as ground truth. Never assert a specific date or recency claim ("today", "just happened", "recently", "IPO'd on [date]") that conflicts with this date. If you are unsure about the timing of an event, hedge with "reportedly" or "according to recent coverage" rather than fabricating a specific date.`;

    // ── Retry prompt injection (for validation-driven regeneration) ──
    const requestedBudget = extractBudgetFromHistory(messages);

    // ── Stock Screening: delegated to Phase 3 orchestrator ──
    const { orchestrateScreening } = await import('@/lib/ai/orchestrator');
    const screeningOrch = await orchestrateScreening(lastMessage, profile.investorStyle, messages, requestedBudget);
    const screeningContext = screeningOrch.context;
    let screeningResults: Awaited<ReturnType<typeof import('@/lib/ai/orchestrator').runScreening>> | null = screeningOrch.results;
    let screeningCriteria: Record<string, any> | null = screeningOrch.criteria;
    let screeningSource = screeningOrch.source;
    let multiSectorPools = screeningOrch.multiSectorPools;

    if (!screeningOrch.skipped) {
      console.log(`[chat] 🔍 Orchestrator: source=${screeningOrch.source} pools=${screeningOrch.multiSectorPools?.length || 0} results=${screeningOrch.results?.results?.length || 0}`);
      if (screeningOrch.results?.error) {
        console.error('[chat] 🔍 Screener error:', screeningOrch.results.error);
      }
    }
    const systemBlocks: SystemBlock[] = [
    ...CHAT_SAFETY_BLOCKS,
      {
        type: 'text' as const,
        text: systemPrompt,
        cache_control: { type: 'ephemeral' as const },
      },
      {
        type: 'text' as const,
        text: [dateContext, profileContext, portfolioContext || '', additionalContext || '', searchContext, liveMarketContext, preResolvedContext, deviationContext, screeningContext].filter(Boolean).join('\n\n'),
      },
    ];

    if (retryAttempt >= 1 && retryFailures && retryFailures.length > 0) {
      console.log(`[chat] Retry attempt ${retryAttempt} — injecting stricter prompt. Failures:`, retryFailures.length);
      systemBlocks.push({
        type: 'text' as const,
        text: buildRetryPrompt(retryFailures),
      });
    }

    // ── Model selection with tier-based access control ──────
    // Default: Haiku for chat, Sonnet for deep analysis.
    // Tier override: if model_access='haiku', Sonnet is blocked —
    // deep analysis falls back to Haiku (slower but still functional).
    let modelAccess = 'haiku+sonnet'; // safe default for anonymous / on-error
    if (userId && userId !== 'anonymous') {
      try {
        const supabase = createServerClient();
        // Resolve user's tier, then look up model_access for that tier.
        // (We don't use get_tier_limit() RPC — it returns INTEGER and
        // model_access is a string like 'haiku' or 'haiku+sonnet'.)
        const { data: userRow } = await (supabase as any)
          .from('users').select('tier').eq('id', userId).single();
        if (userRow?.tier) {
          const { data: tierRow } = await (supabase as any)
            .from('subscription_tiers').select('id').eq('key', userRow.tier).single();
          if (tierRow?.id) {
            const { data: featRow } = await (supabase as any)
              .from('tier_features').select('id').eq('key', 'model_access').single();
            if (featRow?.id) {
              const { data: valRow } = await (supabase as any)
                .from('tier_feature_values')
                .select('value')
                .eq('tier_id', tierRow.id)
                .eq('feature_id', featRow.id)
                .single();
              if (valRow?.value && typeof valRow.value === 'string') {
                modelAccess = valRow.value;
              }
            }
          }
        }
      } catch { /* use default — sonnet allowed */ }
    }

    let model: string;
    if (mode === 'deep') {
      model = modelAccess === 'haiku' ? 'claude-haiku-4-5' : 'claude-sonnet-4-6';
    } else {
      model = 'claude-haiku-4-5';
    }

    // Safety: cap messages to prevent context abuse (UI sends max 5)
    const cappedMessages = messages.slice(-20);

    // ── Tool definition: resolveSymbol ────────────────────────
    const resolveSymbolTool: Anthropic.Tool = {
      name: 'resolveSymbol',
      description:
        'Resolve a company name to its authoritative stock ticker symbol(s). ' +
        'Use this BEFORE recommending any stock to verify the correct ticker.',
      input_schema: {
        type: 'object' as const,
        properties: {
          companyName: {
            type: 'string',
            description: 'The company name to look up (e.g., "SK Hynix", "Apple")',
          },
        },
        required: ['companyName'],
      },
    };

    // ── Build initial conversation ────────────────────────────
    const initialMessages: Array<{ role: 'user' | 'assistant'; content: any }> =
      cappedMessages.map((m: any) => ({
        role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.content,
      }));

    const stream = await client.messages.stream({
      model,
      max_tokens: mode === 'deep' ? 8192 : 4096,
      system: systemBlocks as any,
      messages: initialMessages,
      tools: [resolveSymbolTool],
      tool_choice: { type: 'auto' },
    })

    const encoder = new TextEncoder();
    const fullResponse: string[] = []; // ALL text from ALL tool-call turns
    const readable = new ReadableStream({
      async start(controller) {
        try {
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let turn = 0;
        const MAX_TOOL_TURNS = 8; // enough for complex portfolios with many symbol lookups (pharma, minerals, etc.)
        const convMessages: Array<{ role: 'user' | 'assistant'; content: any }> =
          [...initialMessages];

        // ── Screening results checklist ──
        if (screeningResults && screeningCriteria) {
          const isMulti = screeningCriteria._multi === true && multiSectorPools && multiSectorPools.length > 0;

          if (isMulti && multiSectorPools) {
            // ── MULTI-SECTOR checklist: one entry per sector pool ──
            const pools = multiSectorPools; // narrow type
            const count = screeningResults.results?.length || 0;
            const perSector = pools.map(p => `${p.label}: ${p.count}`).join(', ');
            const providers = [...new Set(pools.map(p => p.provider))].join('+');

            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              screeningMeta: { criteria: screeningCriteria, criteriaDescription: perSector, matchCount: count, provider: providers, source: screeningSource, multiSector: true }
            })}\n\n`));
            sendChecklist(controller, encoder, 'screening', 'done',
              `${perSector} via ${providers}`);
            sendChecklist(controller, encoder, 'tickers_resolved', 'done',
              `${count} candidates across ${pools.length} sectors${preResolvedCount > 0 ? ` + ${preResolvedCount} pre-resolved` : ''}`);
          } else {
            // ── SINGLE-POOL checklist: original behavior ──
            const count = screeningResults.results?.length || 0;
            const criteriaDesc = Object.entries(screeningCriteria)
              .map(([k, v]) => {
                if (k === '_multi') return '';
                if (k === 'market_cap_min') return `MCap > $${(v/1e9).toFixed(1)}B`;
                if (k === 'market_cap_max') return `MCap < $${(v/1e9).toFixed(1)}B`;
                if (k === 'pe_max') return `PE < ${v}`;
                if (k === 'min_growth_rate') return `Growth > ${(v*100).toFixed(0)}%`;
                if (k === 'sector') return `${v}`;
                if (k === 'volume_min') return `Vol > ${(v/1e6).toFixed(1)}M`;
                return '';
              })
              .filter(Boolean)
              .join(', ');

            if (count > 0) {
              const sourceLabel = screeningSource === 'style_defaults' ? ` (${profile.investorStyle} defaults)` : '';
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                screeningMeta: { criteria: screeningCriteria, criteriaDescription: criteriaDesc + sourceLabel, matchCount: count, provider: screeningResults.provider, source: screeningSource }
              })}\n\n`));
              sendChecklist(controller, encoder, 'screening', 'done',
                `${count} US-listed candidates${sourceLabel} via ${screeningResults.provider} — ${criteriaDesc}`);
              sendChecklist(controller, encoder, 'tickers_resolved', 'done',
                `${count} screened from ${criteriaDesc}${preResolvedCount > 0 ? ` + ${preResolvedCount} pre-resolved` : ''}`);
            } else {
              sendChecklist(controller, encoder, 'screening', 'failed',
                `0 matches for ${criteriaDesc}`);
              sendChecklist(controller, encoder, 'tickers_resolved', 'failed',
                `0 results for ${criteriaDesc} — try wider criteria`);
            }
          }
        } else {
          sendChecklist(controller, encoder, 'screening', 'skipped', 'No screening criteria detected');
          sendChecklist(controller, encoder, 'tickers_resolved', 'done',
            preResolvedCount > 0 ? `${preResolvedCount} resolved` : 'None needed');
        }

        // ── Checklist: Building recommendations ──
        sendChecklist(controller, encoder, 'recommendations_built', 'in_progress');

        // ── Multi-turn tool-calling loop ──────────────────────
        do {
          const turnStream = turn === 0
            ? stream // reuse initial stream for first turn
            : await client.messages.stream({
                model,
                max_tokens: mode === 'deep' ? 8192 : 4096,
                system: systemBlocks as any,
                messages: convMessages,
                tools: [resolveSymbolTool],
                tool_choice: { type: 'auto' },
              });

          let turnText = '';
          const turnToolBlocks: Array<{ id: string; name: string; input: any }> = [];
          let currentToolBlock: { id?: string; name?: string; inputJson: string } | null = null;
          let hadToolCalls = false;

          for await (const chunk of turnStream) {
            if (chunk.type === 'message_start') {
              totalInputTokens += (chunk as any).message?.usage?.input_tokens || 0;
            }
            if (chunk.type === 'message_delta') {
              totalOutputTokens += (chunk as any).usage?.output_tokens || 0;
              if ((chunk as any).delta?.stop_reason === 'tool_use') hadToolCalls = true;
            }

            if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
              const text = chunk.delta.text;
              turnText += text;
              fullResponse.push(text);
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
            }

            if (chunk.type === 'content_block_start') {
              const block = (chunk as any).content_block;
              if (block?.type === 'tool_use') {
                hadToolCalls = true;
                currentToolBlock = { id: block.id, name: block.name, inputJson: '' };
              }
            }

            if (chunk.type === 'content_block_delta' && chunk.delta.type === 'input_json_delta') {
              if (currentToolBlock) currentToolBlock.inputJson += (chunk.delta as any).partial_json;
            }

            if (chunk.type === 'content_block_stop') {
              if (currentToolBlock && currentToolBlock.id) {
                try {
                  turnToolBlocks.push({
                    id: currentToolBlock.id,
                    name: currentToolBlock.name || 'unknown',
                    input: JSON.parse(currentToolBlock.inputJson),
                  });
                } catch (e) { console.warn('[chat] Tool input parse error:', e); }
                currentToolBlock = null;
              }
            }
          }

          if (!hadToolCalls || turnToolBlocks.length === 0) break;

          // ── Inject assistant + tool results into conversation ───
          console.log(`[chat] Turn ${turn + 1}: ${turnToolBlocks.length} tool call(s)`);
          convMessages.push({
            role: 'assistant',
            content: [
              ...(turnText ? [{ type: 'text' as const, text: turnText }] : []),
              ...turnToolBlocks.map((tb) => ({
                type: 'tool_use' as const, id: tb.id, name: tb.name, input: tb.input,
              })),
            ],
          });
          for (const tb of turnToolBlocks) {
            let result: string;
            if (tb.name === 'resolveSymbol') {
              const t0 = Date.now();
              result = await resolveSymbol(tb.input?.companyName || '');
              console.log(`[chat] resolveSymbol("${tb.input?.companyName || ''}") → ${Date.now() - t0}ms`);
            } else {
              result = JSON.stringify({ error: `Unknown tool: ${tb.name}` });
            }
            convMessages.push({
              role: 'user' as const,
              content: [{ type: 'tool_result' as const, tool_use_id: tb.id, content: result }],
            });
          }
          turn++;

          // ── Turn-exhaustion warning: inject a system message when model is burning
          // through turns without producing any RECOMMEND markers yet ──
          const accumulatedText = fullResponse.join('');
          const hasAnyRecs = /\[RECOMMEND:[A-Z0-9]{1,5}(?:\.[A-Z]{1,2})?:(BUY|SELL)/i.test(accumulatedText);
          if (!hasAnyRecs) {
            const remaining = MAX_TOOL_TURNS - turn;
            if (remaining === 3) {
              console.log(`[chat] ⚠️ Turn ${turn}/${MAX_TOOL_TURNS} — no markers yet. Injecting batch warning (${remaining} turns remain)`);
              convMessages.push({
                role: 'user' as const,
                content: [{ type: 'text' as const, text: `[SYSTEM] You have used ${turn}/${MAX_TOOL_TURNS} allowed tool turns and have NOT produced any [RECOMMEND:...] markers yet. IF you need more symbol lookups, call ALL of them in ONE message — batch them. If you run out of turns before producing markers, the user will only see your partial text.` }],
              });
            } else if (remaining === 1) {
              console.log(`[chat] 🔴 Turn ${turn}/${MAX_TOOL_TURNS} — URGENT: 1 turn remaining, no markers yet`);
              convMessages.push({
                role: 'user' as const,
                content: [{ type: 'text' as const, text: `[SYSTEM] ⚠️ URGENT — ${remaining} turn remaining out of ${MAX_TOOL_TURNS}, and you have produced ZERO [RECOMMEND:...] markers. Do NOT call any more tools. Produce your full recommendation with markers NOW. If you fail to emit markers this turn, the user will see only partial/incomplete text.` }],
              });
            }
          }
        } while (turn < MAX_TOOL_TURNS);

        let responseText = fullResponse.join('');

        // ── Unified pass 1: sanitization + incoherence detection ──
        const validationReport = validateResponse(responseText, requestedBudget);
        responseText = validationReport.sanitizedText;
        if (validationReport.suffixesStripped > 0) {
          console.warn(`[chat] 🔧 Stripped ${validationReport.suffixesStripped} foreign exchange suffixes`);
        }

        // ── Guard: tool-loop exhaustion detection ──
        const hasMarkers = /\[RECOMMEND:[A-Z]{1,5}(?:\.[A-Z]{1,2})?:(BUY|SELL):\$?[\d,]+\]/i.test(responseText);
        if (!hasMarkers && turn >= MAX_TOOL_TURNS) {
          console.warn(`[chat] ⚠️ Tool-loop exhausted after ${turn} turns — no RECOMMEND markers produced. Response starts with: "${responseText.slice(0, 100)}"`);
        }

        // ── Checklist: Recommendations built ──
        const markerCount = (responseText.match(/\[RECOMMEND:[^\]]*\]/g) || []).length;
        sendChecklist(controller, encoder, 'recommendations_built', 'done',
          markerCount > 0 ? `${markerCount} markers` : 'No markers');

        // ── Validate RECOMMEND markers (catch hallucinated ADR tickers like SKM≠SK Hynix) ──
        // Phase 7: Finnhub validation runs through circuit breaker + fallback
        sendChecklist(controller, encoder, 'marker_format', 'in_progress');
        let correctedCount = 0;
        try {
          const { result: validation, source } = await withFallback(
            'finnhub',
            () => validateRecommendationMarkers(responseText),
            'marker_format',
          );
          if (source === 'fallback') {
            stageLog('warn', 'marker_format', 'Finnhub validation skipped — circuit open, using raw markers', { dependency: 'finnhub' });
          }
          if (validation.hasCorrections) {
            correctedCount = validation.issues.length;
            console.warn('[chat] ⚠️ Marker corrections:', JSON.stringify(validation.issues, null, 2));
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ corrections: validation.issues, correctedText: validation.corrected })}\n\n`)
            );
            responseText = validation.corrected!; // guarded by hasCorrections above
          }
        } catch (valErr) {
          stageLog('error', 'marker_format', 'Marker validation failed', { dependency: 'finnhub', data: { error: String(valErr) } });
        }
        sendChecklist(controller, encoder, 'marker_format', 'done',
          correctedCount > 0 ? `${correctedCount} corrected` : `${markerCount || 0} valid`);

        // NOTE: fillMissingMarkers removed — buttons now ONLY from explicit
        // [RECOMMEND:SYMBOL:BUY:$AMOUNT] markers. Prose heuristics were the
        // root cause of ghost tickers (exchange codes), contradictory buttons,
        // and duplicate positions across foreign listings.

        // ── Strip markers from CLARIFY responses ──
        // CLARIFY responses ([CLARIFY:{...}] blocks) are information-gathering
        // only — they must never contain actionable [RECOMMEND:...] markers.
        // If the model leaks markers into a CLARIFY response, strip them here
        // to prevent amount-less buttons from rendering in the client.
        if (/\[CLARIFY:/.test(responseText)) {
          const stripped = responseText.replace(/\[RECOMMEND:[^\]]*\]/g, '');
          const removedCount = (responseText.match(/\[RECOMMEND:[^\]]*\]/g) || []).length;
          if (removedCount > 0) {
            console.warn(`[chat] ⚠️ Stripped ${removedCount} RECOMMEND markers from CLARIFY response`);
            responseText = stripped;
          }
        }

        // ── Response Coherence Check ──
        // Detects AI producing two contradictory portfolios in one response,
        // raw "NVDA or or or or" marker-decision chains, and internal monologue
        // leaking into user-facing text. These indicate a broken generation that
        // should be regenerated — no partial render.
        sendChecklist(controller, encoder, 'coherence_check', 'in_progress');
        const coherenceFailure = validationReport.issues.find(i => i.pass === 'incoherence' && i.severity === 'fatal')?.message || null;
        if (coherenceFailure) {
          console.warn('[chat] ⚠️ Response coherence check FAILED:', coherenceFailure);
          console.warn('[chat] Raw response (first 3000 chars):', responseText.slice(0, 3000));
          sendChecklist(controller, encoder, 'coherence_check', 'failed', 'Dual portfolios or leaked monologue');

          // Log coherence failure to DB for debugging observability
          try {
            if (userId && userId !== 'anonymous') {
              const supabase = createServerClient();
              const rawMarkers = [...responseText.matchAll(/\[RECOMMEND:[^\]]*\]/g)].map(m => m[0]);
              await (supabase as any)
                .from('validation_failures')
                .insert({
                  user_id: userId,
                  attempt: (retryAttempt || 0) + 1,
                  prompt: lastMessage.slice(0, 2000),
                  raw_response: responseText.slice(0, 5000),
                  raw_markers: rawMarkers.length > 0 ? rawMarkers : null,
                  failures: [{ check: 'response_coherence', detail: coherenceFailure, offendingMarkers: [] }],
                  budget: requestedBudget,
                  allocation: 0,
                });
              console.log('[chat] Coherence failure logged to DB');
            }
          } catch (logErr) {
            console.error('[chat] Coherence failure DB log error:', logErr);
          }

          if (retryAttempt >= 1) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ fatalValidationFailure: true, failures: [{ check: 'response_coherence', detail: coherenceFailure, offendingMarkers: [] }] })}\n\n`)
            );
          } else {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ regenerate: true, failures: [{ check: 'response_coherence', detail: coherenceFailure, offendingMarkers: [] }], budget: requestedBudget })}\n\n`)
            );
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
          return;
        }
        // ── Precompute marker presence BEFORE any gate code references it ──
        const hasRecommendMarkers = /\[RECOMMEND:[A-Z0-9]{1,5}(?:\.[A-Z]{1,2})?:(BUY|SELL)/i.test(responseText);

        // ── Budget Coherence Gate (marker-less recommendations) ──
        // If the user requested a budget, the response has NO [RECOMMEND:...] markers,
        // but extractResponseTotal found a portfolio total that's >2% off — the AI made
        // text-based recommendations with wrong amounts. Reject so the AI regenerates
        // with proper markers AND correct budget.
        // SKIP for [CLARIFY:...] responses — frameworks with budget numbers are fine.
        const hasClarifyMarkers = /\[CLARIFY:/.test(responseText);
        if (requestedBudget !== null && !hasRecommendMarkers && !hasClarifyMarkers) {
          const budgetGate = validateBudgetGate(lastMessage, responseText, requestedBudget);
          if (budgetGate.hasViolation && budgetGate.responseTotal !== null) {
            console.warn('[chat] ⚠️ Budget coherence gate FAILED:', budgetGate.message);
            sendChecklist(controller, encoder, 'coherence_check', 'failed', `Budget mismatch: $${budgetGate.responseTotal.toLocaleString()} vs $${requestedBudget.toLocaleString()}`);
            if (retryAttempt >= 1) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ fatalValidationFailure: true, failures: [{ check: 'budget_reconciliation', detail: budgetGate.message, offendingMarkers: [] }] })}\n\n`)
              );
            } else {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ regenerate: true, failures: [{ check: 'budget_reconciliation', detail: budgetGate.message + ' Regenerate with correct [RECOMMEND:SYMBOL:BUY:$AMOUNT] markers that sum to exactly $' + requestedBudget.toLocaleString() + '.', offendingMarkers: [] }], budget: requestedBudget })}\n\n`)
              );
            }
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
            return;
          }
        }

        sendChecklist(controller, encoder, 'coherence_check', 'done', 'No duplicates found');

        // ── STRICT VALIDATION: format, symbol existence, dedupes, budget reconciliation ──
        // ONLY runs when response contains RECOMMEND markers. Responses without markers
        // (clarifying questions, informational replies, "I can't recommend X" prose) are
        // skipped — they aren't recommendations and shouldn't be validated as such.
        // ALSO skip for multi-strategy: PORTFOLIO blocks validated per-block by
        // validatePortfolioBlocks (each block independently checks against budget).
        // Global marker-sum would be N × budget, which is expected and correct.
        const portfolioBlocks = parsePortfolioBlocks(responseText);
        const isMultiStrategy = portfolioBlocks.length > 1;

        let validationRejected = false;
        if (requestedBudget !== null && hasRecommendMarkers) {
          sendChecklist(controller, encoder, 'symbol_verification', 'in_progress');
          try {
            const strictValidation = await validateRecommendations(responseText, requestedBudget, undefined, isMultiStrategy);
            if (!strictValidation.ok) {
              console.warn('[chat] ⚠️ Strict validation FAILED:', JSON.stringify(strictValidation.failures, null, 2));
              validationRejected = true;

              // Determine which checks failed for checklist detail
              const failedChecks = strictValidation.failures.map(f => f.check);
              if (failedChecks.includes('symbol_resolution') || failedChecks.includes('marker_format') || failedChecks.includes('duplicate_company')) {
                sendChecklist(controller, encoder, 'symbol_verification', 'failed',
                  strictValidation.failures.filter(f => f.check !== 'budget_reconciliation').map(f => f.detail).join('; '));
              } else {
                sendChecklist(controller, encoder, 'symbol_verification', 'done', 'All symbols verified');
              }

              if (failedChecks.includes('budget_reconciliation')) {
                const budgetFailure = strictValidation.failures.find(f => f.check === 'budget_reconciliation');
                sendChecklist(controller, encoder, 'budget_reconciliation', 'failed',
                  budgetFailure?.detail || 'Budget mismatch');
              } else {
                // Validation failed on an earlier check — budget was never reached
                sendChecklist(controller, encoder, 'budget_reconciliation', 'skipped', 'Skipped — earlier check failed');
              }

              // ... DB logging omitted for brevity (unchanged)
              try {
                if (userId && userId !== 'anonymous') {
                  const supabase = createServerClient();
                  const rawMarkers = [...responseText.matchAll(/\[RECOMMEND:[^\]]*\]/g)].map(m => m[0]);
                  await (supabase as any)
                    .from('validation_failures')
                    .insert({
                      user_id: userId,
                      attempt: (retryAttempt || 0) + 1,
                      prompt: lastMessage.slice(0, 2000),
                      raw_response: responseText.slice(0, 5000),
                      raw_markers: rawMarkers.length > 0 ? rawMarkers : null,
                      failures: JSON.parse(JSON.stringify(strictValidation.failures)),
                      budget: requestedBudget,
                      allocation: 0,
                    });
                  console.log('[chat] Validation failure logged to DB');
                }
              } catch (logErr) {
                console.error('[chat] Validation failure DB log error:', logErr);
              }

              if (retryAttempt >= 1) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ fatalValidationFailure: true, failures: strictValidation.failures })}\n\n`)
                );
              } else {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ regenerate: true, failures: strictValidation.failures, budget: requestedBudget })}\n\n`)
                );
              }
            } else {
              // All checks passed
              sendChecklist(controller, encoder, 'symbol_verification', 'done',
                `${strictValidation.result.count} symbols verified`);
              sendChecklist(controller, encoder, 'budget_reconciliation', 'done',
                `$${strictValidation.result.total.toLocaleString()} / $${requestedBudget.toLocaleString()}`);
            }
          } catch (strictValErr) {
            console.error('[chat] Strict validation error:', strictValErr);
          }
        } else if (requestedBudget !== null && !hasRecommendMarkers) {
          console.log('[chat] ⏭️ Skipped validation — no RECOMMEND markers in response (likely a question or informational reply)');
          sendChecklist(controller, encoder, 'symbol_verification', 'skipped', 'Non-recommendation response');
          sendChecklist(controller, encoder, 'budget_reconciliation', 'skipped', 'No budget to reconcile');
        }

        // ── Budget reconciliation gate (secondary guard) ──
        // Only fire if validation didn't already reject (avoid confusing users with
        // budget warnings on top of symbol/format failures — client already shows those).
        if (!validationRejected) {
        try {
          const budgetGate = validateBudgetGate(lastMessage, responseText, requestedBudget);
          if (budgetGate.hasViolation) {
            console.warn('[chat] ⚠️ Budget gate violation:', JSON.stringify(budgetGate, null, 2));
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ budgetViolation: budgetGate })}\n\n`)
            );
          }
        } catch (bgErr) {
          console.error('[chat] Budget gate error:', bgErr);
        }
        }

        // [DONE] signal
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        // ── Post-stream: await DB write BEFORE closing the stream ──
        // Must complete before controller.close() so the client's
        // refreshRemaining() reads the updated count, not the old one.
        // Skip usage tracking for rejected responses — client will retry.
        if (userId && userId !== 'anonymous' && !validationRejected) {
          const totalTokens = totalInputTokens + totalOutputTokens;
          const isDeep = mode === 'deep';
          // Claude 4.5 Haiku: $1/MTok input, $5/MTok output
          // Claude 4.6 Sonnet: $3/MTok input, $15/MTok output
          const cost = isDeep
            ? (totalInputTokens / 1_000_000) * 3 + (totalOutputTokens / 1_000_000) * 15
            : (totalInputTokens / 1_000_000) * 1 + (totalOutputTokens / 1_000_000) * 5;
          try {
            await incrementUsage(userId, usageType, totalTokens, cost, localDate);
          } catch (e) {
            console.error('[chat] incrementUsage failed:', e);
          }
        }

        controller.close()

        // ── Post-stream: detect style deviation & write fact ──
        try {
          if (userId && userId !== 'anonymous') {
            const deviationPatterns = [
              /isn't.*typical.*(Buffett|Lynch|Livermore|Munger|Soros).*pick/i,
              /outside.*your.*(typical|usual|style|wheelhouse)/i,
              /not.*(what|something).*(Buffett|Lynch|Livermore|Munger|Soros).*(would|typically|usually)/i,
              /deviat(?:es?|ion|ing).*(?:from.*style|from.*profile)/i,
            ]
            const hasDeviation = deviationPatterns.some(p => p.test(responseText))
            if (hasDeviation) {
              // Detect category from user message
              let category = 'speculative'
              if (/spacex|pre-?ipo|private company|startup|crypto|meme stock|penny stock/i.test(lastMessage)) category = 'speculative'
              else if (/options?|calls?|puts?|leveraged|margin/i.test(lastMessage)) category = 'derivatives'
              else if (/dividend|yield|value trap|turnaround|dying/i.test(lastMessage)) category = 'value'
              else if (/momentum|breakout|trend|chart pattern/i.test(lastMessage)) category = 'momentum'
              else if (/index|etf|passive|diversif/i.test(lastMessage)) category = 'passive'

              writeFact(userId, {
                subject: `user_style_deviation:${category}`,
                fact_type: 'observation',
                claim: `User asked about ${category} despite ${profile.investorStyle}-style profile`,
                confidence: 'confirmed',
                source: 'chat',
              }).catch(err => console.error('[chat] deviation writeFact error:', err))
            }
          }
        } catch (e) {
          console.error('[chat] deviation detection error:', e)
        }

        } catch (streamError: any) {
          // Catch any unhandled exception inside the streaming pipeline.
          // Without this, the ReadableStream crashes silently → browser sees
          // a closed connection → client throws generic "API error" → user
          // sees "Sorry — I encountered an error" with zero context.
          console.error('[chat] 🔴 STREAM FATAL ERROR:', streamError?.message || streamError);
          if (streamError?.stack) console.error('[chat] Stack trace:', streamError.stack);
          try {
            // Attempt to send diagnostic SSE event before the stream dies.
            // NEVER leak raw JS error text to the user — the full trace is logged below.
            console.error('[chat] 🔴 STREAM FATAL ERROR (full):', streamError);
            if (streamError?.stack) console.error('[chat] Stack trace:', streamError.stack);
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({
                fatalStreamError: true,
                message: 'Server error: An unexpected internal error occurred. Our team has been notified. Please try again — if this persists, try a simpler or rephrased query.',
              })}\n\n`)
            );
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          } catch (_) {
            // Stream is already broken — nothing we can do
            console.error('[chat] Could not send error event — stream already closed');
          }
        }
      }
    })

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    })

  } catch (error) {
    console.error('Chat API error:', error)
    return Response.json({ error: 'Failed to process request' }, { status: 500 })
  }
}
