import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { VANTAGE_SYSTEM_PROMPT } from '@/lib/ai-system-prompt';

export async function GET() {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY!,
    defaultHeaders: { 'anthropic-beta': 'prompt-caching-2024-07-31' },
  });

  const resolveSymbolTool: Anthropic.Tool = {
    name: 'resolveSymbol',
    description: 'Resolve a company name to its authoritative stock ticker symbol(s). Use this BEFORE recommending any stock to verify the correct ticker.',
    input_schema: {
      type: 'object' as const,
      properties: {
        companyName: { type: 'string', description: 'The company name to look up (e.g., "SK Hynix", "Apple")' },
      },
      required: ['companyName'],
    },
  };

  const currentDate = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/New_York' });
  const dateContext = `\nAUTHORITATIVE CURRENT DATE: ${currentDate} (in user's timezone). Treat this as ground truth.`;

  // Simulate the EXACT context the chat route would build
  // 1. Finnhub search for "SK Hynix" → returns 000660.KS
  const searchContext = '';
  const liveMarketContext = `
📡 LIVE MARKET DATA (real-time via Finnhub — AUTHORITATIVE):
000660.KS: $168.01 | +$3.20 (+1.9%) | Day: $165.00–$169.50 | Prev close: $164.81 | Source: finnhub

CRITICAL: Use these live prices for any current-price questions. They override both training data AND web search results for current stock prices.
`;

  // Simulate portfolio context (has existing SKX position)
  const portfolioContext = `
PORTFOLIO:
Cash: $45,230.00
Positions:
- SKX: 200 shares @ $159.20 avg, current $161.85, total value $32,370.00, P&L +$530.00
- AAPL: 50 shares @ $195.50 avg, current $232.75, total value $11,637.50, P&L +$1,862.50

PENDING ORDERS:
- SKX: BUY 74 shares limit $162.00 (Monday 9:30 AM ET)
`;

  const systemBlocks = [
    { type: 'text' as const, text: VANTAGE_SYSTEM_PROMPT },
    { type: 'text' as const, text: [dateContext, portfolioContext, liveMarketContext].join('\n\n') },
  ];

  const messages = [
    { role: 'assistant' as const, content: "Your existing SKX (SK Hynix ADR) position is up nicely. What's your next move — adding more, trimming, or holding?" },
    { role: 'user' as const, content: "Let's buy some more so Hynix" },
  ];

  // Test with streaming (exact chat route simulation)
  const stream = client.messages.stream({
    model: 'claude-haiku-4-5',
    max_tokens: 2048,
    system: systemBlocks as any,
    messages: messages,
    tools: [resolveSymbolTool],
    tool_choice: { type: 'auto' },
  });

  let streamText = '';
  const streamToolBlocks: any[] = [];
  let currentTool: any = null;
  let hadToolCalls = false;
  let allEvents: string[] = [];

  for await (const chunk of stream) {
    allEvents.push(chunk.type);
    if (chunk.type === 'message_delta') {
      if ((chunk as any).delta?.stop_reason === 'tool_use') hadToolCalls = true;
    }
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
      streamText += chunk.delta.text;
    }
    if (chunk.type === 'content_block_start') {
      const block = (chunk as any).content_block;
      if (block?.type === 'tool_use') {
        hadToolCalls = true;
        currentTool = { id: block.id, name: block.name, inputJson: '' };
      }
      allEvents.push('content_block_start:' + block?.type);
    }
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'input_json_delta') {
      if (currentTool) currentTool.inputJson += (chunk.delta as any).partial_json;
    }
    if (chunk.type === 'content_block_stop') {
      if (currentTool?.id) {
        try {
          streamToolBlocks.push({ id: currentTool.id, name: currentTool.name, input: JSON.parse(currentTool.inputJson) });
        } catch (e: any) { streamToolBlocks.push({ error: e.message }); }
        currentTool = null;
      }
    }
  }

  // If tool called, do turn 2
  let turn2Text = '';
  if (streamToolBlocks.length > 0) {
    const { resolveSymbol } = await import('@/lib/tools/resolve-symbol');
    const toolResult = await resolveSymbol(streamToolBlocks[0].input.companyName || '');
    const r = JSON.parse(toolResult);
    
    const stream2 = client.messages.stream({
      model: 'claude-haiku-4-5',
      max_tokens: 2048,
      system: systemBlocks as any,
      messages: [
        ...messages,
        { role: 'assistant' as const, content: [
          ...(streamText ? [{ type: 'text' as const, text: streamText }] : []),
          { type: 'tool_use' as const, id: streamToolBlocks[0].id, name: streamToolBlocks[0].name, input: streamToolBlocks[0].input },
        ]},
        { role: 'user' as const, content: [{ type: 'tool_result' as const, tool_use_id: streamToolBlocks[0].id, content: toolResult }]},
      ],
    });
    for await (const chunk of stream2) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        turn2Text += chunk.delta.text;
      }
    }
  }

  return NextResponse.json({
    hadToolCalls,
    toolCalls: streamToolBlocks.map((t: any) => ({ name: t.name, input: t.input })),
    turn1_text: streamText.slice(0, 200),
    turn1_mentionsSKX: streamText.includes('SKX'),
    turn1_mentionsSKHYV: streamText.includes('SKHYV'),
    turn2_text: turn2Text.slice(0, 500),
    turn2_hasMarker: turn2Text.includes('[RECOMMEND:'),
    turn2_hasSKHYV: turn2Text.includes('SKHYV'),
    turn2_hasSKX: turn2Text.includes('SKX'),
  });
}
