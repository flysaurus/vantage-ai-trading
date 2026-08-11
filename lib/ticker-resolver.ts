// ─── Ticker Resolver — 5-Tier Symbol Resolution ──────────────────
// Replaces the fragile regex-only extractTickers() in the chat route
// with a multi-tier system that handles company names, descriptive
// references, and misspelled tickers.
//
// TIER 0 — Fast path (regex + cache)
// TIER 1 — Classify (cheap LLM pass via DeepSeek)
// TIER 2 — Ground in live data (Finnhub + SearXNG)
// TIER 3 — Confidence branch (resolve / clarify / notFound)
// TIER 4 — Trade-Gate (unmodified — existing order pipeline)
//
// The resolver returns proposals; Trade-Gate independently re-verifies
// before execution in the existing order processing pipeline.
// ──────────────────────────────────────────────────────────────────

import {
  NOT_TICKERS,
  FALLBACK_SYMBOLS,
  PREVERIFIED_TICKERS,
  loadSymbolCache,
} from '@/lib/symbol-resolution';

// ── Types ──────────────────────────────────────────────────

export interface TickerResult {
  symbol: string;
  name: string;
  exchange?: string;
  confidence: 'high' | 'medium' | 'low';
  source: 'regex' | 'finnhub_profile' | 'finnhub_search' | 'web_search' | 'preverified' | 'fallback';
  tier: 0 | 1 | 2 | 3;
}

export interface ResolverOutput {
  resolved: TickerResult[];
  needsClarification: boolean;
  clarificationOptions?: Array<{ symbol: string; name: string; exchange: string }>;
  notFound: string[]; // phrases that couldn't be resolved
  tier2Required: boolean; // whether Tier 2 (live search) was needed
}

// ── Tier 1 classification types ───────────────────────────

type Tier1Category =
  | 'ticker_candidate'
  | 'company_name'
  | 'descriptive_reference'
  | 'time_sensitive_factual'
  | 'time_sensitive_contested'
  | 'category_too_broad';

interface Tier1Phrase {
  phrase: string;
  category: Tier1Category;
  cleanedQuery: string;
}

// ── Finnhub search result ─────────────────────────────────

interface FinnhubSearchHit {
  symbol: string;
  description: string;
  type?: string;
  exchange?: string;
}

// ── Helpers ───────────────────────────────────────────────

function apiKey(options?: { finnhubKey?: string }): string {
  return options?.finnhubKey || process.env.FINNHUB_IO_API_KEY || '';
}

function searxngUrl(options?: { searxngUrl?: string }): string {
  return options?.searxngUrl || process.env.SEARXNG_URL || 'http://localhost:8888';
}

function deepseekKey(options?: { deepseekKey?: string }): string {
  return options?.deepseekKey || process.env.DEEPSEEK_API_KEY || '';
}

/** Extract uppercase 2-5 letter sequences — same regex as chat route's extractTickers */
function extractRegexTickers(text: string): string[] {
  const matches = text.match(/\$?\b([A-Z]{2,5})\b/gi);
  if (!matches) return [];
  const tickers = matches
    .map(t => t.replace('$', '').toUpperCase())
    .filter(t => !NOT_TICKERS.has(t));
  return [...new Set(tickers)];
}

/** Quick validate: is this ticker in the US symbol cache or known allowlists? */
async function quickValidate(symbol: string, usSymbols: Set<string>): Promise<TickerResult | null> {
  const upper = symbol.toUpperCase();

  // Pre-verified tickers (e.g., SPCX — newer IPOs Finnhub free tier might not index)
  if (PREVERIFIED_TICKERS[upper]) {
    const pv = PREVERIFIED_TICKERS[upper];
    return { symbol: upper, name: pv.name, exchange: pv.exchange, confidence: 'high', source: 'preverified', tier: 0 };
  }

  // US symbol cache (fast, in-memory)
  if (usSymbols.has(upper)) {
    return { symbol: upper, name: upper, confidence: 'high', source: 'regex', tier: 0 };
  }

  // Fallback symbols (ETFs Finnhub free tier might miss)
  if (FALLBACK_SYMBOLS[upper]) {
    return { symbol: upper, name: FALLBACK_SYMBOLS[upper], confidence: 'high', source: 'fallback', tier: 0 };
  }

  return null;
}

// ── Tier 1: Classify via DeepSeek ─────────────────────────

const TIER1_CLASSIFY_PROMPT = `Classify each phrase below. Reply with a JSON array. For each phrase provide:
- phrase: the original text
- category: one of ["ticker_candidate", "company_name", "descriptive_reference", "time_sensitive_factual", "time_sensitive_contested", "category_too_broad"]
- cleanedQuery: optimized search query for this phrase

Categories:
- ticker_candidate: looks like a stock ticker (2-5 uppercase letters, possibly abbreviated)
- company_name: a known company name ("Tesla", "Apple Inc")
- descriptive_reference: describes a company without naming it ("the iPhone maker", "that AI chip company")
- time_sensitive_factual: needs current data ("latest IPO", "newest EV stock")
- time_sensitive_contested: disputed/contested claim ("richest company", "biggest lithium miner")
- category_too_broad: too vague to resolve ("tech stocks", "something green")

Reply with ONLY the JSON array, no explanation.`;

async function classifyPhrases(
  phrases: string[],
  dkKey: string,
): Promise<Tier1Phrase[]> {
  if (phrases.length === 0) return [];

  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${dkKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        max_tokens: 100,
        temperature: 0,
        messages: [{
          role: 'user',
          content: `${TIER1_CLASSIFY_PROMPT}\n\nPhrases: ${JSON.stringify(phrases)}`,
        }],
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      console.error('[ticker-resolver] Tier 1 classify HTTP', res.status);
      return [];
    }

    const data = await res.json();
    let raw = data.choices?.[0]?.message?.content || '';
    raw = raw.replace(/```(?:json)?\s*\n?/g, '').trim();

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const validCategories = new Set<Tier1Category>([
      'ticker_candidate', 'company_name', 'descriptive_reference',
      'time_sensitive_factual', 'time_sensitive_contested', 'category_too_broad',
    ]);

    return parsed
      .filter((p: any) => p.phrase && p.category && validCategories.has(p.category))
      .map((p: any) => ({
        phrase: p.phrase,
        category: p.category as Tier1Category,
        cleanedQuery: p.cleanedQuery || p.phrase,
      }));
  } catch (err: any) {
    console.error('[ticker-resolver] Tier 1 classify error:', err.message);
    return [];
  }
}

// ── Tier 2: Ground in live data ───────────────────────────

interface Tier2Match {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
  score: number;
}

async function finnhubSearch(
  query: string,
  fKey: string,
): Promise<Tier2Match[]> {
  if (!fKey) return [];

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/search?q=${encodeURIComponent(query)}&token=${fKey}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return [];
    const data = await res.json();
    if (!data.result?.length) return [];

    // Filter: US exchanges only (or blank exchange — common for ETFs)
    const usExchanges = new Set(['NASDAQ NMS - GLOBAL MARKET', 'NASDAQ GLOBAL MARKET',
      'NEW YORK STOCK EXCHANGE', 'NYSE', 'NASDAQ', 'NYSE ARCA', 'NYSE MKT', 'BATS',
      'OTC MARKETS', 'OTC US', 'NASDAQ CAPITAL MARKET', 'NASDAQ GLOBAL SELECT',
      'NASDAQ GS', 'NASDAQ GM', 'NYSE American', 'Cboe US', 'Cboe BZX',
    ]);

    return data.result
      .filter((r: any) => {
        // Allow symbols matching US ticker pattern; exchange filtering is lenient
        if (/^[A-Z]{1,5}$/.test(r.symbol)) {
          // If exchange is specified, prefer US exchanges
          if (r.exchange && r.exchangeDisplay) {
            return !r.exchangeDisplay.toLowerCase().includes('london') &&
              !r.exchangeDisplay.toLowerCase().includes('toronto') &&
              !r.exchangeDisplay.toLowerCase().includes('tokyo') &&
              !r.exchangeDisplay.toLowerCase().includes('hong kong') &&
              !r.exchangeDisplay.toLowerCase().includes('shanghai') &&
              !r.exchangeDisplay.toLowerCase().includes('frankfurt') &&
              !r.exchangeDisplay.toLowerCase().includes('paris');
          }
          return true;
        }
        return false;
      })
      .slice(0, 5)
      .map((r: any) => ({
        symbol: r.symbol,
        name: r.description || r.symbol,
        exchange: r.exchangeDisplay || r.exchange || '',
        type: r.type || 'Common Stock',
        score: 0, // will be set below
      }));
  } catch (err: any) {
    console.error('[ticker-resolver] Finnhub search error:', err.message);
    return [];
  }
}

async function finnhubProfile(
  symbol: string,
  fKey: string,
): Promise<{ name: string; exchange: string } | null> {
  if (!fKey) return null;

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${fKey}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.name && !data.ticker) return null;
    return { name: data.name || symbol, exchange: data.exchange || '' };
  } catch {
    return null;
  }
}

async function webSearch(
  query: string,
  sxngUrl: string,
): Promise<string[]> {
  if (!sxngUrl) return [];

  try {
    const res = await fetch(
      `${sxngUrl}/search?q=${encodeURIComponent(query)}&format=json&categories=general,news&language=en`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return [];
    const data = await res.json();
    if (!data.results?.length) return [];

    // Extract potential company names from titles + snippets
    const names = new Set<string>();
    const companyPattern = /\b([A-Z][a-z]{2,}(?:\s+(?:of|the|de|van|von|del|&|and)\s+)?[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)\b/g;

    for (const r of data.results.slice(0, 10)) {
      const text = `${r.title || ''} ${r.content || ''} ${r.snippet || ''}`;
      const matches = text.matchAll(companyPattern);
      for (const m of matches) {
        const name = m[1];
        if (name.length > 3 && name.length < 50) names.add(name);
      }
    }

    return [...names].slice(0, 5);
  } catch (err: any) {
    console.error('[ticker-resolver] Web search error:', err.message);
    return [];
  }
}

async function processTier2(
  classified: Tier1Phrase[],
  fKey: string,
  sxngUrl: string,
): Promise<{ results: TickerResult[]; clarifications: Array<{ symbol: string; name: string; exchange: string }>; notFound: string[]; tier2Used: boolean }> {
  const results: TickerResult[] = [];
  const clarifications: Array<{ symbol: string; name: string; exchange: string }> = [];
  const notFound: string[] = [];
  let tier2Used = false;

  for (const item of classified) {
    switch (item.category) {
      case 'ticker_candidate': {
        // Try direct profile lookup first
        tier2Used = true;
        const profile = await finnhubProfile(item.phrase, fKey);
        if (profile) {
          results.push({
            symbol: item.phrase.toUpperCase(),
            name: profile.name,
            exchange: profile.exchange,
            confidence: 'high',
            source: 'finnhub_profile',
            tier: 2,
          });
        } else {
          // Try search as fallback
          const searchResults = await finnhubSearch(item.cleanedQuery, fKey);
          if (searchResults.length === 1) {
            results.push({
              symbol: searchResults[0].symbol,
              name: searchResults[0].name,
              exchange: searchResults[0].exchange,
              confidence: 'medium',
              source: 'finnhub_search',
              tier: 2,
            });
          } else if (searchResults.length > 1) {
            clarifications.push(...searchResults.slice(0, 3).map(r => ({
              symbol: r.symbol, name: r.name, exchange: r.exchange,
            })));
          } else {
            notFound.push(item.phrase);
          }
        }
        break;
      }

      case 'company_name': {
        tier2Used = true;
        const searchResults = await finnhubSearch(item.cleanedQuery, fKey);
        if (searchResults.length === 1) {
          results.push({
            symbol: searchResults[0].symbol,
            name: searchResults[0].name,
            exchange: searchResults[0].exchange,
            confidence: 'high',
            source: 'finnhub_search',
            tier: 2,
          });
        } else if (searchResults.length > 1) {
          clarifications.push(...searchResults.slice(0, 3).map(r => ({
            symbol: r.symbol, name: r.name, exchange: r.exchange,
          })));
        } else {
          notFound.push(item.phrase);
        }
        break;
      }

      case 'descriptive_reference': {
        // Web search first, then Finnhub on extracted names
        tier2Used = true;
        const extractedNames = await webSearch(item.cleanedQuery, sxngUrl);
        if (extractedNames.length > 0) {
          // Search Finnhub for each extracted name
          let found = false;
          for (const name of extractedNames.slice(0, 3)) {
            const searchResults = await finnhubSearch(name, fKey);
            if (searchResults.length === 1 && !found) {
              results.push({
                symbol: searchResults[0].symbol,
                name: searchResults[0].name,
                exchange: searchResults[0].exchange,
                confidence: 'medium',
                source: 'web_search',
                tier: 2,
              });
              found = true;
              break;
            } else if (searchResults.length > 1 && !found) {
              clarifications.push(...searchResults.slice(0, 2).map(r => ({
                symbol: r.symbol, name: r.name, exchange: r.exchange,
              })));
              found = true;
              break;
            }
          }
          if (!found) notFound.push(item.phrase);
        } else {
          // Direct Finnhub search as fallback
          const searchResults = await finnhubSearch(item.cleanedQuery, fKey);
          if (searchResults.length === 1) {
            results.push({
              symbol: searchResults[0].symbol,
              name: searchResults[0].name,
              exchange: searchResults[0].exchange,
              confidence: 'low',
              source: 'finnhub_search',
              tier: 2,
            });
          } else if (searchResults.length > 1) {
            clarifications.push(...searchResults.slice(0, 3).map(r => ({
              symbol: r.symbol, name: r.name, exchange: r.exchange,
            })));
          } else {
            notFound.push(item.phrase);
          }
        }
        break;
      }

      case 'time_sensitive_factual': {
        // Web search FIRST (model cannot be trusted for "latest")
        tier2Used = true;
        const extractedNames = await webSearch(item.cleanedQuery, sxngUrl);
        if (extractedNames.length > 0) {
          let found = false;
          for (const name of extractedNames.slice(0, 3)) {
            const searchResults = await finnhubSearch(name, fKey);
            if (searchResults.length === 1 && !found) {
              results.push({
                symbol: searchResults[0].symbol,
                name: searchResults[0].name,
                exchange: searchResults[0].exchange,
                confidence: 'medium',
                source: 'web_search',
                tier: 2,
              });
              found = true;
              break;
            }
          }
          if (!found) notFound.push(item.phrase);
        } else {
          notFound.push(item.phrase);
        }
        break;
      }

      case 'time_sensitive_contested': {
        // Web search runs but ALWAYS routes to Tier 3 clarification
        tier2Used = true;
        const extractedNames = await webSearch(item.cleanedQuery, sxngUrl);
        if (extractedNames.length > 0) {
          for (const name of extractedNames.slice(0, 3)) {
            const searchResults = await finnhubSearch(name, fKey);
            clarifications.push(...searchResults.slice(0, 2).map(r => ({
              symbol: r.symbol, name: r.name, exchange: r.exchange,
            })));
          }
        }
        if (clarifications.length === 0) notFound.push(item.phrase);
        break;
      }

      case 'category_too_broad':
        // Route to Tier 3 ask — too vague to resolve automatically
        notFound.push(item.phrase);
        break;
    }
  }

  return { results, clarifications, notFound, tier2Used };
}

// ── Main Resolution Function ─────────────────────────────

/**
 * Resolve ticker symbols from a user message using a 5-tier system:
 *
 * TIER 0 — Regex extraction + cache validation (fast, synchronous cache check)
 * TIER 1 — DeepSeek classification of unmatched phrases
 * TIER 2 — Live data grounding (Finnhub + SearXNG)
 * TIER 3 — Confidence branching (resolve / clarify / notFound)
 * TIER 4 — Trade-Gate (unmodified, in existing order pipeline)
 */
export async function resolveTickers(
  userMessage: string,
  options?: { finnhubKey?: string; searxngUrl?: string; deepseekKey?: string },
): Promise<ResolverOutput> {
  const resolved: TickerResult[] = [];
  const notFound: string[] = [];
  let needsClarification = false;
  const clarificationOptions: Array<{ symbol: string; name: string; exchange: string }> = [];
  let tier2Required = false;

  const fKey = apiKey(options);
  const sxngUrl = searxngUrl(options);
  const dkKey = deepseekKey(options);

  // ── TIER 0: Fast regex + cache validation ──────────────
  const regexTickers = extractRegexTickers(userMessage);
  const unmatchedTier0: string[] = [];

  if (regexTickers.length > 0) {
    let usSymbols: Set<string> = new Set();
    try {
      usSymbols = await loadSymbolCache();
    } catch {
      // Cache unavailable — all tickers go to Tier 1
    }

    for (const ticker of regexTickers) {
      const validated = await quickValidate(ticker, usSymbols);
      if (validated) {
        resolved.push(validated);
      } else {
        unmatchedTier0.push(ticker);
      }
    }
  }

  // If ALL resolved in Tier 0, return immediately
  if (unmatchedTier0.length === 0) {
    return { resolved, needsClarification: false, notFound: [], tier2Required: false };
  }

  // ── TIER 1: Classify unmatched phrases ─────────────────
  const classifyResult = await classifyPhrases(unmatchedTier0, dkKey);

  if (classifyResult.length === 0) {
    // Classification failed — unmatched tickers become notFound
    unmatchedTier0.forEach(t => notFound.push(t));
    return { resolved, needsClarification: false, notFound, tier2Required: false };
  }

  // ── TIER 2: Ground in live data ────────────────────────
  const tier2 = await processTier2(classifyResult, fKey, sxngUrl);
  resolved.push(...tier2.results);
  clarificationOptions.push(...tier2.clarifications);
  notFound.push(...tier2.notFound);
  tier2Required = tier2.tier2Used;

  // ── TIER 3: Confidence branch ──────────────────────────
  // Multiple plausible matches → CLARIFY
  if (clarificationOptions.length > 0) {
    needsClarification = true;
  }

  // Deduplicate resolved (by symbol, prefer highest confidence)
  const seen = new Set<string>();
  const deduped: TickerResult[] = [];
  for (const r of resolved) {
    if (!seen.has(r.symbol)) {
      seen.add(r.symbol);
      deduped.push(r);
    }
  }

  return {
    resolved: deduped,
    needsClarification,
    clarificationOptions: needsClarification ? clarificationOptions : undefined,
    notFound,
    tier2Required,
  };
}
