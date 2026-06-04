// ─── AI Usage Guard ───────────────────────────────────────────
// Daily usage limits per user + finance-only query filter.
// Server-side only — uses createServerClient for Supabase access.

import { createServerClient } from '@/lib/supabase';

// ─── Daily Limits ────────────────────────────────────────────

const DAILY_LIMITS = {
  messages: 20,
  deepAnalysis: 5,
};

export async function checkUsageLimit(
  userId: string,
  type: 'message' | 'deepAnalysis'
): Promise<{
  allowed: boolean;
  remaining: number;
  resetsIn: string;
}> {
  const today = new Date().toISOString().split('T')[0];
  const supabase = createServerClient();

  let count = 0;
  try {
    const { data } = await (supabase as any)
      .from('ai_usage')
      .select('message_count, deep_analysis_count')
      .eq('user_id', userId)
      .eq('date', today)
      .single();
    count =
      type === 'message'
        ? (data?.message_count || 0)
        : (data?.deep_analysis_count || 0);
  } catch {
    // Table may not exist yet — allow unlimited until migration runs
    count = 0;
  }

  const limit =
    type === 'message'
      ? DAILY_LIMITS.messages
      : DAILY_LIMITS.deepAnalysis;

  const allowed = count < limit;
  const remaining = Math.max(0, limit - count);

  const now = new Date();
  const midnight = new Date();
  midnight.setUTCHours(24, 0, 0, 0);
  const diffMs = midnight.getTime() - now.getTime();
  const diffHrs = Math.floor(diffMs / 3600000);
  const diffMins = Math.floor((diffMs % 3600000) / 60000);
  const resetsIn = `${diffHrs}h ${diffMins}m`;

  return { allowed, remaining, resetsIn };
}

export async function incrementUsage(
  userId: string,
  type: 'message' | 'deepAnalysis',
  tokensUsed?: number,
  costUsd?: number
): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const supabase = createServerClient();

  try {
    await (supabase as any).rpc('increment_ai_usage', {
      p_user_id: userId,
      p_date: today,
      p_message_increment: type === 'message' ? 1 : 0,
      p_analysis_increment: type === 'deepAnalysis' ? 1 : 0,
      p_tokens: tokensUsed || 0,
      p_cost: costUsd || 0,
    });
  } catch {
    // RPC or table may not exist — fail silently, limit tracking is non-critical
    console.warn('[ai-guard] increment_ai_usage RPC not available — skipping');
  }
}

// ─── Finance-Only Guard ──────────────────────────────────────

const FINANCE_KEYWORDS = [
  'portfolio', 'position', 'holding', 'allocation',
  'rebalance', 'diversif', 'concentration',
  'stock', 'share', 'equity', 'ticker', 'symbol',
  'buy', 'sell', 'trade', 'invest',
  'market', 'sector', 'industry', 'index', 'etf',
  'bull', 'bear', 'volatil', 'correction',
  'pe', 'eps', 'rsi', 'moving average', 'technical',
  'fundamental', 'valuation', 'earnings', 'revenue',
  'margin', 'growth', 'dividend', 'yield',
  'tax', 'harvest', 'gain', 'loss', 'return',
  'risk', 'hedge', 'bond', 'rate', 'inflation',
  'aapl', 'msft', 'googl', 'meta', 'nvda', 'amzn',
  'spy', 'qqq', 'fed', 'gdp', 'nasdaq', 'dow',
  'basket', 'theme', 'analyst', 'research',
  'vantage', 'advisor', 'recommendation', 'health',
  'opportunity', 'momentum', 'value',
];

const NON_FINANCE_TOPICS = [
  'recipe', 'cook', 'weather', 'sport', 'game',
  'movie', 'music', 'travel', 'hotel', 'flight',
  'relationship', 'doctor', 'medical symptom',
  'write essay', 'write poem', 'write story',
  'joke', 'funny', 'meme', 'social media post',
  'homework', 'math problem', 'history essay',
];

export function isFinanceQuery(message: string): boolean {
  const lower = message.toLowerCase();

  const hasNonFinance = NON_FINANCE_TOPICS.some((kw) =>
    lower.includes(kw)
  );
  const hasFinance = FINANCE_KEYWORDS.some((kw) =>
    lower.includes(kw)
  );

  if (hasNonFinance && !hasFinance) return false;
  if (hasFinance) return true;
  if (message.trim().length < 20) return true;
  return true;
}

export const NON_FINANCE_RESPONSE = `
Vantage AI is a specialized financial advisor focused on:
- Portfolio analysis and health checks
- Stock and ETF research
- Market trends and sector analysis
- Thematic basket investing
- Investment strategy and risk assessment
- Tax efficiency opportunities

Please ask me about your portfolio, specific securities, or market conditions.`;
