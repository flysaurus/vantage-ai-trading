// ─── AI Usage Guard ───────────────────────────────────────────
// Multi-dimensional usage limits with daily + monthly caps,
// demo trial deep-analysis pool, and per-surface counters.
// Server-side only — uses createServerClient for Supabase access.
// Limits are tier-aware: read from tier_feature_values via get_tier_limit RPC.
//
// Timezone-aware: all daily counters use the user's LOCAL date,
// not server UTC. Callers pass a YYYY-MM-DD localDate string.

import { createServerClient } from '@/lib/supabase';

export type UsageType = 'message' | 'deepAnalysis' | 'dailyBrief' | 'weeklySnapshot' | 'greeting' | 'noticed';

// ─── Timezone helpers ────────────────────────────────────

/** Compute the user's local YYYY-MM-DD from an IANA timezone. */
export function getLocalDateFromTimezone(timezone?: string): string {
  try {
    return new Date().toLocaleDateString('en-CA', {
      timeZone: timezone || 'America/New_York',
    });
  } catch {
    // If timezone is invalid, fall back to America/New_York
    return new Date().toLocaleDateString('en-CA', {
      timeZone: 'America/New_York',
    });
  }
}

/** Compute hours remaining until the user's local midnight (0-24). */
export function getHoursUntilLocalMidnight(timezone?: string): number {
  try {
    const tz = timezone || 'America/New_York';
    const now = Date.now();

    // Extract local hour/minute/second in the user's timezone
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(new Date(now));
    const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value || '0');

    const msSinceMidnight = (get('hour') * 3600 + get('minute') * 60 + get('second')) * 1000;
    const msRemaining = 86400000 - msSinceMidnight;

    return Math.max(0, Math.ceil(msRemaining / 3600000));
  } catch {
    // Fallback: UTC midnight (original behavior)
    const midnight = new Date();
    midnight.setUTCHours(24, 0, 0, 0);
    return Math.ceil((midnight.getTime() - Date.now()) / 3600000);
  }
}

export interface LimitCheck {
  allowed: boolean;
  remaining: number;
  resetsIn: string;
  reason?: string;
}

// ─── Tier resolution ────────────────────────────────────

async function getUserTier(userId: string): Promise<string> {
  const supabase = createServerClient();
  try {
    const { data } = await (supabase as any)
      .from('users')
      .select('tier')
      .eq('id', userId)
      .single();
    return data?.tier || 'demo';
  } catch {
    return 'demo';
  }
}

async function getUserTierLimit(
  userId: string,
  featureKey: string
): Promise<number> {
  const supabase = createServerClient();
  try {
    const { data, error } = await (supabase as any)
      .rpc('get_tier_limit', { p_user_id: userId, p_feature_key: featureKey });

    if (!error && typeof data === 'number') return data;
  } catch { /* throw below */ }

  throw new Error('get_tier_limit RPC unavailable');
}

// ─── Usage Check (multi-dimensional) ─────────────────────

// Surface → generation_log mapping (for greeting/brief/snapshot daily limits)
const SURFACE_LOG_MAP: Record<string, string> = {
  greeting: 'greeting',
  dailyBrief: 'daily_brief',
  weeklySnapshot: 'weekly_snapshot',
  noticed: 'noticed',
};

export async function checkUsageLimit(
  userId: string,
  type: UsageType,
  localDate?: string,
  timezone?: string,
): Promise<LimitCheck> {
  const tier = await getUserTier(userId);
  // Use user's local date (browser timezone), not server UTC
  const today = localDate || getLocalDateFromTimezone(timezone);
  const supabase = createServerClient();

  // Map type to feature keys and DB field
  const configMap: Record<UsageType, {
    dailyFeature: string;
    monthlyFeature: string | null;
    poolFeature?: string;
    dbField: string;
  }> = {
    message: {
      dailyFeature: 'ai_message_limit',
      monthlyFeature: 'monthly_chat_limit',
      dbField: 'message_count',
    },
    deepAnalysis: {
      dailyFeature: 'deep_analysis_limit',
      monthlyFeature: 'monthly_deep_limit',
      poolFeature: 'demo_deep_pool',
      dbField: 'deep_analysis_count',
    },
    dailyBrief: {
      dailyFeature: 'daily_brief_limit',
      monthlyFeature: null,
      dbField: '', // checked via ai_generation_log, not ai_usage
    },
    weeklySnapshot: {
      dailyFeature: 'weekly_snapshot_limit',
      monthlyFeature: null,
      dbField: '', // checked via ai_generation_log, not ai_usage
    },
    greeting: {
      dailyFeature: 'greeting_limit',
      monthlyFeature: null,
      dbField: '', // checked via ai_generation_log, not ai_usage
    },
    noticed: {
      dailyFeature: 'noticed_check_limit',
      monthlyFeature: null,
      dbField: '', // checked via ai_generation_log, not ai_usage
    },
  };

  const config = configMap[type];

  // ── Get daily usage ──
  // Chat (message/deepAnalysis): read from ai_usage table
  // Surface (greeting/brief/snapshot): read from ai_generation_log to avoid
  //   contaminating the chat message_count with non-chat activity
  let dailyUsed = 0;

  if (type === 'greeting' || type === 'dailyBrief' || type === 'weeklySnapshot' || type === 'noticed') {
    const logSurface = SURFACE_LOG_MAP[type];
    const { count } = await (supabase as any)
      .from('ai_generation_log')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('surface', logSurface)
      .gte('created_at', `${today}T00:00:00Z`)
      .lte('created_at', `${today}T23:59:59Z`);
    dailyUsed = count || 0;
  } else {
    const { data } = await (supabase as any)
      .from('ai_usage')
      .select(config.dbField)
      .eq('user_id', userId)
      .eq('date', today)
      .single();
    dailyUsed = data?.[config.dbField] || 0;
  }

  // Get daily limit from DB tier tables — never hardcoded
  let dailyLimit = 0;
  try {
    const limit = await getUserTierLimit(userId, config.dailyFeature);
    if (typeof limit === 'number') dailyLimit = limit;
    else console.warn(`[ai-guard] get_tier_limit(${config.dailyFeature}) returned non-number:`, limit);
  } catch (err: any) {
    console.error(`[ai-guard] get_tier_limit(${config.dailyFeature}) RPC failed:`, err.message);
    // If we can't read the limit, fail closed (block usage) rather than
    // silently allowing with a wrong hardcoded number.
    return {
      allowed: false,
      remaining: 0,
      resetsIn: 'unknown',
      reason: `Unable to verify ${type} limit — tier system unavailable`,
    };
  }

  // Calculate hours until user's LOCAL midnight (not UTC)
  // Uses Intl.DateTimeFormat to extract local time components
  // so the countdown reflects actual timezone, not server UTC
  const hoursLeft = getHoursUntilLocalMidnight(timezone);

  // Check daily limit
  if (dailyLimit > 0 && dailyUsed >= dailyLimit) {
    return {
      allowed: false,
      remaining: 0,
      resetsIn: `${hoursLeft}h`,
      reason: `Daily ${type} limit (${dailyLimit}) reached`,
    };
  }

  // For message/deepAnalysis: check monthly limit
  if (config.monthlyFeature) {
    try {
      const monthlyLimit = await getUserTierLimit(userId, config.monthlyFeature);
      if (typeof monthlyLimit === 'number' && monthlyLimit > 0) {
        // Get user's monthly counters
        const { data: userData } = await (supabase as any)
          .from('users')
          .select('monthly_chat_used, monthly_deep_used')
          .eq('id', userId)
          .single();

        const monthlyUsed =
          type === 'message'
            ? (userData?.monthly_chat_used || 0)
            : (userData?.monthly_deep_used || 0);

        if (monthlyUsed >= monthlyLimit) {
          const daysInMonth = new Date(
            new Date().getFullYear(),
            new Date().getMonth() + 1,
            0
          ).getDate();
          const daysLeft = daysInMonth - new Date().getDate();
          return {
            allowed: false,
            remaining: 0,
            resetsIn: `${daysLeft}d`,
            reason: `Monthly ${type} limit (${monthlyLimit}) reached`,
          };
        }
      }
    } catch { /* fail open */ }
  }

  // For deepAnalysis: check demo trial pool
  if (type === 'deepAnalysis' && tier === 'demo') {
    try {
      const poolLimit = await getUserTierLimit(userId, 'demo_deep_pool');
      if (typeof poolLimit === 'number' && poolLimit > 0) {
        const { data: userData } = await (supabase as any)
          .from('users')
          .select('demo_deep_pool_used, demo_expires_at')
          .eq('id', userId)
          .single();

        const poolUsed = userData?.demo_deep_pool_used || 0;
        if (poolUsed >= poolLimit) {
          const expiresAt = userData?.demo_expires_at
            ? new Date(userData.demo_expires_at)
            : null;
          const resetMsg =
            expiresAt && expiresAt > new Date()
              ? `Trial pool of ${poolLimit} deep analyses exhausted${expiresAt ? ` (resets ${expiresAt.toLocaleDateString()} with upgrade)` : ''}`
              : `Trial pool exhausted. Upgrade to Silver/Gold for more deep analyses.`;
          return { allowed: false, remaining: 0, resetsIn: 'upgrade', reason: resetMsg };
        }
      }
    } catch { /* fail open */ }
  }

  const remaining = dailyLimit > 0 ? Math.max(0, dailyLimit - dailyUsed) : 999;
  return { allowed: true, remaining, resetsIn: `${hoursLeft}h` };
}

// ─── Increment Usage (with monthly/pool counters) ────────

export async function incrementUsage(
  userId: string,
  type: UsageType,
  tokens?: number,
  cost?: number,
  localDate?: string,
) {
  // Use user's local date (browser timezone), not server UTC
  const today = localDate || getLocalDateFromTimezone();
  const tier = await getUserTier(userId);
  const supabase = createServerClient();

  // Map type to increment values.
  // CRITICAL: Only actual chat messages increment message_count.
  // Greeting/brief/snapshot track tokens/cost but do NOT contaminate the
  // chat counter — their daily limits are checked via ai_generation_log.
  const isMessage = type === 'message';
  const isDeep = type === 'deepAnalysis';

  // Try RPC first
  const { error: rpcError } = await (supabase as any).rpc('increment_ai_usage', {
    p_user_id: userId,
    p_date: today,
    p_message_increment: isMessage ? 1 : 0,
    p_analysis_increment: isDeep ? 1 : 0,
    p_tokens: tokens || 0,
    p_cost: cost || 0,
  });

  if (rpcError) {
    console.error('[ai-guard] RPC increment_ai_usage failed:', rpcError);
    // Fallback: direct upsert
    const field = isDeep ? 'deep_analysis_count' : 'message_count';

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
          cost_usd: (existing.cost_usd || 0) + (cost || 0),
        })
        .eq('user_id', userId)
        .eq('date', today);
    } else {
      await (supabase as any)
        .from('ai_usage')
        .insert({
          user_id: userId,
          date: today,
          message_count: isMessage ? 1 : 0,
          deep_analysis_count: isDeep ? 1 : 0,
          tokens_used: tokens || 0,
          cost_usd: cost || 0,
        });
    }
  } else {
    console.log(
      `[ai-guard] incrementUsage OK: user=${userId.slice(0, 8)} type=${type} tokens=${tokens || 0} cost=$${(cost || 0).toFixed(6)}`,
    );
  }

  // Increment monthly/pool counters via RPC
  try {
    await (supabase as any).rpc('increment_user_counters', {
      p_user_id: userId,
      p_chat_delta: type === 'message' ? 1 : 0,
      p_deep_delta: type === 'deepAnalysis' ? 1 : 0,
      p_deep_pool_delta: type === 'deepAnalysis' && tier === 'demo' ? 1 : 0,
    });
  } catch (e) {
    console.error('[ai-guard] RPC increment_user_counters failed:', e);
  }
}

// ─── Finance-Only Guard ───────────────────────────────────

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
