// ─── POST /api/ai/greeting ───────────────────────────────────
// Generates a personalized 1-2 sentence greeting using real portfolio
// context, upcoming earnings, P&L, market conditions, and the user's
// investor profile. Uses Anthropic Claude Haiku with prompt caching.
//
// Body: {
//   userInitial, investorStyle, riskTolerance,
//   portfolioValue, todayPnL, todayPnLPct, totalPnL, totalPnLPct,
//   spyReturn, spyReturnPct,
//   positions: [{ symbol, totalPnLPct, dailyPnLPct }],
//   upcomingEarnings: [...],
//   lastHookType: string | null,
//   marketStatus: { isOpen, period, opener } | null,
// }

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  defaultHeaders: {
    'anthropic-beta': 'prompt-caching-2024-07-31',
  },
});

// ─── Market hours helper (ET) ──────────────────────────────────

function getMarketStatus(): {
  isOpen: boolean;
  period: 'premarket' | 'open' | 'afterhours' | 'closed';
  opener: string;
} {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hour = et.getHours();
  const min = et.getMinutes();
  const day = et.getDay();
  const timeInMin = hour * 60 + min;
  const isWeekend = day === 0 || day === 6;

  if (isWeekend) return {
    isOpen: false,
    period: 'closed',
    opener: hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening',
  };

  if (timeInMin >= 240 && timeInMin < 570) return { isOpen: false, period: 'premarket', opener: 'Pre-market' };
  if (timeInMin >= 570 && timeInMin < 960) return { isOpen: true, period: 'open', opener: hour < 12 ? 'Morning' : 'Afternoon' };
  if (timeInMin >= 960 && timeInMin < 1200) return { isOpen: false, period: 'afterhours', opener: 'After hours' };
  return { isOpen: false, period: 'closed', opener: 'Evening' };
}

// ─── Greeting system prompt ────────────────────────────────────

const GREETING_SYSTEM = `You are Vantage AI, a warm and intelligent portfolio advisor. Generate a greeting that feels like a trusted advisor who checked in before the user did — brief, sharp, and personal.

GREETING FORMAT (strict):
"{opener}, {initial}. {one insightful hook}"

RULES:
- Total length: 1-2 sentences MAX. Never more.
- Address user by their initial only (e.g. "M.")
- The hook must reference REAL data from context
- Tone: warm, confident, slightly playful — like a friend, not like a Bloomberg terminal
- Never mention Peter Lynch, Warren Buffett, or any investor name
- Never use generic phrases like "markets are moving" or "interesting times"
- Never start with "I"
- Never mention Claude or Anthropic

HOOK SELECTION (pick most relevant):

1. UPCOMING EVENT (highest priority):
   Use when earnings/Fed/macro data within 48h
   Example: "LLY reports Thursday — your largest pharma position."

2. END OF DAY (after 4pm ET):
   Use closing summary with SPY comparison
   Example: "Solid close. Portfolio up $1,469 while SPY gained 0.8% — you beat it today."

3. MARKET HOURS — SPY COMPARISON:
   Use during open market
   Formula based on spread:
   - Portfolio >> SPY (+1%+): "Markets up 0.6%, you're up 1.8% — NVDA carrying the load today."
   - Portfolio ≈ SPY (within 0.5%): "Moving with the market — up 0.7% alongside SPY's 0.8%."
   - Portfolio << SPY (-1%+): "Markets up 0.8% but you're flat — ADBE dragging. Worth a look."
   - Market down, you down less: "Rough day out there — SPY down 1.2%, you're only down 0.4%. Holding up."
   - Market down, you down more: "Markets down 0.8%, you're down 1.4% — tech concentration showing today."

4. MACRO/SECTOR IMPACT:
   Use when macro event is recent (today/yesterday)
   Example: "Inflation print just dropped — growth stocks taking heat, your portfolio is feeling it."

5. PORTFOLIO SIGNAL (always available fallback):
   Most interesting signal from positions
   Example: "ADBE down three days running. Might be worth a conversation."

Never repeat the same hook type in consecutive sessions (track in the request if possible).`;

// ─── Hook type detection ───────────────────────────────────────

function detectHookType(greeting: string): string {
  if (greeting.includes('report') || greeting.includes('earnings')) return 'event';
  if (greeting.includes('close') || greeting.includes('today')) return 'eod';
  if (greeting.includes('SPY') || greeting.includes('market')) return 'market';
  if (greeting.includes('inflation') || greeting.includes('Fed') || greeting.includes('sector')) return 'macro';
  return 'signal';
}

// ─── POST handler ──────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      userInitial = 'M',
      investorStyle = 'Lynch',
      riskTolerance = 'Moderate',
      portfolioValue = 0,
      todayPnL = 0,
      todayPnLPct = 0,
      totalPnL = 0,
      totalPnLPct = 0,
      spyReturn = 0,
      spyReturnPct = 0,
      positions = [],
      upcomingEarnings = [],
      lastHookType = null,
    } = body;

    const market = getMarketStatus();

    // Find biggest winner and laggard
    const sortedByPct = [...positions].sort((a: any, b: any) =>
      (b.totalPnLPct || 0) - (a.totalPnLPct || 0)
    );
    const biggestWinner = sortedByPct[0];
    const biggestLaggard = sortedByPct[sortedByPct.length - 1];

    // ── Build dynamic context ──
    const dynamicContext = `
CURRENT CONTEXT:
User initial: ${userInitial}
Time period: ${market.opener}
Market status: ${market.period}
Investor style: ${investorStyle}
Risk tolerance: ${riskTolerance}

PORTFOLIO TODAY:
Value: $${portfolioValue.toLocaleString()}
Today P&L: ${todayPnL >= 0 ? '+' : ''}$${Math.abs(todayPnL).toLocaleString()} (${todayPnLPct >= 0 ? '+' : ''}${todayPnLPct.toFixed(1)}%)
Total P&L: ${totalPnL >= 0 ? '+' : ''}$${Math.abs(totalPnL).toLocaleString()} (${totalPnLPct >= 0 ? '+' : ''}${totalPnLPct.toFixed(1)}%)

MARKET BENCHMARK:
SPY today: ${spyReturnPct >= 0 ? '+' : ''}${spyReturnPct.toFixed(2)}%
Portfolio vs SPY spread: ${(todayPnLPct - spyReturnPct).toFixed(2)}%

TOP POSITIONS (by value):
${positions.slice(0, 5).map((p: any) =>
  `${p.symbol}: ${p.totalPnLPct >= 0 ? '+' : ''}${(p.totalPnLPct || 0).toFixed(1)}% total, ${(p.dailyPnLPct || 0) >= 0 ? '+' : ''}${(p.dailyPnLPct || 0).toFixed(1)}% today`
).join('\n')}

${biggestWinner ? `NOTABLE POSITIONS:
Biggest winner: ${biggestWinner.symbol} (+${(biggestWinner.totalPnLPct || 0).toFixed(1)}%)
Biggest laggard: ${biggestLaggard?.symbol} (${(biggestLaggard?.totalPnLPct || 0).toFixed(1)}%)` : ''}

UPCOMING EVENTS (next 48h):
${upcomingEarnings.length > 0
  ? upcomingEarnings.map((e: any) =>
    `${e.symbol} earnings ${e.date}`).join('\n')
  : 'None scheduled'}

LAST HOOK TYPE USED: ${lastHookType || 'none'}
(Do not repeat this hook type)

Opener to use: "${market.opener}"
`;

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      system: [
        {
          type: 'text' as const,
          text: GREETING_SYSTEM,
          cache_control: { type: 'ephemeral' as const },
        },
        {
          type: 'text' as const,
          text: dynamicContext,
        },
      ],
      messages: [{
        role: 'user' as const,
        content: 'Generate my greeting now.',
      }],
    });

    const greeting = response.content[0]?.type === 'text'
      ? (response.content[0] as any).text?.trim()
      : null;

    if (!greeting) throw new Error('Empty response');

    console.log('[Greeting] Success:', greeting);

    return NextResponse.json({
      greeting,
      hookType: detectHookType(greeting),
    });
  } catch (error: any) {
    console.error('[Greeting] Error:', error.message);
    console.error('[Greeting] Status:', error.status);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
