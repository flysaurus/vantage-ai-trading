// ─── POST /api/ai/greeting ───────────────────────────────────
// Generates a personalized 1-2 sentence greeting using real portfolio
// context, upcoming earnings, P&L, market conditions, and the user's
// investor profile. Tracks hook type to avoid repetition.
//
// Body: {
//   userInitial, investorStyle, riskTolerance,
//   portfolioValue, todayPnL, todayPnLPct, totalPnL, totalPnLPct,
//   spyReturn, spyReturnPct,
//   positions: [{ symbol, totalPnLPct, dailyPnLPct }],
//   upcomingEarnings: [...],
//   lastHookType: string | null,
// }

import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { buildUserProfileContext } from '@/lib/ai/userProfile';
import type { UserProfile } from '@/lib/ai/userProfile';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  defaultHeaders: {
    'anthropic-beta': 'prompt-caching-2024-07-31',
  },
});

const HOOK_STYLES = [
  'earnings_alert',  // Upcoming earnings mention
  'market_pulse',    // SPY/market movement
  'pnl_snapshot',    // Today's P&L highlight
  'portfolio_health',// Overall % return
  'top_mover',       // Best-performing position
  'watchlist_nudge', // Suggestion to review something
  'macro_lens',      // Big-picture macro view
  'style_reflection',// Investor style lens
];

const GREETING_SYSTEM_PROMPT = `You are Vantage AI, a warm, sharp, slightly playful trading companion.
Generate exactly ONE short sentence (max 20 words) as a greeting.

Rules:
- Address the user by initial: "{initial}."
- Reference a SPECIFIC ticker, dollar amount, or % from the data.
- Match the investor style and risk tolerance in tone.
- Vary the hook type — if lastHookType is provided, use a DIFFERENT one.
- Be casual and conversational. No corporate speak.
- Never mention Claude, Anthropic, or your AI nature.
- Never use markdown.
- No exclamation points unless it's genuinely exciting.
- One sentence only. Period at the end.

Hook types to rotate through:
- earnings_alert: "EarningsWatch {ticker} reports {date} — could move {pct}%"
- market_pulse: "SPY {up/down} {pct}% — {bullish/bearish} tone"
- pnl_snapshot: "Today: {+/-}\${amount} — {green/red} day so far"
- portfolio_health: "Portfolio {up/down} {pct}% since inception"
- top_mover: "{ticker} is your best performer at {+pct}%"
- styl_reflection: "{style}-style lens: {observation}"`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      userInitial = 'M',
      investorStyle = 'Lynch',
      riskTolerance = 'Moderate',
      portfolioValue,
      todayPnL,
      todayPnLPct,
      totalPnL,
      totalPnLPct,
      spyReturn,
      spyReturnPct,
      positions = [],
      upcomingEarnings = [],
      lastHookType,
    } = body;

    // Pick a different hook type if possible
    const availableHooks = lastHookType
      ? HOOK_STYLES.filter(h => h !== lastHookType)
      : HOOK_STYLES;
    const hookType = availableHooks[Math.floor(Math.random() * availableHooks.length)];

    // Build portfolio summary for LLM
    const fmtDollar = (v: number) => `${v >= 0 ? '+' : '-'}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

    const posLines = positions.map((p: any) =>
      `${p.symbol}: total ${fmtPct(p.totalPnLPct || 0)}, today ${fmtPct(p.dailyPnLPct || 0)}`
    ).join(' | ');

    const earningsLines = upcomingEarnings.map((e: any) =>
      `${e.symbol} reports earnings on ${e.date || 'unknown'}. Estimate: $${e.estimate || 'N/A'}, Prior: $${e.revenueActual || 'N/A'}`
    ).join(' | ');

    const portfolioSummary = [
      portfolioValue != null ? `Portfolio: $${Number(portfolioValue).toLocaleString('en-US')}` : '',
      todayPnL != null ? `Today: ${fmtDollar(todayPnL)} (${fmtPct(todayPnLPct || 0)})` : '',
      totalPnL != null ? `Total: ${fmtDollar(totalPnL)} (${fmtPct(totalPnLPct || 0)})` : '',
      spyReturnPct != null ? `SPY today: ${fmtPct(spyReturnPct)}` : '',
      posLines ? `Positions: ${posLines}` : '',
      earningsLines ? `Upcoming earnings: ${earningsLines}` : '',
    ].filter(Boolean).join('\n');

    const profile: UserProfile = {
      investorStyle: (investorStyle as UserProfile['investorStyle']) || 'Lynch',
      riskTolerance: (riskTolerance as UserProfile['riskTolerance']) || 'Moderate',
      name: userInitial,
    };
    const profileContext = buildUserProfileContext(profile);

    const userMessage = `Generate my greeting. Use hook type: ${hookType}.

Investor: ${profileContext}

${portfolioSummary || 'No portfolio data available.'}

User initial: ${userInitial}
Last hook used: ${lastHookType || 'none'}`;

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      system: [
        {
          type: 'text' as const,
          text: GREETING_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' as const },
        },
      ],
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = (response.content as any[])
      .map((block: any) => block.type === 'text' ? block.text : '')
      .join('')
      .trim();

    const usage = (response as any).usage || {};
    console.log('[Greeting]', JSON.stringify({
      hookType,
      lastHookType,
      cacheHit: (usage.cache_read_input_tokens || 0) > 0,
      greetingLen: text.length,
    }));

    return NextResponse.json({ greeting: text, hookType });
  } catch (error: any) {
    console.error('[Greeting] Error:', error?.message || error);
    return NextResponse.json(
      { error: error?.message || 'Failed to generate greeting' },
      { status: 500 }
    );
  }
}
