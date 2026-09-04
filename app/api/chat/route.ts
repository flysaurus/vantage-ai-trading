import Anthropic from '@anthropic-ai/sdk'

// Allow the full pipeline (DeepSeek screening → search → quotes → model stream)
// to finish without Vercel killing the function mid-stream.
export const maxDuration = 300;
import { parsePortfolioBlocks } from '@/lib/portfolio-blocks'
import { VANTAGE_SYSTEM_PROMPT, ALERTS_SYSTEM_PROMPT } from '@/lib/ai-system-prompt'
import { withFallback, stageLog, createTimeoutBudget, startStage, endStage } from '@/lib/ai/resilience'
import { resolveSymbol } from '@/lib/tools/resolve-symbol'
import type { SystemBlock } from '@/lib/ai-provider'
import { CHAT_SAFETY_BLOCKS } from '@/lib/ai/shared-safety-blocks';
import { CHAT_PRINCIPLES } from '@/lib/ai-principles';
import { resolveTickers } from '@/lib/ticker-resolver';
import { buildUserProfileContext } from '@/lib/ai/userProfile'
import type { UserProfile } from '@/lib/ai/userProfile'
import { buildProfileAnswer, type ProfileQuestionKind } from '@/lib/ai/profile-answers'
import { buildAppHelpAnswer, type AppHelpKind } from '@/lib/ai/app-help'
import { extractRiskTarget, extractStyleTarget, extractRebalanceTarget, computeRebalancePlan, styleLabel, formatStyleChangeAnswer, formatInvalidStyleAnswer, formatStylePickPrompt, formatRiskChangeAnswer, detectRiskLevel, buildAccountStateAnswer, normalizeStyle, formatRebalancePlanAnswer, formatTargetsOnlyAnswer, detectPortfolioGroundingMismatch, detectExecuteRebalance, detectRebalanceFollowUp, detectCashOnlyRebalance, detectFullPortfolioRebalance, detectCustomAmountRebalance, detectScopedRebalanceMode, detectAssetClass, formatRebalanceBudgetPrompt, formatAssetClassPrompt, rebalancePlanToLegs, formatRebalanceExecutionPreview, buildScheduledActivityAnswer, isDcaCreationCommand, parseOrderHistoryWindow, orderHistoryWindowLabel, buildOrderHistoryAnswer, buildTaxLossHarvestAnswer, type OrderHistoryRow } from '@/lib/ai/account-actions'
import type { PortfolioSnapshot } from '@/lib/ai/account-actions'
import { READONLY_TOOLS, executeReadonlyTool } from '@/lib/ai/readonly-tools'
import type { ReadonlyToolContext } from '@/lib/ai/readonly-tools'
import { MONEY_TOOLS, executeMoneyTool } from '@/lib/ai/money-tools'
import type { MoneyToolContext } from '@/lib/ai/money-tools'
import { detectConfirmIntent, actionRequiresSymbolEcho, symbolEchoMatches, findParamConflict } from '@/lib/ai/confirm'
import { isQuestionLike, isHesitant } from '@/lib/ai/question-guard'
import { getPendingAction, markPendingAction, createPendingAction } from '@/lib/ai/pending-actions'
import { executePendingAction } from '@/lib/ai/executors'
import { checkUsageLimit, incrementUsage, getLocalDateFromTimezone } from '@/lib/ai-guard'
import { getOptionalUserId } from '@/lib/auth/get-server-user'
import { getActiveFacts, writeFact, formatFactsForPrompt } from '@/lib/ai/facts'
import { parseAccountScope, applyAccountScopeFilter } from '@/lib/account-scope'
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
  validateSymbol,
  NOT_TICKERS,
  FOREIGN_EXCHANGE_SUFFIXES,
  NOT_COMPANIES,
  FILTERED_COMMON_WORDS,
  isFilteredCommonWord,
  FALLBACK_SYMBOLS,
} from '@/lib/symbol-resolution'
import { getStyleScreeningDefaults } from '@/lib/investor-style-defaults'
import {
  resolveVehicleForRequest,
  detectVehicleAnswer,
} from '@/lib/ai/manager'
import { classify, type ClassifierResult } from '@/lib/ai/classifier'
import { logClassifierAudit } from '@/lib/ai/classifier-audit'
import { validateResponse } from '@/lib/ai/validator'

/** Fetch the user's DCA schedules + open/queued orders and render the answer. */
async function fetchScheduledActivityAnswer(userId: string, accountId?: string | null): Promise<string> {
  const supabase = createServerClient();
  const acctScope = accountId ? parseAccountScope(accountId) : null;
  let dcaQuery = (supabase as any).from('strategies')
    .select('id, symbol, config, is_active, next_run_at, connection_id, is_demo')
    .eq('user_id', userId).eq('type', 'dca')
    .order('created_at', { ascending: true });
  dcaQuery = acctScope ? applyAccountScopeFilter(dcaQuery, acctScope) : dcaQuery.eq('is_demo', false);
  let orderQuery = (supabase as any).from('orders')
    .select('id, symbol, side, qty, notional, status, created_at, connection_id, is_demo')
    .eq('user_id', userId)
    .in('status', ['submitted', 'open', 'partially_filled']);
  orderQuery = acctScope ? applyAccountScopeFilter(orderQuery, acctScope) : orderQuery.eq('is_demo', false);
  const [dcaRes, orderRes] = await Promise.all([
    dcaQuery.order('created_at', { ascending: true }),
    orderQuery.order('created_at', { ascending: false }),
  ]);
  const dcas = ((dcaRes.data || []) as any[]).map((d: any) => ({
    symbol: d.symbol,
    amount: typeof d.config?.amount === 'number' ? d.config.amount : null,
    frequency: d.config?.frequency || null,
    dayOfWeek: d.config?.dayOfWeek,
    dayOfMonth: d.config?.dayOfMonth,
    endDate: d.config?.endDate || null,
    nextRunAt: d.next_run_at || null,
    isActive: !!d.is_active,
  }));
  const orders = ((orderRes.data || []) as any[]).map((o: any) => ({
    symbol: o.symbol,
    side: o.side,
    qty: o.qty != null ? Number(o.qty) : null,
    notional: o.notional != null ? Number(o.notional) : null,
    status: o.status,
    createdAt: o.created_at || null,
  }));
  return buildScheduledActivityAnswer(dcas, orders);
}

/** Fetch executed (filled) orders within an optional time window and render them. */
async function fetchOrderHistoryAnswer(
  userId: string,
  accountId: string | null | undefined,
  since: Date | null,
  windowLabel: string,
): Promise<string> {
  const supabase = createServerClient();
  const acctScope = accountId ? parseAccountScope(accountId) : null;
  let orderQuery = (supabase as any).from('orders')
    .select('symbol, company_name, side, qty, filled_qty, status, filled_price, notional, filled_at, created_at')
    .eq('user_id', userId)
    .in('status', ['filled', 'partially_filled', 'executed', 'closed']);
  orderQuery = acctScope ? applyAccountScopeFilter(orderQuery, acctScope) : orderQuery.eq('is_demo', false);
  if (since) orderQuery = orderQuery.gte('filled_at', since.toISOString());
  const { data, error } = await orderQuery.order('filled_at', { ascending: false }).limit(50);
  if (error) {
    console.error('[chat] order-history query failed:', error.message);
    return "I couldn't load your order history right now — please try again.";
  }
  const orders: OrderHistoryRow[] = (data || []).map((o: any) => ({
    symbol: o.symbol,
    companyName: o.company_name ?? null,
    side: o.side,
    qty: o.qty != null ? Number(o.qty) : null,
    filledQty: o.filled_qty != null ? Number(o.filled_qty) : null,
    status: o.status,
    filledPrice: o.filled_price != null ? Number(o.filled_price) : null,
    notional: o.notional != null ? Number(o.notional) : null,
    filledAt: o.filled_at ?? null,
    createdAt: o.created_at ?? null,
  }));
  return buildOrderHistoryAnswer(orders, windowLabel);
}

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  defaultHeaders: {
    'anthropic-beta': 'prompt-caching-2024-07-31',
  },
})
const SEARXNG_URL = process.env.SEARXNG_URL || 'http://localhost:8888'

// ─── Account context builder — prevents AI from confusing Demo with real holdings ──
function buildAccountContext(meta: {
  isDemo: boolean;
  brokerSource: string;
  brokerName: string;
  environment: string;
  tradingEnabled: boolean;
}): string {
  if (meta.isDemo) {
    return `⚠️ ACCOUNT CONTEXT: You are viewing a DEMO / paper-trading portfolio. All positions, cash, and P&L are simulated. NOT real money. The user cannot execute real trades from this account.`;
  }
  const envLabel = meta.environment === 'paper' ? 'paper trading' : 'live';
  const tradeNote = meta.tradingEnabled ? ' Trading is enabled.' : ' Trading is READ-ONLY — the user cannot place orders from this account.';
  return `🔒 ACCOUNT CONTEXT: Connected to ${meta.brokerName} (${envLabel} environment). These are REAL ${envLabel === 'live' ? 'positions with real money' : 'paper-trading positions'}.${tradeNote}`;
}

// ─── Holdings-callout scope (SSE dataCallout event) ──────────────────
// The server decides WHICH holdings to surface in a client-side callout based
// on the classified intent. The client renders from its OWN live PortfolioContext
// (never trusts server-sent numbers), so the event only carries scope + tickers.
export interface DataCalloutEvent {
  scope: 'holdings' | 'positions';
  /** For scope='positions': the held tickers to show. Omitted for 'holdings'. */
  tickers?: string[] | null;
}

/**
 * Determine whether (and how) to surface a holdings callout for a classified
 * message. Deterministic — no prose heuristics, no trust in model output.
 *
 * Rule 1+2: `portfolio_relative_question` / `account_state` → full holdings.
 * Rule 3: `single_security_research` / `comparative` → only the mentioned
 *         tickers the user ACTUALLY holds (intersection).
 */
function resolveDataCallout(
  classification: ClassifierResult,
  portfolioSnapshot: PortfolioSnapshot | null,
  lastMessage: string,
): DataCalloutEvent | null {
  const hasHoldings = !!(portfolioSnapshot && portfolioSnapshot.positions.length > 0);
  if (!hasHoldings) return null;

  const category = classification.category;

  if (category === 'portfolio_relative_question' || category === 'account_state') {
    return { scope: 'holdings' };
  }

  // Rule 3: research/comparative — surface ONLY held tickers mentioned in the
  // message. Never surfaces a ticker the user doesn't own (e.g. "NVDA vs AMD"
  // while holding only NVDA → callout shows NVDA only).
  if (category === 'single_security_research' || category === 'comparative') {
    const mentioned = new Set(extractTickers(lastMessage).map(t => t.toUpperCase()));
    if (mentioned.size === 0) return null;
    const held = portfolioSnapshot!.positions.map(p => (p.symbol || '').toUpperCase());
    const intersection = held.filter(s => mentioned.has(s));
    if (intersection.length === 0) return null;
    return { scope: 'positions', tickers: intersection };
  }

  return null;
}

// Known single-letter NYSE/Nasdaq tickers
// These are legitimate US-listed stocks that the 2-5 char regex can't match.
// MUST be kept in sync with actual listings (check if delisted/renamed).
const SINGLE_LETTER_TICKERS = new Set([
  'X',  // US Steel (NYSE)
  'F',  // Ford Motor (NYSE)
  'V',  // Visa (NYSE)
  'T',  // AT&T (NYSE)
  'C',  // Citigroup (NYSE)
  'M',  // Macy's (NYSE)
  'W',  // Wayfair (NYSE)
]);

// ─── Ticker extraction (filters from shared symbol-resolution module) ──
function extractTickers(text: string): string[] {
  // Match: $SPCX, SPCX (2-5 letters, standalone, case-insensitive)
  const matches = text.match(/\$?\b([A-Z]{2,5})\b/gi);
  const results = new Set<string>();

  if (matches) {
    matches
      .map(t => t.replace('$', '').toUpperCase())
      .filter(t => !NOT_TICKERS.has(t))
      .forEach(t => results.add(t));
  }

  // Single-letter tickers: keyword context (e.g., "F stock", "C price quote")
  const singleLetter = text.match(/\$?\b([A-Z])\b\s*(?:stocks|shares|stock|share|price|quote|trading|ticker)\b/gi);
  if (singleLetter) {
    singleLetter
      .map(t => t.replace(/[\$\s]+.*$/g, '').toUpperCase())
      .filter(t => t.length === 1 && /^[A-Z]$/.test(t) && !NOT_TICKERS.has(t))
      .forEach(t => results.add(t));
  }

  // Adjacent NOT_TICKERS → single-letter extraction
  // Handles "spec. X" → SPEC blocked by NOT_TICKERS, X extracted as legit ticker
  // Requires either: (a) blocked word is uppercase (ticker intent), or
  // (b) buy/sell/invest context exists nearby within 100 chars.
  const hasTradingContext = /\b(?:buy|sell|invest|trade|purchase|portfolio|position|allocation|shares|stock|stocks)\b/i.test(text);
  const adjacentPattern = /\b([A-Z]{2,5})\b[.\s]+\b([A-Z])\b/gi;
  let adjMatch;
  while ((adjMatch = adjacentPattern.exec(text)) !== null) {
    const rawBlocker = adjMatch[1];
    const blocker = rawBlocker.toUpperCase();
    const candidate = adjMatch[2].toUpperCase();
    const isUppercase = rawBlocker === blocker;
    if (NOT_TICKERS.has(blocker) && SINGLE_LETTER_TICKERS.has(candidate) && (isUppercase || hasTradingContext)) {
      results.add(candidate);
    }
  }

  // Direct buy/sell context with single-letter whitelist (e.g., "buy X", "sell F")
  const buyPattern = /\b(?:buy|sell|invest|trade|purchase|get|add)\s+(?:\$?\d+\s+)?(?:some\s+)?(?:worth\s+)?\b([A-Z])\b/gi;
  let buyMatch;
  while ((buyMatch = buyPattern.exec(text)) !== null) {
    const candidate = buyMatch[1].toUpperCase();
    if (SINGLE_LETTER_TICKERS.has(candidate) && !NOT_TICKERS.has(candidate)) {
      results.add(candidate);
    }
  }

  return [...results]; // deduplicated via Set
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
  const parenTicker = text.matchAll(/([A-Z][a-z]{2,}(?:\s+(?:of|the|de|van|von|del|&|and)\s+)?[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)\s*\(([A-Z]{1,5})\)/g)
  for (const m of parenTicker) {
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
  // Pattern: ticker symbols (1-5 letters, optionally with single-letter suffix)
  // Catches "buy SPCX", "spcx for $1000", "NVDA at 140", regardless of case
  const tickerPattern = text.matchAll(/\b([A-Z]{1,5}(?:\.[A-Z])?)\b/gi)
  for (const m of tickerPattern) {
    const t = m[1]
    // Skip common all-caps words that aren't tickers
    if (['A', 'I', 'AI', 'IT', 'AT', 'BE', 'GO', 'IN', 'IS', 'MY', 'NO', 'OK', 'OR', 'SO', 'TO', 'US', 'WE', 'AM', 'BY', 'IF', 'ON', 'AS', 'AN', 'DO', 'HE', 'HI', 'ME', 'OH', 'PI', 'RE', 'UP', 'ALL', 'AND', 'ARE', 'BUY', 'BUYS', 'CAN', 'CEO', 'CFO', 'COO', 'CTO', 'DAY', 'DID', 'DUE', 'ETF', 'FOR', 'GET', 'GOT', 'HAS', 'HER', 'HIM', 'HIS', 'HOW', 'IPO', 'ITS', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC', 'JOB', 'JOBS', 'LOW', 'NEW', 'NOT', 'NOW', 'OFF', 'OUR', 'OUT', 'OWN', 'PAY', 'PUT', 'SAY', 'SEE', 'SET', 'SIX', 'TEN', 'THE', 'TOP', 'TWO', 'USE', 'WAR', 'WAS', 'WAY', 'WHO', 'WHY', 'WON', 'WORTH', 'YES', 'YET', 'YOU'].includes(t.toUpperCase())) continue
    names.add(t.toUpperCase())
  }
  return [...names].slice(0, 15)
}

/** Resolve a company name to its US ticker via Finnhub search (fast Phase 1 only). */
async function resolveOneFast(name: string): Promise<{ symbol: string; name: string } | null> {
  const key = process.env.FINNHUB_IO_API_KEY
  // Phase -1: Pre-verified tickers bypass Finnhub entirely
  // canonicalSymbol is the authoritative ticker, NOT the lookup key.
  // Prevents [RECOMMEND:SPACEX:...] when the real ticker is SPCX.
  const PREVERIFIED: Record<string, { name: string; canonicalSymbol: string }> = {
    'SPCX': { name: 'Space Exploration Technologies Corp.', canonicalSymbol: 'SPCX' },
    'SPACEX': { name: 'Space Exploration Technologies Corp.', canonicalSymbol: 'SPCX' },
    'SPACE EXPLORATION': { name: 'Space Exploration Technologies Corp.', canonicalSymbol: 'SPCX' },
  };
  const upper = name.trim().toUpperCase();
  if (PREVERIFIED[upper]) {
    const pv = PREVERIFIED[upper];
    console.log(`[chat] ✅ resolveOneFast: pre-verified "${upper}" → ${pv.name} (canonical: ${pv.canonicalSymbol})`);
    return { symbol: pv.canonicalSymbol, name: pv.name };
  }
  if (!key) return null
  try {
    // Phase 0: If input looks like a ticker, check profile directly
    // MUST validate exchange — OTC stocks are excluded (see OTC_EXCHANGE_RE below)
    if (/^[A-Z]{1,5}$/i.test(name.trim())) {
      const ticker = name.trim().toUpperCase();
      const pRes = await fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(ticker)}&token=${key}`)
      if (pRes.ok) {
        const p = await pRes.json()
        if (p.name && p.ticker && p.exchange) {
          // Reject OTC-listed securities — same as foreign-exchange exclusion
          const rawEx = (p.exchange || '').toUpperCase();
          if (/^OTC|OTCMKTS|OTCBB|OTCQB|OTCQX|PINK/i.test(rawEx)) {
            console.log(`[chat] 🚫 resolveOneFast: rejected OTC ticker "${ticker}" (exchange: ${p.exchange})`);
            return null;
          }
          console.log(`[chat] ✅ resolveOneFast: direct ticker lookup "${ticker}" → ${p.name} (${p.exchange})`)
          return { symbol: ticker, name: p.name }
        }
      }
      console.log(`[chat] 🔍 resolveOneFast: "${ticker}" no profile match — falling back to search`)
    }
    // Phase 1: Finnhub search
    const res = await fetch(`https://finnhub.io/api/v1/search?q=${encodeURIComponent(name)}&token=${key}`)
    if (!res.ok) return null
    const data = await res.json()
    if (data.result?.length > 0) {
      // Prefer US-exchange results — NYSE, NASDAQ, AMEX, ARCA, BATS, IEX ONLY (NO OTC)
      const usResult = data.result.find((r: any) =>
        /^(NASDAQ|Nasdaq|NYSE|AMEX|ARCA|BATS|IEX)/i.test(r.exchange || '') &&
        /^[A-Z]{1,5}(\.[A-Z])?$/.test(r.symbol)
      )
      if (usResult) return { symbol: usResult.symbol, name: usResult.description }
      // Log when US exchange check fails but symbol format is valid
      const valid = data.result.find((r: any) => /^[A-Z]{1,5}(\.[A-Z])?$/.test(r.symbol))
      if (valid && valid.symbol.toUpperCase() === name.toUpperCase()) {
        console.log(`[chat] 🔍 resolveOneFast: "${name}" found with exchange="${valid.exchange}", type="${valid.type}" — exchange didn't match US pattern`)
      }
      if (valid) {
        // Check if the only valid result is OTC — if so, reject it
        const rawEx = (valid.exchange || '').toUpperCase();
        if (/^OTC|OTCMKTS|OTCBB|OTCQB|OTCQX|PINK/i.test(rawEx)) {
          console.log(`[chat] 🚫 resolveOneFast: search result for "${name}" is OTC (${valid.exchange}) — rejecting`);
          return null;
        }
        return { symbol: valid.symbol, name: valid.description };
      }
      // Log when no results pass the US ticker format check
      console.warn(`[chat] 🔍 resolveOneFast: "${name}" — ${data.result.length} Finnhub results, 0 passed US format check. Raw: ${data.result.slice(0,3).map((r:any) => `${r.symbol}(${r.exchange})`).join(', ')}`)
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
  // Only extract company names from the USER MESSAGE.
  // Web search context is for market data enrichment, NOT named entity extraction.
  // Random capitalized words from news snippets ("Prediction", "Street", "Source")
  // are noise — they waste Finnhub calls and produce zero resolutions.
  const fromUser = extractCompanyNames(userMessage)
  // Deduplicate, sort longest-first (more specific names first)
  const seen = new Set<string>()
  const unique = [...fromUser].filter(n => {
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

// ─── Stage 1: SearXNG Web Search ───
async function searchWeb(query: string): Promise<string> {
  try {
    const res = await fetch(
      `${SEARXNG_URL}/search?q=${encodeURIComponent(query)}&format=json&categories=general,news&language=en`,
      { signal: AbortSignal.timeout(6000) }
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

/** Build a CLARIFY event from validation failures, replacing fatal errors with
 *  user-facing questions. */
function buildClarifyFromFailures(
  failures: Array<{ check: string; detail: string }>,
  budget: number | null,
): { clarify: { question: string; options: string[] } } {
  const budgetFailure = failures.find(f => f.check === 'budget_reconciliation');
  const symbolFailure = failures.find(f => f.check === 'symbol_resolution');
  const formatFailure = failures.find(f => f.check === 'marker_format');
  const dupeFailure = failures.find(f => f.check === 'duplicate_company');

  if (budgetFailure && budget) {
    return {
      clarify: {
        question: `The portfolio totals don't match your $${budget.toLocaleString()} budget. How should I fix this?`,
        options: [
          `Use $${budget.toLocaleString()} — match my budget`,
          'Use whatever the AI recommended',
          'Let me adjust the request',
        ],
      },
    };
  }
  if (symbolFailure) {
    return {
      clarify: {
        question: 'Some ticker symbols were not recognized. How would you like to proceed?',
        options: [
          'Re-run with corrected symbols',
          'Skip unrecognized ones — use the rest',
          'Let me fix the symbols myself',
        ],
      },
    };
  }
  if (formatFailure || dupeFailure) {
    return {
      clarify: {
        question: 'The portfolio needs a small fix. Should I correct it and try again?',
        options: [
          'Yes, fix and regenerate',
          'Let me rephrase my request',
          'Cancel',
        ],
      },
    };
  }
  // Generic fallback
  return {
    clarify: {
      question: 'Something went wrong generating your portfolio. What should I do?',
      options: [
        'Try again with the same request',
        'Simplify my request',
        'Cancel',
      ],
    },
  };
}

/** Deterministic vehicle-triage CLARIFY (Part B) — no model call, no screening.
 *  Emitted when a portfolio build has no explicit vehicle (stocks vs ETFs vs mixed). */
function buildVehicleClarifyResponse(): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({
        clarify: {
          question: 'Do you want this portfolio built with individual stocks, ETFs, or a mix of both?',
          options: ['Stocks only', 'ETFs only', 'A mix of both'],
        },
      })}\n\n`));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

/** Deterministic single-text answer as SSE — mirrors the client's `data.text`
 *  streaming path. Use this for EVERY deterministic (non-model) response so it
 *  actually renders: the client ONLY parses `data: {...}` SSE lines, so a plain
 *  `Response.json({ content })` body is silently dropped (empty AI bubble). */
function textSSEResponse(content: string, action?: { kind: string }, dataCallout?: DataCalloutEvent): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      if (action) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ action })}\n\n`));
      }
      if (dataCallout) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ dataCallout })}\n\n`));
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: content })}\n\n`));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
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

// Strategy-advice / ideas questions are ADVICE, not a portfolio build. GPT-5 nano
// occasionally misclassifies "what strategies should I consider" →
// portfolio_construction (especially when a stale vehicle answer like "A mix of
// both" sits in history), which fires the slow screening pipeline and blows the
// 60s Vercel function timeout → Safari "Load failed". Detect these
// deterministically and force them to the light path.
const CONSTRUCTION_VERBS =
  /\b(build|rebuild|re-?balance|add|diversify|grow|deploy|allocate|convert|construct|create|execute|buy|purchase|sell|short|invest)\b/i;

function isStrategyAdviceQuery(message: string): boolean {
  const m = (message || '').toLowerCase();
  const hasAdviceNoun = /\bstrateg(y|ies)\b|\bideas?\b|\badvice\b|\brecommendations?\b|\bsuggestions?\b/.test(m);
  const asksForDirection = /\bconsider\b|\bshould\b|\bwould\b|\bcould\b|\bwhat\b|\bhow\b|\bgive\s+me\b/.test(m);
  return hasAdviceNoun && asksForDirection && !CONSTRUCTION_VERBS.test(m);
}

// ─── POST Handler ───
export async function POST(req: Request) {
  const t0 = Date.now();
  const tMark = (label: string) => console.log(`[chat] ⏱ +${Date.now() - t0}ms ${label}`);
  try {
    const body = await req.json()
    const { messages, portfolioContext, additionalContext, mode, timezone, retryAttempt: retryAttemptRaw, validationFailures: retryFailuresRaw, accountMeta, portfolio } = body
    const portfolioSnapshot: PortfolioSnapshot | null = (portfolio && typeof portfolio === 'object' && Array.isArray(portfolio.positions))
      ? portfolio as PortfolioSnapshot
      : null;
    const retryAttempt: number = typeof retryAttemptRaw === 'number' ? retryAttemptRaw : 0;
    const retryFailures: ValidationFailure[] | undefined = Array.isArray(retryFailuresRaw) ? retryFailuresRaw : undefined;

    // ── Usage limit check (type depends on mode) ──
    const userId = await getOptionalUserId();
    
    // Request tracing — makes it easy to isolate specific failures in Vercel logs
    const lastMsg = messages?.[messages.length - 1]?.content;
    const lastMsgPreview = typeof lastMsg === 'string' ? lastMsg.slice(0, 80) : '[non-text]';
    console.log(`[chat] ===> REQUEST user=${userId?.slice(0,8) || 'anon'} retry=${retryAttempt} msg="${lastMsgPreview}"`);
    
    // (usage-limit check runs below, after isFullPipeline is resolved)

    // Build user profile context from request
    const profile: UserProfile = {
      investorStyle: body.investorStyle || 'Lynch',
      riskTolerance: body.riskTolerance || 'Moderate',
      name: body.name || 'M',
      timezone: timezone || 'America/New_York',
    }

    // Fresh profile (investor style + risk tolerance) from DB overrides the
    // stale client body. The client caches `user.investorStyle` / `user.riskTolerance`,
    // so immediately after "change my style to X" or "change to aggressive" the
    // NEXT request still sends the OLD value. The DB is the source of truth, so a
    // "rebalance" follow-up targets the profile the user just switched to.
    if (userId && userId !== 'anonymous') {
      try {
        const supabase = createServerClient();
        const { data: userRow } = await (supabase as any)
          .from('users')
          .select('investor_style, risk_tolerance')
          .eq('id', userId)
          .maybeSingle();
        if (userRow?.investor_style) profile.investorStyle = userRow.investor_style;
        if (userRow?.risk_tolerance) profile.riskTolerance = userRow.risk_tolerance.charAt(0).toUpperCase() + userRow.risk_tolerance.slice(1);
      } catch (e) {
        console.error('[chat] fresh profile fetch failed (non-fatal):', e);
      }
    }

    const profileContext = buildUserProfileContext(profile)

    // Finance guard — check last user message
    const lastMessage: string = messages[messages.length - 1]?.content || ''
    // (Non-finance guard, profile questions, app-help, DCA setup, scheduled
    // activity, order history, account state, and tax-loss harvesting are now
    // detected inside classify()'s Tier 0 fast-path — see lib/ai/classifier.ts
    // `deterministicTier0` — and dispatched right after classify() below.)

    // ── Deterministic CONFIRM GATE (plan-then-confirm) ──
    // Handles the user's reply to a pending-action preview. NEVER the LLM — this
    // is the safety rail between "the model proposed something" and "a side
    // effect happened". Execution uses the STORED payload only, never text parsed
    // out of the confirm message. Negation → cancel; "yes but X" / param change
    // → re-plan; large amounts → require symbol echo.
    if (mode !== 'alerts') {
      const confirmIntent = detectConfirmIntent(lastMessage);
      if (confirmIntent.type !== 'none') {
        const supabase = createServerClient();
        const pending = userId && userId !== 'anonymous'
          ? await getPendingAction(supabase, userId)
          : null;
        if (pending) {
          if (confirmIntent.type === 'cancel') {
            await markPendingAction(supabase, pending.id, 'cancelled');
            return textSSEResponse('✅ Cancelled — nothing was executed.');
          }

          const conflict = confirmIntent.type === 'modify'
            ? 'parameters'
            : findParamConflict(lastMessage, pending.payload);
          if (confirmIntent.type === 'modify' || conflict) {
            // Params changed → re-plan, never execute the old preview.
            await markPendingAction(supabase, pending.id, 'cancelled');
            return textSSEResponse("Got it — I'll re-plan with those changes. Tell me the new parameters (e.g. \"invest $200 weekly instead\").");
          }

          // confirm → escalate strength by amount (echo the symbol for large sums).
          if (
            actionRequiresSymbolEcho(pending.actionType, pending.amountUsd) &&
            !symbolEchoMatches(lastMessage, pending.confirmToken)
          ) {
            const amt = pending.amountUsd != null ? ` $${pending.amountUsd}` : '';
            return textSSEResponse(
              `To confirm this${amt} action, please type the ticker back: \"confirm ${pending.confirmToken}\".`,
            );
          }

          // Atomically transition pending→executed (double-tap returns null).
          const executed = await markPendingAction(supabase, pending.id, 'executed');
          if (!executed) {
            return textSSEResponse('That action was already handled — nothing else ran.');
          }
          console.log(`[chat] 🔓 confirm gate → executing ${executed.actionType} (user ${userId?.slice(0, 8)})`);
          const result = await executePendingAction(supabase, executed);
          return textSSEResponse(result.message);
        }
        // No pending action → fall through to the model ("confirm what?").
      }
    }

    // ── Deterministic REBALANCE EXECUTION (Phase 4 — real multi-leg orders) ──
    // "execute the rebalance" stages a preview (pending_action) and asks for
    // confirmation. The actual order placement happens in the confirm gate above
    // via executePendingAction → execRebalance. Detected BEFORE classify() so
    // "execute the rebalance" isn't re-read as a new plan request.
    if (mode !== 'alerts' && (detectExecuteRebalance(lastMessage) || detectRebalanceFollowUp(messages))) {
      const supabase = createServerClient();
      const targetStyle = (profile.investorStyle || 'Lynch').toLowerCase();
      if (!portfolioSnapshot || (portfolioSnapshot.equity <= 0 && portfolioSnapshot.positions.length === 0)) {
        return textSSEResponse('⚠️ I need your current portfolio loaded to rebalance — connect your broker or refresh, then try again.');
      }
      if (!userId || userId === 'anonymous') {
        return textSSEResponse('You need to be signed in to execute trades.');
      }
      const scope = detectScopedRebalanceMode(messages);
      const plan = computeRebalancePlan(portfolioSnapshot, targetStyle, {
        cashOnly: scope.cashOnly,
        customAmount: scope.customAmount ?? undefined,
        assetClass: scope.assetClass ?? undefined,
      });
      const legs = rebalancePlanToLegs(plan);
      if (legs.length === 0) {
        return textSSEResponse(scope.cashOnly
          ? 'You have no available cash to deploy right now. Once your pending orders fill or you add cash, say "rebalance using cash only" again.'
          : scope.customAmount != null
            ? 'That amount is too small to split into buys — try a larger amount.'
            : `Your portfolio is already aligned with the **${plan.styleName}** targets — no rebalancing trades needed.`);
      }
      const action = await createPendingAction(supabase, userId, {
        actionType: 'rebalance_execute',
        payload: { style: targetStyle, legs },
        summary: `${scope.cashOnly ? 'Cash-only rebalance' : scope.customAmount != null ? 'Custom rebalance' : 'Rebalance'} to ${plan.styleName} (${legs.length} trades)`,
        amountUsd: null,
        confirmToken: null,
      });
      if (!action) return textSSEResponse('Failed to stage the rebalance — please try again.');
      console.log(`[chat] 🔒 staged rebalance_execute (${legs.length} legs) for user ${userId.slice(0, 8)}`);
      return textSSEResponse(formatRebalanceExecutionPreview(plan), { kind: 'rebalance_confirm' });
    }

    // (Style/risk mutations + rebalance plans are now confirm-only, gated on
    // classify()'s category — see the post-classify dispatch below.)

    const systemPrompt = mode === 'alerts'
      ? ALERTS_SYSTEM_PROMPT
      : VANTAGE_SYSTEM_PROMPT

    // ── Classifier (normalize → fast-path → GPT-5 nano) ──
    // Authoritative routing decision. Replaces the regex `classifyIntent` +
    // DeepSeek `screenMessage` stack. Fast-path handles unambiguous direct
    // trades / empty / trivial inputs synchronously; everything else goes to
    // GPT-5 nano, whose output is trusted directly (not a narrow backstop).
    const classification = await classify(lastMessage);
    tMark('classified');
    console.log(`[chat] ===> CLASSIFY category=${classification.category} vehicle=${classification.vehicle} source=${classification.source} needsSearch=${classification.needsSearch}${classification.gibberish ? ' GIBBERISH' : ''}${classification.trivial ? ' TRIVIAL' : ''}`);
    // Append-only audit (fire-and-forget) so mislabels can be reviewed over time.
    void logClassifierAudit(userId, lastMessage, classification);

    // ── Tier 0 deterministic dispatch (read-only grounded answerers) ──
    // profile questions / app-help / DCA setup / order history / tax-loss are
    // detected inside classify()'s synchronous Tier 0 (lib/ai/classifier.ts
    // `deterministicTier0`) and answered here with deterministic text — never the
    // model. account_state / scheduled_activity carry no handler; they're routed
    // purely by category in the block below.
    if (mode !== 'alerts' && classification.handler) {
      switch (classification.handler) {
        case 'profile_question':
          return textSSEResponse(buildProfileAnswer(profile, (classification.handlerData?.kind ?? 'profile') as ProfileQuestionKind));
        case 'app_help':
          return textSSEResponse(buildAppHelpAnswer((classification.handlerData?.kind ?? 'capabilities') as AppHelpKind));
        case 'dca_setup':
          return textSSEResponse(
            "Let's set up your dollar-cost averaging plan — pick the symbol, amount, frequency, and end date in the form.",
            { kind: 'dca_setup' },
          );
        case 'order_history':
          if (userId && userId !== 'anonymous') {
            const since = parseOrderHistoryWindow(lastMessage);
            const windowLabel = orderHistoryWindowLabel(lastMessage);
            console.log('[chat] 🧭 order-history → deterministic answer');
            return textSSEResponse(await fetchOrderHistoryAnswer(userId, accountMeta?.accountId, since, windowLabel));
          }
          break;
        case 'tax_loss':
          if (portfolioSnapshot && portfolioSnapshot.positions.length > 0) {
            console.log('[chat] 🧭 tax-loss-harvesting → deterministic answer');
            return textSSEResponse(buildTaxLossHarvestAnswer(portfolioSnapshot));
          }
          break;
      }
    }

    // ── Confirm-only mutations + read-only category fallbacks ──
    // classify() is now the sole authority on intent. Mutating detectors (style /
    // risk) only act once classify() already said `profile_mutation`; rebalance
    // plans only once it said `portfolio_construction`. The DB write + answer text
    // stay deterministic code, never the model. Confirm/execute stay on the
    // pre-classify gate (state-machine transitions, not intent).
    if (mode !== 'alerts') {
      const questionGuard = isQuestionLike(lastMessage);
      const hesitantGuard = isHesitant(lastMessage);

      // Single write path for style/risk mutations (replaces the old pre-classify
      // detectAccountAction + the duplicate classifier handler).
      if (classification.category === 'profile_mutation' && !questionGuard && !hesitantGuard) {
        const supabase = createServerClient();
        const rebalanceWanted = extractRebalanceTarget(lastMessage).rebalance;

        // Risk first (preserves the old risk-before-style precedence).
        const risk = extractRiskTarget(lastMessage, { riskTolerance: profile.riskTolerance, investorStyle: profile.investorStyle })
          ?? (classification.profileField === 'risk' ? detectRiskLevel((classification.profileValue || '').trim()) : null);
        if (risk) {
          try {
            if (userId && userId !== 'anonymous') {
              await (supabase as any).from('users').update({ risk_tolerance: risk.toLowerCase() }).eq('id', userId);
            }
          } catch (e) { console.error('[chat] risk change failed:', e); }
          console.log(`[chat] 🎚️ risk changed → ${risk}`);
          return textSSEResponse(formatRiskChangeAnswer(risk), { kind: 'risk_changed' });
        }

        const styleRes = extractStyleTarget(lastMessage, { riskTolerance: profile.riskTolerance, investorStyle: profile.investorStyle });

        if (styleRes?.type === 'change_style') {
          const style = styleRes.style;
          try {
            if (userId && userId !== 'anonymous') {
              await (supabase as any).from('users').update({ investor_style: style, investor_style_set_at: new Date().toISOString() }).eq('id', userId);
            }
          } catch (e) { console.error('[chat] style change failed:', e); }
          console.log(`[chat] 🎛️ style changed → ${style}`);

          // Compound "change my style to X and rebalance" — the single-category
          // classifier can't express multi-intent, so detect the rebalance here.
          if (rebalanceWanted) {
            const targetStyle = style;
            if (!portfolioSnapshot || (portfolioSnapshot.equity <= 0 && portfolioSnapshot.positions.length === 0)) {
              return textSSEResponse(
                `✅ Your investor style is now **${styleLabel(style)}**.

` + formatTargetsOnlyAnswer(targetStyle) + '\n\n⚠️ I need your current portfolio loaded to compute exact trades — connect your broker or refresh, then say "rebalance my portfolio."'
              );
            }
            const plan = computeRebalancePlan(portfolioSnapshot, targetStyle);
            return textSSEResponse(`✅ Your investor style is now **${styleLabel(style)}**.

` + formatRebalancePlanAnswer(plan), { kind: 'rebalance_plan' });
          }
          return textSSEResponse(formatStyleChangeAnswer(style, profile.riskTolerance), { kind: 'style_changed' });
        }
        if (styleRes?.type === 'invalid_style') {
          return textSSEResponse(formatInvalidStyleAnswer(styleRes.requested), { kind: 'style_pick' });
        }
        if (styleRes?.type === 'change_style_ask') {
          return textSSEResponse(formatStylePickPrompt(profile.investorStyle), { kind: 'style_pick' });
        }

        // Classifier fallback for phrasings the regex misses (e.g. "I want to be
        // a high-risk investor" / "make me a Lynch-style investor").
        const field = classification.profileField;
        const value = (classification.profileValue || '').trim();
        if (field === 'style' && value) {
          const style = normalizeStyle(value);
          if (style) {
            try {
              if (userId && userId !== 'anonymous') {
                await (supabase as any).from('users').update({ investor_style: style, investor_style_set_at: new Date().toISOString() }).eq('id', userId);
              }
            } catch (e) { console.error('[chat] style change (classifier) failed:', e); }
            console.log(`[chat] 🎛️ style changed via classifier → ${style} ("${value}")`);
            return textSSEResponse(formatStyleChangeAnswer(style, profile.riskTolerance), { kind: 'style_changed' });
          }
          return textSSEResponse(formatInvalidStyleAnswer(value), { kind: 'style_pick' });
        }
        // No concrete target → fall through to the model (don't invent one).
        console.warn(`[chat] profile_mutation with field=${field} value="${value}" → fall through`);
      }

      // Rebalance plan (confirm-only): portfolio_construction + explicit rebalance.
      if (classification.category === 'portfolio_construction' && extractRebalanceTarget(lastMessage).rebalance) {
        const targetStyle = (profile.investorStyle || 'Lynch').toLowerCase();
        if (!portfolioSnapshot || (portfolioSnapshot.equity <= 0 && portfolioSnapshot.positions.length === 0)) {
          return textSSEResponse(
            formatTargetsOnlyAnswer(targetStyle) + '\n\n⚠️ I need your current portfolio loaded to compute exact trades — connect your broker or refresh, then say "rebalance my portfolio."'
          );
        }
        const assetClass = detectAssetClass(lastMessage);
        if (assetClass) {
          const scope = detectScopedRebalanceMode(messages);
          const plan = computeRebalancePlan(portfolioSnapshot, targetStyle, {
            cashOnly: scope.cashOnly,
            customAmount: scope.customAmount ?? undefined,
            assetClass,
          });
          return textSSEResponse(formatRebalancePlanAnswer(plan), { kind: 'rebalance_plan' });
        }
        if (detectCashOnlyRebalance(lastMessage)) {
          return textSSEResponse(formatAssetClassPrompt('cash-only'), { kind: 'rebalance_asset' });
        }
        const customAmount = detectCustomAmountRebalance(lastMessage);
        if (customAmount != null) {
          return textSSEResponse(formatAssetClassPrompt('custom', customAmount), { kind: 'rebalance_asset' });
        }
        if (detectFullPortfolioRebalance(lastMessage)) {
          return textSSEResponse(formatAssetClassPrompt('full'), { kind: 'rebalance_asset' });
        }
        return textSSEResponse(formatRebalanceBudgetPrompt(portfolioSnapshot, targetStyle), { kind: 'rebalance_budget' });
      }

      if (classification.category === 'account_state') {
        if (portfolioSnapshot && (portfolioSnapshot.equity > 0 || portfolioSnapshot.positions.length > 0)) {
          return textSSEResponse(buildAccountStateAnswer(portfolioSnapshot, profile.riskTolerance), undefined, { scope: 'holdings' });
        }
        // No portfolio loaded → let the model prompt the user to connect a broker.
        console.log('[chat] 🧭 account_state with no portfolio → fall through to model');
      }

      if (classification.category === 'scheduled_activity') {
        // Creation commands ("set up a DCA plan") are tool-path actions, not
        // listings — never answer them with the read-only schedule list.
        if (isDcaCreationCommand(lastMessage)) {
          console.log('[chat] 🧭 scheduled_activity via classifier but DCA-creation → fall through to tools');
        } else if (userId && userId !== 'anonymous') {
          console.log('[chat] 🧭 scheduled_activity via classifier → deterministic answer');
          return textSSEResponse(await fetchScheduledActivityAnswer(userId, accountMeta?.accountId));
        } else {
          console.log('[chat] 🧭 scheduled_activity anonymous → fall through to model');
        }
      }
    }

    // Strategy-advice / ideas questions must NOT run the heavy build pipeline.
    // GPT-5 nano sometimes routes "what strategies should I consider" →
    // portfolio_construction (especially when a stale "A mix of both" vehicle
    // answer sits in history), firing screening → 60s Vercel timeout → "Load failed".
    if (classification.category === 'portfolio_construction' && isStrategyAdviceQuery(lastMessage)) {
      classification.category = 'portfolio_relative_question';
      classification.vehicle = 'unspecified';
      console.log(`[chat] 🧭 Downgraded portfolio_construction → portfolio_relative_question (strategy-advice query, no build verb)`);
    }

    // Empty / pure-gibberish → graceful "didn't understand" (never classified).
    if (classification.gibberish) {
      return textSSEResponse(
        "I didn't quite catch that — could you rephrase? I specialize in portfolio analysis and market intelligence, so tell me what you'd like to research, build, or trade.",
      );
    }

    // Off-topic (non-trivial) → polite scope redirect. Trivial commands
    // (hi/help/thanks) fall through to the light path and get a natural reply.
    if (classification.category === 'off_topic' && !classification.trivial) {
      return textSSEResponse(
        "I specialize exclusively in portfolio analysis and market intelligence. What would you like to know about your portfolio or the markets?",
      );
    }

    // ── Vehicle resolution ─────────────────────────────────────
    // The conversational resolver stays authoritative for multi-turn CLARIFY
    // answers (it knows which clarify type is open — "a mix of both" to a
    // sub-sector clarify must NOT read as a vehicle answer). For a FRESH
    // construction request, the classifier's vehicle field supplements it —
    // catching phrasings the regex-based detectVehiclePreference misses.
    const isVehicleFollowUp = detectVehicleAnswer(lastMessage) !== null;
    const conversationVehicle = resolveVehicleForRequest(messages);
    const resolvedVehicle =
      classification.category === 'portfolio_construction' &&
      !isVehicleFollowUp &&
      classification.vehicle !== 'unspecified'
        ? classification.vehicle
        : conversationVehicle;

    // ── Vehicle triage: portfolio build with no vehicle → CLARIFY ──
    if (classification.category === 'portfolio_construction' && resolvedVehicle === 'unspecified') {
      console.log('[chat] 🚦 VEHICLE TRIAGE: portfolio construction, no vehicle → CLARIFY stocks/ETFs/mixed');
      return buildVehicleClarifyResponse();
    }

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

    // ── Pipeline routing (fix: general questions must not run the build pipeline) ──
    // ── Pipeline routing ───────────────────────────────────────
    // FULL pipeline (screening → checklist → validation) for portfolio
    // construction and direct trade instructions. Everything else takes the
    // lighter direct-answer path — web search + live market data, but NO
    // orchestrateScreening, NO checklist stages, NO marker validation.
    // A bare vehicle answer ("ETFs only", "A mix of both") to the CLARIFY
    // continues the build via isVehicleFollowUp → full pipeline.
    const isRecommendationIntent =
      classification.category === 'portfolio_construction' ||
      classification.category === 'direct_trade_instruction';
    const hasExplicitVehicle = resolvedVehicle !== 'unspecified';
    const isFullPipeline =
      isRecommendationIntent ||
      (hasExplicitVehicle && isVehicleFollowUp);
    console.log(`[chat] 🧭 Pipeline routing: category=${classification.category} vehicle=${resolvedVehicle} source=${classification.source} vehicleFollowUp=${isVehicleFollowUp} → ${isFullPipeline ? 'FULL (screening+checklist+validation)' : 'DIRECT ANSWER (no checklist)'}`);
    tMark('routed (usage check next)');

    // ── Usage limit check (message quota only) ──
    // Deep Dive costs 2 messages of the existing quota; normal chat costs 1.
    // There is NO separate deep-analysis pool — Deep Dive draws from the same
    // daily/monthly message count (building a portfolio is core, not premium).
    // Compute user's local date from their timezone (not server UTC)
    const localDate = getLocalDateFromTimezone(timezone);
    if (userId && userId !== 'anonymous') {
      const required = mode === 'deep' ? 2 : 1;
      const usageCheck = await checkUsageLimit(userId, 'message', localDate, timezone);
      // Insufficient = limit not yet exhausted, but fewer messages left than this
      // send requires (e.g. Deep Dive with only 1 remaining).
      const insufficient = usageCheck.remaining < required;
      if (!usageCheck.allowed || insufficient) {
        let reason = usageCheck.reason || 'Daily limit reached';
        if (mode === 'deep' && insufficient && usageCheck.remaining === 1) {
          reason = 'Deep Dive needs 2 messages — you have 1 left today';
        }
        return Response.json(
          {
            error: reason,
            remaining: usageCheck.remaining,
            resetsIn: usageCheck.resetsIn,
            type: 'message',
            required,
          },
          { status: 429 }
        );
      }
    }

    tMark('usage check done');

    // Stage 2: Search if needed
    let searchContext = ''
    if (classification.needsSearch && classification.searchQuery) {
      searchContext = await searchWeb(classification.searchQuery)
    }
    tMark('search done');

    // ── Tiered ticker resolution: 5-tier system replaces regex-only extractTickers ──
    let liveMarketContext = ''
    let tickerResolverContext = ''
    let tickers: string[] = []

    try {
      const resolution = await resolveTickers(lastMessage)
      tickers = resolution.resolved.map(r => r.symbol)

      // Always log resolver outcome — silence hides failures
      const tier0Count = resolution.resolved.filter(r=>r.tier===0).length;
      const tier2Count = resolution.resolved.filter(r=>r.tier===2).length;
      if (resolution.emptyInput) {
        console.log(`[chat] 🔍 Tiered resolver: EMPTY INPUT — tokenizer found zero candidates`);
      } else if (resolution.resolved.length > 0) {
        console.log(`[chat] 🔍 Tiered resolver: ${resolution.resolved.length} resolved (tier0=${tier0Count} tier2=${tier2Count})${resolution.notFound.length > 0 ? `, notFound=${resolution.notFound.length}` : ''}${resolution.tier2Required ? ', tier2=required' : ''}`);
      } else if (resolution.notFound.length > 0) {
        console.log(`[chat] 🔍 Tiered resolver: 0 resolved, ${resolution.notFound.length} notFound${resolution.tier2Required ? ', tier2=required' : ''}`);
      } else {
        console.log(`[chat] 🔍 Tiered resolver: 0 resolved, 0 notFound — nothing to resolve`);
      }

      // Build resolver context for system prompt enrichment
      const ctxParts: string[] = []
      if (resolution.needsClarification && resolution.clarificationOptions?.length) {
        ctxParts.push(`\n⚠️ TICKER CLARIFICATION NEEDED: Multiple possible tickers found.\n` +
          resolution.clarificationOptions.map(o => `  ${o.name} → ${o.symbol} (${o.exchange})`).join('\n') +
          `\nAsk the user to clarify which they meant before making any recommendation.`)
      }
      if (resolution.notFound.length > 0) {
        ctxParts.push(`\n❓ UNRESOLVED REFERENCES: ${resolution.notFound.join(', ')}. Do NOT invent tickers for these — tell the user you couldn't find a US-listed match.`)
      }
      if (resolution.resolved.length > 0) {
        ctxParts.push(`\n✅ RESOLVED TICKERS: ${resolution.resolved.map(r => `${r.name} → ${r.symbol} (${r.confidence} confidence, ${r.source})`).join('; ')}`)
      }
      tickerResolverContext = ctxParts.join('\n')
    } catch (e) {
      console.error('[chat] Tiered resolver error (falling back to regex):', e)
      tickers = extractTickers(lastMessage)
    }

    // Secondary: extract tickers from search result titles (handles company names like SpaceX→SPCX)
    if (searchContext) {
      const searchTickers = extractTickers(searchContext)
      tickers = [...new Set([...tickers, ...searchTickers])]
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
    tMark('ticker resolution + market data done');

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
    tMark('pre-resolve done');

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

    // ── Vehicle-aware screening (Part B): ETF / stock / mixed hard constraint ──
    // The resolved vehicle decides which screener(s) run. Resolved fresh each
    // request from the conversation (never stored).
    let screeningContext = '';
    let screeningResults: Awaited<ReturnType<typeof import('@/lib/ai/orchestrator').runScreening>> | null = null;
    let screeningCriteria: Record<string, any> | null = null;
    let screeningSource: string | null = null;
    let multiSectorPools: Awaited<ReturnType<typeof import('@/lib/ai/orchestrator').orchestrateScreening>>['multiSectorPools'] = null;
    let etfScreeningResults: { total: number; scanned: number; universe: number } | null = null;
    let isMixedVehicle = false;

    // ETF leg + Stock leg — run CONCURRENTLY for mixed builds (full pipeline).
    // Previously these ran sequentially: the ETF screener awaited, then the
    // equity orchestrator awaited. For "A mix of both" (stocks + ETFs) that
    // stacked two full screens ahead of the model stream + validation, which
    // could blow past the 60s function timeout → Vercel kills the SSE stream
    // mid-flight → Safari surfaces it as the opaque "Load failed". The two legs
    // are fully independent, so Promise.all halves the screening latency.
    const needEtfLeg = isFullPipeline && (resolvedVehicle === 'etfs' || resolvedVehicle === 'mixed');
    const needStockLeg = isFullPipeline && (resolvedVehicle === 'stocks' || resolvedVehicle === 'mixed' || resolvedVehicle === 'unspecified');
    isMixedVehicle = needEtfLeg && needStockLeg;

    let etfCtx: string | null = null;
    let stockCtx: string | null = null;

    await Promise.all([
      (async () => {
        if (!needEtfLeg) return;
        const { extractEtfCriteria, screenEtfs, formatEtfContext } = await import('@/lib/etf-screener');
        try {
          // Bug B fix: derive ETF criteria from the FULL user-message history, not
          // just the last message. Follow-up answers like "A mix of both" carry no
          // sector keyword, so `extractEtfCriteria(lastMessage)` lost the original
          // "healthcare" context and silently ran a broad (SPY/QQQ/VOO-style) scan
          // — which is why healthcare ETFs (XLV/VHT) never appeared. User messages
          // only, to avoid assistant responses polluting category detection.
          const etfHistoryText = [...messages]
            .filter((m) => m.role === 'user')
            .map((m) => m.content)
            .join('\n');
          const etfCriteria = extractEtfCriteria(etfHistoryText);
          const etfOutput = await screenEtfs(etfCriteria, { maxScan: 12, limit: 15 });
          etfScreeningResults = { total: etfOutput.total, scanned: etfOutput.scanned, universe: etfOutput.universe };
          etfCtx = formatEtfContext(etfOutput.results, etfCriteria, etfOutput.relaxations);
          screeningCriteria = { ...etfCriteria, _etf: true };
          console.log(`[chat] 🔍 ETF screener: scanned=${etfOutput.scanned} matches=${etfOutput.total} universe=${etfOutput.universe}`);
        } catch (e) {
          console.error('[chat] ETF screening error (non-fatal):', e);
        }
      })(),
      (async () => {
        if (!needStockLeg) return;
        try {
          const { orchestrateScreening } = await import('@/lib/ai/orchestrator');
          const screeningOrch = await orchestrateScreening(lastMessage, profile.investorStyle, messages, requestedBudget);
          stockCtx = screeningOrch.context;
          screeningResults = screeningOrch.results;
          screeningSource = screeningOrch.source;
          multiSectorPools = screeningOrch.multiSectorPools;
          if (!isMixedVehicle) {
            screeningCriteria = screeningOrch.criteria;
          }
          if (!screeningOrch.skipped) {
            console.log(`[chat] 🔍 Orchestrator: source=${screeningOrch.source} pools=${screeningOrch.multiSectorPools?.length || 0} results=${screeningOrch.results?.results?.length || 0}`);
            if (screeningOrch.results?.error) {
              console.error('[chat] 🔍 Screener error:', screeningOrch.results.error);
            }
          }
        } catch (e) {
          console.error('[chat] Equity screening error (non-fatal):', e);
        }
      })(),
    ]);

    // Compose the screening context once both legs settle.
    if (isMixedVehicle) {
      screeningContext = '[MIXED PORTFOLIO — the user wants BOTH individual stocks AND ETFs. Build a diversified allocation drawing from BOTH universes below.]';
      if (etfCtx) screeningContext += `\n\n=== ETF UNIVERSE ===\n${etfCtx}\n`;
      if (stockCtx) screeningContext += `\n=== STOCK UNIVERSE (equity screener) ===\n${stockCtx}\n`;
    } else if (etfCtx) {
      screeningContext = etfCtx;
    } else if (stockCtx) {
      screeningContext = stockCtx;
    }

    console.log(`[chat] 🚦 Vehicle resolved: ${resolvedVehicle}${isMixedVehicle ? ' (mixed)' : ''}`);
    tMark('screening done → building system prompt');
    const systemBlocks: SystemBlock[] = [
    ...CHAT_PRINCIPLES,
    ...CHAT_SAFETY_BLOCKS,
      {
        type: 'text' as const,
        text: systemPrompt,
        cache_control: { type: 'ephemeral' as const },
      },
      {
        type: 'text' as const,
        text: [dateContext, accountMeta ? buildAccountContext(accountMeta) : '', profileContext, portfolioContext || '', additionalContext || '', searchContext, liveMarketContext, preResolvedContext, deviationContext, tickerResolverContext, screeningContext].filter(Boolean).join('\n\n'),
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
    // Default: Haiku for chat, Sonnet for Deep Dive.
    // Tier override: if model_access='haiku', Sonnet is blocked —
    // Deep Dive falls back to Haiku (slower but still functional).
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
    tMark('model selected');

    // Safety: cap messages to prevent context abuse (UI sends max 5)
    const cappedMessages = messages.slice(-20);

    // ── Tool definition: resolveSymbol ────────────────────────
    const resolveSymbolTool: Anthropic.Tool = {
      name: 'resolveSymbol',
      description:
        'Resolve a company name OR ticker symbol to its authoritative stock ticker details. ' +
        'Pass the ticker directly if the user provided one (e.g., user says "buy spcx" → resolveSymbol("SPCX")). ' +
        'Use this BEFORE recommending any stock to verify the correct ticker.',
      input_schema: {
        type: 'object' as const,
        properties: {
          companyName: {
            type: 'string',
            description: 'The company name OR ticker symbol to look up (e.g., "SK Hynix", "SPCX", "AAPL")',
          },
        },
        required: ['companyName'],
      },
    };

    // ── Tool definitions: resolveSymbol + read-only account tools + money tools ──
    const allTools: Anthropic.Tool[] = [resolveSymbolTool, ...READONLY_TOOLS, ...MONEY_TOOLS];
    const toolCtx: ReadonlyToolContext = {
      // Lazy: service-role client is only constructed when a DB-backed tool
      // actually runs (in-memory tools never touch it).
      get supabase() { return createServerClient(); },
      userId,
      portfolioSnapshot,
      investorStyle: profile.investorStyle,
      // Account segregation: thread the acting account so money tools (e.g.
      // DCA create) write strategy rows under the correct account.
      accountId: accountMeta?.accountId ?? null,
    };

    // ── Build initial conversation ────────────────────────────
    const initialMessages: Array<{ role: 'user' | 'assistant'; content: any }> =
      cappedMessages.map((m: any) => ({
        role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.content,
      }));

    let stream: Awaited<ReturnType<typeof client.messages.stream>>;
    try {
      tMark('starting model stream');
      stream = await client.messages.stream({
        model,
        max_tokens: mode === 'deep' ? 8192 : 4096,
        system: systemBlocks as any,
        messages: initialMessages,
        tools: allTools,
        tool_choice: { type: 'auto' },
      })
      tMark('model stream started');
    } catch (streamInitError: any) {
      // The model stream failed BEFORE any bytes were produced (Anthropic 4xx/5xx,
      // rate limit, overloaded, or timeout). A bare 500 here surfaces to the user
      // as the opaque "Sorry — I encountered an error" message. Return a graceful
      // SSE clarify instead so the user can retry / simplify rather than hit a wall.
      const errMsg = (streamInitError?.status
        ? `Anthropic ${streamInitError.status}: ${streamInitError?.error?.error?.message || streamInitError.message}`
        : (streamInitError?.message || String(streamInitError))).slice(0, 200);
      console.error('[chat] 🔴 MODEL STREAM INIT FAILED:', errMsg);
      if (streamInitError?.stack) console.error('[chat] Stack trace:', streamInitError.stack);
      const initEncoder = new TextEncoder();
      const initErrStream = new ReadableStream({
        start(controller) {
          controller.enqueue(initEncoder.encode(`data: ${JSON.stringify({
            error: errMsg,
            clarify: {
              question: 'I hit a temporary hiccup reaching the AI model. What should I do?',
              options: ['Try again', 'Simplify my request', 'Cancel'],
            },
          })}\n\n`));
          controller.enqueue(initEncoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });
      return new Response(initErrStream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    const encoder = new TextEncoder();
    const fullResponse: string[] = []; // ALL text from ALL tool-call turns
    const dataCallout = resolveDataCallout(classification, portfolioSnapshot, lastMessage);
    const readable = new ReadableStream({
      async start(controller) {
        try {
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let turn = 0;
        let stagedMoneyPreview = false; // set when a preview* money tool stages a pending action this turn
        const MAX_TOOL_TURNS = 8; // enough for complex portfolios with many symbol lookups (pharma, minerals, etc.)
        const convMessages: Array<{ role: 'user' | 'assistant'; content: any }> =
          [...initialMessages];

        // ── Holdings callout (SSE dataCallout) ──
        // Emitted BEFORE the first text byte so the client can render the holdings
        // callout (from its own live PortfolioContext) alongside the streamed
        // answer. Server only signals scope/tickers — never position numbers.
        if (dataCallout) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ dataCallout })}\n\n`));
        }

        // ── Screening results checklist ──
        if (isMixedVehicle) {
          const stockCount = screeningResults?.results?.length || 0;
          const etfCount = etfScreeningResults?.total || 0;
          const total = stockCount + etfCount;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            screeningMeta: { criteria: { mixed: true }, criteriaDescription: 'Mixed portfolio — stocks + ETFs', matchCount: total, provider: 'equity+etf', source: 'mixed', multiSector: false }
          })}\n\n`));
          if (total > 0) {
            sendChecklist(controller, encoder, 'screening', 'done', `Mixed: ${stockCount} stocks + ${etfCount} ETFs`);
            sendChecklist(controller, encoder, 'tickers_resolved', 'done', `Mixed portfolio — ${stockCount} stocks + ${etfCount} ETFs`);
          } else {
            sendChecklist(controller, encoder, 'screening', 'failed', `0 candidates across stocks and ETFs`);
            sendChecklist(controller, encoder, 'tickers_resolved', 'failed', `0 results — try wider criteria`);
          }
        } else if (etfScreeningResults) {
          const count = etfScreeningResults.total;
          const criteria = (screeningCriteria || {}) as Record<string, any>;
          const parts: string[] = [];
          if (Array.isArray(criteria.categories) && criteria.categories.length) parts.push(`sectors: ${criteria.categories.join(', ')}`);
          if (criteria.expenseRatioMax != null) parts.push(`ER ≤ ${criteria.expenseRatioMax}%`);
          if (criteria.aumMin != null) parts.push(`AUM ≥ $${(criteria.aumMin / 1e6).toFixed(0)}M`);
          if (criteria.yieldMin != null) parts.push(`yield ≥ ${criteria.yieldMin}%`);
          if (criteria.return1yMin != null) parts.push(`1y ≥ ${criteria.return1yMin}%`);
          const criteriaDesc = parts.join(', ') || 'broad ETF scan';
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            screeningMeta: { criteria, criteriaDescription: criteriaDesc, matchCount: count, provider: 'etf-screener', source: 'etf', multiSector: false }
          })}\n\n`));
          if (count > 0) {
            sendChecklist(controller, encoder, 'screening', 'done', `${count} ETFs with live expense/return data (${criteriaDesc})`);
            sendChecklist(controller, encoder, 'tickers_resolved', 'done', `${count} ETFs screened from ${etfScreeningResults.universe} universe funds`);
          } else {
            sendChecklist(controller, encoder, 'screening', 'failed', `0 ETFs matched ${criteriaDesc}`);
            sendChecklist(controller, encoder, 'tickers_resolved', 'failed', `0 ETFs for ${criteriaDesc} — try wider criteria`);
          }
        } else if (screeningResults && screeningCriteria) {
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
        } else if (isFullPipeline) {
          sendChecklist(controller, encoder, 'screening', 'skipped', 'No screening criteria detected');
          sendChecklist(controller, encoder, 'tickers_resolved', 'done',
            preResolvedCount > 0 ? `${preResolvedCount} resolved` : 'None needed');
        }

        // ── Checklist: Building recommendations (full pipeline only) ──
        if (isFullPipeline) {
          sendChecklist(controller, encoder, 'recommendations_built', 'in_progress');
        }

        // ── Multi-turn tool-calling loop ──────────────────────
        do {
          const turnStream = turn === 0
            ? stream // reuse initial stream for first turn
            : await client.messages.stream({
                model,
                max_tokens: mode === 'deep' ? 8192 : 4096,
                system: systemBlocks as any,
                messages: convMessages,
                tools: allTools,
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
                // Note: block.input is always {} here (a placeholder); the real
                // JSON streams in via input_json_delta below. Zero-arg tools
                // (e.g. getPortfolio) emit NO deltas — just start/stop.
                currentToolBlock = { id: block.id, name: block.name, inputJson: '' };
              }
            }

            if (chunk.type === 'content_block_delta' && chunk.delta.type === 'input_json_delta') {
              if (currentToolBlock) currentToolBlock.inputJson += (chunk.delta as any).partial_json;
            }

            if (chunk.type === 'content_block_stop') {
              if (currentToolBlock && currentToolBlock.id) {
                try {
                  const raw = (currentToolBlock.inputJson || '').trim();
                  turnToolBlocks.push({
                    id: currentToolBlock.id,
                    name: currentToolBlock.name || 'unknown',
                    // Zero-arg tools stream no input_json_delta → raw is ''.
                    // Default to {} so the tool still executes with no args
                    // instead of throwing and aborting the whole turn.
                    input: raw ? JSON.parse(raw) : {},
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
            } else if (tb.name.startsWith('preview')) {
              // Money tools are PREVIEW-ONLY: they validate + store a pending
              // action, never execute. The deterministic confirm gate (earlier in
              // this route) is what actually runs the side effect.
              stagedMoneyPreview = true;
              result = await executeMoneyTool(tb.name, tb.input, toolCtx);
            } else {
              result = await executeReadonlyTool(tb.name, tb.input, toolCtx);
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
        tMark('model stream complete → validation');

        // ── TRUNCATION-DEBUG (server) — raw streamed text across ALL tool turns ──
        console.log('[TRUNCATION-DEBUG][server] streamed.length =', responseText.length,
          '| isFullPipeline =', isFullPipeline,
          '| head =', JSON.stringify(responseText.slice(0, 140)),
          '| tail =', JSON.stringify(responseText.slice(-140)));

        // ── Direct-answer path (general / market questions, plain chat) ──
        // Non-recommendation messages skip the build pipeline entirely: no screening,
        // no checklist stages, no marker/coherence/symbol/budget validation. The
        // model's plain-text answer already streamed above (with web search + live
        // market data). Only recommendation requests — or an explicit
        // stocks/ETFs/mixed vehicle, or DeepSeek's 'portfolio' queryType — take the
        // full screening → checklist → validation path.
        if (!isFullPipeline) {
          // Defensive: strip any leaked [RECOMMEND:...] markers so no ghost
          // buy/sell buttons render for a message that wasn't a recommendation.
          responseText = responseText.replace(/\[RECOMMEND:[^\]]*\]/g, '');
          // Phase 3 grounding backstop: if the light-path model fabricated a
          // portfolio/account total, cash figure, or claimed ownership of a ticker
          // it doesn't hold, append an honest correction instead of letting the
          // hallucination stand.
          if (portfolioSnapshot) {
            const correction = detectPortfolioGroundingMismatch(responseText, portfolioSnapshot);
            if (correction) {
              console.log('[chat] 🔧 Phase 3 grounding correction appended');
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: correction })}\n\n`));
            }
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          if (userId && userId !== 'anonymous') {
            const totalTokens = totalInputTokens + totalOutputTokens;
            // Cost is bookkeeping only. Chat uses Claude 4.5 Haiku ($1/$5 per MTok);
            // Deep Dive uses Sonnet ($3/$15 per MTok).
            const perIn = mode === 'deep' ? 3 : 1;
            const perOut = mode === 'deep' ? 15 : 5;
            const cost = (totalInputTokens / 1_000_000) * perIn + (totalOutputTokens / 1_000_000) * perOut;
            try {
              await incrementUsage(userId, 'message', totalTokens, cost, localDate, mode === 'deep' ? 2 : 1);
            } catch (e) {
              console.error('[chat] incrementUsage failed:', e);
            }
          }
          controller.close();
          return;
        }

        // ── Unified pass 1: sanitization + incoherence detection ──
        const validationReport = validateResponse(responseText, requestedBudget);
        responseText = validationReport.sanitizedText;
        if (validationReport.suffixesStripped > 0) {
          console.warn(`[chat] 🔧 Stripped ${validationReport.suffixesStripped} foreign exchange suffixes`);
        }

        // ── Budget trust: LLM's PORTFOLIO_BLOCK budget wins ──
        // The LLM has full conversation context — when it emits a [PORTFOLIO:$X]
        // block, that $X reflects its contextual judgment (new request vs continuation).
        // Always trust the LLM over history-based extraction.
        const llmBudget = extractResponseTotal(responseText);
        const effectiveBudget = llmBudget ?? requestedBudget;
        if (llmBudget && llmBudget !== requestedBudget) {
          console.log(`[chat] 🎯 LLM budget override: $${llmBudget} (history had $${requestedBudget})`);
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
            console.log('[TRUNCATION-DEBUG][server] correctedText.length =', responseText.length,
              '| head =', JSON.stringify(responseText.slice(0, 140)));
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
                  budget: effectiveBudget,
                  allocation: 0,
                });
              console.log('[chat] Coherence failure logged to DB');
            }
          } catch (logErr) {
            console.error('[chat] Coherence failure DB log error:', logErr);
          }

          if (retryAttempt >= 2) {
            // 3 failed attempts — show CLARIFY instead of infinite retry loop
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ clarify: { question: "I'm having trouble generating this — let's try a fresh approach. What would you prefer?", options: ["Regenerate with your original request", "Simplify the request", "Cancel"] } })}\n\n`)
            );
          } else {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ regenerate: true, failures: [{ check: 'response_coherence', detail: coherenceFailure, offendingMarkers: [] }], budget: effectiveBudget })}\n\n`)
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
        if (effectiveBudget !== null && !hasRecommendMarkers && !hasClarifyMarkers) {
          const budgetGate = validateBudgetGate(lastMessage, responseText, effectiveBudget);
          if (budgetGate.hasViolation && budgetGate.responseTotal !== null) {
            console.warn('[chat] ⚠️ Budget coherence gate FAILED:', budgetGate.message);
            sendChecklist(controller, encoder, 'coherence_check', 'failed', `Budget mismatch: $${budgetGate.responseTotal.toLocaleString()} vs $${effectiveBudget.toLocaleString()}`);
            if (retryAttempt >= 1) {
              // CLARIFY instead of fatal error
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ clarify: { question: `The AI mentioned $${budgetGate.responseTotal.toLocaleString()} but your budget is $${effectiveBudget.toLocaleString()}. Which should we use?`, options: [`Use $${effectiveBudget.toLocaleString()} (your budget)`, `Use $${budgetGate.responseTotal.toLocaleString()} (the AI's total)`, "Let me adjust the request"] } })}\n\n`)
              );
            } else {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ regenerate: true, failures: [{ check: 'budget_reconciliation', detail: budgetGate.message + ' Regenerate with correct [RECOMMEND:SYMBOL:BUY:$AMOUNT] markers that sum to exactly $' + effectiveBudget.toLocaleString() + '.', offendingMarkers: [] }], budget: effectiveBudget })}\n\n`)
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
        if (effectiveBudget !== null && hasRecommendMarkers) {
          sendChecklist(controller, encoder, 'symbol_verification', 'in_progress');
          try {
            const strictValidation = await validateRecommendations(responseText, effectiveBudget, undefined, isMultiStrategy);
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

              // ... DB logging (unchanged)
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
                      budget: effectiveBudget,
                      allocation: 0,
                    });
                  console.log('[chat] Validation failure logged to DB');
                }
              } catch (logErr) {
                console.error('[chat] Validation failure DB log error:', logErr);
              }

              if (retryAttempt >= 1) {
                // Instead of a fatal error, send a CLARIFY with the specific issue
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(buildClarifyFromFailures(strictValidation.failures, effectiveBudget))}\n\n`)
                );
              } else {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ regenerate: true, failures: strictValidation.failures, budget: effectiveBudget })}\n\n`)
                );
              }
            } else {
              // All checks passed
              sendChecklist(controller, encoder, 'symbol_verification', 'done',
                `${strictValidation.result.count} symbols verified`);
              sendChecklist(controller, encoder, 'budget_reconciliation', 'done',
                `$${strictValidation.result.total.toLocaleString()} / $${effectiveBudget?.toLocaleString() ?? 'auto'}`);
            }
          } catch (strictValErr) {
            console.error('[chat] Strict validation error:', strictValErr);
          }
        } else if (effectiveBudget !== null && !hasRecommendMarkers) {
          console.log('[chat] ⏭️ Skipped validation — no RECOMMEND markers in response (likely a question or informational reply)');
          sendChecklist(controller, encoder, 'symbol_verification', 'skipped', 'Non-recommendation response');
          sendChecklist(controller, encoder, 'budget_reconciliation', 'skipped', 'No budget to reconcile');
        }

        // ── Budget reconciliation gate (secondary guard) ──
        // Only fire if validation didn't already reject.
        if (!validationRejected) {
        try {
          const budgetGate = validateBudgetGate(lastMessage, responseText, effectiveBudget);
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

        // ── Pending-action confirm/cancel buttons ──
        // If a preview* money tool staged a pending action this turn, tag the
        // response so the client renders ✓ Confirm / ✕ Cancel buttons (same
        // deterministic phrases the confirm gate already matches).
        if (stagedMoneyPreview && userId && userId !== 'anonymous' && !validationRejected) {
          try {
            const pending = await getPendingAction(createServerClient(), userId);
            if (pending) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ action: { kind: 'confirm_pending' } })}\n\n`));
            }
          } catch (e) {
            console.error('[chat] confirm_pending detection error:', e);
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
          // Cost is bookkeeping only. Chat uses Claude 4.5 Haiku ($1/$5 per MTok);
          // Deep Dive uses Sonnet ($3/$15 per MTok).
          const perIn = mode === 'deep' ? 3 : 1;
          const perOut = mode === 'deep' ? 15 : 5;
          const cost = (totalInputTokens / 1_000_000) * perIn + (totalOutputTokens / 1_000_000) * perOut;
          try {
            await incrementUsage(userId, 'message', totalTokens, cost, localDate, mode === 'deep' ? 2 : 1);
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
          const errorSummary = streamError?.status 
            ? `Anthropic ${streamError.status}: ${streamError?.error?.error?.message || streamError.message}`
            : (streamError?.message || String(streamError)).slice(0, 200);
          console.error('[chat] 🔴 STREAM FATAL ERROR:', errorSummary);
          if (streamError?.stack) console.error('[chat] Stack trace:', streamError.stack);
          try {
            // Send diagnostic SSE event with error summary for debugging.
            // Includes the error type but NOT raw JS traces.
            console.error('[chat] 🔴 STREAM FATAL ERROR (full):', streamError);
            if (streamError?.stack) console.error('[chat] Stack trace:', streamError.stack);
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({
                error: errorSummary,
                clarify: {
                  question: 'I hit an internal hiccup processing your request. What should I do?',
                  options: ['Try again with the same request', 'Simplify my request', 'Cancel'],
                },
              })}\n\n`)
            );
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          } catch (_) {
            // Stream is already broken — try an emergency one-liner
            console.error('[chat] Could not send clarify — trying emergency error event');
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: errorSummary })}\n\n`));
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            } catch (__) {
              console.error('[chat] Stream fully dead — no recovery possible');
            }
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

  } catch (error: any) {
    console.error('Chat API error:', error?.message || error, '\n', error?.stack || '(no stack)')
    return Response.json({ error: 'Failed to process request' }, { status: 500 })
  }
}
