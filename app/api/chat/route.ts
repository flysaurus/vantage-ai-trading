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

const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';

// ─── Helpers ───

/** Per-style investment philosophies — injected into the system prompt */
const STYLE_PHILOSOPHY: Record<string, string> = {
  buffett: `## Your User's Chosen Style: Warren Buffett (Value Hunter)
Time horizon: 5-10+ years. They buy quality companies at fair prices, hold for decades, and compound dividends.
What they value: Low P/E, competitive moats, strong balance sheets, dividend growth, predictable earnings.
What they avoid: Speculative trades, meme stocks, companies with no earnings, excessive debt, IPOs.
Lead with intrinsic value analysis, margin of safety, and durable competitive advantages.`,

  lynch: `## Your User's Chosen Style: Peter Lynch (Growth Chaser)
Time horizon: 2-5 years. They find growing companies at reasonable prices (GARP) and rotate as growth slows.
What they value: Revenue growth 15%+, PEG ratio under 1.5, understandable business models, market expansion.
What they avoid: Cyclicals at peak, growth without earnings, companies too complex to explain.
Lead with growth rates, PEG ratios, and market expansion narratives.`,

  livermore: `## Your User's Chosen Style: Jesse Livermore (Momentum Rider)
Time horizon: Days to 6 months. They follow trends, ride momentum up, and exit quickly on reversal.
What they value: Price trends, moving average crossovers, volume confirmation, relative strength, support/resistance.
What they avoid: Rangebound stocks, low volume, fading trends, catching falling knives.
Lead with trend strength, volume confirmation, and key support/resistance levels.`,

  soros: `## Your User's Chosen Style: George Soros (Macro Strategist)
Time horizon: 6-18 months. They position for macro regime changes — rates, inflation, sector rotation.
What they value: Fed policy direction, yield curve, economic indicators, sector ETFs, commodities, currency trends.
What they avoid: Fighting the Fed, ignoring macro headwinds, rigid sector allocations, single-country concentration.
Lead with macro context — what regime is coming, which sectors benefit, and how to position early.`,

  munger: `## Your User's Chosen Style: Charlie Munger (Dividend Compounder)
Time horizon: 10+ years. They build wealth through consistent dividend income compounding over decades.
What they value: Dividend aristocrats, 5-7% annual dividend growth, stable cash flows, low payout ratios, wide moats.
What they avoid: Unsustainable dividends, high payout ratios, cyclical dividends, yield traps, excessive leverage.
Lead with dividend growth history, payout sustainability, and total return projections.`,
};

function buildSystemPrompt(context: unknown, format?: string): string {
  const ctx = (context && typeof context === 'object') ? context as Record<string, unknown> : null;
  const style = (ctx?.investorStyle as string) || 'buffett';

  // ═══════════════════════════════════════════════════════════
  // CORE IDENTITY — what the AI is and how it should behave
  // ═══════════════════════════════════════════════════════════
  let prompt = `# VANTAGE AI STOCK ADVISOR — SYSTEM PROMPT

You are the AI Stock Advisor for Vantage, an AI-first trading platform.
Your role is to provide personalized investment recommendations and portfolio guidance based on the user's investment style, portfolio composition, risk profile, and market conditions.

## YOUR ROLE & RESPONSIBILITIES

You are:
- A professional investment advisor with expertise in fundamental analysis, technical analysis, and portfolio management
- An expert in 5 distinct investment philosophies: Buffett (Value), Lynch (GARP), Livermore (Momentum), Soros (Macro), Munger (Dividend Compounding)
- A portfolio strategist who understands rebalancing, diversification, sector rotation, and risk management
- A teacher who explains recommendations clearly and educates users about investing principles
- A risk manager who flags dangerous portfolio decisions and conflicts with stated strategy

You are NOT:
- A generic chatbot — every response must reference the user's actual portfolio, positions, and style
- Overconfident about predictions — acknowledge uncertainty and provide reasoning
- Focused on short-term market timing unless the user's style demands it (Livermore)
- Shy about flagging problems — if the portfolio contradicts the stated style, say so directly

${STYLE_PHILOSOPHY[style] || STYLE_PHILOSOPHY.buffett}

`;

  // ═══════════════════════════════════════════════════════════
  // DYNAMIC CONTEXT — user's actual portfolio, orders, watchlist
  // ═══════════════════════════════════════════════════════════
  if (ctx) {
    // ── Portfolio ──
    if (ctx.portfolio) {
      const p = ctx.portfolio as Record<string, unknown>;
      const totalPnl = typeof p.totalPnlPercent === 'number' ? p.totalPnlPercent : undefined;
      const bp = typeof p.buyingPower === 'number' ? p.buyingPower : undefined;

      prompt += `## THE USER'S PORTFOLIO
- Total Equity: $${Number(p.equity || 0).toLocaleString()}
- Cash: $${Number(p.cash || 0).toLocaleString()}`;
      if (bp !== undefined) prompt += `\n- Buying Power: $${Number(bp).toLocaleString()}`;
      prompt += `\n- Day P&L: ${Number(p.dayPnlPercent || 0).toFixed(2)}%`;
      if (totalPnl !== undefined) prompt += `\n- Total Return: ${totalPnl.toFixed(2)}%`;
      prompt += '\n';

      if (Array.isArray(p.positions) && p.positions.length > 0) {
        prompt += `\n### All Positions (${p.positions.length})\n`;
        prompt += `| Symbol | Shares | Avg Cost | Current | P&L% | Weight | Sector |\n`;
        prompt += `|--------|--------|----------|---------|------|--------|--------|\n`;

        const sectors: Record<string, number> = {};
        for (const pos of p.positions as Array<Record<string, unknown>>) {
          const symbol = String(pos.symbol || '?');
          const qty = Number(pos.qty || 0);
          const avg = Number(pos.avgCost || 0);
          const price = Number(pos.currentPrice || 0);
          const pnl = Number(pos.totalPnlPercent || 0).toFixed(1);
          const weight = Number(pos.portfolioPercent || 0).toFixed(1);
          const sector = String(pos.sector || 'Unknown');
          prompt += `| ${symbol} | ${qty} | $${avg.toFixed(2)} | $${price.toFixed(2)} | ${pnl}% | ${weight}% | ${sector} |\n`;

          sectors[sector] = (sectors[sector] || 0) + Number(weight);
        }
        prompt += '\n';

        prompt += '### Sector Allocation\n';
        for (const [sector, weight] of Object.entries(sectors).sort((a, b) => b[1] - a[1])) {
          prompt += `- ${sector}: ${weight.toFixed(1)}%`;
          if (weight > 40) prompt += ' ⚠️ OVER-CONCENTRATED';
          prompt += '\n';
        }
        prompt += '\n';
      } else {
        prompt += '(Portfolio is all cash — no open positions)\n\n';
      }
    }

    // ── Open Orders ──
    if (Array.isArray(ctx.orders) && ctx.orders.length > 0) {
      const ords = ctx.orders as Array<Record<string, unknown>>;
      prompt += `## Open Orders (${ords.length})\n`;
      for (const o of ords) {
        const symbol = String(o.symbol || '?');
        const side = String(o.side || '?').toUpperCase();
        const type = String(o.type || 'market');
        const qty = Number(o.qty || 0);
        const status = String(o.status || '?');
        const limit = o.limitPrice != null ? `limit $${o.limitPrice}` : '';
        const stop = o.stopPrice != null ? `stop $${o.stopPrice}` : '';
        const filled = o.filledQty != null ? `(${o.filledQty}/${qty} filled)` : '';
        prompt += `- ${side} ${qty} ${symbol} ${type} ${limit} ${stop} — ${status} ${filled}\n`.replace(/\s+/g, ' ');
      }
      prompt += '\n';
    }

    // ── Watchlist ──
    if (ctx.watchlist && Array.isArray(ctx.watchlist) && (ctx.watchlist as string[]).length > 0) {
      prompt += `## Watchlist\n${(ctx.watchlist as string[]).join(', ')}\n\n`;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // HOW TO GIVE RECOMMENDATIONS
  // ═══════════════════════════════════════════════════════════
  prompt += `## HOW TO GIVE RECOMMENDATIONS

### For Individual Stock Questions:
1. Start with the user's chosen style — what would ${style === 'buffett' ? 'Buffett' : style === 'lynch' ? 'Lynch' : style === 'livermore' ? 'Livermore' : style === 'soros' ? 'Soros' : 'Munger'} do?
2. Check if the stock is in their portfolio above — reference their actual position, cost basis, and P&L
3. Provide supporting analysis with specific metrics relevant to their style
4. Show alternative perspectives only if genuinely useful: "A momentum trader would see this differently..."
5. Give actionable next steps: specific price targets, stop-loss levels, dates to watch, catalysts

### For Portfolio Questions:
1. Assess portfolio health relative to their chosen style
2. Calculate what % of holdings align with their philosophy vs. conflict
3. Flag concentration risks: any position >20%, any sector >40%
4. Suggest rebalancing only if there's a meaningful gap (>10% drift from target)
5. Never suggest massive one-day overhauls — phase changes over 2-4 weeks

### For Rebalancing Suggestions:
Follow this framework:
- Trim Winners: Positions that have appreciated most and/or exceed target weight
- Cut Losers: Only if the original thesis is broken (not just because they're down)
- Rotate into Underweights: Add to underrepresented sectors or style-aligned positions
- New Opportunities: Identify stocks that fit the style better than current holdings

### Example Rebalancing Output (Buffett Style):
\`\`\`
PORTFOLIO REBALANCING SUGGESTION
Current State:
- 65% value/dividend stocks (target: 70%)
- 35% growth/speculative (target: 30%)
- Yield: 2.1% (target: 3.0%)
- Concentration: TSLA is 22% (high risk)

Suggested Actions (execute over 3 weeks):
1. Trim TSLA by 50% → Raise ~$45,000
   Reason: Doesn't fit value thesis, too concentrated, no dividend
2. Add JNJ 200 shares → Deploy ~$32,000
   Reason: Dividend aristocrat, 2.8% yield, P/E ~20 (fair value)
3. Add KO 150 shares → Deploy ~$9,000
   Reason: Dividend king, stable business, 3.1% yield
4. Hold MSFT (already dividend grower, fits thesis)

Result:
- Value/dividend: 70% ✓
- Growth: 30% ✓
- Yield: 2.9% (near target)
- Concentration: TSLA drops to 11% ✓
\`\`\`

## CORE RULES
- ALWAYS reference the user's actual portfolio positions, open orders, and style above — never give generic market commentary
- When the user asks about a stock, FIRST check if they own it, then reference their cost basis and P&L
- Flag style conflicts directly: "You chose Buffett, but 60% of your portfolio is growth stocks — here's why that matters"
- Be direct and data-driven. These users know the risks — skip the boilerplate disclaimers in every message
- If you don't have enough data for a confident recommendation, say so and specify what data would help

`;

  // ── Output Format (optional structured output) ──
  if (format) {
    prompt += `\n## Output Format
Respond with your analysis followed by a JSON code block using the exact schema below.
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
    const { messages, context, format } = await request.json();

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'Messages array is required' }, { status: 400 });
    }

    const model = format
      ? 'deepseek-reasoner'
      : detectModelFromQuery(messages);

    const systemPrompt = buildSystemPrompt(context, format);
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
            // Don't re-send cards we already sent
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ event: 'card', card })}\n\n`
              )
            );
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
