// ─── AI Usage Guard ───────────────────────────────────────────
// Daily usage limits per user + finance-only query filter.
// Server-side only — uses createServerClient for Supabase access.

import { createServerClient } from '@/lib/supabase';

// ─── Daily Limits ────────────────────────────────────────────
// (limits are defined inline in checkUsageLimit — 75 messages, 20 deepAnalysis)

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

  const { data, error } = await (supabase as any)
    .from('ai_usage')
    .select('message_count, deep_analysis_count')
    .eq('user_id', userId)
    .eq('date', today)
    .single();

  console.log('checkUsageLimit:', { userId, type, today, data, error });

  const LIMITS = { message: 75, deepAnalysis: 20 };

  const limit = LIMITS[type];
  const used = type === 'message' ? (data?.message_count || 0) : (data?.deep_analysis_count || 0);
  const remaining = Math.max(0, limit - used);

  // Calculate time until midnight UTC
  const now = new Date();
  const midnight = new Date();
  midnight.setUTCHours(24, 0, 0, 0);
  const hoursLeft = Math.ceil((midnight.getTime() - now.getTime()) / 3600000);

  return { allowed: remaining > 0, remaining, resetsIn: `${hoursLeft}h` };
}

export async function incrementUsage(
  userId: string,
  type: 'message' | 'deepAnalysis',
  tokens?: number,
  cost?: number
) {
  const today = new Date().toISOString().split('T')[0];

  console.log('incrementUsage called:', { userId, type, today });

  const supabase = createServerClient();

  // Try RPC first
  const { error: rpcError } = await (supabase as any).rpc('increment_ai_usage', {
    p_user_id: userId,
    p_date: today,
    p_message_increment: type === 'message' ? 1 : 0,
    p_analysis_increment: type === 'deepAnalysis' ? 1 : 0,
    p_tokens: tokens || 0,
    p_cost: cost || 0
  });

  if (rpcError) {
    console.error('RPC increment failed:', rpcError);

    // Fallback: direct upsert
    const field = type === 'message' ? 'message_count' : 'deep_analysis_count';

    const { data: existing } = await (supabase as any)
      .from('ai_usage')
      .select('*')
      .eq('user_id', userId)
      .eq('date', today)
      .single();

    if (existing) {
      await (supabase as any)
        .from('ai_usage')
        .update({
          [field]: (existing[field] || 0) + 1,
          tokens_used: (existing.tokens_used || 0) + (tokens || 0),
          cost_usd: (existing.cost_usd || 0) + (cost || 0)
        })
        .eq('user_id', userId)
        .eq('date', today);
    } else {
      await (supabase as any)
        .from('ai_usage')
        .insert({
          user_id: userId,
          date: today,
          message_count: type === 'message' ? 1 : 0,
          deep_analysis_count: type === 'deepAnalysis' ? 1 : 0,
          tokens_used: tokens || 0,
          cost_usd: cost || 0
        });
    }
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
