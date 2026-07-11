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

  const userMessage = "Let's buy some more so Hynix";
  const systemBlocks = [
    { type: 'text' as const, text: VANTAGE_SYSTEM_PROMPT.replace('{date_context}', 'Saturday July 11 2026').replace('{profile_context}', '').replace('{portfolio_context}', '').replace('{additional_context}', '').replace('{search_context}', '').replace('{live_market_context}', '').replace('{deviation_context}', '') },
  ];

  // Test with Haiku (default for standard chat)
  const test1 = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    system: systemBlocks as any,
    messages: [{ role: 'user' as const, content: userMessage }],
    tools: [resolveSymbolTool],
    tool_choice: { type: 'auto' },
  });

  // Check if tool was called
  const toolCalls: any[] = [];
  let text = '';
  for (const block of test1.content) {
    if (block.type === 'text') text += block.text;
    if (block.type === 'tool_use') toolCalls.push({ name: block.name, input: block.input });
  }

  // If tool was called, do a second turn with the result
  let turn2: any = null;
  if (toolCalls.length > 0) {
    const { resolveSymbol } = await import('@/lib/tools/resolve-symbol');
    const toolResult = await resolveSymbol(toolCalls[0].input.companyName || '');

    const test2 = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: systemBlocks as any,
      messages: [
        { role: 'user' as const, content: userMessage },
        {
          role: 'assistant' as const,
          content: [
            { type: 'text' as const, text: text },
            { type: 'tool_use' as const, id: toolCalls[0].id || 'toolu_001', name: toolCalls[0].name, input: toolCalls[0].input },
          ],
        },
        {
          role: 'user' as const,
          content: [{ type: 'tool_result' as const, tool_use_id: toolCalls[0].id || 'toolu_001', content: toolResult }],
        },
      ],
    });
    const t2blocks: any[] = [];
    for (const block of test2.content) {
      if (block.type === 'text') t2blocks.push(block.text);
      if (block.type === 'tool_use') t2blocks.push({ name: block.name, input: block.input });
    }
    turn2 = { text: t2blocks.join(''), hasRecommendMarker: t2blocks.join('').includes('[RECOMMEND:') };
  }

  return NextResponse.json({
    model: 'claude-haiku-4-5',
    turn1_toolCalls: toolCalls.map((t: any) => ({ name: t.name, input: t.input })),
    turn1_text: text.slice(0, 300),
    turn1_textHasRecommendMarker: text.includes('[RECOMMEND:'),
    turn2,
  });
}
