/**
 * POST /api/chat — AI chat endpoint (Vantage 2.0)
 *
 * Wires together the full AI pipeline:
 *   1. Auth via session cookie
 *   2. Finance-only guard (keywords)
 *   3. Daily usage limits (75 messages / 25 deep analyses)
 *   4. User profile lookup (investor style, risk tolerance)
 *   5. AI context builder (portfolio, market, tax)
 *   6. Theme detection → basket generation + DB persistence
 *   7. Standard modes → system prompt + Claude routing
 *   8. Usage tracking
 *
 * All AI calls go through callAnalystAI (Sonnet) or callChatAI (Haiku).
 * No DeepSeek, no streaming SSE — composable and clean.
 */

import { NextRequest, NextResponse } from 'next/server';

// ─── New guard layer ─────────────────────────────────────────
import {
  checkUsageLimit,
  incrementUsage,
  isFinanceQuery,
  NON_FINANCE_RESPONSE,
} from '@/lib/ai-guard';

// ─── Theme / basket engine ───────────────────────────────────
import {
  detectTheme,
  getThemeBasket,
  THEME_UNIVERSE,
} from '@/lib/stock-universe';

// ─── AI provider — Claude only now ──────────────────────────
import { callAnalystAI, callChatAI } from '@/lib/ai-provider';

// ─── System prompt builder ──────────────────────────────────
import {
  buildSystemPrompt,
  type AdvisorMode,
  type ResponseMode,
} from '@/lib/ai-system-prompt';

// ─── Context builder (portfolio, market, tax, sector leaders) ─
import { buildAIContext } from '@/lib/ai-context';

// ─── Supabase ────────────────────────────────────────────────
import { createServerClient } from '@/lib/supabase';

// ─── Types ───────────────────────────────────────────────────
type ChatBody = {
  message: string;
  mode?: string;
  responseMode?: string;
  investorStyle?: string;
};

// ─── Deep-analysis mode set ──────────────────────────────────
const DEEP_ANALYSIS_MODES = new Set([
  'research',
  'theme',
  'health',
  'opportunities',
  'tax',
]);

// ─── Auth ────────────────────────────────────────────────────

async function getUserIdFromSession(req: NextRequest): Promise<string> {
  const sessionCookie = req.cookies.get('session')?.value || '';
  if (sessionCookie) {
    const hashBuffer = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(sessionCookie),
    );
    const sessionHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    try {
      const supabase = createServerClient();
      const { data } = await (supabase as any)
        .from('user_sessions')
        .select('user_id')
        .eq('session_hash', sessionHash)
        .maybeSingle();
      if (data?.user_id) return data.user_id;
    } catch {
      /* fall through */
    }
  }
  return 'anonymous';
}

// ─── POST handler ────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    // ▸ 1. Auth
    const userId = await getUserIdFromSession(req);
    if (userId === 'anonymous') {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 },
      );
    }

    // ▸ 2. Parse body
    const body = (await req.json()) as ChatBody;
    const {
      message,
      mode = 'general',
      responseMode = 'summary',
    } = body;

    if (!message?.trim()) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 },
      );
    }

    // ▸ 3. Finance-only guard (checks BEFORE usage limit)
    if (!isFinanceQuery(message)) {
      return NextResponse.json({
        content: NON_FINANCE_RESPONSE,
        type: 'text',
      });
    }

    // ▸ 4. Determine if deep analysis
    const isDeepAnalysis =
      DEEP_ANALYSIS_MODES.has(mode) || detectTheme(message) !== null;

    // ▸ 5. Check usage limits
    const limitType = isDeepAnalysis ? 'deepAnalysis' : 'message';

    const { allowed, remaining } = await checkUsageLimit(
      userId,
      limitType,
    );

    if (!allowed) {
      const limitName = isDeepAnalysis
        ? 'deep analysis'
        : 'message';
      return NextResponse.json({
        content: [
          `Daily ${limitName} limit reached (${isDeepAnalysis ? 5 : 20}/day).`,
          isDeepAnalysis
            ? 'You can still ask general market questions.'
            : 'Try again after midnight EST.',
        ].join('\n'),
        type: 'limit_reached',
      });
    }

    // ▸ 6. Get user profile
    const supabase = createServerClient();
    const { data: user } = await (supabase as any)
      .from('users')
      .select('investor_style, risk_tolerance, display_name')
      .eq('id', userId)
      .single();

    const investorStyle = user?.investor_style || 'lynch';
    const riskTolerance = user?.risk_tolerance || 'moderate';

    // ▸ 7. Build AI context
    const context = await buildAIContext(userId, {
      investorStyle: body.investorStyle,
    });

    // ▸ 8. Theme detection & basket generation
    const detectedTheme = detectTheme(message);

    if (detectedTheme || mode === 'theme') {
      const themeKey = detectedTheme || 'ai_infrastructure';
      const themeInfo = THEME_UNIVERSE[themeKey];

      if (!themeInfo) {
        return NextResponse.json({
          content:
            'Theme not found. Try asking about AI, clean energy, cybersecurity, healthcare, dividends, reshoring, fintech, or consumer trends.',
          type: 'text',
        });
      }

      // Generate scored basket
      const basketResult = await getThemeBasket(
        themeKey,
        investorStyle,
        riskTolerance,
        2, // max 2 stocks per sub-theme
      );

      // Build basket context for AI
      const basketContext = basketResult.scoredStocks
        .map(
          (s) =>
            [
              `${s.symbol} (${s.subTheme}):`,
              `Score: ${s.compositeScore}/100`,
              `Conviction: ${s.conviction}`,
              `PE: ${s.data.pe?.toFixed(1) || 'N/A'}`,
              `EPS Growth: ${s.data.epsGrowth?.toFixed(1) || 'N/A'}%`,
              `RSI: ${s.data.rsi14?.toFixed(0) || 'N/A'}`,
              `Trend: ${s.data.trend}`,
              `Sentiment: ${s.data.newsSentiment}`,
              `Analyst: ${s.data.analystConsensus || 'N/A'}`,
              `Price: $${s.data.currentPrice?.toFixed(2) || 'N/A'}`,
              `Target: $${s.data.targetMean?.toFixed(2) || 'N/A'}`,
            ].join('\n'),
        )
        .join('\n\n');

      const systemPrompt = buildSystemPrompt(
        context,
        'theme' as AdvisorMode,
        responseMode as ResponseMode,
      );

      const themePrompt = `
Theme: ${themeInfo.emoji} ${themeInfo.name}
Description: ${themeInfo.description}
User investor style: ${investorStyle}
User risk tolerance: ${riskTolerance}

Pre-scored stocks (DO NOT change these scores):
${basketContext}

User asked: "${message}"

Present this basket following the THEMATIC BASKET
MODE output format exactly.
Explain the investment thesis.
Explain why each stock fits ${investorStyle} style.
Identify top 2 picks for this style.`;

      // Use Claude Sonnet for theme analysis
      const aiResponse = await callAnalystAI({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: themePrompt },
        ],
      });

      // ── Persist basket to DB ──
      let basketId: string | null = null;

      const { data: newBasket } = await (supabase as any)
        .from('baskets')
        .insert({
          user_id: userId,
          name: `${themeInfo.emoji} ${themeInfo.name}`,
          emoji: themeInfo.emoji,
          description: themeInfo.description,
          theme: themeKey,
          source: 'ai_generated',
          status: 'draft',
        })
        .select()
        .single();

      if (newBasket?.id) {
        basketId = newBasket.id;

        // Basket positions
        await (supabase as any).from('basket_positions').insert(
          basketResult.scoredStocks.map((s) => ({
            basket_id: newBasket.id,
            user_id: userId,
            symbol: s.symbol,
            company: s.company,
            sector: s.sector,
            sub_theme: s.subTheme,
            composite_score: s.compositeScore,
            conviction: s.conviction,
            reasoning: `${themeInfo.name} basket — ${s.subTheme}`,
            status: 'pending',
            is_watchlist_only: false,
            target_pct: parseFloat(
              (100 / basketResult.scoredStocks.length).toFixed(1),
            ),
          })),
        );

        // AI suggestions for tracking
        await (supabase as any).from('ai_suggestions').insert(
          basketResult.scoredStocks.map((s) => ({
            user_id: userId,
            symbol: s.symbol,
            company: s.company,
            sector: s.sector,
            action: 'buy',
            suggested_price: s.data.currentPrice,
            investor_style: investorStyle,
            risk_tolerance: riskTolerance,
            composite_score: s.compositeScore,
            fundamental_score: s.fundamentalScore,
            technical_score: s.technicalScore,
            sentiment_score: s.sentimentScore,
            analyst_score: s.analystScore,
            style_fit_score: s.styleFitScore,
            conviction: s.conviction,
            entry_observation_low: s.entryObservationLow,
            entry_observation_high: s.entryObservationHigh,
            reasoning: `${themeInfo.emoji} ${themeInfo.name} basket`,
          })),
        );
      }

      // Increment deep analysis usage
      await incrementUsage(
        userId,
        'deepAnalysis',
        aiResponse.tokensUsed,
        (aiResponse.tokensUsed || 0) * 0.000003,
      );

      return NextResponse.json({
        content: aiResponse.content,
        type: 'theme_basket',
        basketId,
        basketName: newBasket?.name || themeInfo.name,
        stockCount: basketResult.scoredStocks.length,
        stocks: basketResult.scoredStocks.map((s) => ({
          symbol: s.symbol,
          company: s.company,
          subTheme: s.subTheme,
          compositeScore: s.compositeScore,
          conviction: s.conviction,
          currentPrice: s.data.currentPrice,
        })),
        remaining: remaining - 1,
      });
    }

    // ▸ 9. Standard modes
    const systemPrompt = buildSystemPrompt(
      context,
      mode as AdvisorMode,
      responseMode as ResponseMode,
    );

    const useDeepAnalysis = DEEP_ANALYSIS_MODES.has(mode);
    const aiCall = useDeepAnalysis ? callAnalystAI : callChatAI;

    const aiResponse = await aiCall({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
    });

    // Increment usage
    const costPerToken = useDeepAnalysis ? 0.000003 : 0.00000025;

    await incrementUsage(
      userId,
      useDeepAnalysis ? 'deepAnalysis' : 'message',
      aiResponse.tokensUsed,
      (aiResponse.tokensUsed || 0) * costPerToken,
    );

    return NextResponse.json({
      content: aiResponse.content,
      type: 'text',
      model: aiResponse.model,
      remaining: remaining - 1,
    });
  } catch (err: any) {
    console.error('Chat API error:', err.message, err.stack);
    return NextResponse.json(
      {
        content:
          'Analysis temporarily unavailable. Please try again in a moment.',
        type: 'error',
      },
      { status: 500 },
    );
  }
}
