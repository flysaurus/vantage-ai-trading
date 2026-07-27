import Anthropic from '@anthropic-ai/sdk'
import { VANTAGE_SYSTEM_PROMPT, ALERTS_SYSTEM_PROMPT } from '@/lib/ai-system-prompt'
import { validateRecommendationMarkers } from '@/lib/validate-markers'
import { resolveSymbol } from '@/lib/tools/resolve-symbol'
import type { SystemBlock } from '@/lib/ai-provider'
import { buildUserProfileContext } from '@/lib/ai/userProfile'
import type { UserProfile } from '@/lib/ai/userProfile'
import { checkUsageLimit, incrementUsage, getLocalDateFromTimezone, checkAbuseCooldown } from '@/lib/ai-guard'
import { getOptionalUserId } from '@/lib/auth/get-server-user'
import { loadSymbolCache } from '@/lib/symbol-validator'
import { getActiveFacts, writeFact, formatFactsForPrompt } from '@/lib/ai/facts'
import { getBatchQuotes } from '@/lib/market-data'
import { createServerClient } from '@/lib/supabase'
import {
  validateRecommendations,
  buildRetryPrompt,
  extractBudget,
  type ValidationFailure,
} from '@/lib/validate-recommendations'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  defaultHeaders: {
    'anthropic-beta': 'prompt-caching-2024-07-31',
  },
})
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY
const SEARXNG_URL = process.env.SEARXNG_URL || 'http://localhost:8888'

// ─── Common words that look like tickers but aren't ──
const NOT_TICKERS = new Set([
  'IPO', 'ETF', 'REIT', 'CEO', 'CFO', 'GDP', 'API', 'AI', 'ML', 'ITM', 'OTM',
  'THE', 'AND', 'FOR', 'NOT', 'BUT', 'WAS', 'HAS', 'CAN', 'ARE', 'YOU', 'OUR',
  'HOW', 'WHAT', 'WHEN', 'WHY', 'WHO', 'NEW', 'OUT', 'ALL', 'ANY', 'ONE', 'TWO',
  'ITS', 'HIS', 'HER', 'THEM', 'THEY', 'FROM', 'THAT', 'THIS', 'WITH', 'WILL',
  'JUST', 'NOW', 'VERY', 'MUCH', 'WELL', 'ALSO', 'THEN', 'SOME', 'LIKE', 'GET',
  'SEE', 'GOOD', 'BAD', 'BIG', 'PUT', 'CALL', 'IN', 'ON', 'IT', 'AT', 'TO',
  'BE', 'IS', 'SO', 'ME', 'MY', 'WE', 'HE', 'NO', 'GO', 'DO', 'UP', 'AM',
  'A', 'I', 'O', 'USD', 'EST', 'LTD', 'INC', 'CORP', 'PLC', 'LLC', 'NYSE',
  'NASDAQ', 'SVS', 'USA', 'EUR', 'GBP', 'JPY', 'YTD', 'NYSEARCA',
  'BUY', 'SELL', 'HOLD', 'PUT', 'CALL', // trading verbs/options that look like 3-4 char tickers
  // Exchange/country-code suffixes — prevent ghost buttons from foreign listings
  'DE', 'MX', 'SW', 'VI', 'SN', 'DU', 'HM', 'GLP', 'LN', 'L', 'PA', 'SA',
  'TO', 'CN', 'HK', 'JP', 'KR', 'BR', 'IN', 'AU', 'AS', 'AX', 'TA', 'OL',
  // Note: "TO" is already blocked — a common preposition AND Toronto exchange suffix
]);

// ─── Ticker extraction ──
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
    if (!isFilteredWord(longest)) return longest;
  }
  
  // Try: ALL capitalized words, skip filtered ones, pick the first real name
  const allCapWords = cleaned.match(/\b([A-Z][a-z]{2,})\b/g);
  if (allCapWords) {
    for (const word of allCapWords) {
      if (!isFilteredWord(word)) return word;
    }
  }
  
  return null;
}

// NOTE: fillMissingMarkers() was removed — buttons now ONLY generated from
// explicit [RECOMMEND:SYMBOL:BUY:$AMOUNT] markers in the AI response text.
// Prose-scanning heuristics were the root cause of ghost tickers (exchange
// suffixes like DE/MX/SN), contradictory buttons (SPY when VOO is recommended),
// and duplicate positions across foreign exchange listings.

// ─── Common non-company capitalized words ──
const FILTERED_PROPER_NOUNS = /^(This|That|What|When|Where|Why|Which|Whose|How|There|Today|Tomorrow|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December|Could|Would|Should|About|Your|Their|Some|Many|More|Less|Each|Every|Other|After|Before|During|Still|Already|Always|Never|Tell|Show|Find|Look|Check|Search|Give|Make|Take|Know|Think|Want|Need|Like|Love|Can|Will|Just|Also|Only|Even|Then|Than|Its|His|Her|Our|Been|Being|Having|Doing|Going|Getting)$/;

function isFilteredWord(word: string): boolean {
  return FILTERED_PROPER_NOUNS.test(word);
}

// ─── Pre-flight company name extraction + resolution ───
// Words that commonly appear in financial text but aren't company names
const NOT_COMPANIES = new Set([
  'NYSE', 'NASDAQ', 'STOCK', 'STOCKS', 'SHARE', 'SHARES', 'PRICE', 'PRICES',
  'TRADE', 'TRADING', 'MARKET', 'MARKETS', 'INVEST', 'INVESTING', 'ANALYST',
  'FUTURE', 'FUTURES', 'TODAY', 'QUARTERLY', 'ANNUAL', 'REPORT', 'REPORTS',
  'GROWTH', 'VALUE', 'PROFIT', 'REVENUE', 'EARNINGS', 'DIVIDEND', 'YIELD',
  'TECH', 'HEALTH', 'FINANCE', 'ENERGY', 'SECTOR', 'SECTORS', 'INDUSTRY',
  'YAHOO', 'BLOOMBERG', 'REUTERS', 'BARRONS', 'FIDELITY', 'VANGUARD',
  'RECOMMEND', 'RECOMMENDATION', 'ANALYSIS', 'OUTLOOK', 'FORECAST',
  'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY',
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY',
  'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
  'PORTFOLIO', 'ALLOCATION', 'BUDGET', 'STRATEGY', 'RISK', 'BALANCE',
  'COMPANY', 'CORPORATION', 'HOLDINGS', 'LIMITED', 'GROUP', 'LTD', 'CORP', 'INC',
  'INTERNATIONAL', 'RESEARCH', 'MANAGEMENT', 'CAPITAL', 'PARTNERS',
])

/** Extract potential company names from text (search results, user message). */
function extractCompanyNames(text: string): string[] {
  const names = new Set<string>()
  if (!text) return []
  // Pattern: 2-3 word capitalized phrases ("Eli Lilly", "Novo Nordisk", "Goldman Sachs")
  const multiWord = text.match(/\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){1,2})\b/g)
  if (multiWord) {
    for (const m of multiWord) {
      if (!NOT_COMPANIES.has(m.toUpperCase()) && !FILTERED_PROPER_NOUNS.test(m) && m.length > 5) {
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
      if (!NOT_COMPANIES.has(m.toUpperCase()) && !FILTERED_PROPER_NOUNS.test(m) && m.length > 4) {
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
  const dollarMatch = message.match(/\
$([\
d,]+(?:\
.\
d+)?)\s*(?:portfolio|basket|worth|in|of|budget|total|invest|allocate|spend|split|across|each|pick|choose|buy|build)/i);
  if (dollarMatch) return parseFloat(dollarMatch[1].replace(/,/g, ''));

  // Match: "500 dollar portfolio", "500 portfolio", "500 budget"
  const numMatch = message.match(/([\
d,]+(?:\
.\
d+)?)\s*(?:dollar|portfolio|basket|budget)\b/i);
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

/** Extract total portfolio value from the AI's response. */
function extractResponseTotal(response: string): number | null {
  // Pattern 1: Explicit total line — "Total: $800", "**Total** $800", "TOTAL: $1,234.56"
  const totalMatch = response.match(/(?:total|TOTAL|Total Portfolio|Sum|Portfolio Value|Grand Total|portfolio total)\s*(?:[:$]|is)\s*\$?([\d,]+(?:\.\d+)?)/i);
  if (totalMatch) return parseFloat(totalMatch[1].replace(/,/g, ''));

  // Pattern 2: "Total:" preceded by "6 positions totaling $800"
  const positionsMatch = response.match(/(?:positions?|stocks?|holdings?)\s*(?:totaling|totalling|worth|valued? at|at)\s*\$?([\d,]+(?:\.\d+)?)\b/i);
  if (positionsMatch) return parseFloat(positionsMatch[1].replace(/,/g, ''));

  // Pattern 3: Sum all dollar amounts in table rows and take the largest
  // (the total is usually the largest figure in a portfolio response)
  const dollarAmounts = [...response.matchAll(/\$([\d,]+(?:\.\d+)?)\b/g)];
  if (dollarAmounts.length >= 3) {
    const amounts = dollarAmounts.map(m => parseFloat(m[1].replace(/,/g, '')));
    const sorted = [...amounts].sort((a, b) => b - a);
    // Skip obvious stock prices (>5% of max for individual positions)
    const max = sorted[0];
    // Count how many amounts are close to the max — if there's a clear top value
    // that's >2x the next value, it's likely the total
    if (sorted.length >= 4 && max > sorted[1] * 1.5) {
      return max;
    }
  }

  return null;
}

/** Validate portfolio totals against requested budget (±2% threshold). */
function validateBudgetGate(userMessage: string, aiResponse: string): BudgetGateResult {
  const requestedBudget = extractRequestedBudget(userMessage);
  if (!requestedBudget) {
    return { hasViolation: false, requestedBudget: null, responseTotal: null, deviationPercent: null, message: null };
  }

  const responseTotal = extractResponseTotal(aiResponse);
  if (!responseTotal) {
    // Can't determine total — no violation to report (false positive avoidance)
    return { hasViolation: false, requestedBudget, responseTotal: null, deviationPercent: null, message: null };
  }

  const deviationPercent = ((responseTotal - requestedBudget) / requestedBudget) * 100;
  const withinTolerance = Math.abs(deviationPercent) <= 2;

  if (withinTolerance) {
    return { hasViolation: false, requestedBudget, responseTotal, deviationPercent, message: null };
  }

  const direction = responseTotal > requestedBudget ? 'exceeds' : 'falls short of';
  const message = `⚠️ Budget mismatch: You requested a $${requestedBudget.toLocaleString()} portfolio, but the generated allocation totals $${responseTotal.toLocaleString()} (${deviationPercent >= 0 ? '+' : ''}${deviationPercent.toFixed(1)}% ${direction} your budget by ${Math.abs(deviationPercent).toFixed(1)}% — outside the ±2% tolerance). The AI may need to regenerate this with tighter constraints.`;

  return {
    hasViolation: true,
    requestedBudget,
    responseTotal,
    deviationPercent,
    message,
  };
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

    // ── Pre-flight symbol resolution: resolve company names from search results
    // BEFORE the Anthropic call. This prevents the model from burning tool-loop
    // turns on one-by-one resolveSymbol calls (the #1 cause of cut-off responses).
    let preResolvedContext = ''
    try {
      const preResolved = await preResolveTickers(lastMessage, searchContext)
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

    const systemBlocks: SystemBlock[] = [
      {
        type: 'text' as const,
        text: systemPrompt,
        cache_control: { type: 'ephemeral' as const },
      },
      {
        type: 'text' as const,
        text: [dateContext, profileContext, portfolioContext || '', additionalContext || '', searchContext, liveMarketContext, preResolvedContext, deviationContext].filter(Boolean).join('\n\n'),
      },
    ];

    // ── Retry prompt injection (for validation-driven regeneration) ──
    const requestedBudget = extractBudget(lastMessage);
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

        // ── Progress: Stage 1 — Researching ──
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress: { stage: 1, total: 3 } })}\n\n`));

        // ── Progress: Stage 2 — Building portfolio (Anthropic starts generating) ──
        // Small stagger so stage 1 is visible before transitioning
        await new Promise(r => setTimeout(r, 300));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress: { stage: 2, total: 3 } })}\n\n`));

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
          const hasAnyRecs = /\[RECOMMEND:[A-Z0-9]{1,5}(?:\.[A-Z]{1,2})?:BUY/i.test(accumulatedText);
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

        // ── Guard: tool-loop exhaustion detection ──
        const hasMarkers = /\[RECOMMEND:[A-Z]{1,5}(?:\.[A-Z]{1,2})?:BUY:\$?[\d,]+\]/i.test(responseText);
        if (!hasMarkers && turn >= MAX_TOOL_TURNS) {
          console.warn(`[chat] ⚠️ Tool-loop exhausted after ${turn} turns — no RECOMMEND markers produced. Response starts with: "${responseText.slice(0, 100)}"`);
        }

        // ── Progress: Stage 3 — Validating ──
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress: { stage: 3, total: 3 } })}\n\n`));

        // ── Validate RECOMMEND markers (catch hallucinated ADR tickers like SKM≠SK Hynix) ──
        try {
          const validation = await validateRecommendationMarkers(responseText);
          if (validation.hasCorrections) {
            console.warn('[chat] ⚠️ Marker corrections:', JSON.stringify(validation.issues, null, 2));
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ corrections: validation.issues, correctedText: validation.corrected })}\n\n`)
            );
            responseText = validation.corrected;
          }
        } catch (valErr) {
          console.error('[chat] Marker validation error:', valErr);
        }

        // NOTE: fillMissingMarkers removed — buttons now ONLY from explicit
        // [RECOMMEND:SYMBOL:BUY:$AMOUNT] markers. Prose heuristics were the
        // root cause of ghost tickers (exchange codes), contradictory buttons,
        // and duplicate positions across foreign listings.

        // ── STRICT VALIDATION: format, symbol existence, dedupes, budget reconciliation ──
        // ONLY runs when response contains RECOMMEND markers. Responses without markers
        // (clarifying questions, informational replies, "I can't recommend X" prose) are
        // skipped — they aren't recommendations and shouldn't be validated as such.
        let validationRejected = false;
        const hasRecommendMarkers = /\[RECOMMEND:[A-Z0-9]{1,5}(?:\.[A-Z]{1,2})?:BUY/i.test(responseText);
        if (requestedBudget !== null && hasRecommendMarkers) {
          try {
            const strictValidation = await validateRecommendations(responseText, requestedBudget);
            if (!strictValidation.ok) {
              console.warn('[chat] ⚠️ Strict validation FAILED:', JSON.stringify(strictValidation.failures, null, 2));
              validationRejected = true;

              // Log failure to DB for review
              try {
                if (userId && userId !== 'anonymous') {
                  const supabase = createServerClient();
                  const rawMarkers = [...responseText.matchAll(/\[RECOMMEND:[^\]]*\]/g)].map(m => m[0]);
                  const allocation = strictValidation.failures.length > 0 ? 0 : 0; // markers exist but failed checks
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
                      allocation: allocation,
                    });
                  console.log('[chat] Validation failure logged to DB');
                }
              } catch (logErr) {
                console.error('[chat] Validation failure DB log error:', logErr);
              }

              if (retryAttempt >= 1) {
                // Second attempt also failed — fatal
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ fatalValidationFailure: true, failures: strictValidation.failures })}\n\n`)
                );
              } else {
                // First attempt — trigger client-side regeneration
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ regenerate: true, failures: strictValidation.failures, budget: requestedBudget })}\n\n`)
                );
              }
            }
          } catch (strictValErr) {
            console.error('[chat] Strict validation error:', strictValErr);
            // Non-fatal — proceed without validation (existing corrections still apply)
          }
        } else if (requestedBudget !== null && !hasRecommendMarkers) {
          console.log('[chat] ⏭️ Skipped validation — no RECOMMEND markers in response (likely a question or informational reply)');
        }

        // ── Budget reconciliation gate (secondary guard) ──
        // Runs IN ADDITION to strict validation above — catches cases where
        // RECOMMEND markers are absent but the response is a portfolio table
        // (e.g., old-style portfolio generation without markers).
        try {
          const budgetGate = validateBudgetGate(lastMessage, responseText);
          if (budgetGate.hasViolation) {
            console.warn('[chat] ⚠️ Budget gate violation:', JSON.stringify(budgetGate, null, 2));
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ budgetViolation: budgetGate })}\n\n`)
            );
          }
        } catch (bgErr) {
          console.error('[chat] Budget gate error:', bgErr);
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
            // Attempt to send diagnostic SSE event before the stream dies
            const errMsg = streamError?.message || 'Unknown streaming error';
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({
                fatalStreamError: true,
                message: `Server error: ${errMsg.slice(0, 200)}`,
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
