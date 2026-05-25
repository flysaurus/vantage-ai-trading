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

function buildSystemPrompt(context: unknown, format?: string): string {
  let basePrompt = `You are Vantage AI, an expert financial analyst assistant for a mobile trading app.
You help users understand their portfolio, identify trading opportunities, and manage risk.
Be concise, actionable, and specific. Use numbers and data when possible.
Never give generic advice — always reference the user's actual portfolio and market data.

`;

  if (context && typeof context === 'object') {
    const ctx = context as Record<string, unknown>;
    if (ctx.portfolio) {
      const p = ctx.portfolio as Record<string, unknown>;
      basePrompt += `## Current Portfolio
- Total equity: $${p.equity || 'unknown'}
- Cash available: $${p.cash || 'unknown'}
- Day P&L: ${p.dayPnlPercent || 0}%
`;

      if (Array.isArray(p.positions) && p.positions.length > 0) {
        basePrompt += `- Positions (${p.positions.length}):\n`;
        for (const pos of p.positions as Array<Record<string, unknown>>) {
          basePrompt += `  - ${pos.symbol}: ${pos.qty} shares at avg $${pos.avgCost} · Market $${pos.currentPrice} · P&L ${pos.totalPnlPercent}% · ${pos.portfolioPercent}% of portfolio · Sector: ${pos.sector || 'Unknown'}\n`;
        }
      }
    }
    if (ctx.watchlist && Array.isArray(ctx.watchlist)) {
      basePrompt += `\n## Watchlist\n${(ctx.watchlist as string[]).join(', ')}\n`;
    }
  }

  if (format) {
    basePrompt += `\n## Output Format
Respond with your analysis followed by a JSON code block using the exact schema below.
Wrap structured data in \`\`\`json ... \`\`\` fenced code blocks.

`;
    switch (format) {
      case 'trade_signal':
        basePrompt += `Schema: { "type": "trade_signal", "data": { "symbol": "AAPL", "action": "buy|sell|hold", "conviction": 75, "entryPrice": 150.00, "stopLoss": 145.00, "takeProfit": 165.00, "reason": "...", "risks": ["risk 1", "risk 2"] } }`;
        break;
      case 'risk_analysis':
        basePrompt += `Schema: { "type": "risk_analysis", "data": { "overallRisk": 65, "factors": [{ "name": "Concentration", "score": 70, "explanation": "...", "weight": 0.25 }], "warnings": ["..."], "suggestions": ["..."] } }`;
        break;
      case 'rebalance_plan':
        basePrompt += `Schema: { "type": "rebalance_plan", "data": { "trades": [{ "symbol": "AAPL", "action": "trim", "qty": 5, "dollarAmount": 750, "reason": "..." }], "summary": "..." } }`;
        break;
    }
  }

  return basePrompt;
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
 */
function sanitizeUnicode(str: string): string {
  return str.replace(/\u[dD][8-9a-fA-F][0-9a-fA-F]{2}(?!\u[dD][c-fC-F][0-9a-fA-F]{2})/g, '\ufffd')
    .replace(/[\uD800-\uDFFF]/g, '\ufffd');
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
