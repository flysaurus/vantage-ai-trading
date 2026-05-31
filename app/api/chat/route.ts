/**
 * POST /api/chat — AI streaming chat endpoint
 *
 * Proxies requests to DeepSeek API with Server-Sent Events.
 * NEVER exposes DEEPSEEK_API_KEY to the client.
 *
 * Features:
 *   - Streaming SSE response (token by token)
 *   - Structured output detection (parses JSON cards)
 *   - Model routing (chat vs reasoner)
 *   - Error handling with fallback
 *   - Cost estimation
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  TradeSignalSchema,
  RiskAnalysisSchema,
  RebalancePlanSchema,
  MarketInsightSchema,
} from '@/lib/schemas';
import { estimateTokens, estimateCost, selectModel } from '@/lib/ai';
import { callAI, streamAI, isAIAvailable, getAIProvider, type AIMessage } from '@/lib/ai-provider';
import { createServerClient } from '@/lib/supabase';
import { buildAIContext, formatContextForPrompt, type AIContext, type PortfolioContext } from '@/lib/ai-context';
import { buildSystemPrompt, type AdvisorMode, type ResponseMode } from '@/lib/ai-system-prompt';
import { getCandles, getBatchQuotes, getQuote, getCompanyProfile, getFundamentals } from '@/lib/market-data';

// ─── Helpers ───

/** Per-style investment philosophies — injected into the system prompt */
/** Per-style investment philosophies — static reference for the AI */
const STYLE_PHILOSOPHY: Record<string, string> = {
  buffett: `Focus on: Intrinsic value vs current price, economic moat strength, dividend sustainability and growth, business quality (ROE, ROIC), 5-10+ year holding horizon. Suggest rebalancing toward: dividend payers, quality undervalued names with predictable earnings.`,

  lynch: `Focus on: Revenue growth trajectory (15%+), P/E relative to growth rate (PEG under 1.5), market expansion opportunities, management quality, 2-5 year horizon. Suggest rebalancing toward: fast-growing mid-caps, margin-expanding companies, understandable businesses.`,

  livermore: `Focus on: Technical trend strength, volume confirmation, support/resistance levels, entry/exit signals, 6-month max holding period. Suggest rebalancing toward: positions above 200MA, strong volume, breakout candidates, cut anything that breaks trend.`,

  soros: `Focus on: Macro regime alignment, sector rotation opportunities, interest rate sensitivity, recession risk positioning, early cycle positioning (6-18 month horizon). Suggest rebalancing toward: sectors favored by current macro outlook, ETF rotations, commodity exposure where appropriate.`,

  munger: `Focus on: Dividend yield and growth (5-7% annually), payout ratio sustainability, business stability, 10+ year holding horizon, compounding power. Suggest rebalancing toward: dividend aristocrats/kings, high-yield stable businesses, wide-moat compounders.`,
};

/** Map DB investor style keys to display names */
const STYLE_DISPLAY: Record<string, string> = {
  buffett: 'Value-Style',
  lynch: 'Growth-Style',
  livermore: 'Momentum-Style',
  soros: 'Macro-Style',
  munger: 'Dividend-Style',
};

/**
 * Extract stock symbols from a text query.
 * Matches 1-5 char uppercase tickers, excluding common English words and known false positives.
 */
const FAKE_TICKERS = new Set([
  'I', 'A', 'AM', 'AN', 'AS', 'AT', 'BE', 'BY', 'DO', 'GO', 'HE', 'HI', 'IF', 'IN',
  'IS', 'IT', 'ME', 'MY', 'NO', 'OF', 'OK', 'ON', 'OR', 'SO', 'TO', 'US', 'WE',
  'ALL', 'AND', 'ARE', 'CAN', 'CEO', 'DID', 'END', 'EPS', 'ETA', 'FOR', 'GDP',
  'HAS', 'HOW', 'IPO', 'ITS', 'LOW', 'NEW', 'NOT', 'NOW', 'OUR', 'OUT', 'PE',
  'PUT', 'THE', 'TOO', 'WAS', 'WAY', 'WHO', 'WHY', 'WOW', 'YOY',
  'ABOUT', 'AFTER', 'AGAIN', 'EVERY', 'PRICE', 'SINCE', 'STOCK', 'THERE',
  'THEIR', 'THESE', 'THINK', 'TRADE', 'TREND', 'VALUE', 'WHICH', 'WOULD',
  'CHANGE', 'MARKET', 'MONEY', 'NEWS', 'GROWTH',
]);

function extractSymbols(text: string): string[] {
  if (!text) return [];
  const matches = text.toUpperCase().match(/\b[A-Z]{1,5}\b/g) || [];
  return [...new Set(matches.filter(s => !FAKE_TICKERS.has(s)))];
}

/** Fetch stock data using multi-source fallback (Finnhub → Alpaca → Yahoo). */
async function fetchStockData(symbols: string[]): Promise<Record<string, any> | null> {
  if (symbols.length === 0) return null;

  const results: Record<string, any> = {};
  const uniqueSymbols = [...new Set(symbols)].slice(0, 5); // Limit to 5 stocks max

  for (const symbol of uniqueSymbols) {
    try {
      const [quote, profile, candles] = await Promise.all([
        getQuote(symbol),
        getCompanyProfile(symbol),
        getCandles(symbol, 'D'),
      ]);

      if (!quote || quote.price <= 0) continue;

      const history = (candles || []).map((c: any) => ({
        date: new Date(c.timestamp).toISOString().split('T')[0],
        close: c.close,
      }));

      let weeksAgoPrice: number | null = null;
      let monthChangePct: number | null = null;
      if (history.length >= 2) {
        const oldestClose = history[0].close;
        weeksAgoPrice = oldestClose;
        if (oldestClose > 0) {
          monthChangePct = ((quote.price - oldestClose) / oldestClose) * 100;
        }
      }

      results[symbol] = {
        symbol,
        price: quote.price,
        change: quote.change,
        changePercent: quote.changePercent,
        high: quote.high,
        low: quote.low,
        open: quote.open,
        prevClose: quote.previousClose,
        name: profile?.name || symbol,
        marketCap: profile?.marketCap ?? null,
        sector: profile?.industry || null,
        exchange: profile?.exchange || null,
        weeksAgoPrice,
        monthChangePct,
        history,
        source: quote.source,
      };
    } catch {
      continue;
    }
  }

  return Object.keys(results).length > 0 ? results : null;
}

/**
 * Extract rebalance plan from AI response text.
 * Parses ```json blocks for type: "rebalance_plan" and returns trades + summary.
 */
function extractRebalancePlan(text: string): { trades: Array<{ symbol: string; action: string; shares: number; estimatedValue: number }>; summary: string } | null {
  const jsonBlockRegex = /```json\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = jsonBlockRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const items = Array.isArray(parsed) ? parsed : [parsed];

      for (const item of items) {
        if (item.type === 'rebalance_plan' && item.data) {
          const d = item.data;
          const trades = (d.trades || []).map((t: any) => ({
            symbol: String(t.symbol || ''),
            action: String(t.action || ''),
            shares: Number(t.qty || t.shares || 0),
            estimatedValue: Number(t.dollarAmount || t.estimatedValue || 0),
          })).filter((t: any) => t.symbol && t.shares > 0);

          if (trades.length > 0) {
            return {
              trades,
              summary: String(d.summary || ''),
            };
          }
        }
      }
    } catch {
      // Skip unparseable blocks
    }
  }
  return null;
}

function buildLegacySystemPrompt(context: unknown, format?: string, stockData?: Record<string, any> | null, responseMode?: string): string {
  const ctx = (context && typeof context === 'object') ? context as Record<string, unknown> : null;
  const style = (ctx?.investorStyle as string) || 'buffett';
  const styleDisplay = STYLE_DISPLAY[style] || 'Value-Style';
  const styleGuidance = STYLE_PHILOSOPHY[style] || STYLE_PHILOSOPHY.buffett;

  // Build portfolio summary
  let portfolioSummary = 'No portfolio data available.';
  let buyingPower = '$0';
  if (ctx?.portfolio) {
    const p = ctx.portfolio as Record<string, unknown>;
    const equity = Number(p.equity || 0);
    const bp = Number(p.buyingPower || 0);
    const cash = Number(p.cash || 0);
    const posCount = Array.isArray(p.positions) ? (p.positions as any[]).length : 0;
    buyingPower = `$${bp.toLocaleString()}`;
    portfolioSummary = `${posCount} positions, $${equity.toLocaleString()} equity, $${cash.toLocaleString()} cash`;
  }

  // ── Base system prompt ──
  let prompt = `You are Vantage AI, a professional portfolio advisor.
You are direct, concise, and actionable — like a senior
financial advisor, not a chatbot.

STYLE RULES:
- Lead with the most important insight immediately
- Use bullet points for multiple items
- Never use filler phrases like "Great question",
  "Certainly", "Of course", or "I'd be happy to"
- Never repeat what the user just said
- Numbers and percentages over vague descriptions
- If something needs action: say what, why, how much
- If something is fine: say so in one line and move on
- Professional but not cold — like Claude AI's tone

${responseMode === 'detailed' ? `RESPONSE FORMAT (Detailed mode):
Provide thorough analysis with clear sections.
Still be professional and direct, not verbose.

` : `RESPONSE FORMAT (Summary mode — default):
Respond in maximum 3-5 bullet points. Be direct and concise.
No lengthy explanations. Lead with the most important point.
- Key finding
- Recommendation
- Risk to watch (if any)

`}
The user's investor style is: ${styleDisplay}
Their portfolio: ${portfolioSummary}
Their buying power: ${buyingPower}

You CANNOT execute trades. You suggest only.
Always end suggestions with:
"→ Use the Trade tab or Strategies to act on this."

NEVER say "as a Lynch-style investor" or any investor name.
Say "given your ${styleDisplay} approach" instead.

---

## INVESTMENT STYLE GUIDANCE

The user has chosen the **${styleDisplay}** approach:

${styleGuidance}

---

`;

  // Inject live market data
  if (stockData && Object.keys(stockData).length > 0) {
    prompt += `## LIVE MARKET DATA

`;
    for (const [sym, d] of Object.entries(stockData)) {
      if (!d || !d.price) continue;
      prompt += `### ${sym}${d.name && d.name !== sym ? ` — ${d.name}` : ''}
`;
      prompt += `- Current Price: $${Number(d.price).toFixed(2)}`;
      if (d.change != null) {
        const signStr = d.change >= 0 ? '+' : '';
        prompt += ` — ${signStr}${Number(d.change).toFixed(2)} (${signStr}${Number(d.changePercent).toFixed(2)}%)
`;
      } else {
        prompt += '\n';
      }
      prompt += `- Previous Close: $${Number(d.prevClose || 0).toFixed(2)}
`;
      prompt += `- Day Range: $${Number(d.low || 0).toFixed(2)} — $${Number(d.high || 0).toFixed(2)}
`;
      if (d.monthChangePct != null) {
        const histSignStr = d.monthChangePct >= 0 ? '+' : '';
        prompt += `- 4-Week Change: ${histSignStr}${Number(d.monthChangePct).toFixed(2)}% (was $${Number(d.weeksAgoPrice).toFixed(2)})
`;
      }
      if (d.marketCap) {
        const capB = Number(d.marketCap);
        const capStr = capB >= 1e12 ? `$${(capB/1e12).toFixed(2)}T` : `$${(capB/1e9).toFixed(1)}B`;
        prompt += `- Market Cap: ${capStr}
`;
      }
      if (d.sector) prompt += `- Sector: ${d.sector}
`;
      if (d.exchange) prompt += `- Exchange: ${d.exchange}
`;
        prompt += '\n';
    }
    prompt += `Use this live data in your analysis. Reference specific prices and changes.

`;
  }

  // Inject portfolio details if available
  if (ctx?.portfolio) {
    const p = ctx.portfolio as Record<string, unknown>;
    const totalPnl = typeof p.totalPnlPercent === 'number' ? p.totalPnlPercent : undefined;
    prompt += `## PORTFOLIO SNAPSHOT
`;
    prompt += `- Equity: $${Number(p.equity || 0).toLocaleString()}
`;
    prompt += `- Cash: $${Number(p.cash || 0).toLocaleString()}
`;
    const bp = typeof p.buyingPower === 'number' ? p.buyingPower : undefined;
    if (bp !== undefined) prompt += `- Buying Power: $${Number(bp).toLocaleString()}
`;
    prompt += `- Day P&L: ${Number(p.dayPnlPercent || 0).toFixed(2)}%
`;
    if (totalPnl !== undefined) prompt += `- Total Return: ${totalPnl.toFixed(2)}%
`;

    if (Array.isArray(p.positions) && (p.positions as any[]).length > 0) {
      const positions = p.positions as any[];
      prompt += `
### Positions (${positions.length})
`;
      prompt += `| Symbol | Shares | Avg Cost | Price | P&L% | Weight |
`;
      prompt += `|--------|--------|----------|-------|------|--------|
`;
      for (const pos of positions) {
        prompt += `| ${pos.symbol} | ${pos.qty} | $${(pos.avgCost || 0).toFixed(2)} | $${(pos.currentPrice || 0).toFixed(2)} | ${Number(pos.totalPnlPercent || 0).toFixed(1)}% | ${Number(pos.portfolioPercent || 0).toFixed(1)}% |
`;
      }
        prompt += '\n';
    }
  }

  // Inject open orders if available
  if (Array.isArray(ctx?.orders) && (ctx.orders as any[]).length > 0) {
    const ords = ctx.orders as any[];
    prompt += `## Open Orders (${ords.length})
`;
    for (const o of ords) {
      prompt += `- ${String(o.side || '?').toUpperCase()} ${o.qty} ${o.symbol} ${o.type || 'market'} — ${o.status || '?'}
`;
    }
        prompt += '\n';
  }

  // Inject watchlist if available
  if (ctx?.watchlist && Array.isArray(ctx.watchlist) && (ctx.watchlist as string[]).length > 0) {
    prompt += `## Watchlist
${(ctx.watchlist as string[]).join(', ')}

`;
  }

  // Core rules
  prompt += `---

## CORE RULES

1. Suggest only — you NEVER execute trades. The user must act in the app.
2. Answer questions about ANY stock, ETF, or market topic.
3. Reference portfolio positions when relevant — but analyze any stock the user asks about.
4. Lead with your most important finding or recommendation.
5. Be direct: say what to do, why, and how much.
6. Use specific numbers — prices, percentages, ratios. Never vague language.
7. Flag risks clearly: concentration, style conflict, broken thesis, valuation extremes.
8. For rebalancing: suggest trims for overweight positions, adds for underweights.
9. Phase changes over 2-4 weeks — never suggest one-day overhauls.
10. When declining non-financial questions: respond briefly with a redirect.

## RISK FLAGS TO WATCH

- **Concentration**: any position >20% or sector >40%
- **Style Conflict**: positions misaligned with ${styleDisplay}
- **Broken Thesis**: business fundamentals deteriorated
- **Valuation Extreme**: PE far above/below historical average
- **Unsustainable Dividend**: payout ratio >95%

## TONE

Be the advisor they'd pay $10,000/year for, delivered free through AI.
Professional, direct, data-driven. Numbers matter. Action matters.
`;

  if (format) {
    prompt += `
## Output Format
Respond with your analysis followed by a JSON code block.
Wrap structured data in \`\`\`json ... \`\`\` fenced code blocks.

`;
    switch (format) {
      case 'trade_signal':
        prompt += `Schema: { "type": "trade_signal", "data": { "symbol": "AAPL", "action": "buy|sell|hold", "conviction": 75, "entryPrice": 150.00, "stopLoss": 145.00, "takeProfit": 165.00, "reason": "...", "risks": ["risk 1", "risk 2"] } }`;
        break;
      case 'risk_analysis':
        prompt += `Schema: { "type": "risk_analysis", "data": { "overallRisk": 65, "factors": [{ "name": "Concentration", "score": 70, "explanation": "...", "weight": 0.25 }], "warnings": ["..."], "suggestions": ["..."] } }`;
        break;
      case 'rebalance_plan':
        prompt += `Schema: { "type": "rebalance_plan", "data": { "trades": [{ "symbol": "AAPL", "action": "trim", "qty": 5, "dollarAmount": 750, "reason": "..." }], "summary": "..." } }`;
        break;
    }
  }

  return prompt;
}

function detectModelFromQuery(messages: Array<{ role: string; content: string }>): 'deepseek-chat' | 'deepseek-reasoner' {
  return selectModel(messages);
}

/**
 * Parses structured JSON cards from streaming response text.
 * Called when we detect ```json blocks in the stream.
 */
function tryParseCards(text: string): Array<{
  type: string;
  symbol?: string;
  title: string;
  conviction?: number;
  reason?: string;
  price?: number;
  metrics?: Record<string, number | string>;
  actions?: Array<{ label: string; action: string; params?: Record<string, string | number> }>;
}> {
  const cards: Array<{
    type: string;
    symbol?: string;
    title: string;
    conviction?: number;
    reason?: string;
    price?: number;
    metrics?: Record<string, number | string>;
    actions?: Array<{ label: string; action: string; params?: Record<string, string | number> }>;
    data?: Record<string, any>;
  }> = [];

  const jsonBlockRegex = /```json\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = jsonBlockRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const items = Array.isArray(parsed) ? parsed : [parsed];

      for (const item of items) {
        if (!item.type || !item.data) continue;

        switch (item.type) {
          case 'trade_signal': {
            const validated = TradeSignalSchema.safeParse(item.data);
            if (validated.success) {
              const d = validated.data;
              const isBuy = d.action === 'buy';
              cards.push({
                type: isBuy ? 'buy_signal' : 'sell_signal',
                symbol: d.symbol,
                title: isBuy ? `High Conviction Buy: ${d.symbol}` : `Take Profit: ${d.symbol}`,
                conviction: d.conviction,
                reason: d.reason,
                price: d.entryPrice,
                metrics: d.stopLoss || d.takeProfit
                  ? { stopLoss: d.stopLoss || 0, takeProfit: d.takeProfit || 0 }
                  : undefined,
                actions: [
                  { label: isBuy ? 'Buy' : 'Sell', action: isBuy ? 'buy' : 'sell', params: { symbol: d.symbol } },
                  { label: 'Details', action: 'details' },
                ],
              });
            }
            break;
          }
          case 'risk_analysis': {
            const validated = RiskAnalysisSchema.safeParse(item.data);
            if (validated.success) {
              const d = validated.data;
              cards.push({
                type: 'risk_analysis',
                title: `Risk Score: ${d.overallRisk}/100`,
                conviction: d.overallRisk,
                reason: d.factors.map((f: { name: string; score: number; explanation: string }) => `${f.name}: ${f.score}/100`).join(' • '),
                metrics: Object.fromEntries(d.factors.map((f: { name: string; score: number }) => [f.name, f.score])),
                actions: [{ label: 'View Details', action: 'details' }],
              });
            }
            break;
          }
          case 'rebalance_plan': {
            const validated = RebalancePlanSchema.safeParse(item.data);
            if (validated.success) {
              const d = validated.data;
              cards.push({
                type: 'rebalance',
                title: 'Rebalance Plan',
                reason: d.trades.map((t: { symbol: string; action: string; reason: string }) => `${t.symbol}: ${t.action} — ${t.reason}`).join('\n'),
                data: {
                  trades: d.trades.map((t: any) => ({
                    symbol: t.symbol,
                    action: t.action,
                    shares: t.qty || 0,
                    estimatedValue: t.dollarAmount || 0,
                  })),
                  summary: d.summary || '',
                },
                actions: [{ label: 'Execute Plan', action: 'rebalance' }],
              });
            }
            break;
          }
          case 'market_insight': {
            const validated = MarketInsightSchema.safeParse(item.data);
            if (validated.success) {
              cards.push({
                type: 'insight',
                title: validated.data.headline,
                reason: validated.data.summary,
                actions: [{ label: 'Explore', action: 'details' }],
              });
            }
            break;
          }
        }
      }
    } catch {
      // Skip unparseable blocks
    }
  }

  return cards;
}

/**
 * Stream a single SSE event.
 */
function sendSSE(
  controller: ReadableStreamDefaultController<Uint8Array>,
  event: string,
  data: unknown
): void {
  const line = `data: ${JSON.stringify({ event, ...(typeof data === 'object' ? data : { content: data }) })}\n\n`;
  controller.enqueue(new TextEncoder().encode(line));
}

// ─── Route Handler ───

/**
 * Strip lone surrogates and other invalid Unicode from strings.
 * Prevents DeepSeek 400: "lone leading surrogate in hex escape" errors
 * caused by corrupted data in stored chat history.
 *
 * Uses hex integer comparison (0xD800=55296, 0xDFFF=57343) to avoid storing
 * lone surrogate codepoints in the source file — they are invalid in UTF-8
 * and cause file corruption on disk.
 */
function sanitizeUnicode(str: string): string {
  let result = '';
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= 0xD800 && code <= 0xDFFF) {
      result += String.fromCharCode(0xFFFD);
    } else {
      result += str[i];
    }
  }
  return result;
}

// ─── Rebalance Math (pure computation, no AI) ───

function calculateRebalanceTrades(
  portfolio: PortfolioContext,
  targets: Array<{ symbol: string; targetPercent: number }>
): Array<{ symbol: string; action: string; shares: number; dollarAmount: number; currentPct: number; targetPct: number; drift: number }> {
  const trades: any[] = [];
  const totalValue = portfolio.totalValue;

  for (const target of targets) {
    const position = portfolio.positions.find(p => p.symbol === target.symbol);
    const currentValue = position?.marketValue ?? 0;
    const currentPct = (currentValue / totalValue) * 100;
    const drift = currentPct - target.targetPercent;

    if (Math.abs(drift) < 1) continue; // within threshold, skip

    const driftValue = Math.abs((drift / 100) * totalValue);
    const currentPrice = position?.currentPrice || 0;

    if (currentPrice === 0) continue;

    trades.push({
      symbol: target.symbol,
      action: drift > 0 ? 'sell' : 'buy',
      shares: Math.round(driftValue / currentPrice),
      dollarAmount: Math.round(driftValue),
      currentPct: Math.round(currentPct * 10) / 10,
      targetPct: target.targetPercent,
      drift: Math.round(drift * 10) / 10
    });
  }

  return trades.sort((a, b) => Math.abs(b.dollarAmount) - Math.abs(a.dollarAmount));
}

async function getUserFromSession(req: NextRequest): Promise<string> {
  const sessionCookie = req.cookies.get('session')?.value || '';
  if (sessionCookie) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sessionCookie));
    const sessionHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    try {
      const supabase = createServerClient();
      const { data } = await (supabase as any).from('user_sessions').select('user_id').eq('session_hash', sessionHash).maybeSingle();
      if (data?.user_id) return data.user_id;
    } catch { /* fall through */ }
  }
  return 'anonymous';
}

async function storeRebalanceSession(userId: string, trades: Array<any>): Promise<string> {
  const sessionId = crypto.randomUUID();
  try {
    const supabase = createServerClient();
    await (supabase as any).from('rebalance_sessions').insert({
      session_id: sessionId,
      user_id: userId,
      trades,
      status: 'pending',
      created_at: new Date().toISOString(),
    });
  } catch {
    console.error('Failed to store rebalance session');
  }
  return sessionId;
}

// ─── RSI Calculator ───────────────────────────────────────────────────────

function calculateRSI(candles: Array<{ close: number }>, period = 14): number {
  if (candles.length < period + 1) return 50; // neutral if not enough data
  const closes = candles.map(c => c.close);
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// ─── New Chat Handler (JSON response, single-turn) ───

async function handleNewChat(body: any, userId: string, req: NextRequest) {
  const mode: AdvisorMode = body.mode || 'general';
  const responseMode: ResponseMode = body.responseMode || 'summary';
  const message = body.message || '';

  // 1. Build data context (cached 5 min)
  const context = await buildAIContext(userId);

  // 2. Detect rebalancing intent
  const rebalanceKeywords = ['rebalance', 'rebalancing', 'drift',
    'allocation', 'overweight', 'underweight', 'redistribute'];
  const isRebalanceRequest = rebalanceKeywords.some(k =>
    message.toLowerCase().includes(k));

  if (isRebalanceRequest) {
    if (context.savedTargetAllocations && context.savedTargetAllocations.length > 0) {
      const trades = calculateRebalanceTrades(
        context.portfolio,
        context.savedTargetAllocations
      );

      if (trades.length > 0) {
        const sessionId = await storeRebalanceSession(userId, trades);
        const modeStr = responseMode === 'summary' ? '3-4 bullets' : 'detail';
        const explainPrompt = `Explain these rebalancing trades in ${modeStr}. Do not change the trades. Only explain the drift from targets.\nTrades: ${JSON.stringify(trades)}`;

        const systemPrompt = buildSystemPrompt(context, 'general', responseMode);
        const aiResponse = await callAI({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: explainPrompt }
          ],
          temperature: 0.2,
          maxTokens: responseMode === 'summary' ? 400 : 800,
        });

        return NextResponse.json({
          content: aiResponse.content,
          type: 'rebalance_plan',
          sessionId,
          trades,
          tradeCount: trades.length,
          estimatedValue: trades.reduce((sum, t) => sum + t.dollarAmount, 0)
        });
      } else {
        return NextResponse.json({
          content: 'Your portfolio is within 1% of all target allocations. No rebalancing needed.',
          type: 'text'
        });
      }
    } else {
      return NextResponse.json({
        content: "You don't have saved target allocations yet. Set your targets in the Rebalancing strategy first to get consistent, math-based rebalancing advice.",
        type: 'no_targets'
      });
    }
  }

  // 3. Opportunities mode: run server-side checks and enrich prompt
  if (mode === 'opportunities') {
    const styleLimits: Record<string, number> = {
      'Growth-Style': 15,
      'Value-Style': 10,
      'Momentum-Style': 20,
      'Macro-Style': 12,
      'Dividend-Style': 8,
    };
    const styleDisplay = STYLE_DISPLAY[context.investorStyle] || 'Value-Style';
    const positionLimit = styleLimits[styleDisplay] || 15;
    const sectorLimit = 40;

    // CHECK 1: Oversold holdings (RSI-based) — top 5 positions by market value
    const topPositions = [...context.portfolio.positions]
      .sort((a, b) => b.marketValue - a.marketValue)
      .slice(0, 5);

    const oversoldOpps: Array<{
      type: string;
      symbol: string;
      rsi: number;
      priceVs52wLow: number | null;
      unrealizedPnL: number;
      unrealizedPnLPercent: number;
      confidence: string;
      reason: string;
    }> = [];

    const candleResults = await Promise.allSettled(
      topPositions.map(pos => getCandles(pos.symbol, 'D'))
    );

    for (let i = 0; i < topPositions.length; i++) {
      const pos = topPositions[i];
      const result = candleResults[i];
      if (result.status !== 'fulfilled') continue;
      const candles = result.value;
      if (!candles || candles.length < 15) continue;

      try {
        const rsi = calculateRSI(candles);
        const pctFrom52wLow = pos.week52Low > 0
          ? ((pos.currentPrice - pos.week52Low) / pos.week52Low) * 100
          : null;

        if (rsi < 35) {
          oversoldOpps.push({
            type: 'oversold',
            symbol: pos.symbol,
            rsi: Math.round(rsi),
            priceVs52wLow: pctFrom52wLow,
            unrealizedPnL: pos.unrealizedPnL,
            unrealizedPnLPercent: pos.unrealizedPnLPercent,
            confidence: rsi < 25 ? 'high' : 'medium',
            reason: `RSI at ${Math.round(rsi)} suggests oversold conditions`
          });
        }
      } catch {
        // skip this position
      }
    }

    // Limit to top 3 oversold opportunities
    const topOversoldOpps = oversoldOpps.slice(0, 3);

    // CHECK 2: Concentration reduction opportunities
    const trimOpps = context.portfolio.positions
      .filter(p => p.portfolioPercent > positionLimit)
      .map(p => ({
        type: 'trim',
        symbol: p.symbol,
        currentPercent: p.portfolioPercent,
        styleLimit: positionLimit,
        excessPercent: +(p.portfolioPercent - positionLimit).toFixed(1),
        excessValue: +((p.portfolioPercent - positionLimit) / 100 * context.portfolio.totalValue).toFixed(0),
        confidence: 'high',
        reason: `${p.symbol} is ${p.portfolioPercent.toFixed(1)}% of portfolio, above ${positionLimit}% style limit`
      }));

    // CHECK 3: Sector gap opportunities
    const sectorOpps = context.portfolio.sectorBreakdown
      .filter(s => s.aboveLimit)
      .map(s => ({
        type: 'sector_reduce',
        sector: s.sector,
        currentPercent: s.percent,
        limit: sectorLimit,
        excessPercent: +(s.percent - sectorLimit).toFixed(1),
        excessValue: +((s.percent - sectorLimit) / 100 * context.portfolio.totalValue).toFixed(0),
        confidence: 'high',
        reason: `${s.sector} sector at ${s.percent.toFixed(1)}% exceeds ${sectorLimit}% limit`
      }));

    const underweightSectors = context.portfolio.sectorBreakdown
      .filter(s => s.percent > 0 && s.percent < 5)
      .map(s => ({
        type: 'sector_add',
        sector: s.sector,
        currentPercent: s.percent,
        targetPercent: 10,
        gapPercent: +(10 - s.percent).toFixed(1),
        gapValue: +((10 - s.percent) / 100 * context.portfolio.totalValue).toFixed(0),
        confidence: 'medium',
        reason: `${s.sector} sector at ${s.percent.toFixed(1)}% is underweight — consider adding exposure`
      }));

    // Build opportunities context string
    let oppContext = 'OPPORTUNITY SCAN RESULTS:\n\n';

    if (topOversoldOpps.length > 0) {
      oppContext += '⚠️ POTENTIALLY OVERSOLD:\n';
      for (const o of topOversoldOpps) {
        const pctLowStr = o.priceVs52wLow != null ? `${o.priceVs52wLow.toFixed(1)}% above` : 'N/A';
        oppContext += `- ${o.symbol}: RSI=${o.rsi} | Near 52w Low: ${pctLowStr} | P&L: ${o.unrealizedPnLPercent > 0 ? '+' : ''}${o.unrealizedPnLPercent.toFixed(1)}% | Confidence: ${o.confidence}\n`;
      }
      oppContext += '\n';
    }

    if (trimOpps.length > 0) {
      oppContext += '⚠️ CONCENTRATION WARNINGS:\n';
      for (const t of trimOpps) {
        oppContext += `- ${t.symbol}: ${t.currentPercent.toFixed(1)}% of portfolio (limit: ${t.styleLimit}%) — trim $${t.excessValue.toLocaleString()} | Confidence: ${t.confidence}\n`;
      }
      oppContext += '\n';
    }

    if (sectorOpps.length > 0) {
      oppContext += '⚠️ SECTOR ALERTS:\n';
      for (const s of sectorOpps) {
        oppContext += `- ${s.sector}: ${s.currentPercent.toFixed(1)}% (limit: ${s.limit}%) — reduce by $${s.excessValue.toLocaleString()} | Confidence: ${s.confidence}\n`;
      }
      oppContext += '\n';
    }

    if (underweightSectors.length > 0) {
      oppContext += '📊 UNDERWEIGHT SECTORS:\n';
      for (const s of underweightSectors) {
        oppContext += `- ${s.sector}: ${s.currentPercent.toFixed(1)}% — gap of ${s.gapPercent}% to target | Confidence: ${s.confidence}\n`;
      }
      oppContext += '\n';
    }

    if (topOversoldOpps.length === 0 && trimOpps.length === 0 && sectorOpps.length === 0 && underweightSectors.length === 0) {
      oppContext += '✓ No immediate concerns detected.\n';
      oppContext += 'Your portfolio is within all limits and no positions are showing oversold conditions.\n\n';
    }

    oppContext += 'Based on the above, suggest specific, data-grounded opportunities. Focus on actionable items.\n\n';
    oppContext += `Format your response as:

TOP OPPORTUNITIES:
[Name each significant opportunity found]

For each opportunity:
- WHAT: [description with numbers]
- WHY: [data point driving this recommendation]
- ACTION: [specific action to take]
- CONFIDENCE: 🟢/🟡/🔴 — [explanation]
- INVALIDATES IF: [what would make this opportunity invalid]

PRIORITY ACTIONS:
1. [Most important action first]
2. [Next most important]
...

→ Execute in [Trade / Strategies / Tax Harvest] tab`;

    const systemPrompt = buildSystemPrompt(context, 'opportunities', responseMode) + '\n\n' + oppContext;
    const aiResponse = await callAI({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message }
      ],
      maxTokens: responseMode === 'summary' ? 600 : 1200,
      temperature: 0.3,
    });

    return NextResponse.json({
      content: aiResponse.content,
      type: 'opportunities',
      model: aiResponse.model,
      tokensUsed: aiResponse.tokensUsed
    });
  }

  // 4. Trends mode: market snapshot + news themes + portfolio beta
  if (mode === 'trends') {
    const INDICATOR_SYMBOLS = ['SPY', 'QQQ', 'IWM', 'DIA', 'TLT', 'GLD'];
    const INDICATOR_NAMES: Record<string, string> = {
      SPY: 'S&P 500', QQQ: 'Nasdaq 100', IWM: 'Russell 2000',
      DIA: 'Dow Jones', TLT: '20Y Treasuries', GLD: 'Gold',
    };

    // Step 1: Fetch market indicator quotes
    let indicators: Array<{ symbol: string; name: string; price: number; changePercent: number }> = [];
    try {
      const quotes = await getBatchQuotes(INDICATOR_SYMBOLS);
      for (const sym of INDICATOR_SYMBOLS) {
        const q = quotes.get(sym);
        indicators.push({
          symbol: sym,
          name: INDICATOR_NAMES[sym] || sym,
          price: q?.price ?? 0,
          changePercent: q?.changePercent ?? 0,
        });
      }
    } catch {
      // Fallback: use context.market data
      if (context.market.spyChange != null) {
        indicators.push({ symbol: 'SPY', name: 'S&P 500', price: 0, changePercent: context.market.spyChange });
      }
      if (context.market.qqqChange != null) {
        indicators.push({ symbol: 'QQQ', name: 'Nasdaq 100', price: 0, changePercent: context.market.qqqChange });
      }
    }

    // Step 2: Fetch general market news from Finnhub (top 10)
    const THEMES: Record<string, string[]> = {
      'Fed/Rates': ['federal reserve', 'interest rate', 'fed', 'powell', 'rate cut', 'rate hike', 'fomc'],
      'Inflation': ['inflation', 'cpi', 'pce', 'prices', 'consumer price'],
      'Earnings': ['earnings', 'revenue', 'profit', 'quarterly', 'guidance'],
      'Tech': ['ai', 'artificial intelligence', 'semiconductor', 'tech', 'nvidia', 'apple', 'microsoft'],
      'Geopolitical': ['tariff', 'trade war', 'sanctions', 'geopolitical', 'china', 'russia'],
    };

    let news: Array<{ headline: string; summary: string; sentiment: string }> = [];
    let newsByTheme: Record<string, Array<{ headline: string; sentiment: string }>> = {};

    try {
      const finnhubKey = process.env.FINNHUB_IO_API_KEY;
      if (finnhubKey) {
        const newsRes = await fetch(
          `https://finnhub.io/api/v1/news?category=general&token=${finnhubKey}`,
          { signal: AbortSignal.timeout(8000) }
        );
        if (newsRes.ok) {
          const data = await newsRes.json();
          if (Array.isArray(data)) {
            // Local keyword sentiment analyzer
            const classifySentiment = (text: string): string => {
              const lower = text.toLowerCase();
              const posWords = ['beat', 'surge', 'rally', 'gain', 'rise', 'positive', 'upgrade', 'breakthrough', 'growth'];
              const negWords = ['drop', 'fall', 'decline', 'crash', 'fear', 'risk', 'warning', 'downgrade', 'loss', 'sell-off', 'selloff'];
              let p = 0, n = 0;
              for (const w of posWords) if (lower.includes(w)) p++;
              for (const w of negWords) if (lower.includes(w)) n++;
              if (p > n) return 'positive';
              if (n > p) return 'negative';
              return 'neutral';
            };

            news = data.slice(0, 10).map((item: any) => ({
              headline: item.headline || '',
              summary: item.summary || '',
              sentiment: classifySentiment((item.headline || '') + ' ' + (item.summary || '')),
            }));

            // Group by theme
            for (const article of news) {
              const text = (article.headline + ' ' + article.summary).toLowerCase();
              for (const [theme, keywords] of Object.entries(THEMES)) {
                for (const kw of keywords) {
                  if (text.includes(kw)) {
                    if (!newsByTheme[theme]) newsByTheme[theme] = [];
                    newsByTheme[theme].push({ headline: article.headline, sentiment: article.sentiment });
                    break;
                  }
                }
              }
            }
          }
        }
      }
    } catch {
      // Use context.market.recentNews as fallback
      if (context.market.recentNews && context.market.recentNews.length > 0) {
        news = context.market.recentNews.map((n: any) => ({
          headline: n.headline || '',
          summary: '',
          sentiment: n.sentiment || 'neutral',
        }));
      }
    }

    // Step 3: Calculate portfolio beta approximation
    let estimatedBeta = 1.0;
    if (context.portfolio.positions.length > 0) {
      let weightedBeta = 0;
      let totalValue = 0;
      for (const pos of context.portfolio.positions) {
        let posBeta = 1.0;
        const sector = (pos.sector || '').toLowerCase();
        if (sector.includes('technology') || sector.includes('semiconductor')) posBeta = 1.4;
        else if (pos.symbol === 'QQQ' || pos.symbol === 'TQQQ') posBeta = 1.5;
        else if (sector.includes('consumer') || sector.includes('discretionary')) posBeta = 1.2;
        else if (sector.includes('healthcare') || sector.includes('utilities') || sector.includes('consumer staples')) posBeta = 0.6;
        else if (sector.includes('financial')) posBeta = 1.1;
        else if (pos.symbol === 'TLT' || pos.symbol === 'GLD') posBeta = 0.3;
        else if (pos.symbol === 'IWM') posBeta = 1.3;

        weightedBeta += posBeta * (pos.marketValue || 0);
        totalValue += (pos.marketValue || 0);
      }
      if (totalValue > 0) estimatedBeta = +(weightedBeta / totalValue).toFixed(1);
    }

    // Helper: dominant sentiment for a group of articles
    const getDominantSentiment = (articles: Array<{ headline: string; sentiment: string }>): string => {
      let pos = 0, neg = 0;
      for (const a of articles) {
        if (a.sentiment === 'positive') pos++;
        else if (a.sentiment === 'negative') neg++;
      }
      if (pos > neg) return 'mostly positive 🟢';
      if (neg > pos) return 'mostly negative 🔴';
      return 'mixed ⚪';
    };

    // Step 4: Build market context string for the AI prompt
    let trendContext = `MARKET SNAPSHOT (${new Date().toLocaleDateString()}):\n\n`;
    trendContext += 'Broad Market:\n';
    for (const ind of indicators) {
      const sign = ind.changePercent >= 0 ? '+' : '';
      trendContext += `${ind.name}: $${ind.price} (${sign}${ind.changePercent.toFixed(2)}%)\n`;
    }
    trendContext += `\nPortfolio Beta: ~${estimatedBeta}x\n`;
    trendContext += `(Your portfolio moves ~${estimatedBeta}x the market on average)\n\n`;

    trendContext += 'News Themes Today:\n';
    const sortedThemes = Object.entries(newsByTheme)
      .filter(([_, articles]) => articles.length > 0)
      .sort((a, b) => b[1].length - a[1].length);
    if (sortedThemes.length > 0) {
      for (const [theme, articles] of sortedThemes) {
        const sentiment = getDominantSentiment(articles);
        trendContext += `- ${theme}: ${articles.length} articles — ${sentiment}\n`;
      }
    } else {
      trendContext += '(No dominant themes detected)\n';
    }

    trendContext += '\nTop Headlines:\n';
    for (let i = 0; i < Math.min(5, news.length); i++) {
      const n = news[i];
      const sentIcon = n.sentiment === 'positive' ? '🟢' : n.sentiment === 'negative' ? '🔴' : '⚪';
      trendContext += `${i + 1}. ${n.headline} (${sentIcon})\n`;
    }

    // Step 5: Response format instructions
    const trendsModeInstructions = `Analyze market trends and connect directly to the user's portfolio.

Structure your response EXACTLY as:

Market Pulse
[2-3 sentences on overall market direction backed by data]

What This Means for Your Portfolio
- [Specific holding]: [impact of current trend] 🟢/🟡/🔴
- [Specific holding]: [impact of current trend]
(Include at least 3 holdings)

Key Risk to Watch
[Most important macro risk with specific probability estimate]

Opportunity in Current Environment
[One specific opportunity given current trends]
Confidence: 🟡/🔴 [reason]

→ [Specific action direction]`;

    // Step 6: Send to AI
    const systemPrompt = buildSystemPrompt(context, 'trends', responseMode);
    const aiResponse = await callAI({
      messages: [
        { role: 'system', content: systemPrompt + '\n\n' + trendContext + '\n\n' + trendsModeInstructions },
        { role: 'user', content: message }
      ],
      maxTokens: 600,
      temperature: 0.3,
    });

    return NextResponse.json({
      content: aiResponse.content,
      type: 'trends',
      model: aiResponse.model,
      tokensUsed: aiResponse.tokensUsed,
      marketData: {
        indicators: indicators.map(i => ({
          symbol: i.symbol,
          price: i.price,
          changePercent: i.changePercent,
        })),
        estimatedBeta,
        topThemes: sortedThemes.slice(0, 3).map(([theme, articles]) => ({
          theme,
          articleCount: articles.length,
          sentiment: getDominantSentiment(articles),
        })),
      },
    });
  }

  // 5. Tax mode: all math computed server-side, AI only formats output
  if (mode === 'tax') {
    const currentYear = new Date().getFullYear();
    const tax = (context as any).tax || {};

    // Realized gains/losses (short vs long term based on holding period)
    const shortTermRealizedGains = tax.shortTermGains || 0;
    const shortTermRealizedLosses = tax.shortTermLosses || 0;
    const longTermRealizedGains = tax.longTermGains || 0;
    const longTermRealizedLosses = tax.longTermLosses || 0;

    // Net positions
    const netShortTerm = shortTermRealizedGains - shortTermRealizedLosses;
    const netLongTerm = longTermRealizedGains - longTermRealizedLosses;
    const totalNet = netShortTerm + netLongTerm;

    // Estimated tax (rough calculation)
    // Short-term rate: 35% (ordinary income assumption)
    // Long-term rate: 20%
    const estimatedShortTermTax = Math.max(0, netShortTerm * 0.35);
    const estimatedLongTermTax = Math.max(0, netLongTerm * 0.20);
    const estimatedTotalTax = estimatedShortTermTax + estimatedLongTermTax;

    // Harvestable losses from current portfolio
    const harvestable: Array<{
      symbol: string;
      loss: number;
      estTaxSaving: number;
      washSafe: boolean;
    }> = [];

    for (const pos of context.portfolio.positions) {
      if (pos.unrealizedPnL < 0) {
        const absLoss = Math.abs(pos.unrealizedPnL);
        const estSaving = absLoss * 0.20; // long-term capital gains rate
        if (estSaving < 100) continue; // not worth harvesting under $100 savings

        // Check wash sale: was position bought in last 30 days?
        const heldDays = (pos as any).heldDays || 999;
        const washSafe = heldDays > 30;

        harvestable.push({
          symbol: pos.symbol,
          loss: Math.round(absLoss),
          estTaxSaving: Math.round(estSaving),
          washSafe
        });
      }
    }
    harvestable.sort((a, b) => b.estTaxSaving - a.estTaxSaving);

    const totalHarvestable = harvestable.reduce((s, h) => s + h.loss, 0);
    const totalTaxSaving = harvestable.reduce((s, h) => s + h.estTaxSaving, 0);

    // Year-end urgency
    const month = new Date().getMonth() + 1;
    const isYearEnd = month >= 10;
    const daysLeft = isYearEnd
      ? Math.floor((new Date(currentYear, 11, 31).getTime() - Date.now()) / 86400000)
      : 0;

    // Build tax context string
    let taxContext = `TAX ANALYSIS — ${currentYear}\n\n`;
    taxContext += `Realized This Year:\n`;
    taxContext += `Short-term Gains: $${shortTermRealizedGains.toLocaleString()} | Short-term Losses: $${shortTermRealizedLosses.toLocaleString()}\n`;
    taxContext += `Long-term Gains: $${longTermRealizedGains.toLocaleString()} | Long-term Losses: $${longTermRealizedLosses.toLocaleString()}\n`;
    taxContext += `Net Short-term: $${netShortTerm.toLocaleString()} | Net Long-term: $${netLongTerm.toLocaleString()}\n`;
    taxContext += `Total Net: $${totalNet.toLocaleString()} (${totalNet > 0 ? 'gain' : 'loss'})\n\n`;

    taxContext += `Estimated Tax Liability: $${Math.round(estimatedTotalTax).toLocaleString()}\n`;
    taxContext += `(Short-term: $${Math.round(estimatedShortTermTax).toLocaleString()} at 35% | Long-term: $${Math.round(estimatedLongTermTax).toLocaleString()} at 20%)\n`;
    taxContext += `⚠️ Estimate only — consult a tax advisor\n\n`;

    if (harvestable.length > 0) {
      taxContext += `Harvestable Losses Available:\n`;
      for (const h of harvestable) {
        taxContext += `  ${h.symbol}: -$${h.loss.toLocaleString()} loss | Est. saving: $${h.estTaxSaving.toLocaleString()} | Wash sale: ${h.washSafe ? 'safe' : '⚠️ risky'}\n`;
      }
      taxContext += `Total Harvestable: $${totalHarvestable.toLocaleString()} loss | Est. Tax Saving: $${totalTaxSaving.toLocaleString()}\n\n`;
    }

    if (isYearEnd) {
      taxContext += `⚠️ ${daysLeft} days left in ${currentYear} tax year — act before Dec 31\n`;
    } else {
      const monthsLeft = 12 - month;
      taxContext += `${monthsLeft} months remaining in ${currentYear} tax year\n`;
    }

    // Format instructions for the AI
    const taxFormatInstructions = `Present this pre-calculated tax analysis.
Do not change the numbers.
Be direct about the tax implications.

Format:

📊 ${currentYear} Tax Summary

Realized P&L:
Short-term: $${netShortTerm.toLocaleString()} ${netShortTerm >= 0 ? 'gain' : 'loss'}
Long-term: $${netLongTerm.toLocaleString()} ${netLongTerm >= 0 ? 'gain' : 'loss'}
Net: $${totalNet.toLocaleString()} ${totalNet >= 0 ? 'gain' : 'loss'}

💰 Estimated Tax: $${Math.round(estimatedTotalTax).toLocaleString()}
[Breakdown by short vs long term]

🌱 Harvest Opportunities:
[List each with savings and wash sale status]
Total potential savings: $${totalTaxSaving.toLocaleString()}

${isYearEnd ? '⚠️ Act before Dec 31' : `Plan ahead — ${12 - month} months remaining`}

→ Use Tax Harvest strategy to execute harvesting`;

    const systemPrompt = buildSystemPrompt(context, 'tax', responseMode);
    const aiResponse = await callAI({
      messages: [
        { role: 'system', content: systemPrompt + '\n\n' + taxContext + '\n\n' + taxFormatInstructions },
        { role: 'user', content: message || 'Show me my tax situation' }
      ],
      maxTokens: 500,
      temperature: 0.2,
    });

    return NextResponse.json({
      content: aiResponse.content,
      type: 'tax',
      taxData: {
        netShortTerm,
        netLongTerm,
        totalNet,
        estimatedTotalTax,
        harvestable,
        totalHarvestable,
        totalTaxSaving,
        isYearEnd,
        daysLeft
      },
      model: aiResponse.model,
      tokensUsed: aiResponse.tokensUsed
    });
  }

  // 5. Health mode: rules-based diagnostic with 0-10 scoring
  if (mode === 'health') {
    // ─── SCORE 1: Diversification (0-10) ───
    let diversificationScore = 10;
    const violations: string[] = [];
    const strengths: string[] = [];
    const styleLimits: Record<string, number> = {
      'Growth-Style': 15,
      'Value-Style': 12,
      'Momentum-Style': 20,
      'Macro-Style': 12,
      'Dividend-Style': 10,
    };
    const positionLimit = styleLimits[context.investorStyle] || 15;

    // Deductions for position concentration
    for (const pos of context.portfolio.positions) {
      if (pos.portfolioPercent > 25) {
        diversificationScore -= 3;
        violations.push(`${pos.symbol}: ${pos.portfolioPercent.toFixed(1)}% of portfolio (severe concentration >25%)`);
      } else if (pos.portfolioPercent > 15) {
        diversificationScore -= 2;
        violations.push(`${pos.symbol}: ${pos.portfolioPercent.toFixed(1)}% of portfolio (above 15% limit)`);
      }
    }

    // Sector concentration
    const sectorBreakdown = context.portfolio.sectorBreakdown || [];
    for (const s of sectorBreakdown) {
      if (s.percent > 40) {
        diversificationScore -= 2;
        violations.push(`${s.sector}: ${s.percent.toFixed(1)}% sector concentration (above 40%)`);
      }
    }

    // Position count check
    const positionCount = context.portfolio.positions.length;
    if (positionCount < 5) {
      diversificationScore -= 2;
      violations.push(`Only ${positionCount} positions — under-diversified`);
    }

    // Sector diversity check
    const sectors = new Set(context.portfolio.positions.map(p => p.sector).filter(Boolean));
    if (sectors.size < 3) {
      diversificationScore -= 2;
      violations.push(`Only ${sectors.size} sectors represented`);
    }
    if (sectors.size === 1) {
      diversificationScore -= 4;
      violations.push('All positions in same sector');
    }

    diversificationScore = Math.max(0, diversificationScore);
    if (diversificationScore >= 8) strengths.push('Well diversified across sectors and positions');

    // ─── SCORE 2: Risk Management (0-10) ───
    let riskScore = 10;
    for (const pos of context.portfolio.positions) {
      if (pos.unrealizedPnLPercent < -35) {
        riskScore -= 2;
        violations.push(`${pos.symbol}: down ${Math.abs(pos.unrealizedPnLPercent).toFixed(1)}% — severe loss`);
      } else if (pos.unrealizedPnLPercent < -20) {
        riskScore -= 1;
        violations.push(`${pos.symbol}: down ${Math.abs(pos.unrealizedPnLPercent).toFixed(1)}%`);
      }
    }

    // Cash position check
    const cashPct = context.portfolio.buyingPower > 0
      ? (context.portfolio.buyingPower / (context.portfolio.totalValue + context.portfolio.buyingPower)) * 100
      : 0;
    if (cashPct < 3) {
      riskScore -= 1;
      violations.push(`Cash: ${cashPct.toFixed(0)}% — no dry powder`);
    }
    if (cashPct > 20) {
      riskScore -= 1;
      violations.push(`Cash: ${cashPct.toFixed(0)}% — too conservative`);
    }

    // Upcoming earnings risk — check if any position >10% has earnings within 7 days
    const now = Date.now();
    const weekFromNow = now + 7 * 86400000;
    for (const pos of context.portfolio.positions) {
      if (pos.portfolioPercent > 10 && pos.upcomingEarnings) {
        const earnDate = new Date(pos.upcomingEarnings).getTime();
        if (earnDate > now && earnDate < weekFromNow) {
          riskScore -= 1;
          violations.push(`${pos.symbol}: earnings in <7 days with ${pos.portfolioPercent.toFixed(1)}% position`);
        }
      }
    }

    riskScore = Math.max(0, riskScore);
    if (riskScore >= 8) strengths.push('Strong risk profile');

    // ─── SCORE 3: Style Alignment (0-10) ───
    let styleScore = 10;

    // Growth style checks
    if (context.investorStyle === 'Growth-Style') {
      let highPETotal = 0;
      for (const pos of context.portfolio.positions) {
        if (pos.pe && pos.pe > 40) highPETotal += pos.portfolioPercent;
      }
      if (highPETotal > 20) {
        styleScore -= 2;
        violations.push(`${highPETotal.toFixed(0)}% in high PE (>40) stocks — growth risk`);
      }

      const growthSectors = ['Technology', 'Healthcare', 'Consumer Cyclical', 'Communication Services'];
      const growthPct = context.portfolio.positions
        .filter(p => growthSectors.some(s => (p.sector || '').includes(s)))
        .reduce((s, p) => s + p.portfolioPercent, 0);
      if (growthPct < 30) {
        styleScore -= 3;
        violations.push(`Only ${growthPct.toFixed(0)}% in growth sectors — misaligned with Growth style`);
      }
    }

    // Value style checks
    if (context.investorStyle === 'Value-Style') {
      const valueSectors = ['Financial Services', 'Energy', 'Consumer Defensive', 'Healthcare'];
      const valuePct = context.portfolio.positions
        .filter(p => valueSectors.some(s => (p.sector || '').includes(s)))
        .reduce((s, p) => s + p.portfolioPercent, 0);
      if (valuePct < 20) {
        styleScore -= 2;
        violations.push(`Only ${valuePct.toFixed(0)}% in value sectors`);
      }
    }

    styleScore = Math.max(0, styleScore);
    if (styleScore >= 8) strengths.push('Well aligned with investment style');

    // ─── SCORE 4: Performance (0-10) ───
    let performanceScore = 0;

    const totalPnL = context.portfolio.positions.reduce((s, p) => s + (p.unrealizedPnL || 0), 0);
    if (totalPnL > 0) performanceScore += 2;
    else performanceScore += 1;

    // Check if beating SPY
    const spyChange = context.market?.spyChange || 0;
    const totalCostBasis = context.portfolio.totalValue - (context.portfolio.totalPnL || 0);
    const portfolioYtdChange = totalCostBasis > 0
      ? ((context.portfolio.totalValue - totalCostBasis) / totalCostBasis) * 100
      : 0;
    if (portfolioYtdChange > spyChange) performanceScore += 2;

    if ((context.portfolio.todayPnL || 0) > 0) performanceScore += 1;

    const winners = context.portfolio.positions.filter(p => p.unrealizedPnL > 0).length;
    const losers = context.portfolio.positions.filter(p => p.unrealizedPnL < 0).length;
    if (winners > losers) performanceScore += 2;

    const largestWin = Math.max(...context.portfolio.positions.map(p => p.unrealizedPnLPercent || 0));
    if (largestWin > 20) performanceScore += 1;

    const worstLoss = Math.min(...context.portfolio.positions.map(p => p.unrealizedPnLPercent || 0));
    if (worstLoss > -40) performanceScore += 2;

    performanceScore = Math.min(10, performanceScore);
    if (performanceScore >= 7) strengths.push('Strong performance metrics');

    // ─── SCORE 5: Tax Efficiency (0-10) ───
    let taxScore = 10;

    const realizedGains = context.tax?.ytdRealizedGains || 0;
    const realizedLosses = context.tax?.ytdRealizedLosses || 0;
    const harvestablePositions = context.tax?.harvestablePositions || [];
    const harvestableLosses = harvestablePositions.reduce((sum, p) => sum + p.unrealizedLoss, 0);
    const washSaleCount = harvestablePositions.filter(p => !p.washSaleSafe).length;

    if (realizedGains > 5000) {
      taxScore -= 2;
      violations.push(`$${(realizedGains / 1000).toFixed(0)}k in realized gains — taxed at higher rate`);
    }
    if (harvestableLosses > 2000 && realizedLosses < harvestableLosses) {
      taxScore -= 2;
      violations.push(`$${(harvestableLosses / 1000).toFixed(0)}k in unharvested losses available`);
    }
    if (washSaleCount > 0) {
      taxScore -= 3;
      violations.push(`${washSaleCount} wash sale violation(s) in portfolio`);
    }

    const month = new Date().getMonth() + 1;
    if (month >= 10 && realizedGains > 1000) {
      taxScore -= 1;
      violations.push('Year-end approaching with realized gains — consider tax planning');
    }

    taxScore = Math.max(0, taxScore);
    if (taxScore >= 8) strengths.push('Tax-efficient positioning');

    // ─── Overall Score (weighted average) ───
    const overallScore = +((diversificationScore * 0.25 + riskScore * 0.25 + styleScore * 0.20 + performanceScore * 0.20 + taxScore * 0.10).toFixed(1));

    function healthLabel(score: number): string {
      if (score >= 8) return 'Excellent';
      if (score >= 6) return 'Good';
      if (score >= 4) return 'Needs Attention';
      return 'Critical';
    }

    function healthDot(score: number): string {
      if (score >= 8) return '🟢';
      if (score >= 6) return '🟡';
      if (score >= 4) return '🟠';
      return '🔴';
    }

    // ─── Build Health Context & Data ───
    const healthData = {
      scores: {
        diversification: diversificationScore,
        risk: riskScore,
        style: styleScore,
        performance: performanceScore,
        tax: taxScore,
        overall: overallScore
      },
      violations,
      strengths: strengths.length > 0 ? strengths : ['Portfolio exists and is being tracked'],
      priorityActions: violations.slice(0, 5)
    };

    let healthContext = `PORTFOLIO HEALTH DIAGNOSTIC\n\n`;
    healthContext += `SCORES (ALL CALCULATED BY RULES, 0-10 scale):\n`;
    healthContext += `Diversification: ${diversificationScore}/10 ${healthDot(diversificationScore)}\n`;
    healthContext += `Risk Management: ${riskScore}/10 ${healthDot(riskScore)}\n`;
    healthContext += `Style Alignment: ${styleScore}/10 ${healthDot(styleScore)}\n`;
    healthContext += `Performance: ${performanceScore}/10 ${healthDot(performanceScore)}\n`;
    healthContext += `Tax Efficiency: ${taxScore}/10 ${healthDot(taxScore)}\n`;
    healthContext += `OVERALL: ${overallScore}/10 — ${healthLabel(overallScore)}\n\n`;
    healthContext += `VIOLATIONS:\n${violations.length > 0 ? violations.map(v => `- ${v}`).join('\n') : '- None'}\n\n`;
    healthContext += `STRENGTHS:\n${strengths.map(s => `- ${s}`).join('\n')}\n`;

    // ─── Format Instructions ───
    const healthFormatInstructions = `Present this pre-calculated portfolio health report.
Do not change the scores. Explain each score clearly.
Use this format:

📊 Portfolio Health Report

Overall Score: {X}/10 — {Excellent/Good/Needs Attention/Critical}

| Area | Score | Status |
|------|-------|--------|
| Diversification | {X}/10 | 🟢/🟡/🟠/🔴 |
| Risk Management | {X}/10 | 🟢/🟡/🟠/🔴 |
| Style Alignment | {X}/10 | 🟢/🟡/🟠/🔴 |
| Performance | {X}/10 | 🟢/🟡/🟠/🔴 |
| Tax Efficiency | {X}/10 | 🟢/🟡/🟠/🔴 |

Priority Actions:
1. [Highest impact action] → [where to act]
2. [Second action] → [where to act]
3. [Third action] → [where to act]

What's Working:
- [strength]
- [strength]`;

    // ─── Call AI ───
    const systemPrompt = buildSystemPrompt(context, mode, responseMode);
    const aiResponse = await callAI({
      messages: [
        { role: 'system', content: systemPrompt + '\n\n' + healthContext + '\n\n' + healthFormatInstructions },
        { role: 'user', content: message || 'Give me a portfolio health check' }
      ],
      maxTokens: 600,
      temperature: 0.2,
    });

    return NextResponse.json({
      content: aiResponse.content,
      type: 'health',
      scores: healthData.scores,
      violations,
      strengths,
      model: aiResponse.model,
      tokensUsed: aiResponse.tokensUsed
    });
  }

  // 6. Research mode — deep stock analysis with live data
  if (mode === 'research') {
    const symbols = extractSymbols(message);
    const stockSymbol = symbols[0];

    if (!stockSymbol) {
      const fallbackMsg = 'I couldn\u2019t find a stock ticker in your message. Try: \u2018Research AAPL\u2019 or \u2018Analyze NVDA for me\u2019.\n\nOriginal query: ' + message;
      const sysPrompt = buildSystemPrompt(context, 'general', responseMode);
      const aiResp = await callAI({
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: fallbackMsg }
        ],
        maxTokens: 200,
        temperature: 0.3,
      });
      return NextResponse.json({
        content: aiResp.content,
        type: 'text',
        model: aiResp.model,
        tokensUsed: aiResp.tokensUsed
      });
    }

    try {
      const finnhubApiKey = process.env.FINNHUB_IO_API_KEY;
      const FINNHUB = 'https://finnhub.io/api/v1';

      // Fetch core data in parallel
      const [quote, profile, fundamentals] = await Promise.all([
        getQuote(stockSymbol),
        getCompanyProfile(stockSymbol),
        getFundamentals(stockSymbol),
      ]);

      if (!quote || quote.price <= 0) {
        return NextResponse.json({
          content: `I couldn\u2019t fetch price data for **${stockSymbol}**. The symbol may be invalid, delisted, or the data provider is unavailable.`,
          type: 'text'
        });
      }

      // Fetch candles, news, earnings from Finnhub directly
      let candles: Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }> = [];
      let newsArticles: any[] = [];
      let earningsData: any[] = [];

      if (finnhubApiKey) {
        const now = Math.floor(Date.now() / 1000);
        const sixtyDaysAgo = now - 60 * 24 * 60 * 60;
        const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const todayStr = new Date().toISOString().split('T')[0];

        const [candleRes, newsRes, earnRes] = await Promise.allSettled([
          fetch(`${FINNHUB}/stock/candle?symbol=${encodeURIComponent(stockSymbol)}&resolution=D&from=${sixtyDaysAgo}&to=${now}&token=${finnhubApiKey}`),
          fetch(`${FINNHUB}/company-news?symbol=${encodeURIComponent(stockSymbol)}&from=${fourteenDaysAgo}&to=${todayStr}&token=${finnhubApiKey}`),
          fetch(`${FINNHUB}/calendar/earnings?symbol=${encodeURIComponent(stockSymbol)}&token=${finnhubApiKey}`),
        ]);

        if (candleRes.status === 'fulfilled' && candleRes.value.ok) {
          const cd = await candleRes.value.json().catch(() => null);
          if (cd?.s === 'ok' && cd.t) {
            candles = cd.t.map((t: number, i: number) => ({
              timestamp: t * 1000,
              open: cd.o[i],
              high: cd.h[i],
              low: cd.l[i],
              close: cd.c[i],
              volume: cd.v[i],
            }));
          }
        }
        if (newsRes.status === 'fulfilled' && newsRes.value.ok) {
          newsArticles = await newsRes.value.json().catch(() => []) || [];
        }
        if (earnRes.status === 'fulfilled' && earnRes.value.ok) {
          earningsData = await earnRes.value.json().catch(() => []) || [];
        }
      }

      // Fallback: getCandles from market-data if Finnhub returned nothing
      if (candles.length === 0) {
        const now = Math.floor(Date.now() / 1000);
        const sixtyDaysAgo = now - 60 * 24 * 60 * 60;
        const result = await getCandles(stockSymbol, 'D', sixtyDaysAgo, now);
        if (result) candles = result;
      }

      // --- Calculate technicals ---
      const price = quote.price;
      const changePercent = quote.changePercent;
      const high52w = quote.high52w ?? fundamentals?.high52w ?? 0;
      const low52w = quote.low52w ?? fundamentals?.low52w ?? 0;

      let ma20 = 0, ma50 = 0, vs20MA = 0, vs50MA = 0;
      let rsiVal: number | null = null;
      let support = 0, resistance = 0;
      let trend = 'unknown';

      if (candles.length >= 20) {
        const closePrices = candles.map(c => c.close);
        const recent20 = closePrices.slice(-20);
        ma20 = recent20.reduce((a, b) => a + b, 0) / 20;
        const recent50 = closePrices.slice(-50);
        ma50 = recent50.length > 0
          ? recent50.reduce((a, b) => a + b, 0) / recent50.length
          : closePrices.reduce((a, b) => a + b, 0) / closePrices.length;

        vs20MA = ma20 > 0 ? ((price - ma20) / ma20) * 100 : 0;
        vs50MA = ma50 > 0 ? ((price - ma50) / ma50) * 100 : 0;

        // RSI (14)
        if (closePrices.length >= 15) {
          const diffs: number[] = [];
          const slice = closePrices.slice(-15);
          for (let i = 1; i < slice.length; i++) diffs.push(slice[i] - slice[i - 1]);
          const gains = diffs.filter(v => v > 0);
          const losses = diffs.filter(v => v < 0).map(v => Math.abs(v));
          const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / 14 : 0;
          const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / 14 : 0;
          const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
          rsiVal = 100 - (100 / (1 + rs));
        }

        // Support / Resistance from last 20 candles
        const recentCandles = candles.slice(-20);
        support = Math.min(...recentCandles.map(c => c.low));
        resistance = Math.max(...recentCandles.map(c => c.high));

        // Trend from 20-day price change
        const oldestIdx = Math.max(0, closePrices.length - 20);
        const oldestClose = closePrices[oldestIdx];
        if (oldestClose > 0) {
          const priceChange20d = ((closePrices[closePrices.length - 1] - oldestClose) / oldestClose) * 100;
          if (priceChange20d > 10) trend = 'strongly up';
          else if (priceChange20d > 3) trend = 'up';
          else if (priceChange20d > -3) trend = 'sideways';
          else if (priceChange20d > -10) trend = 'down';
          else trend = 'strongly down';
        }
      }

      // --- Build research context ---
      const companyName = profile?.name || stockSymbol;
      const sector = profile?.industry || 'Unknown';
      const exchange = profile?.exchange || 'Unknown';
      const marketCapB = fundamentals?.marketCap
        ? (fundamentals.marketCap / 1e9).toFixed(1) + 'B'
        : 'N/A';

      let researchContext = `RESEARCH: ${stockSymbol}\nCompany: ${companyName} | Sector: ${sector} | Market Cap: $${marketCapB}\nExchange: ${exchange}\n\nPrice Action:\nCurrent: $${price.toFixed(2)} | Change: ${changePercent > 0 ? '+' : ''}${changePercent.toFixed(2)}%\n`;

      if (high52w > 0) {
        researchContext += `52w High: $${high52w.toFixed(2)} | 52w Low: $${low52w.toFixed(2)}\n`;
        const pctFromHigh = ((price - high52w) / high52w) * 100;
        const pctFromLow = ((price - low52w) / low52w) * 100;
        researchContext += `% from 52w High: ${pctFromHigh.toFixed(1)}% | % from 52w Low: ${pctFromLow.toFixed(1)}%\n`;
      }

      if (candles.length >= 20) {
        researchContext += `20-day MA: $${ma20.toFixed(2)} | Price vs 20MA: ${vs20MA >= 0 ? 'above' : 'below'} by ${Math.abs(vs20MA).toFixed(1)}%\n`;
        researchContext += `50-day MA: $${ma50.toFixed(2)} | Price vs 50MA: ${vs50MA >= 0 ? 'above' : 'below'} by ${Math.abs(vs50MA).toFixed(1)}%\n`;
        if (rsiVal !== null) {
          const rsiLabel = rsiVal > 70 ? 'OVERBOUGHT' : rsiVal < 30 ? 'OVERSOLD' : 'neutral';
          researchContext += `RSI (14): ${rsiVal.toFixed(0)} \u2014 ${rsiLabel}\n`;
        }
        researchContext += `Support: $${support.toFixed(2)} | Resistance: $${resistance.toFixed(2)}\n`;
        researchContext += `Trend: ${trend}\n`;
      }

      // Fundamentals
      researchContext += '\nFundamentals:';
      if (fundamentals) {
        const peStr = fundamentals.pe ? fundamentals.pe.toFixed(1) + 'x' : 'N/A';
        const epsStr = fundamentals.eps ? '$' + fundamentals.eps.toFixed(2) : 'N/A';
        researchContext += `\nPE Ratio: ${peStr} | EPS: ${epsStr}`;
        if (fundamentals.marketCap) researchContext += `\nMarket Cap: $${(fundamentals.marketCap / 1e9).toFixed(1)}B`;
        if (fundamentals.beta != null) researchContext += ` | Beta: ${fundamentals.beta.toFixed(2)}`;
        if (fundamentals.dividendYield && fundamentals.dividendYield > 0) {
          researchContext += ` | Div Yield: ${(fundamentals.dividendYield * 100).toFixed(2)}%`;
        }
      }

      // Earnings
      if (earningsData.length > 0) {
        researchContext += '\n\nEarnings History:';
        const pastEarnings = earningsData.filter((e: any) => new Date(e.date) <= new Date()).slice(-2);
        for (const e of pastEarnings) {
          const est = e.estimateActual?.[0]?.estimate ?? '?';
          const actual = e.estimateActual?.[0]?.actual ?? '?';
          const surprise = e.estimateActual?.[0]?.surprise ?? '?';
          researchContext += `\n${e.date}: Est $${est} vs Actual $${actual} (${surprise}%)`;
        }
        const nextEarnings = earningsData.filter((e: any) => new Date(e.date) > new Date()).slice(0, 2);
        if (nextEarnings.length > 0) {
          researchContext += `\nNext Earnings: ${nextEarnings.map((e: any) => e.date).join(', ')}`;
        } else {
          researchContext += '\nNext Earnings: not scheduled';
        }
      }

      // News
      if (newsArticles.length > 0) {
        researchContext += '\n\nRecent News (14 days):';
        for (const n of newsArticles.slice(0, 5)) {
          const sent = n.sentiment === 'positive' ? '\u{1F7E2}' : n.sentiment === 'negative' ? '\u{1F534}' : '\u26AA';
          researchContext += `\n${sent} ${n.headline}`;
        }
      }

      // Portfolio fit
      const inPortfolio = context.portfolio.positions.find(
        (p: any) => p.symbol.toUpperCase() === stockSymbol.toUpperCase()
      );
      if (inPortfolio) {
        const shares = inPortfolio.shares ?? 0;
        const mktVal = (inPortfolio.marketValue ?? 0).toFixed(0);
        const pct = (inPortfolio.portfolioPercent ?? 0).toFixed(1);
        const pnlSign = (inPortfolio.unrealizedPnLPercent ?? 0) > 0 ? '+' : '';
        const pnlVal = (inPortfolio.unrealizedPnLPercent ?? 0).toFixed(1);
        researchContext += `\n\nIn Portfolio: Yes \u2014 ${shares} shares, $${mktVal} value, ${pct}% of portfolio, ${pnlSign}${pnlVal}% P&L`;
      } else {
        researchContext += '\n\nIn Portfolio: No';
      }

      // --- Format instructions ---
      const styleKey = context.investorStyle || 'growth';
      const styleNames: Record<string, string> = {
        growth: 'Growth', value: 'Value', momentum: 'Momentum', macro: 'Macro', dividend: 'Dividend',
        buffett: 'Value-Style', lynch: 'Growth-Style', livermore: 'Momentum-Style', soros: 'Macro-Style', munger: 'Dividend-Style',
      };
      const styleDisplay = styleNames[styleKey] || 'Growth';

      const formatInstructions = `\n\nStructure your research response exactly as:\n\n${stockSymbol} \u2014 ${companyName}\n*${sector} | Market Cap: $${marketCapB}*\n\nVerdict: [BUY THESIS / HOLD / AVOID] \u{1F7E2}/\u{1F7E1}/\u{1F534}\n*Confidence: [High/Medium/Speculative] \u2014 [one line reason]*\n\nStrengths:\n- [data-backed point]\n- [data-backed point]\n- [data-backed point]\n\nRisks:\n- [data-backed point]\n- [data-backed point]\n\nTechnicals:\nRSI: {X} ({overbought/oversold/neutral}) | Trend: {direction}\nPrice vs 50MA: {above/below} by {X}% | Support: $${support > 0 ? support.toFixed(2) : 'X'}\n\nFit for your ${styleDisplay} portfolio:\n[One paragraph on whether this fits investor style rules,\n position sizing recommendation as % of portfolio]\n\n\u2192 To trade: Search ${stockSymbol} in the Trade tab`;

      // --- Call AI ---
      const systemPrompt = buildSystemPrompt(context, 'research', responseMode);
      const fullSystemPrompt = systemPrompt + '\n\n' + researchContext + formatInstructions;

      const aiResponse = await callAI({
        messages: [
          { role: 'system', content: fullSystemPrompt },
          { role: 'user', content: message }
        ],
        maxTokens: responseMode === 'summary' ? 600 : 1200,
        temperature: 0.3,
      });

      return NextResponse.json({
        content: aiResponse.content,
        type: 'research',
        model: aiResponse.model,
        tokensUsed: aiResponse.tokensUsed
      });
    } catch (researchErr) {
      console.error('Research mode data fetch error:', researchErr);
      // Fall through to regular AI on error
    }
  }

  // 7. Regular AI call
  const systemPrompt = buildSystemPrompt(context, mode, responseMode);
  const aiResponse = await callAI({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: message }
    ],
    maxTokens: responseMode === 'summary' ? 400 : 800,
    temperature: 0.3,
  });

  return NextResponse.json({
    content: aiResponse.content,
    type: 'text',
    model: aiResponse.model,
    tokensUsed: aiResponse.tokensUsed
  });
}

// ─── Legacy Chat Handler (streaming SSE, old frontend compat) ───

async function handleLegacyChat(request: NextRequest): Promise<NextResponse> {
  if (!isAIAvailable()) {
    console.warn('No AI provider configured — using fallback message');
    return handleFallback(request);
  }

  try {
    const { messages, context, format, responseMode } = await request.json();

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'Messages array is required' }, { status: 400 });
    }

    // Extract stock symbols from last user message and fetch live data
    const lastUserMsg = [...messages].reverse().find((m: any) => m.role === 'user');
    const lastUserContent = (lastUserMsg?.content || '').toLowerCase();
    const symbols = extractSymbols(lastUserMsg?.content || '');
    const stockData = symbols.length > 0 ? await fetchStockData(symbols) : null;

    // Detect rebalancing intent from user message
    const hasRebalanceIntent = !format && /\brebalance\b|\brebalancing\b|\bdrift\b|\ballocation\b|\boverweight\b|\bunderweight\b|\bredistribute\b/i.test(lastUserContent);
    console.log('[chat/route] hasRebalanceIntent:', hasRebalanceIntent, 'format:', format, 'lastUserContent:', lastUserContent.slice(0, 80));
    const effectiveFormat = format || (hasRebalanceIntent ? 'rebalance_plan' : undefined);
    console.log('[chat/route] effectiveFormat:', effectiveFormat);

    const model = effectiveFormat
      ? 'deepseek-reasoner'
      : detectModelFromQuery(messages);

    const systemPrompt = buildLegacySystemPrompt(context, effectiveFormat, stockData, responseMode);
    const chatMessages = [
      { role: 'system', content: sanitizeUnicode(systemPrompt) },
      ...messages.map((m: { role: string; content: string }) => ({
        role: m.role,
        content: sanitizeUnicode(m.content),
      })),
    ];

    const inputTokens = estimateTokens(systemPrompt) +
      messages.reduce((sum: number, m: { content: string }) => sum + estimateTokens(m.content), 0);

    // Try AI provider with reasoner → chat fallback
    let stream: ReadableStream | null = null;
    let usedModel: string = model;
    let streamError = '';

    try {
      const provider = getAIProvider();
      const isDeepSeek = provider.name === 'deepseek';
      const isReasoner = model === 'deepseek-reasoner';

      try {
        const result = await streamAI({
          messages: chatMessages as AIMessage[],
          model,
          maxTokens: isReasoner ? 4096 : 2048,
          temperature: isReasoner ? 0.3 : 0.7,
          timeoutMs: isReasoner ? 25000 : 60000,
        });
        stream = result.stream;
        usedModel = result.model;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        streamError = msg;
        console.error(streamError);

        // Retry with chat model if reasoner failed (DeepSeek only)
        if (isDeepSeek && isReasoner) {
          console.error('Reasoner failed, trying chat model');
          usedModel = 'deepseek-chat';
          try {
            const result = await streamAI({
              messages: chatMessages as AIMessage[],
              model: 'deepseek-chat',
              maxTokens: 2048,
              temperature: 0.7,
              timeoutMs: 60000,
            });
            stream = result.stream;
            streamError = '';
          } catch (e2) {
            const msg2 = e2 instanceof Error ? e2.message : String(e2);
            streamError = `Chat fallback: ${msg2}`;
            console.error(streamError);
          }
        }
      }

      if (!stream) {
        throw new Error(streamError || 'AI provider unreachable');
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('AI provider error:', errorMsg);
      return handleFallback(request, errorMsg);
    }

    // Build SSE stream
    const encoder = new TextEncoder();
    let outputTokens = 0;
    let fullResponse = '';
    let cardBuffer = '';

    // JSON block stripping state
    let jsonBlockDepth = 0;       // 0 = outside, 1 = inside ```json, 2 = inside nested ```
    let jsonBlockBuffer = '';     // accumulate json block content
    const JSON_FENCE = '```';

    /** Check if text contains a JSON code fence and update state accordingly.
     *  Returns { filtered text, cards to emit }. */
    const filterJsonBlocks = (text: string): { text: string; cards: Array<any> } => {
      let result = '';
      const emittedCards: Array<any> = [];
      let i = 0;
      while (i < text.length) {
        if (jsonBlockDepth === 0) {
          // Outside JSON block — look for ```json
          const fenceIdx = text.indexOf(JSON_FENCE + 'json', i);
          if (fenceIdx !== -1 && fenceIdx < text.length) {
            result += text.slice(i, fenceIdx);
            jsonBlockDepth = 1;
            jsonBlockBuffer = '';
            i = fenceIdx + (JSON_FENCE + 'json').length;
            // Skip newline after opening fence
            if (text[i] === '\n') i++;
            else if (text[i] === '\r' && text[i + 1] === '\n') i += 2;
          } else {
            result += text.slice(i);
            break;
          }
        } else {
          // Inside JSON block — look for closing ```
          const closeIdx = text.indexOf(JSON_FENCE, i);
          if (closeIdx !== -1) {
            jsonBlockBuffer += text.slice(i, closeIdx);
            jsonBlockDepth = 0;
            i = closeIdx + JSON_FENCE.length;
            // Skip trailing newline after closing fence
            if (text[i] === '\n') i++;
            else if (text[i] === '\r' && text[i + 1] === '\n') i += 2;

            // Parse raw JSON directly (no fences needed — we already extracted it)
            try {
              const parsed = JSON.parse(jsonBlockBuffer.trim());
              const items = Array.isArray(parsed) ? parsed : [parsed];
              for (const item of items) {
                if (!item.type || !item.data) continue;
                // Reconstruct with fences so tryParseCards can find it
                const withFences = '```json\n' + JSON.stringify(item) + '\n```';
                const cards = tryParseCards(withFences);
                emittedCards.push(...cards);
              }
            } catch {
              // Invalid JSON — skip
            }
            jsonBlockBuffer = '';
          } else {
            // No closing fence yet — buffer everything
            jsonBlockBuffer += text.slice(i);
            break;
          }
        }
      }
      return { text: result, cards: emittedCards };
    };

    const readable = new ReadableStream({
      async start(controller) {
        try {
          const reader = stream!.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Parse SSE (DeepSeek — OpenAI-compatible format)
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const data = line.slice(6).trim();
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta?.content;
                if (delta) {
                  outputTokens += estimateTokens(delta);
                  fullResponse += delta;

                  // Strip ```json blocks before streaming to client
                  const { text: cleanDelta, cards: fenceCards } = filterJsonBlocks(delta);
                  if (cleanDelta) {
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({ event: 'token', content: cleanDelta })}\n\n`
                      )
                    );
                  }
                  // Emit cards parsed from JSON fences immediately
                  for (const card of fenceCards) {
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({ event: 'card', card })}\n\n`
                      )
                    );
                  }
                }
              } catch {
                // Skip unparseable lines
              }
            }

            // Legacy: Check for JSON blocks in plain cardBuffer (pre-fence detection path)
            cardBuffer += (jsonBlockDepth === 0 ? buffer : '');
            if (jsonBlockDepth === 0 && cardBuffer.length > 200) {
              const cards = tryParseCards(cardBuffer);
              if (cards.length > 0) {
                for (const card of cards) {
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({ event: 'card', card })}\n\n`
                    )
                  );
                }
                cardBuffer = '';
              }
            }
          }

          // Parse any remaining buffered JSON after stream ends
          if (jsonBlockDepth === 1 && jsonBlockBuffer) {
            const cards = tryParseCards(jsonBlockBuffer);
            for (const card of cards) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ event: 'card', card })}\n\n`
                )
              );
            }
          }

          // Final card parse attempt (legacy — for JSON that wasn't fence-wrapped)
          const finalCards = tryParseCards(fullResponse);
          for (const card of finalCards) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ event: 'card', card })}\n\n`
              )
            );
          }

          // If rebalance plan was generated, extract and store session
          if (effectiveFormat === 'rebalance_plan') {
            console.log('[chat/route] Rebalance intent detected. Extracting plan from fullResponse...');
            try {
              const rebalanceData = extractRebalancePlan(fullResponse);
              console.log('[chat/route] extractRebalancePlan result:', rebalanceData ? `${rebalanceData.trades.length} trades found` : 'null');
              if (rebalanceData) {
                // Get userId from session cookie
                const sessionCookie = request.cookies.get('session')?.value;
                console.log('[chat/route] Session cookie present:', !!sessionCookie);
                let userId: string | null = null;
                if (sessionCookie) {
                  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sessionCookie));
                  const sessionHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
                  const supabase = createServerClient();
                  const { data: sessionData } = await (supabase as any)
                    .from('user_sessions')
                    .select('user_id')
                    .eq('session_hash', sessionHash)
                    .single();
                  userId = sessionData?.user_id || null;
                  console.log('[chat/route] userId from session lookup:', userId || 'null');
                }

                if (userId) {
                  const supabase2 = createServerClient();
                  console.log('[chat/route] Inserting into rebalance_sessions...');
                  const { data: session, error: sessionErr } = await (supabase2 as any)
                    .from('rebalance_sessions')
                    .insert({
                      user_id: userId,
                      trades: rebalanceData.trades,
                      summary: rebalanceData.summary || '',
                      source: 'ai_chat',
                    })
                    .select('id')
                    .single();

                  if (sessionErr) {
                    console.error('[chat/route] DB insert error:', sessionErr);
                  }
                  if (session && !sessionErr) {
                    console.log('[chat/route] Session stored:', session.id);
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({
                          event: 'session',
                          sessionId: session.id,
                          summary: rebalanceData.summary,
                          trades: rebalanceData.trades,
                        })}\n\n`
                      )
                    );
                  } else {
                    console.log('[chat/route] Session NOT stored — will rely on client-side fallback');
                  }
                } else {
                  console.log('[chat/route] No userId — skipping DB session storage');
                }
              }
            } catch (e) {
              console.error('[chat/route] Rebalance session storage failed:', e);
            }
          }

          // Send cost info
          const cost = estimateCost(usedModel as any, inputTokens, outputTokens);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ event: 'cost', tokens: { input: inputTokens, output: outputTokens }, cost })}\n\n`
            )
          );

          // Done
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ event: 'done' })}\n\n`)
          );
        } catch (err) {
          console.error('Stream processing error:', err);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ event: 'error', message: 'Stream interrupted' })}\n\n`
            )
          );
        } finally {
          controller.close();
        }
      },
    });

    return new NextResponse(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Model-Used': usedModel,
        'X-Chat-Source': 'live',
        'Access-Control-Expose-Headers': 'X-Chat-Source, X-Model-Used, X-Chat-Error',
      },
    });
  } catch (error) {
    console.error('Chat route error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ─── New Chat Dispatcher ───

export async function POST(request: NextRequest) {
  if (!isAIAvailable()) {
    console.warn('No AI provider configured — using fallback message');
    return handleFallback(request);
  }

  try {
    const body = await request.json();
    const userId = await getUserFromSession(request);
    const isNewFormat = body.message !== undefined;

    if (isNewFormat) {
      return handleNewChat(body, userId, request);
    } else {
      return handleLegacyChat(request);
    }
  } catch (error) {
    console.error('Chat route error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}


/**
 * Graceful fallback when AI provider is not configured.
 * Returns a single honest message — no fake data, no pretending.
 */
async function handleFallback(request: NextRequest, errorDetail?: string): Promise<NextResponse> {
  const aiAvailable = isAIAvailable();
  
  let responseText: string;
  if (!aiAvailable) {
    responseText = 'AI is not configured. Add a DeepSeek API key to enable portfolio analysis, trade signals, and market insights.\n\nYou can still view your portfolio, monitor trades, and place orders — AI-powered analysis will be available once configured.';
  } else {
    responseText = 'The AI provider is currently unreachable. This might be a temporary network issue — try again in a moment.\n\nYour portfolio, trades, and orders are unaffected.';
  }

  const encoder = new TextEncoder();
  const words = responseText.split(/(\s+)/);

  const readable = new ReadableStream({
    async start(controller) {
      for (const word of words) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ event: 'token', content: word })}\n\n`
          )
        );
        await new Promise((r) => setTimeout(r, 8));
      }
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ event: 'done' })}\n\n`)
      );
      controller.close();
    },
  });

  return new NextResponse(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Model-Used': 'fallback',
      'X-Chat-Source': 'fallback',
      'X-Chat-Error': errorDetail || 'unknown',
      'Access-Control-Expose-Headers': 'X-Chat-Source, X-Model-Used, X-Chat-Error',
    },
  });
}
