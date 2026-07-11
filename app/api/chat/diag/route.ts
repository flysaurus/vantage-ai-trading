import { NextResponse } from 'next/server';

export async function GET() {
  // Test 1: resolveSymbol
  let resolveResult: any = null;
  try {
    const { resolveSymbol } = await import('@/lib/tools/resolve-symbol');
    resolveResult = JSON.parse(await resolveSymbol('SK Hynix'));
  } catch(e: any) { resolveResult = { error: e.message }; }

  // Test 2: Check system prompt for RESOLVESYMBOL
  let systemPrompt: string = '';
  let hasResolveTool: boolean = false;
  try {
    const { buildSystemPrompt } = await import('@/lib/ai-system-prompt');
    systemPrompt = buildSystemPrompt('');
    hasResolveTool = systemPrompt.includes('RESOLVESYMBOL') || systemPrompt.includes('resolveSymbol');
  } catch(e: any) { systemPrompt = `ERROR: ${e.message}`; }

  // Test 3: Check tool config in chat route
  let toolConfig: any = null;
  try {
    // We can't import the chat route's tools config directly, but we can check exports
    const chatRoute = await import('@/app/api/chat/route');
    // Check for exported symbols
    const exports = Object.keys(chatRoute);
    toolConfig = { exports };
  } catch(e: any) { toolConfig = { error: e.message }; }

  return NextResponse.json({
    resolveSymbol: resolveResult,
    promptHasResolveTool: hasResolveTool,
    promptSnippet: systemPrompt.slice(
      systemPrompt.indexOf('RESOLVE') > -1 ? systemPrompt.indexOf('RESOLVE') - 100 : 0,
      systemPrompt.indexOf('RESOLVE') > -1 ? systemPrompt.indexOf('RESOLVE') + 500 : 200
    ),
    toolConfig,
    deployedAt: new Date().toISOString(),
  });
}
