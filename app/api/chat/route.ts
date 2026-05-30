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
import { createServerClient } from '@/lib/supabase';

const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';

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

/** Fetch Finnhub quote + profile for a symbol. Returns null on failure. */
async function fetchStockData(symbols: string[]): Promise<Record<string, any> | null> {
  const apiKey = process.env.FINNHUB_IO_API_KEY;
  if (!apiKey || symbols.length === 0) return null;

  const results: Record<string, any> = {};
  const uniqueSymbols = [...new Set(symbols)].slice(0, 5); // Limit to 5 stocks max

  const fetchSymbolData = async (symbol: string) => {
    try {
      const now = Math.floor(Date.now() / 1000);
      const fourWeeksAgo = now - 28 * 24 * 60 * 60;

      const [quoteRes, profileRes, candleRes] = await Promise.all([
        fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${apiKey}`),
        fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${symbol}&token=${apiKey}`),
        fetch(`https://finnhub.io/api/v1/stock/candle?symbol=${symbol}&resolution=D&from=${fourWeeksAgo}&to=${now}&token=${apiKey}`),
      ]);
      const quote = quoteRes.ok ? await quoteRes.json().catch(() => ({})) : {};
      const profile = profileRes.ok ? await profileRes.json().catch(() => ({})) : {};
      const candle = candleRes.ok ? await candleRes.json().catch(() => ({})) : {};
      
      if (!quote.c || quote.c === 0) return null; // No valid quote data

      // Parse historical candles
      const history: { date: string; close: number }[] = [];
      if (candle.s === 'ok' && Array.isArray(candle.c) && Array.isArray(candle.t)) {
        for (let i = 0; i < Math.min(candle.c.length, candle.t.length); i++) {
          const date = new Date(candle.t[i] * 1000).toISOString().split('T')[0];
          history.push({ date, close: candle.c[i] });
        }
      }

      // Calculate historical changes
      let weeksAgoPrice: number | null = null;
      let monthChangePct: number | null = null;
      if (history.length >= 2) {
        const oldest = history[0];
        weeksAgoPrice = oldest.close;
        if (weeksAgoPrice > 0) {
          monthChangePct = ((quote.c - weeksAgoPrice) / weeksAgoPrice) * 100;
        }
      }
      
      return {
        symbol,
        price: quote.c,
        change: quote.d,
        changePercent: quote.dp,
        high: quote.h,
        low: quote.l,
        open: quote.o,
        prevClose: quote.pc,
        name: profile.name || symbol,
        marketCap: profile.marketCapitalization,
        sector: profile.finnhubIndustry,
        exchange: profile.exchange,
        weeksAgoPrice,
        monthChangePct,
        history,
      };
    } catch {
      return null;
    }
  };

  // Fetch sequentially to respect Finnhub rate limits
  for (const symbol of uniqueSymbols) {
    const data = await fetchSymbolData(symbol);
    if (data) results[symbol] = data;
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

function buildSystemPrompt(context: unknown, format?: string, stockData?: Record<string, any> | null, responseMode?: string): string {
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

export async function POST(request: NextRequest) {
  const deepseekKey = process.env.DEEPSEEK_API_KEY;

  if (!deepseekKey) {
    console.warn('DeepSeek not configured — using fallback message');
    return handleFallback(request);
  }

  try {
    const { messages, context, format, responseMode } = await request.json();

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'Messages array is required' }, { status: 400 });
    }

    // Extract stock symbols from last user message and fetch live Finnhub data
    const lastUserMsg = [...messages].reverse().find((m: any) => m.role === 'user');
    const lastUserContent = (lastUserMsg?.content || '').toLowerCase();
    const symbols = extractSymbols(lastUserMsg?.content || '');
    const stockData = symbols.length > 0 ? await fetchStockData(symbols) : null;

    // Detect rebalancing intent from user message
    const hasRebalanceIntent = !format && /\brebalance\b|\brebalancing\b|\bdrift\b|\ballocation\b|\boverweight\b|\bunderweight\b|\bredistribute\b/i.test(lastUserContent);
    const effectiveFormat = format || (hasRebalanceIntent ? 'rebalance_plan' : undefined);

    const model = effectiveFormat
      ? 'deepseek-reasoner'
      : detectModelFromQuery(messages);

    const systemPrompt = buildSystemPrompt(context, effectiveFormat, stockData, responseMode);
    const chatMessages = [
      { role: 'system', content: sanitizeUnicode(systemPrompt) },
      ...messages.map((m: { role: string; content: string }) => ({
        role: m.role,
        content: sanitizeUnicode(m.content),
      })),
    ];

    const inputTokens = estimateTokens(systemPrompt) +
      messages.reduce((sum: number, m: { content: string }) => sum + estimateTokens(m.content), 0);

    // Try DeepSeek
    let stream: ReadableStream | null = null;
    let usedModel: string = model;
    let streamError = '';

    try {
      // ── Primary: DeepSeek ──
      if (deepseekKey) {
        try {
          const dsRes = await fetch(DEEPSEEK_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${deepseekKey}`,
            },
            body: JSON.stringify({
              model,
              messages: chatMessages,
              stream: true,
              temperature: model === 'deepseek-reasoner' ? 0.3 : 0.7,
              max_tokens: model === 'deepseek-reasoner' ? 4096 : 2048,
            }),
            signal: AbortSignal.timeout(model === 'deepseek-reasoner' ? 25000 : 60000),
          });

          if (dsRes.ok && dsRes.body) {
            stream = dsRes.body;
            usedModel = model;
          } else {
            const errBody = await dsRes.text().catch(() => '');
            streamError = `DeepSeek ${model} ${dsRes.status}: ${errBody.slice(0, 200)}`;
            console.error(streamError);
            // Retry with chat model if reasoner failed
            if (model === 'deepseek-reasoner') {
              console.error('DeepSeek reasoner failed, trying chat model');
              usedModel = 'deepseek-chat';
              const ds2Res = await fetch(DEEPSEEK_URL, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${deepseekKey}`,
                },
                body: JSON.stringify({
                  model: 'deepseek-chat',
                  messages: chatMessages,
                  stream: true,
                  temperature: 0.7,
                  max_tokens: 2048,
                }),
                signal: AbortSignal.timeout(60000),
              });
              if (ds2Res.ok && ds2Res.body) {
                stream = ds2Res.body;
                streamError = '';
              } else {
                const err2Body = await ds2Res.text().catch(() => '');
                streamError = `DeepSeek chat fallback ${ds2Res.status}: ${err2Body.slice(0, 200)}`;
                console.error(streamError);
              }
            }
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          streamError = `DeepSeek fetch threw: ${msg}`;
          console.error(streamError, e instanceof Error ? e.stack : '');
        }
      }

      // Claude disabled — DeepSeek only (2026-05-25)

      if (!stream) {
        throw new Error(streamError || 'DeepSeek unreachable');
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
                  cardBuffer += delta;

                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({ event: 'token', content: delta })}\n\n`
                    )
                  );
                }
              } catch {
                // Skip unparseable lines
              }
            }

            // Check for complete JSON blocks every ~200 chars (both providers)
            if (cardBuffer.length > 200) {
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

          // Final card parse attempt
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
            try {
              const rebalanceData = extractRebalancePlan(fullResponse);
              if (rebalanceData) {
                // Get userId from session cookie
                const sessionCookie = request.cookies.get('session')?.value;
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
                }

                if (userId) {
                  const supabase = createServerClient();
                  const { data: session, error: sessionErr } = await (supabase as any)
                    .from('rebalance_sessions')
                    .insert({
                      user_id: userId,
                      trades: rebalanceData.trades,
                      summary: rebalanceData.summary || '',
                      source: 'ai_chat',
                    })
                    .select('id')
                    .single();

                  if (session && !sessionErr) {
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
                  }
                }
              }
            } catch (e) {
              console.error('Rebalance session storage failed:', e);
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

/**
 * Graceful fallback when AI provider is not configured.
 * Returns a single honest message — no fake data, no pretending.
 */
async function handleFallback(request: NextRequest, errorDetail?: string): Promise<NextResponse> {
  const deepseekSet = !!process.env.DEEPSEEK_API_KEY;
  
  let responseText: string;
  if (!deepseekSet) {
    responseText = 'AI is not configured. Add a DeepSeek API key to enable portfolio analysis, trade signals, and market insights.\n\nYou can still view your portfolio, monitor trades, and place orders — AI-powered analysis will be available once configured.';
  } else {
    responseText = 'DeepSeek is currently unreachable. This might be a temporary network issue — try again in a moment.\n\nYour portfolio, trades, and orders are unaffected.';
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
