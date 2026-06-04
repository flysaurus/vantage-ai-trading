// ─── AI Provider Debug Endpoint ────────────────────────────
// Tests connectivity through the AI provider abstraction.
// Returns: status codes, error details, and latency per provider.
// Access: GET /api/debug/ai

import { NextResponse } from 'next/server';
import { callAI, getAIProvider, ClaudeProvider } from '@/lib/ai-provider';

interface ProviderResult {
  available: boolean;
  status: number | null;
  latencyMs: number | null;
  error: string | null;
}

async function testProviderCall(
  label: string,
  model: string,
  timeoutMs: number
): Promise<ProviderResult> {
  const start = Date.now();
  try {
    const response = await callAI({
      messages: [{ role: 'user', content: 'ping' }],
      model,
      maxTokens: 1,
      timeoutMs,
    });
    return {
      available: true,
      status: 200,
      latencyMs: Date.now() - start,
      error: null,
    };
  } catch (e: any) {
    return {
      available: false,
      status: null,
      latencyMs: Date.now() - start,
      error: e?.message || String(e),
    };
  }
}

async function testClaudeCall(model: string): Promise<ProviderResult> {
  const start = Date.now();
  try {
    const provider = new ClaudeProvider(model);
    const response = await provider.call({
      messages: [{ role: 'user', content: 'ping' }],
      maxTokens: 1,
      timeoutMs: 15000,
    });
    return {
      available: true,
      status: 200,
      latencyMs: Date.now() - start,
      error: null,
    };
  } catch (e: any) {
    return {
      available: false,
      status: null,
      latencyMs: Date.now() - start,
      error: e?.message || String(e),
    };
  }
}

export async function GET() {
  const provider = getAIProvider();
  const results: Record<string, ProviderResult> = {};
  const keys: Record<string, boolean> = {
    DEEPSEEK_API_KEY: !!process.env.DEEPSEEK_API_KEY,
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
    CLAUDE_API_KEY: !!process.env.CLAUDE_API_KEY,
    OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
  };

  // Test active provider with its models
  if (provider.name === 'deepseek') {
    results.deepseekChat = await testProviderCall('deepseek-chat', 'deepseek-chat', 15000);
    results.deepseekReasoner = await testProviderCall('deepseek-reasoner', 'deepseek-reasoner', 30000);
  } else if (provider.name === 'claude') {
    results.claude = await testProviderCall('claude', undefined as any, 15000);
  } else if (provider.name === 'openai') {
    results.openai = await testProviderCall('openai', undefined as any, 15000);
  }

  // Always test Claude too — the chat route uses Claude directly via callChatAI/callAnalystAI
  // regardless of AI_PROVIDER setting
  if (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY) {
    results.claudeHaiku = await testClaudeCall('claude-haiku-4-20250514');
    results.claudeSonnet = await testClaudeCall('claude-sonnet-4-20250514');
  }

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    activeProvider: provider.name,
    keys,
    results,
  });
}
