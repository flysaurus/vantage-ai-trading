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

export async function GET() {
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  const claudeKey = process.env.CLAUDE_API_KEY;

  const results: Record<string, ProviderResult> = {};

  // ── DeepSeek test ──
  const dsResult: ProviderResult = { available: false, status: null, latencyMs: null, error: null };
  if (!deepseekKey) {
    dsResult.error = 'DEEPSEEK_API_KEY not set';
  } else {
    const start = Date.now();
    try {
      const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${deepseekKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          stream: false,
        }),
        signal: AbortSignal.timeout(15000),
      });
      dsResult.status = res.status;
      dsResult.latencyMs = Date.now() - start;
      dsResult.available = res.status === 401 ? null as any : res.ok; // 401 = key issue, not "available"
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        dsResult.error = `HTTP ${res.status}: ${body.slice(0, 200)}`;
        if (res.status === 401) dsResult.error = 'API key rejected (401 Unauthorized)';
      }
    } catch (e: any) {
      dsResult.latencyMs = Date.now() - start;
      dsResult.error = e?.message || String(e);
    }
  }
  results.deepseek = dsResult;

  // ── Claude test ──
  const clResult: ProviderResult = { available: false, status: null, latencyMs: null, error: null };
  if (!claudeKey) {
    clResult.error = 'CLAUDE_API_KEY not set';
  } else {
    const start = Date.now();
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': claudeKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20250514',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
          stream: false,
        }),
        signal: AbortSignal.timeout(15000),
      });
      clResult.status = res.status;
      clResult.latencyMs = Date.now() - start;
      clResult.available = res.ok;
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        clResult.error = `HTTP ${res.status}: ${body.slice(0, 200)}`;
      }
    } catch (e: any) {
      clResult.latencyMs = Date.now() - start;
      clResult.error = e?.message || String(e);
    }
  }
  results.claude = clResult;

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    results,
  });
}
