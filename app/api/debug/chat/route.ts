// GET /api/debug/chat — Full chat flow diagnostic
// Tests the EXACT same code path as /api/chat but returns full tracing
import { NextResponse } from 'next/server';
import { getAIProvider, callAI, isAIAvailable } from '@/lib/ai-provider';

export async function GET() {
  const steps: string[] = [];
  const errors: string[] = [];

  const provider = getAIProvider();
  steps.push(`Active provider: ${provider.name}`);
  steps.push(`AI available: ${isAIAvailable()}`);
  steps.push(`DEEPSEEK_API_KEY: ${process.env.DEEPSEEK_API_KEY ? 'set' : 'NOT SET'}`);
  steps.push(`CLAUDE_API_KEY: ${process.env.CLAUDE_API_KEY ? 'set' : 'NOT SET'}`);
  steps.push(`ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? 'set' : 'NOT SET'}`);
  steps.push(`OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? 'set' : 'NOT SET'}`);
  steps.push(`AI_PROVIDER: ${process.env.AI_PROVIDER || 'deepseek (default)'}`);

  if (!isAIAvailable()) {
    return NextResponse.json({ diagnosis: 'No AI provider configured', steps, errors }, { status: 500 });
  }

  // Test 1: Non-streaming call via provider
  steps.push('Testing AI provider (non-streaming)...');
  try {
    const response = await callAI({
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 5,
    });
    steps.push(`Non-streaming: model=${response.model}, tokens=${response.tokensUsed}, content="${response.content.slice(0, 80)}"`);
  } catch (e: any) {
    errors.push(`Non-streaming error: ${e.message}`);
  }

  // Test 2: Streaming via provider
  steps.push('Testing AI provider (streaming)...');
  let streamOk = false;
  try {
    const { stream, model: streamModel } = await getAIProvider().stream({
      messages: [{ role: 'user', content: 'say hi' }],
      maxTokens: 10,
    });
    steps.push(`Streaming: model=${streamModel}, stream obtained`);
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (let i = 0; i < 5; i++) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }
    reader.cancel();
    steps.push(`Stream data (first 200 chars): ${buffer.slice(0, 200)}`);
    streamOk = buffer.length > 0;
  } catch (e: any) {
    errors.push(`Streaming error: ${e.message}`);
  }

  // Test 3: Chat route integration (self-call)
  steps.push('Testing chat route integration...');
  try {
    const chatRes = await fetch('https://vantage-ai-trading.vercel.app/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
      signal: AbortSignal.timeout(20000),
    });
    const chatBody = await chatRes.text().catch(() => '');
    const isStreaming = chatBody.includes('data:') && chatBody.includes('event');
    const isFallback = chatBody.includes('unreachable') || chatBody.includes('unavailable');
    const isError = chatBody.includes('"error"');
    steps.push(`Chat route: HTTP ${chatRes.status}, streaming: ${isStreaming}, fallback: ${isFallback}, error: ${isError}`);
    steps.push(`Chat response (first 300 chars): ${chatBody.slice(0, 300)}`);
    if (isFallback) errors.push('CHAT ROUTE RETURNED FALLBACK MESSAGE');
    if (isError) errors.push('CHAT ROUTE RETURNED ERROR');
  } catch (e: any) {
    errors.push(`Chat route self-call error: ${e.message}`);
  }

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    conclusion: errors.length === 0 ? (
      streamOk ? 'All providers working. Chat should function normally.' :
      'Provider works but streaming may have issues. Check Vercel timeout settings.'
    ) : errors.join(' | '),
    streamOk,
    steps,
    errors,
  });
}
