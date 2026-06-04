// ═══════════════════════════════════════════════════════════════
// AI Provider Abstraction — single entry point for all AI model
// calls in Vantage. All AI calls go through this; never call
// any AI API directly from route handlers or lib code.
//
// Controlled by AI_PROVIDER env var: 'deepseek' | 'claude' | 'openai'
// ═══════════════════════════════════════════════════════════════

// ─── Types ────────────────────────────────────────────────────

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIRequestOptions {
  messages: AIMessage[];
  maxTokens?: number;
  temperature?: number;
  responseFormat?: 'text' | 'json';
  /** Model override — provider-specific (e.g. 'deepseek-reasoner', 'gpt-4o') */
  model?: string;
  /** Request timeout in ms */
  timeoutMs?: number;
}

export interface AIResponse {
  content: string;
  model: string;
  tokensUsed?: number;
  cached?: boolean;
}

export interface AIStreamResult {
  /** The raw streaming response body — caller pipes this to SSE */
  stream: ReadableStream<Uint8Array>;
  /** The model that actually served the request */
  model: string;
}

// ─── Base Provider Interface ─────────────────────────────────

export interface AIProvider {
  name: string;
  /** Non-streaming call — returns full response */
  call(options: AIRequestOptions): Promise<AIResponse>;
  /** Streaming call — returns a ReadableStream body */
  stream(options: AIRequestOptions): Promise<AIStreamResult>;
}

// ═══════════════════════════════════════════════════════════════
// PROVIDER IMPLEMENTATIONS
// ═══════════════════════════════════════════════════════════════

// ─── DeepSeek Provider ────────────────────────────────────────

export class DeepSeekProvider implements AIProvider {
  name = 'deepseek';

  async call(options: AIRequestOptions): Promise<AIResponse> {
    const model = options.model || 'deepseek-chat';

    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: options.messages,
        max_tokens: options.maxTokens ?? 1000,
        temperature: options.temperature ?? 0.3,
        stream: false,
        response_format: options.responseFormat === 'json'
          ? { type: 'json_object' }
          : { type: 'text' },
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 30000),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(`DeepSeek error: ${data.error?.message || `HTTP ${res.status}`}`);
    }

    return {
      content: data.choices[0].message.content,
      model: data.model || model,
      tokensUsed: data.usage?.total_tokens,
    };
  }

  async stream(options: AIRequestOptions): Promise<AIStreamResult> {
    const model = options.model || 'deepseek-chat';

    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: options.messages,
        max_tokens: options.maxTokens ?? 2048,
        temperature: options.temperature ?? 0.7,
        stream: true,
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 60000),
    });

    if (!res.ok || !res.body) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`DeepSeek ${model} ${res.status}: ${errBody.slice(0, 200)}`);
    }

    return { stream: res.body, model };
  }
}

// ─── Claude Provider ──────────────────────────────────────────

export class ClaudeProvider implements AIProvider {
  name = 'claude';
  private model: string;

  constructor(model: string = 'claude-sonnet-4-6') {
    this.model = model;
  }

  async call(options: AIRequestOptions): Promise<AIResponse> {
    const systemMessage = options.messages.find(m => m.role === 'system');
    const userMessages = options.messages.filter(m => m.role !== 'system');

    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY or CLAUDE_API_KEY');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: options.model || this.model,
        max_tokens: options.maxTokens ?? 1000,
        temperature: options.temperature ?? 0.3,
        system: systemMessage?.content || '',
        messages: userMessages.map(m => ({ role: m.role, content: m.content })),
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 30000),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(`Claude error: ${data.error?.message || `HTTP ${res.status}`}`);
    }

    return {
      content: data.content?.[0]?.text || '',
      model: data.model || this.model,
      tokensUsed: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
    };
  }

  async stream(options: AIRequestOptions): Promise<AIStreamResult> {
    const systemMessage = options.messages.find(m => m.role === 'system');
    const userMessages = options.messages.filter(m => m.role !== 'system');

    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY or CLAUDE_API_KEY');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: options.model || this.model,
        max_tokens: options.maxTokens ?? 2048,
        temperature: options.temperature ?? 0.7,
        system: systemMessage?.content || '',
        messages: userMessages.map(m => ({ role: m.role, content: m.content })),
        stream: true,
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 60000),
    });

    if (!res.ok || !res.body) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Claude stream ${res.status}: ${errBody.slice(0, 200)}`);
    }

    return { stream: res.body, model: options.model || this.model };
  }
}

// ─── OpenAI Provider ──────────────────────────────────────────

class OpenAIProvider implements AIProvider {
  name = 'openai';

  async call(options: AIRequestOptions): Promise<AIResponse> {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: options.model || 'gpt-4o',
        messages: options.messages,
        max_tokens: options.maxTokens ?? 1000,
        temperature: options.temperature ?? 0.3,
        response_format: options.responseFormat === 'json'
          ? { type: 'json_object' }
          : { type: 'text' },
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 30000),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(`OpenAI error: ${data.error?.message || `HTTP ${res.status}`}`);
    }

    return {
      content: data.choices[0].message.content,
      model: data.model || options.model || 'gpt-4o',
      tokensUsed: data.usage?.total_tokens,
    };
  }

  async stream(options: AIRequestOptions): Promise<AIStreamResult> {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: options.model || 'gpt-4o',
        messages: options.messages,
        max_tokens: options.maxTokens ?? 2048,
        temperature: options.temperature ?? 0.7,
        stream: true,
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 60000),
    });

    if (!res.ok || !res.body) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`OpenAI stream ${res.status}: ${errBody.slice(0, 200)}`);
    }

    return { stream: res.body, model: options.model || 'gpt-4o' };
  }
}

// ═══════════════════════════════════════════════════════════════
// PROVIDER FACTORY
// ═══════════════════════════════════════════════════════════════

export function getAIProvider(): AIProvider {
  const provider = process.env.AI_PROVIDER || 'deepseek';

  switch (provider) {
    case 'claude':
      return new ClaudeProvider();
    case 'openai':
      return new OpenAIProvider();
    case 'deepseek':
    default:
      return new DeepSeekProvider();
  }
}

// ═══════════════════════════════════════════════════════════════
// CONVENIENCE FUNCTIONS — model-specific routing
// ═══════════════════════════════════════════════════════════════

/**
 * Call Claude Sonnet for deep analysis work.
 * Higher quality, slower — use for portfolio health, risk checks, research.
 */
export async function callAnalystAI(
  options: AIRequestOptions
): Promise<AIResponse> {
  const provider = new ClaudeProvider('claude-sonnet-4-6');
  return provider.call({
    ...options,
    maxTokens: options.maxTokens || 1500,
    temperature: 0.2,
  });
}

/**
 * Call Claude Haiku for general chat.
 * Cheaper and faster for simple user queries.
 */
export async function callChatAI(
  options: AIRequestOptions
): Promise<AIResponse> {
  const provider = new ClaudeProvider('claude-haiku-4-5');
  return provider.call({
    ...options,
    maxTokens: options.maxTokens || 500,
    temperature: 0.2,
  });
}

// ═══════════════════════════════════════════════════════════════
// MAIN EXPORT — the only function allowed for AI calls
// ═══════════════════════════════════════════════════════════════

export async function callAI(options: AIRequestOptions): Promise<AIResponse> {
  const provider = getAIProvider();
  console.log(`🤖 [AI] Using provider: ${provider.name}`);

  try {
    const response = await provider.call(options);
    console.log(`✅ [AI] Response received | tokens: ${response.tokensUsed}`);
    return response;
  } catch (err: any) {
    console.error(`❌ [AI] Provider error:`, err.message);
    throw err;
  }
}

/** Streaming AI call — returns a raw stream body for SSE piping */
export async function streamAI(options: AIRequestOptions): Promise<AIStreamResult> {
  const provider = getAIProvider();
  console.log(`🤖 [AI] Streaming via: ${provider.name} | model: ${options.model}`);

  try {
    const result = await provider.stream(options);
    console.log(`✅ [AI] Stream opened | model: ${result.model}`);
    return result;
  } catch (err: any) {
    console.error(`❌ [AI] Stream error:`, err.message);
    throw err;
  }
}

/**
 * Checks whether any AI provider is configured.
 * Returns false if no provider API keys are set.
 */
export function isAIAvailable(): boolean {
  const provider = process.env.AI_PROVIDER || 'deepseek';
  switch (provider) {
    case 'claude':
      return !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);
    case 'openai':
      return !!process.env.OPENAI_API_KEY;
    case 'deepseek':
    default:
      return !!process.env.DEEPSEEK_API_KEY;
  }
}
