// ───────────────────────────────────────────────────────────────
// Authoritative intent classifier.
//
// Replaces the regex `classifyIntent` + DeepSeek `screenMessage` stack.
// Flow:
//   1. normalizeMessage() — collapse surface-text variation
//   2. fastPath() — narrow, synchronous checks for genuinely unambiguous
//      inputs (direct trades, empty/gibberish, trivial commands)
//   3. GPT-5 nano — fixed, closed taxonomy for everything else
//
// The GPT-5 nano output is AUTHORITATIVE (not a narrow backstop): every
// message that isn't caught by the fast-path is classified by the model,
// and its result is trusted directly. On model error/timeout we fail OPEN
// to the light path (single_security_research), never to a full build.
// ───────────────────────────────────────────────────────────────

import { normalizeMessage, editDistance } from './normalize';
import { NOT_TICKERS } from '@/lib/symbol-resolution';
import type { VehiclePreference } from './manager';

export type TaxonomyCategory =
  | 'portfolio_construction'
  | 'single_security_research'
  | 'direct_trade_instruction'
  | 'portfolio_relative_question'
  | 'educational'
  | 'market_commentary'
  | 'comparative'
  | 'off_topic';

export interface ClassifierResult {
  category: TaxonomyCategory;
  /** Vehicle is only meaningful for portfolio_construction. */
  vehicle: VehiclePreference;
  needsSearch: boolean;
  searchQuery: string | null;
  source: 'fast_path' | 'gpt5_nano' | 'fail_open';
  /** True when input was empty/pure-gibberish → caller returns a graceful reply. */
  gibberish?: boolean;
  /** True when input is a trivial command (hi/help/thanks) → light path. */
  trivial?: boolean;
  confidence: number;
}

const TAXONOMY: TaxonomyCategory[] = [
  'portfolio_construction',
  'single_security_research',
  'direct_trade_instruction',
  'portfolio_relative_question',
  'educational',
  'market_commentary',
  'comparative',
  'off_topic',
];

// ─── Fast-path ────────────────────────────────────────────────

const TRADE_VERBS = /\b(buy|purchase|sell|short|cover|dump|acquire|add)\b/i;
const TRIVIAL_COMMANDS =
  /^(hi|hey|hello|yo|sup|howdy|good\s*(morning|afternoon|evening)|help|what\s+can\s+you\s+do|what\s+do\s+you\s+do|thanks|thank\s+you|thx|ok|okay|cool|nice|menu|start|begin)$/i;
const TICKER_SHAPE = /^\$?[A-Z]{1,5}$/;

/** Extract ticker-like candidates from a raw message (case-preserved). */
function tickerCandidates(message: string): string[] {
  const matches = message.match(/\$?\b([A-Z]{1,5})\b/g) || [];
  const out: string[] = [];
  for (const m of matches) {
    const sym = m.replace('$', '').toUpperCase();
    if (NOT_TICKERS.has(sym)) continue;
    if (!TICKER_SHAPE.test(sym)) continue;
    out.push(sym);
  }
  return [...new Set(out)];
}

/**
 * Narrow, synchronous fast-path. Returns null when the message should go to
 * the model. Only catches genuinely unambiguous inputs.
 */
function fastPath(message: string): ClassifierResult | null {
  const norm = normalizeMessage(message);

  // Empty / whitespace / pure-gibberish → graceful "didn't understand".
  if (norm.isEmpty || norm.isGibberish) {
    return {
      category: 'off_topic',
      vehicle: 'unspecified',
      needsSearch: false,
      searchQuery: null,
      source: 'fast_path',
      gibberish: true,
      confidence: 1,
    };
  }

  // Trivial commands / greetings → light path (model responds naturally).
  if (TRIVIAL_COMMANDS.test(norm.original.trim())) {
    return {
      category: 'off_topic',
      vehicle: 'unspecified',
      needsSearch: false,
      searchQuery: null,
      source: 'fast_path',
      trivial: true,
      confidence: 1,
    };
  }

  const tickers = tickerCandidates(message);
  const hasAmount = /\$?\d[\d,]*(?:\.\d+)?\b/.test(message);
  const hasTradeVerb = TRADE_VERBS.test(message);
  const wordCount = norm.tokens.length;

  // Direct trade: explicit buy/sell verb + exactly one ticker, short and
  // with no other intent language. ("buy AAPL", "sell NVDA", "buy 2 shares AAPL")
  if (hasTradeVerb && tickers.length === 1 && wordCount <= 5) {
    return {
      category: 'direct_trade_instruction',
      vehicle: 'unspecified',
      needsSearch: false,
      searchQuery: null,
      source: 'fast_path',
      confidence: 0.98,
    };
  }

  // Direct trade: ticker + $ amount with no other language. ("$1000 VOO")
  if (!hasTradeVerb && hasAmount && tickers.length === 1 && wordCount <= 4) {
    return {
      category: 'direct_trade_instruction',
      vehicle: 'unspecified',
      needsSearch: false,
      searchQuery: null,
      source: 'fast_path',
      confidence: 0.97,
    };
  }

  return null;
}

// ─── GPT-5 nano classifier ────────────────────────────────────

interface Gpt5Raw {
  category?: string;
  vehicle?: string;
  needsSearch?: boolean | string;
  searchQuery?: string | null;
}

const VEHICLES: VehiclePreference[] = ['stocks', 'etfs', 'mixed', 'unspecified'];

function coerceVehicle(v: unknown): VehiclePreference {
  const s = String(v ?? 'unspecified').toLowerCase();
  if (VEHICLES.includes(s as VehiclePreference)) return s as VehiclePreference;
  return 'unspecified';
}

function coerceNeedsSearch(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  return String(v).toLowerCase() === 'true';
}

function parseClassifierJson(raw: string): Gpt5Raw | null {
  let s = raw.trim();
  // Strip markdown fences if the model wraps the JSON.
  s = s.replace(/```(?:json)?\s*\n?/g, '').replace(/```/g, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1)) as Gpt5Raw;
  } catch {
    return null;
  }
}

const CLASSIFIER_SYSTEM = `You are a precise router for a retail investing assistant. Classify the user's message into EXACTLY ONE category. Reply with JSON only.

Categories (choose exactly one):
- "portfolio_construction" — building, rebalancing, or adding to a portfolio ("build me a portfolio", "rebalance my holdings", "add to my positions", "grow my cash", "diversify what I have")
- "single_security_research" — research/analysis of ONE named security ("tell me about AAPL", "is NVDA a buy", "what's VOO")
- "direct_trade_instruction" — explicit buy/sell/order intent ("buy 10 shares of AAPL", "sell my NVDA")
- "portfolio_relative_question" — a question about the user's OWN current holdings ("how exposed am I to tech", "do I own too much AI")
- "educational" — definitional/conceptual, no live data needed ("what is a P/E ratio", "how do ETFs work")
- "market_commentary" — macro/market questions ("what's happening in the market", "how are rates moving")
- "comparative" — comparing two or more securities ("AAPL vs MSFT", "which is better VOO or SPY")
- "off_topic" — genuinely outside finance/investing (jokes, weather, recipes, etc.)

Also output these fields:
- "vehicle": ONLY relevant when category is "portfolio_construction". One of "stocks", "etfs", "mixed", "unspecified". Use "unspecified" when the user did not indicate which vehicle.
- "needsSearch": true if answering needs current/recent data (news, prices, recent events). false if it is conceptual or about the user's own holdings.
- "searchQuery": a concise search query string when needsSearch is true, otherwise null.

Reply with EXACTLY this JSON shape, nothing else:
{"category":"...","vehicle":"...","needsSearch":true,"searchQuery":"..."}`;

async function classifyWithGpt5Nano(
  message: string,
  normalized: ReturnType<typeof normalizeMessage>,
): Promise<ClassifierResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('[classifier] Missing OPENAI_API_KEY — failing open to light path');
    return failOpen(message);
  }

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(6000),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-5-nano',
        max_completion_tokens: 500,
        reasoning_effort: 'low',
        messages: [
          { role: 'system', content: CLASSIFIER_SYSTEM },
          { role: 'user', content: normalized.compact || normalized.lower },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('[classifier] GPT-5 nano HTTP', res.status, errText.slice(0, 200));
      return failOpen(message);
    }

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || '';
    const parsed = parseClassifierJson(raw);

    if (!parsed || !parsed.category || !TAXONOMY.includes(parsed.category as TaxonomyCategory)) {
      console.error('[classifier] GPT-5 nano returned invalid taxonomy:', raw.slice(0, 200));
      return failOpen(message);
    }

    const category = parsed.category as TaxonomyCategory;
    const vehicle = category === 'portfolio_construction' ? coerceVehicle(parsed.vehicle) : 'unspecified';
    const needsSearch = coerceNeedsSearch(parsed.needsSearch);
    const searchQuery = needsSearch && typeof parsed.searchQuery === 'string' && parsed.searchQuery.trim()
      ? parsed.searchQuery.trim().slice(0, 200)
      : null;

    return {
      category,
      vehicle,
      needsSearch,
      searchQuery,
      source: 'gpt5_nano',
      confidence: 0.9,
    };
  } catch (e) {
    console.error('[classifier] GPT-5 nano failed:', (e as Error)?.message);
    return failOpen(message);
  }
}

/** Fail-open default — light path, never a full portfolio build. */
function failOpen(message: string): ClassifierResult {
  return {
    category: 'single_security_research',
    vehicle: 'unspecified',
    needsSearch: false,
    searchQuery: null,
    source: 'fail_open',
    confidence: 0,
  };
}

// ─── Public API ───────────────────────────────────────────────

export async function classify(message: string): Promise<ClassifierResult> {
  const fast = fastPath(message);
  if (fast) return fast;
  const normalized = normalizeMessage(message);
  return classifyWithGpt5Nano(message, normalized);
}
