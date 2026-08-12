// ─── Ticker Resolver — 5-Tier Symbol Resolution ──────────────────
// Replaces the fragile regex-only extractTickers() in the chat route
// with a multi-tier system that handles company names, descriptive
// references, and misspelled tickers.
//
// TIER 0 — Fast path (regex + cache validation). PURE OPTIMIZATION.
//          NEVER a gate — if regex finds nothing, we fall through to
//          Tier 1 with broader entity extraction.
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
  /** Phrases that passed through Tier 0 but were never sent to classification — true "nothing to resolve" */
  emptyInput: boolean;
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

// ── Common English words that are never tickers or company names ─
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her',
  'was', 'one', 'our', 'out', 'has', 'have', 'from', 'they', 'that', 'with',
  'this', 'what', 'when', 'your', 'which', 'there', 'their', 'about', 'would',
  'could', 'should', 'after', 'before', 'still', 'other', 'every', 'first',
  'where', 'those', 'these', 'being', 'doing', 'going', 'very', 'much', 'many',
  'some', 'any', 'just', 'more', 'most', 'only', 'also', 'then', 'than', 'into',
  'over', 'under', 'again', 'once', 'here', 'want', 'need', 'like', 'make',
  'take', 'give', 'find', 'show', 'tell', 'know', 'think', 'thing', 'well',
  'back', 'good', 'great', 'right', 'even', 'same', 'last', 'next', 'part',
  'look', 'come', 'work', 'down', 'away', 'market', 'stock', 'stocks', 'price',
  'share', 'shares', 'trade', 'trading', 'buy', 'sell', 'worth', 'invest',
  'portfolio', 'money', 'cash', 'fund', 'funds', 'etf', 'etfs', 'index',
  'sector', 'growth', 'value', 'dividend', 'yield', 'risk', 'profit', 'loss',
  'high', 'low', 'open', 'close', 'change', 'volume', 'option', 'options',
  'call', 'put', 'strike', 'expiry', 'ipo', 'news', 'report', 'data', 'analysis',
  'million', 'billion', 'trillion', 'percent', 'rate', 'cost', 'fee',
  'account', 'order', 'orders', 'position', 'holding', 'holdings',
]);

// ── Tokenizer: extract ALL candidate entities from a message ──
// Regex tickers are a fast path. This function extracts EVERYTHING
// that COULD be a ticker, company name, or descriptive reference.
// Tier 0 validates the easy ones; Tier 1 classifies the rest.

export function tokenizeMessage(message: string): string[] {
  const candidates = new Set<string>();

  // 1. Regex ticker patterns (2-5 letter sequences — could be tickers)
  const tickerMatches = message.match(/\$?\b([A-Z]{2,5})\b/gi);
  if (tickerMatches) {
    for (const m of tickerMatches) {
      const upper = m.replace('$', '').toUpperCase();
      if (!NOT_TICKERS.has(upper)) candidates.add(upper);
    }
  }

  // 2. Single-word candidates: alphabetical, 3+ chars, not stop words
  const words = message.split(/[\s,;:!?()\[\]{}"']+/);
  for (const w of words) {
    if (w.length < 3) continue;
    if (!/^[A-Za-z]+$/.test(w)) continue; // skip numbers, symbols
    const lower = w.toLowerCase();
    if (STOP_WORDS.has(lower)) continue;
    if (NOT_TICKERS.has(w.toUpperCase())) continue;
    candidates.add(w);
  }

  // 3. Multi-word candidates: 2-3 consecutive non-stop-words
  const filtered = words.filter(w => {
    if (w.length < 2) return false;
    if (!/^[A-Za-z]+$/.test(w)) return false;
    if (STOP_WORDS.has(w.toLowerCase())) return false;
    return true;
  });

  for (let i = 0; i < filtered.length; i++) {
    // Bigram
    if (i + 1 < filtered.length) {
      const bigram = `${filtered[i]} ${filtered[i + 1]}`;
      // Only if at least one word looks like a proper noun (starts with capital)
      if (/[A-Z]/.test(filtered[i][0]) || /[A-Z]/.test(filtered[i + 1][0])) {
        candidates.add(bigram);
      }
    }
    // Trigram
    if (i + 2 < filtered.length) {
      const trigram = `${filtered[i]} ${filtered[i + 1]} ${filtered[i + 2]}`;
      if (/[A-Z]/.test(filtered[i][0]) || /[A-Z]/.test(filtered[i + 1][0]) || /[A-Z]/.test(filtered[i + 2][0])) {
        candidates.add(trigram);
      }
    }
  }

  // 4. Descriptive reference patterns: "the X Y" where X is capital
  const descMatches = message.match(/\bthe\s+([A-Z][a-z]+\s+[a-z]+(?:\s+[a-z]+)?)\b/g);
  if (descMatches) {
    for (const m of descMatches) {
      candidates.add(m);
    }
  }

  // Deduplicate, sort by length descending (longer = more specific)
  return [...candidates].sort((a, b) => b.length - a.length).slice(0, 25);
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
  // canonicalSymbol is the authoritative ticker, NOT the lookup key.
  if (PREVERIFIED_TICKERS[upper]) {
    const pv = PREVERIFIED_TICKERS[upper];
    return { symbol: pv.canonicalSymbol, name: pv.name, exchange: pv.exchange, confidence: 'high', source: 'preverified', tier: 0 };
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

/** Is this phrase ticker-shaped? (2-5 chars, all alpha, uppercase) */
function isTickerShaped(phrase: string): boolean {
  return /^[A-Z]{2,5}$/.test(phrase);
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
        max_tokens: 200,
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

    return data.result
      .filter((r: any) => {
        if (/^[A-Z]{1,5}$/.test(r.symbol)) {
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
        score: 0,
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
        // Check PREVERIFIED_TICKERS first — newer IPOs (SPCX, etc.) may not be in Finnhub free tier
        const upperPhrase = item.phrase.toUpperCase().replace(/\s+/g, ' ');
        const upperCleaned = item.cleanedQuery.toUpperCase().replace(/\s+/g, ' ');
        const pvMatch = PREVERIFIED_TICKERS[upperPhrase] || PREVERIFIED_TICKERS[upperCleaned];
        if (pvMatch) {
          results.push({
            symbol: upperPhrase,
            name: pvMatch.name,
            exchange: pvMatch.exchange,
            confidence: 'high',
            source: 'preverified',
            tier: 2,
          });
          break;
        }
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
 * TIER 0 — Fast-path regex + cache (PURE OPTIMIZATION, never a gate).
 *          Ticker-shaped candidates get quick-validated. All unmatched
 *          and non-ticker candidates ALWAYS fall through to Tier 1.
 * TIER 1 — DeepSeek classification of all unmatched phrases
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

  // ── Tokenize: extract ALL candidate entities ────────────
  const allCandidates = tokenizeMessage(userMessage);

  if (allCandidates.length === 0) {
    return {
      resolved: [],
      needsClarification: false,
      notFound: [],
      tier2Required: false,
      emptyInput: true,
    };
  }

  console.log(`[ticker-resolver] Tokenized ${allCandidates.length} candidates: ${allCandidates.slice(0, 10).join(', ')}${allCandidates.length > 10 ? '...' : ''}`);

  // ── TIER 0: Fast-path validation for ticker-shaped candidates ──
  const unmatchedTier0: string[] = [];
  let usSymbols: Set<string> = new Set();
  try {
    usSymbols = await loadSymbolCache();
  } catch {
    // Cache unavailable — all go to Tier 1
  }

  for (const candidate of allCandidates) {
    // Only quick-validate ticker-shaped candidates in Tier 0
    // Non-ticker phrases (company names, descriptive refs) skip Tier 0 entirely
    if (isTickerShaped(candidate)) {
      const validated = await quickValidate(candidate, usSymbols);
      if (validated) {
        resolved.push(validated);
      } else {
        unmatchedTier0.push(candidate);
      }
    } else {
      // Non-ticker phrase — always goes to Tier 1 classification
      unmatchedTier0.push(candidate);
    }
  }

  console.log(`[ticker-resolver] Tier 0: ${resolved.length} resolved, ${unmatchedTier0.length} → Tier 1`);

  // CRITICAL: Never return early. Even if Tier 0 resolved everything it could,
  // unmatched candidates ALWAYS go to Tier 1. The only early return is when
  // there were literally zero candidates to begin with (handled above).

  if (unmatchedTier0.length === 0) {
    // Everything resolved in Tier 0 — genuine success
    return {
      resolved,
      needsClarification: false,
      notFound: [],
      tier2Required: false,
      emptyInput: false,
    };
  }

  // ── TIER 1: Classify unmatched phrases ─────────────────
  const classifyResult = await classifyPhrases(unmatchedTier0, dkKey);

  if (classifyResult.length === 0) {
    // Classification failed — unmatched phrases become notFound (honest failure)
    console.warn(`[ticker-resolver] Tier 1 classification returned empty for ${unmatchedTier0.length} candidates: ${unmatchedTier0.join(', ')}`);
    unmatchedTier0.forEach(t => notFound.push(t));
    return {
      resolved,
      needsClarification: notFound.length > 0,
      notFound,
      tier2Required: false,
      emptyInput: false,
    };
  }

  console.log(`[ticker-resolver] Tier 1 classified ${classifyResult.length} phrases: ${classifyResult.map(p => `${p.phrase}→${p.category}`).join(', ')}`);

  // ── TIER 2: Ground in live data ────────────────────────
  const tier2 = await processTier2(classifyResult, fKey, sxngUrl);
  resolved.push(...tier2.results);
  clarificationOptions.push(...tier2.clarifications);
  notFound.push(...tier2.notFound);
  tier2Required = tier2.tier2Used;

  // ── TIER 3: Confidence branch ──────────────────────────
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

  console.log(`[ticker-resolver] Done: ${deduped.length} resolved, ${notFound.length} notFound, clarify=${needsClarification}, tier2=${tier2Required}`);

  return {
    resolved: deduped,
    needsClarification,
    clarificationOptions: needsClarification ? clarificationOptions : undefined,
    notFound,
    tier2Required,
    emptyInput: false,
  };
}
