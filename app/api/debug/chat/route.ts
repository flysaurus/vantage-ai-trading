// GET /api/debug/chat — Full chat flow diagnostic
// Tests the EXACT same code path as /api/chat but returns full tracing
import { NextResponse } from 'next/server';

export async function GET() {
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  const claudeKey = process.env.CLAUDE_API_KEY;
  const steps: string[] = [];
  const errors: string[] = [];

  steps.push(`DEEPSEEK_API_KEY: ${deepseekKey ? 'set (prefix: ' + deepseekKey.slice(0, 6) + '...)' : 'NOT SET'}`);
  steps.push(`CLAUDE_API_KEY: ${claudeKey ? 'set (prefix: ' + claudeKey.slice(0, 6) + '...)' : 'NOT SET'}`);

  if (!deepseekKey) {
    return NextResponse.json({ diagnosis: 'DEEPSEEK_API_KEY not set', steps, errors }, { status: 500 });
  }

  // Test 1: DeepSeek simple connectivity
  steps.push('Testing DeepSeek connectivity...');
  try {
    const dsRes = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deepseekKey}` },
      body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }], max_tokens: 5, stream: false }),
      signal: AbortSignal.timeout(10000),
    });
    const body = await dsRes.text().catch(() => '');
    steps.push(`DeepSeek non-streaming: HTTP ${dsRes.status}, body: ${body.slice(0, 150)}`);
    if (!dsRes.ok) errors.push(`DeepSeek non-streaming returned ${dsRes.status}`);
  } catch (e: any) {
    errors.push(`DeepSeek non-streaming error: ${e.message}`);
  }

  // Test 2: DeepSeek streaming
  steps.push('Testing DeepSeek streaming...');
  let streamOk = false;
  try {
    const dsStreamRes = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deepseekKey}` },
      body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'say hi' }], stream: true, max_tokens: 10 }),
      signal: AbortSignal.timeout(15000),
    });
    steps.push(`DeepSeek streaming: HTTP ${dsStreamRes.status}, has body: ${!!dsStreamRes.body}`);
    if (!dsStreamRes.ok) {
      const errBody = await dsStreamRes.text().catch(() => '');
      errors.push(`DeepSeek streaming returned ${dsStreamRes.status}: ${errBody.slice(0, 200)}`);
    } else if (!dsStreamRes.body) {
      errors.push('DeepSeek streaming: response body is null');
    } else {
      const reader = dsStreamRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (let i = 0; i < 5; i++) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
      }
      reader.cancel();
      steps.push(`DeepSeek stream data (first 200 chars): ${buffer.slice(0, 200)}`);
      streamOk = buffer.length > 0;
    }
  } catch (e: any) {
    errors.push(`DeepSeek streaming error: ${e.message}`);
  }

  // Test 3: Claude connectivity
  if (claudeKey) {
    steps.push('Testing Claude connectivity...');
    try {
      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': claudeKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ model: 'claude-3-haiku-20240307', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
        signal: AbortSignal.timeout(10000),
      });
      const claudeBody = await claudeRes.text().catch(() => '');
      steps.push(`Claude: HTTP ${claudeRes.status}, body: ${claudeBody.slice(0, 150)}`);
      if (!claudeRes.ok) errors.push(`Claude returned ${claudeRes.status}: ${claudeBody.slice(0, 200)}`);
    } catch (e: any) {
      errors.push(`Claude error: ${e.message}`);
    }
  } else {
    steps.push('Claude: skipped (key not set)');
  }

  // Test 4: Chat route integration (self-call)
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
      streamOk ? 'All providers working. Chat should function normally. Try hard-refreshing the page (Ctrl+Shift+R).' :
      'DeepSeek connectivity works but streaming may have issues. Check Vercel function timeout settings.'
    ) : errors.join(' | '),
    streamOk,
    steps,
    errors,
  });
}
