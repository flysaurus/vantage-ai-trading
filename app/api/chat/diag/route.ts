import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { VANTAGE_SYSTEM_PROMPT } from '@/lib/ai-system-prompt';
import { resolveSymbol } from '@/lib/tools/resolve-symbol';

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
  const dateContext = `\nAUTHORITATIVE CURRENT DATE: ${currentDate} (in user's timezone).`;

  const systemBlocks = [
    { type: 'text' as const, text: VANTAGE_SYSTEM_PROMPT },
    { type: 'text' as const, text: dateContext },
  ];

  // Test 1: Non-streaming create() — baseline
  const create = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    system: systemBlocks as any,
    messages: [{ role: 'user' as const, content: "Let's buy some more so Hynix" }],
    tools: [resolveSymbolTool],
    tool_choice: { type: 'auto' },
  });
  const createBlocks = create.content.map((b: any) => b.type === 'tool_use' ? { type: 'tool_use', name: b.name, input: b.input } : { type: 'text', text: b.text?.slice(0, 200) });

  // Test 2: Streaming — same as chat route
  const stream = client.messages.stream({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    system: systemBlocks as any,
    messages: [{ role: 'user' as const, content: "Let's buy some more so Hynix" }],
    tools: [resolveSymbolTool],
    tool_choice: { type: 'auto' },
  });

  let streamText = '';
  const streamToolBlocks: any[] = [];
  let currentTool: any = null;
  let hadToolCalls = false;

  for await (const chunk of stream) {
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
    }
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'input_json_delta') {
      if (currentTool) currentTool.inputJson += (chunk.delta as any).partial_json;
    }
    if (chunk.type === 'content_block_stop') {
      if (currentTool?.id) {
        try {
          streamToolBlocks.push({ id: currentTool.id, name: currentTool.name, input: JSON.parse(currentTool.inputJson) });
        } catch (e) { streamToolBlocks.push({ error: (e as Error).message, raw: currentTool.inputJson }); }
        currentTool = null;
      }
    }
  }

  // Test 3: Full 2-turn simulation via streaming
  let turn2Text = '';
  if (streamToolBlocks.length > 0) {
    const toolResult = await resolveSymbol(streamToolBlocks[0].input.companyName || '');
    const stream2 = client.messages.stream({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: systemBlocks as any,
      messages: [
        { role: 'user' as const, content: "Let's buy some more so Hynix" },
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
    nonStreaming_blocks: createBlocks,
    streaming_hadToolCalls: hadToolCalls,
    streaming_toolBlocks: streamToolBlocks.map((t: any) => ({ name: t.name, input: t.input })),
    streaming_text: streamText.slice(0, 200),
    streaming_turn2_hasMarker: turn2Text.includes('[RECOMMEND:'),
    streaming_turn2_text: turn2Text.slice(0, 300),
  });
}
