/**
 * AI Client — frontend-facing functions that call Vantage API routes.
 *
 * NEVER exposes API keys to the client. All DeepSeek communication
 * happens server-side through /api/chat.
 *
 * Model routing strategy:
 *   - deepseek-chat:     routine chat, general questions (cheap, $0.14/M input)
 *   - deepseek-reasoner: complex analysis, trade signals, risk scoring
 *
 * Cost control:
 *   - Max 75 messages per day, resets at midnight EST
 *   - Responses cached in localStorage for 1 hour
 *   - Cost estimates shown subtly in chat UI
 */

import type { AICardComponent, Position, RebalanceSession } from '@/types';
import { extractStructuredCards, structuredCardToComponent } from './schemas';
import { apiPost } from '@/lib/api-client';

const DEEPSEEK_CHAT_COST_PER_1K_INPUT = 0.00014;
const DEEPSEEK_CHAT_COST_PER_1K_OUTPUT = 0.00028;
const DEEPSEEK_REASONER_COST_PER_1K_INPUT = 0.00055;
const DEEPSEEK_REASONER_COST_PER_1K_OUTPUT = 0.00219;

export interface ChatContext {
  portfolio?: {
    cash: number;
    equity: number;
    positions: Position[];
    dayPnlPercent: number;
    totalPnlPercent?: number;
    buyingPower?: number;
  };
  marketData?: Record<string, unknown>;
  watchlist?: string[];
  confidenceBreakdown?: Record<string, unknown>;
  investorStyle?: string;
  orders?: Array<{
    symbol: string;
    side: string;
    type: string;
    qty: number;
    status: string;
    filledQty?: number;
    limitPrice?: number;
    stopPrice?: number;
  }>;
}

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onCard: (card: AICardComponent) => void;
  onDone: (tokens: { input: number; output: number }, cost: number) => void;
  onError: (error: string) => void;
  onSession?: (session: RebalanceSession) => void;
  onBasket?: (data: { basketId?: string; basketName?: string; stocks?: any[] }) => void;
}

export interface ChatResult {
  text: string;
  cards: AICardComponent[];
  tokens: { input: number; output: number };
  cost: number;
}

// ─── Rate limiting ───
const RATE_LIMIT_KEY = 'vantage_ai_rate_limit';
const MAX_MESSAGES_PER_DAY = 75;

interface RateLimitState {
  count: number;
  resetAt: number; // timestamp when the window resets
}

function getESTMidnight(): number {
  // Returns timestamp of next midnight EST (America/New_York)
  const now = new Date();
  const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const etMidnight = new Date(etNow);
  etMidnight.setDate(etMidnight.getDate() + 1);
  etMidnight.setHours(0, 0, 0, 0);
  return etMidnight.getTime();
}

function getRateLimit(): RateLimitState {
  if (typeof window === 'undefined') return { count: 0, resetAt: getESTMidnight() };
  try {
    const raw = localStorage.getItem(RATE_LIMIT_KEY);
    if (!raw) return { count: 0, resetAt: 0 };
    const parsed = JSON.parse(raw) as RateLimitState;
    // Reset if window expired
    if (Date.now() > parsed.resetAt) {
      localStorage.removeItem(RATE_LIMIT_KEY);
      return { count: 0, resetAt: 0 };
    }
    return parsed;
  } catch {
    return { count: 0, resetAt: 0 };
  }
}

function incrementRateLimit(): void {
  if (typeof window === 'undefined') return;
  const current = getRateLimit();
  const newState: RateLimitState = {
    count: current.count + 1,
    resetAt: current.resetAt || getESTMidnight(), // midnight EST
  };
  localStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(newState));
}

export function isRateLimited(): boolean {
  const state = getRateLimit();
  return state.count >= MAX_MESSAGES_PER_DAY;
}

export function getRemainingCalls(): number {
  const state = getRateLimit();
  return Math.max(0, MAX_MESSAGES_PER_DAY - state.count);
}

// ─── Response caching (localStorage, 1 hour) ───
const CACHE_PREFIX = 'vantage_ai_cache_';
const CACHE_TTL = 3600_000; // 1 hour

function getCacheKey(messages: Array<{ role: string; content: string }>, context?: ChatContext): string {
  const normalized = JSON.stringify({ messages, contextSummary: context ? 'has_context' : 'no_context' });
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const chr = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return CACHE_PREFIX + Math.abs(hash).toString(36);
}

interface CacheEntry {
  text: string;
  cards: AICardComponent[];
  tokens: { input: number; output: number };
  cost: number;
  timestamp: number;
}

function getCached(key: string): CacheEntry | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (Date.now() - entry.timestamp > CACHE_TTL) {
      localStorage.removeItem(key);
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

function setCache(key: string, entry: CacheEntry): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // localStorage full — silently ignore
  }
}

/**
 * Estimate token count from text. Rough approximation: 4 chars ≈ 1 token.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimate USD cost based on model and token counts.
 */
export function estimateCost(
  model: 'deepseek-chat' | 'deepseek-reasoner',
  inputTokens: number,
  outputTokens: number
): number {
  const inputRate =
    model === 'deepseek-reasoner'
      ? DEEPSEEK_REASONER_COST_PER_1K_INPUT
      : DEEPSEEK_CHAT_COST_PER_1K_INPUT;
  const outputRate =
    model === 'deepseek-reasoner'
      ? DEEPSEEK_REASONER_COST_PER_1K_OUTPUT
      : DEEPSEEK_CHAT_COST_PER_1K_OUTPUT;

  return (inputTokens / 1000) * inputRate + (outputTokens / 1000) * outputRate;
}

/**
 * Determines which model to use based on query complexity.
 * Simple queries → deepseek-chat (cheap)
 * Analysis/signals → deepseek-reasoner (expensive but better)
 */
export function selectModel(messages: Array<{ role: string; content: string }>): 'deepseek-chat' | 'deepseek-reasoner' {
  // Check last user message for complexity indicators
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.content?.toLowerCase() || '';

  const complexKeywords = [
    'analyze', 'analysis', 'risk', 'confidence', 'signal', 'trade',
    'rebalance', 'opportunity', 'scan', 'evaluate', 'assess', 'deep dive',
    'breakdown', 'portfolio review', 'what should i', 'recommend',
    'etn', 'nvda', 'aapl', 'buy', 'sell', 'strategy', 'allocation',
  ];

  const isComplex = complexKeywords.some((k) => lastUserMsg.includes(k)) ||
    lastUserMsg.split(' ').length > 15;

  return isComplex ? 'deepseek-reasoner' : 'deepseek-chat';
}

/**
 * Main chat function — sends messages and receives streaming response via SSE.
 */
export async function streamChat(
  messages: Array<{ role: string; content: string }>,
  context: ChatContext | undefined,
  callbacks: StreamCallbacks,
  responseMode?: string,
  mode?: string,
  investorStyle?: string
): Promise<void> {
  // Check cache first
  if (context) {
    const cacheKey = getCacheKey(messages, context);
    const cached = getCached(cacheKey);
    if (cached) {
      // Replay cached response with a slight delay to simulate streaming
      const words = cached.text.split(' ');
      for (let i = 0; i < words.length; i++) {
        callbacks.onToken(words[i] + (i < words.length - 1 ? ' ' : ''));
        await new Promise((r) => setTimeout(r, 8));
      }
      for (const card of cached.cards) {
        callbacks.onCard(card);
      }
      callbacks.onDone(cached.tokens, cached.cost);
      return;
    }
  }

  // Rate limit check
  if (isRateLimited()) {
    callbacks.onError('Daily limit reached: 75 messages per day. Resets at midnight EST.');
    return;
  }

  incrementRateLimit();

  // All modes use the new JSON endpoint (non-streaming, better error handling)
  const NEW_FORMAT_MODES = ['general', 'research', 'opportunities', 'risk', 'trends', 'health', 'tax'];
  const useNewFormat = !!mode && NEW_FORMAT_MODES.includes(mode);

  if (useNewFormat) {
    const newBody: Record<string, unknown> = {
      message: messages[messages.length - 1].content,
      mode,
      responseMode,
      investorStyle,
    };

    const res = await apiPost('/api/chat', newBody);

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: 'Unknown error' }));
      console.error('[VantageChat] Non-OK response:', errBody);
      callbacks.onError(errBody.error || `API error (${res.status})`);
      return;
    }

    const json = await res.json();
    const content = String(json.content || '');
    const tokensUsed = { input: json.tokensUsed?.input || estimateTokens(content), output: json.tokensUsed?.output || estimateTokens(content) };
    const cost = typeof json.cost === 'number' ? json.cost : 0;

    // Simulate streaming by tokenizing content word by word
    const words = content.split(/(\s+)/);
    for (let i = 0; i < words.length; i++) {
      callbacks.onToken(words[i]);
      await new Promise((r) => setTimeout(r, 6));
    }

    // If rebalance_plan type, attach session for Push to Rebalance card
    const isRebalance = json.type === 'rebalance_plan' || json.type === 'rebalance_suggestion';
    if (isRebalance && json.sessionId && Array.isArray(json.trades)) {
      callbacks.onSession?.({
        sessionId: json.sessionId as string,
        summary: `${json.tradeCount || json.trades.length || 0} trades prepared`,
        trades: (json.trades as any[]).map((t: any) => ({
          symbol: t.symbol,
          action: t.action || t.type || 'add',
          shares: t.shares || 0,
          estimatedValue: Math.abs(t.dollarAmount || t.estimatedValue || 0),
          currentPct: t.currentPct,
          targetPct: t.targetPct,
          type: t.type || 'stock',
          reason: t.reason || '',
        })),
        targetSource: json.targetSource as 'saved' | 'style_default' | undefined,
        styleName: json.styleName as string | undefined,
        targets: json.targets as Array<{ symbol: string; targetPercent: number }> | undefined,
      });
    }

    // If theme_basket type, pass basket metadata for action card
    if (json.type === 'theme_basket') {
      callbacks.onBasket?.({
        basketId: json.basketId,
        basketName: json.basketName,
        stocks: json.stocks,
      });
    }

    callbacks.onDone(tokensUsed, cost);
    return;
  }

  try {
    const res = await apiPost('/api/chat', { messages, context, responseMode });

    // Diagnostic: check response headers
    const chatSource = res.headers.get('X-Chat-Source') || 'unknown';
    const modelUsed = res.headers.get('X-Model-Used') || 'unknown';
    const chatError = res.headers.get('X-Chat-Error') || '';
    console.log(`[VantageChat] Source: ${chatSource} | Model: ${modelUsed} | HTTP: ${res.status}${chatError ? ` | Error: ${chatError}` : ''}`);

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: 'Unknown error' }));
      console.error('[VantageChat] Non-OK response:', errBody);
      callbacks.onError(errBody.error || `API error (${res.status})`);
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      callbacks.onError('No response stream available');
      return;
    }

    const decoder = new TextDecoder();
    let fullText = '';
    let tokensUsed = { input: 0, output: 0 };
    let totalCost = 0;
    const cards: AICardComponent[] = [];
    let firstTokenLogged = false;

    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (!data) continue;
          if (data === '[DONE]') break;

          try {
            const parsed = JSON.parse(data);

            switch (parsed.event) {
              case 'token': {
                if (!firstTokenLogged) {
                  console.log(`[VantageChat] First token: "${parsed.content.slice(0, 40)}"`);
                  firstTokenLogged = true;
                }
                fullText += parsed.content;
                callbacks.onToken(parsed.content);
                break;
              }
              case 'card': {
                if (parsed.card) {
                  cards.push(parsed.card);
                  callbacks.onCard(parsed.card);
                }
                break;
              }
              case 'cost': {
                tokensUsed = parsed.tokens;
                totalCost = parsed.cost;
                break;
              }
              case 'session': {
                if (parsed.sessionId && callbacks.onSession) {
                  callbacks.onSession({
                    sessionId: parsed.sessionId,
                    summary: parsed.summary || '',
                    trades: parsed.trades || [],
                  });
                }
                break;
              }
              case 'error': {
                callbacks.onError(parsed.message || 'Stream error');
                return;
              }
            }
          } catch {
            // Ignore unparseable lines
          }
        }
      }
    }

    callbacks.onDone(tokensUsed, totalCost);

    // Cache the response
    if (context) {
      const cacheKey = getCacheKey(messages, context);
      setCache(cacheKey, {
        text: fullText,
        cards,
        tokens: tokensUsed,
        cost: totalCost,
        timestamp: Date.now(),
      });
    }
  } catch (err) {
    callbacks.onError(err instanceof Error ? err.message : 'Connection failed');
  }
}

/**
 * Generate a trade signal for a specific symbol.
 */
export async function generateTradeSignal(
  symbol: string,
  price: number,
  context?: ChatContext
): Promise<AICardComponent | null> {
  const messages = [
    {
      role: 'user' as const,
      content: `Analyze ${symbol} at $${price}. Output a JSON trade signal with: type, action (buy/sell/hold), conviction (0-100), entryPrice, stopLoss, takeProfit, reason (string), risks (string array). Consider portfolio context: $${context?.portfolio?.equity} equity, ${context?.portfolio?.positions.length} positions.`,
    },
  ];

  try {
    const res = await apiPost('/api/chat', {
        messages,
        context,
        format: 'trade_signal',
      });

    if (!res.ok) return null;

    const reader = res.body?.getReader();
    if (!reader) return null;

    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ') && !line.includes('[DONE]')) {
          const data = line.slice(6).trim();
          if (!data) continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.event === 'token') fullText += parsed.content;
          } catch { /* skip */ }
        }
      }
    }

    // Extract structured cards from response
    const cards = extractStructuredCards(fullText);
    if (cards.length > 0) {
      return structuredCardToComponent(cards[0]) as unknown as AICardComponent;
    }
  } catch {
    // Graceful degradation
  }

  return null;
}

/**
 * Analyze portfolio risk using AI.
 */
export async function analyzePortfolioRisk(positions: Position[], account?: { equity: number; cash: number }): Promise<Record<string, unknown> | null> {
  const posSummary = positions.map((p) => `${p.symbol}: ${p.marketValue.toFixed(2)} (${p.portfolioPercent.toFixed(1)}%), P&L ${p.totalPnlPercent.toFixed(1)}%`).join('\n');

  const messages = [
    {
      role: 'user' as const,
      content: `Analyze portfolio risk:\n${posSummary}\nAccount: $${account?.equity} equity, $${account?.cash} cash.\n\nOutput a JSON risk analysis with: overallRisk (0-100), factors (array of {name, score, explanation, weight}), warnings (string array), suggestions (string array).`,
    },
  ];

  try {
    const res = await apiPost('/api/chat', { messages, context: { portfolio: account }, format: 'risk_analysis' });

    if (!res.ok) return null;

    const reader = res.body?.getReader();
    if (!reader) return null;

    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ') && !line.includes('[DONE]')) {
          try {
            const parsed = JSON.parse(line.slice(6).trim());
            if (parsed.event === 'token') fullText += parsed.content;
          } catch { /* skip */ }
        }
      }
    }

    const cards = extractStructuredCards(fullText);
    if (cards.length > 0) {
      return cards[0].data as unknown as Record<string, unknown>;
    }
  } catch {
    // Graceful degradation
  }

  return null;
}

/**
 * Generate rebalance suggestions.
 */
export async function generateRebalanceSuggestions(
  positions: Position[],
  targetAlloc: Record<string, number>
): Promise<Record<string, unknown> | null> {
  const posSummary = positions.map((p) => {
    const sector = p.sector || 'Unknown';
    return `${p.symbol} (${sector}): ${p.marketValue.toFixed(2)} — ${p.portfolioPercent.toFixed(1)}%`;
  }).join('\n');

  const targetSummary = Object.entries(targetAlloc)
    .map(([s, pct]) => `${s}: ${pct}%`)
    .join(', ');

  const messages = [
    {
      role: 'user' as const,
      content: `Current portfolio:\n${posSummary}\n\nTarget allocation: ${targetSummary}\n\nGenerate a JSON rebalance plan with: trades array (each: {symbol, action (buy/sell/trim/add), qty, dollarAmount, reason}), summary string.`,
    },
  ];

  try {
    const res = await apiPost('/api/chat', { messages, format: 'rebalance_plan' });

    if (!res.ok) return null;

    const reader = res.body?.getReader();
    if (!reader) return null;

    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ') && !line.includes('[DONE]')) {
          try {
            const parsed = JSON.parse(line.slice(6).trim());
            if (parsed.event === 'token') fullText += parsed.content;
          } catch { /* skip */ }
        }
      }
    }

    const cards = extractStructuredCards(fullText);
    if (cards.length > 0) {
      return cards[0].data as unknown as Record<string, unknown>;
    }
  } catch {
    // Graceful degradation
  }

  return null;
}

/**
 * Scan watchlist for top opportunities sorted by conviction.
 */
export async function scanForOpportunities(
  watchlist: string[],
  context?: ChatContext
): Promise<Array<{ symbol: string; action: string; conviction: number; reason: string }>> {
  if (!watchlist.length) return [];

  const messages = [
    {
      role: 'user' as const,
      content: `Scan these symbols for trading opportunities: ${watchlist.join(', ')}.\nPortfolio: $${context?.portfolio?.equity} equity, ${context?.portfolio?.positions.length} positions.\n\nFor each symbol with a strong opportunity, output a JSON array of trade signals (type: "trade_signal", data: {symbol, action, conviction, entryPrice, stopLoss, takeProfit, reason, risks}). Sort by conviction descending. Only include if conviction > 50.`,
    },
  ];

  try {
    const res = await apiPost('/api/chat', { messages, context, format: 'trade_signal' });

    if (!res.ok) return [];

    const reader = res.body?.getReader();
    if (!reader) return [];

    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ') && !line.includes('[DONE]')) {
          try {
            const parsed = JSON.parse(line.slice(6).trim());
            if (parsed.event === 'token') fullText += parsed.content;
          } catch { /* skip */ }
        }
      }
    }

    const cards = extractStructuredCards(fullText);
    return cards
      .filter((c) => c.type === 'trade_signal')
      .map((c) => {
        const d = c.data;
        if ('symbol' in d && 'action' in d && 'conviction' in d && 'reason' in d) {
          return {
            symbol: (d as { symbol: string }).symbol,
            action: (d as { action: string }).action,
            conviction: (d as { conviction: number }).conviction,
            reason: (d as { reason: string }).reason,
          };
        }
        return null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.conviction - a.conviction);
  } catch {
    // Graceful degradation
  }

  return [];
}
