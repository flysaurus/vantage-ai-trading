import Anthropic from '@anthropic-ai/sdk'
import { VANTAGE_SYSTEM_PROMPT, ALERTS_SYSTEM_PROMPT } from '@/lib/ai-system-prompt'
import { validateRecommendationMarkers } from '@/lib/validate-markers'
import { resolveSymbol } from '@/lib/tools/resolve-symbol'
import type { SystemBlock } from '@/lib/ai-provider'
import { buildUserProfileContext } from '@/lib/ai/userProfile'
import type { UserProfile } from '@/lib/ai/userProfile'
import { checkUsageLimit, incrementUsage, getLocalDateFromTimezone } from '@/lib/ai-guard'
import { getOptionalUserId } from '@/lib/auth/get-server-user'
import { getActiveFacts, writeFact, formatFactsForPrompt } from '@/lib/ai/facts'
import { getBatchQuotes } from '@/lib/market-data'
import { createServerClient } from '@/lib/supabase'

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

// ─── Gap-fill missing markers for multi-position allocations ───
// Detects explicit $ amount recommendations that lack [RECOMMEND:SYMBOL:BUY:$N] markers.
const RECOMMEND_MARKER = /\[RECOMMEND:([A-Z]{1,5}(?:\.[A-Z])?):(BUY|SELL)(?::(\$?\d+(?:\.\d+)?))?\]/g;

// Dollar-amount + ticker patterns where the model recommended but dropped the marker
const DOLLAR_RECOMMEND_PATTERNS: Array<{ regex: RegExp; tickerGroup: number; amountGroup: number }> = [
  // "$3,500 into VOO", "$500 in MSFT", "$1,000 of QQQ"
  { regex: /\$([\d,]+(?:\.\d+)?)\s+(?:into|in|for|of|to|toward)\s+\b([A-Z]{2,5})\b/gi, tickerGroup: 2, amountGroup: 1 },
  // "VOO ($3,500)", "MSFT ($500)"
  { regex: /\b([A-Z]{2,5})\b\s*\(\$([\d,]+(?:\.\d+)?)\)/g, tickerGroup: 1, amountGroup: 2 },
  // "VOO: $3,500", "QQQ — $1,000"
  { regex: /\b([A-Z]{2,5})\b\s*[:—–-]\s*\$([\d,]+(?:\.\d+)?)\b/g, tickerGroup: 1, amountGroup: 2 },
  // "allocate $3,500 to VOO", "put $500 in MSFT"
  { regex: /(?:allocate|put|place|invest|direct|send)\s+\$([\d,]+(?:\.\d+)?)\s+(?:into|in|for|of|to|toward)\s+\b([A-Z]{2,5})\b/gi, tickerGroup: 2, amountGroup: 1 },
];

function fillMissingMarkers(text: string): string {
  // Gather already-marked symbols
  const marked = new Set<string>();
  RECOMMEND_MARKER.lastIndex = 0;
  for (const m of text.matchAll(RECOMMEND_MARKER)) {
    marked.add(m[1].toUpperCase());
  }

  // Find unmarked symbols with explicit dollar-amount recommendations
  const missing: Array<{ symbol: string; amount: number }> = [];
  const seen = new Set<string>();

  // ── Stage 1: Direct dollar-amount patterns (existing) ──
  for (const { regex, tickerGroup, amountGroup } of DOLLAR_RECOMMEND_PATTERNS) {
    regex.lastIndex = 0;
    for (const m of text.matchAll(regex)) {
      const symbol = m[tickerGroup].toUpperCase();
      const amountStr = m[amountGroup].replace(/,/g, '');
      const amount = parseFloat(amountStr);

      if (marked.has(symbol) || seen.has(symbol)) continue;
      if (NOT_TICKERS.has(symbol)) continue;
      if (amount <= 0 || amount > 100_000_000) continue;

      seen.add(symbol);
      missing.push({ symbol, amount: Math.round(amount) });
    }
  }

  // ── Stage 2: Category-level allocation detection ──
  // Detects patterns like:
  //   "CORE TECH ETFs (60% = $600)"
  //   "QQQ — Invesco Nasdaq 100 ETF"
  //   "VGT — Vanguard Information Technology ETF"
  // Where the $ is at the category level and individual ETFs are unmarked.
  //
  // Strategy: find dollar amounts in headers, then collect unmarked tickers
  // in the following text up to the next section break (--- or blank line before another header).
  if (missing.length === 0) {
    // Match category headers with dollar amounts: "NAME (X% = $N)" or "NAME $N"
    const categoryDollarPattern = /\(\d+%\s*=\s*\$([\d,]+(?:\.\d+)?)\)/g;
    const lines = text.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const dollarMatch = categoryDollarPattern.exec(line);
      categoryDollarPattern.lastIndex = 0;
      if (!dollarMatch) continue;

      const totalAmount = parseFloat(dollarMatch[1].replace(/,/g, ''));
      if (totalAmount <= 0 || totalAmount > 100_000_000) continue;

      // Collect unmarked tickers in subsequent lines until next section break
      const sectionTickers: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j].trim();
        // Stop at section breaks
        if (nextLine === '---' || nextLine === '' && lines[j - 1]?.trim() === '') break;
        // Stop at another category header with dollar amount
        if (/\(\d+%\s*=\s*\$[\d,]+\)/.test(nextLine)) break;
        // Stop at next major category (INDIVIDUAL, CASH, SUMMARY, etc.)
        if (/^(INDIVIDUAL|CASH|BONDS|CRYPTO|COMMODITIES|REAL\s*ESTATE)\s/.test(nextLine)) break;
        // Extract ticker: a 2-5 char uppercase word at start of line, followed by em-dash/en-dash/hyphen/colon
        const tickerMatch = nextLine.match(/^([A-Z]{2,5}(?:\.[A-Z])?)\s*[:—–-]/);
        if (tickerMatch && !marked.has(tickerMatch[1]) && !NOT_TICKERS.has(tickerMatch[1]) && !seen.has(tickerMatch[1])) {
          sectionTickers.push(tickerMatch[1]);
        }
      }

      // Distribute total among unmarked tickers
      if (sectionTickers.length > 0) {
        const perTicker = Math.round(totalAmount / sectionTickers.length);
        for (const sym of sectionTickers) {
          seen.add(sym);
          missing.push({ symbol: sym, amount: perTicker });
        }
      }
    }
  }

  if (missing.length === 0) return text;

  // Append missing markers at the end (invisible markers — appended after a blank line)
  const appendix = '\n\n' + missing
    .map(({ symbol, amount }) => `[RECOMMEND:${symbol}:BUY:$${amount}]`)
    .join(' ');

  return text + appendix;
}

// ─── Common non-company capitalized words ──
const FILTERED_PROPER_NOUNS = /^(This|That|What|When|Where|Why|Which|Whose|How|There|Today|Tomorrow|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December|Could|Would|Should|About|Your|Their|Some|Many|More|Less|Each|Every|Other|After|Before|During|Still|Already|Always|Never|Tell|Show|Find|Look|Check|Search|Give|Make|Take|Know|Think|Want|Need|Like|Love|Can|Will|Just|Also|Only|Even|Then|Than|Its|His|Her|Our|Been|Being|Having|Doing|Going|Getting)$/;

function isFilteredWord(word: string): boolean {
  return FILTERED_PROPER_NOUNS.test(word);
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

// ─── POST Handler ───
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { messages, portfolioContext, additionalContext, mode, timezone } = body

    // ── Usage limit check (type depends on mode) ──
    const userId = await getOptionalUserId();
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
        text: [dateContext, profileContext, portfolioContext || '', additionalContext || '', searchContext, liveMarketContext, deviationContext].filter(Boolean).join('\n\n'),
      },
    ];

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
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let turn = 0;
        const MAX_TOOL_TURNS = 3;
        const convMessages: Array<{ role: 'user' | 'assistant'; content: any }> =
          [...initialMessages];

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
              result = await resolveSymbol(tb.input.companyName || '');
              console.log(`[chat] resolveSymbol("${tb.input.companyName}") → ${Date.now() - t0}ms`);
            } else {
              result = JSON.stringify({ error: `Unknown tool: ${tb.name}` });
            }
            convMessages.push({
              role: 'user' as const,
              content: [{ type: 'tool_result' as const, tool_use_id: tb.id, content: result }],
            });
          }
          turn++;
        } while (turn < MAX_TOOL_TURNS);

        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        let responseText = fullResponse.join('');

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

        // ── Fill missing markers for multi-position allocations ──
        // When AI recommends N holdings with explicit $ amounts but emits < N markers,
        // this detects the gap and appends the missing [RECOMMEND:SYMBOL:BUY:$N] markers.
        try {
          const filled = fillMissingMarkers(responseText);
          if (filled !== responseText) {
            console.log('[chat] 🔧 Filled missing markers for multi-position recommendation');
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ gapFill: true, correctedText: filled })}\n\n`)
            );
            responseText = filled;
          }
        } catch (fillErr) {
          console.error('[chat] Marker gap-fill error:', fillErr);
        }

        // ── Post-stream: await DB write BEFORE closing the stream ──
        // Must complete before controller.close() so the client's
        // refreshRemaining() reads the updated count, not the old one.
        if (userId && userId !== 'anonymous') {
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
