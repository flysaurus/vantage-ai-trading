// ─── AI Provider Debug Endpoint ────────────────────────────
// Tests connectivity to DeepSeek and Claude APIs with configured keys.
// Returns: status codes, error details, and latency per provider.
// Access: GET /api/debug/ai
// ⚠️  Does NOT echo keys — only reports whether they're set.

import { NextResponse } from 'next/server';

interface ProviderResult {
  available: boolean;
  status: number | null;
  latencyMs: number | null;
  error: string | null;
}

async function testProvider(params: {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  timeoutMs: number;
}): Promise<ProviderResult> {
  const result: ProviderResult = { available: false, status: null, latencyMs: null, error: null };
  const start = Date.now();
  try {
    const res = await fetch(params.url, {
      method: 'POST',
      headers: params.headers,
      body: JSON.stringify(params.body),
      signal: AbortSignal.timeout(params.timeoutMs),
    });
    result.status = res.status;
    result.latencyMs = Date.now() - start;
    result.available = res.ok;
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      result.error = res.status === 401 ? 'API key rejected (401)' : `HTTP ${res.status}: ${body.slice(0, 200)}`;
    }
  } catch (e: any) {
    result.latencyMs = Date.now() - start;
    result.error = e?.message || String(e);
  }
  return result;
}

export async function GET() {
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  const claudeKey = process.env.CLAUDE_API_KEY;
  const results: Record<string, ProviderResult> = {};

  // ── DeepSeek Chat ──
  results.deepseekChat = deepseekKey
    ? await testProvider({
        url: 'https://api.deepseek.com/v1/chat/completions',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${deepseekKey}`,
        },
        body: { model: 'deepseek-chat', messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false },
        timeoutMs: 15000,
      })
    : { available: false, status: null, latencyMs: null, error: 'DEEPSEEK_API_KEY not set' };

  // ── DeepSeek Reasoner ──
  results.deepseekReasoner = deepseekKey
    ? await testProvider({
        url: 'https://api.deepseek.com/v1/chat/completions',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${deepseekKey}`,
        },
        body: { model: 'deepseek-reasoner', messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false },
        timeoutMs: 30000,
      })
    : { available: false, status: null, latencyMs: null, error: 'DEEPSEEK_API_KEY not set' };

  // ── Claude Haiku ──
  results.claudeHaiku = claudeKey
    ? await testProvider({
        url: 'https://api.anthropic.com/v1/messages',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': claudeKey,
          'anthropic-version': '2023-06-01',
        },
        body: { model: 'claude-3-5-haiku-latest', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }], stream: false },
        timeoutMs: 15000,
      })
    : { available: false, status: null, latencyMs: null, error: 'CLAUDE_API_KEY not set' };

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    results,
  });
}
