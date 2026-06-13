// ─── POST /api/ai/greeting ───────────────────────────────────
// Generates a personalized two-part greeting (opener ||| hook)
// using durable portfolio data only — no intraday prices/P&L.
// Uses Anthropic Claude Haiku with prompt caching.
//
// Body: {
//   userInitial, investorStyle, riskTolerance,
//   totalPnLPct, cashBalance, cashPct, totalInvested,
//   positions: [{ symbol, totalPnLPct, totalPnL, marketValue }],
//   upcomingEarnings: [...],
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

const GREETING_SYSTEM = `You are Vantage AI.
Generate a greeting for a returning user.

OUTPUT FORMAT — two parts separated by ||| :
 [time-based opener with initial] ||| [hook sentence]

Example outputs:
 Morning, M. ||| GOOGL is your biggest winner at +155% total — want to dig into what's driving it?
 Pre-market, M. ||| LLY reports earnings Thursday — your second largest position by value.
 Evening, M. ||| You're sitting on $65K cash — 33% of your portfolio idle.
 Afternoon, M. ||| ADBE is your only red position at -60% total. Worth a conversation.
 Morning, M. ||| Your portfolio has 10 positions across 4 sectors — reasonably diversified for a growth investor.

STRICT RULES — these are non-negotiable:
 ❌ NEVER mention today's price change %
 ❌ NEVER mention today's P&L in dollars
 ❌ NEVER mention intraday market direction
 ❌ NEVER say "up X% today" or "down X% today"
 ❌ NEVER reference intraday moves
 ✅ ONLY use total return since purchase
   (e.g. "+155% total" or "+155% since you bought")
 ✅ ONLY use upcoming scheduled events
   (earnings dates, Fed meetings)
 ✅ ONLY use portfolio structure facts
   (cash %, position count, sector %)
 ✅ ONLY use relative facts
   (biggest winner, only loser, largest position)
 ✅ Time opener must match actual time:
   Pre-market (4am-9:30am ET): "Pre-market, M."
   Market hours (9:30am-4pm ET):
     Before noon: "Morning, M."
     After noon: "Afternoon, M."
   After hours (4pm-8pm ET): "After hours, M."
   Evening (8pm-4am ET): "Evening, M."
   Weekend: "Morning/Afternoon/Evening, M."

TONE: warm, direct, slightly playful.
Like a trusted advisor who checked in before you did.
One hook sentence max — never two ideas.
Never mention Claude, Anthropic, or any AI model.`;

// ─── Hook type detection ───────────────────────────────────────

function detectHookType(hook: string): string {
  if (!hook) return 'signal';
  if (hook.includes('report') || hook.includes('earnings')) return 'event';
  if (hook.includes('cash') || hook.includes('% of your portfolio') || hook.includes('sitting on')) return 'structure';
  if (hook.includes('SPY') || hook.includes('market')) return 'market';
  if (hook.includes('inflation') || hook.includes('Fed') || hook.includes('sector')) return 'macro';
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
      totalPnLPct = 0,
      cashBalance = 0,
      cashPct = 0,
      positions = [],
      upcomingEarnings = [],
    } = body;

    const market = getMarketStatus();

    // Find biggest winner and laggard
    const sortedByPct = [...positions].sort((a: any, b: any) =>
      (b.totalPnLPct || 0) - (a.totalPnLPct || 0)
    );
    const biggestWinner = sortedByPct[0];
    const biggestLaggard = sortedByPct[sortedByPct.length - 1];

    // Find largest position by market value
    const sortedByValue = [...positions].sort((a: any, b: any) =>
      (b.marketValue || 0) - (a.marketValue || 0)
    );
    const largestPosition = sortedByValue[0];

    // ── Build dynamic context (durable data only — NO intraday) ──
    const dynamicContext = `
CURRENT CONTEXT:
User initial: ${userInitial}
Time period: ${market.opener}
Market status: ${market.period}
Investor style: ${investorStyle}
Risk tolerance: ${riskTolerance}

PORTFOLIO (durable data — use for total returns only):
Total P&L: ${totalPnLPct >= 0 ? '+' : ''}${totalPnLPct.toFixed(1)}%
Cash balance: $${cashBalance.toLocaleString()}
Cash % of portfolio: ${cashPct.toFixed(1)}%
Position count: ${positions.length}

POSITIONS (total return since purchase):
${positions.map((p: any) =>
  `${p.symbol}: ${(p.totalPnLPct || 0) >= 0 ? '+' : ''}${(p.totalPnLPct || 0).toFixed(1)}% total, $${((p.marketValue || 0)).toLocaleString()} value`
).join('\n')}

${biggestWinner ? `NOTABLE:
Biggest winner: ${biggestWinner.symbol} (+${(biggestWinner.totalPnLPct || 0).toFixed(1)}% total)
Biggest laggard: ${biggestLaggard?.symbol} (${(biggestLaggard?.totalPnLPct || 0).toFixed(1)}% total)
Largest position: ${largestPosition?.symbol} ($${((largestPosition?.marketValue || 0)).toLocaleString()})` : ''}

UPCOMING EVENTS (next 48h):
${upcomingEarnings.length > 0
  ? upcomingEarnings.map((e: any) =>
    `${e.symbol} earnings ${e.date}`).join('\n')
  : 'None scheduled'}

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

    const fullText = response.content[0]?.type === 'text'
      ? (response.content[0] as any).text?.trim()
      : null;

    if (!fullText) throw new Error('Empty response');

    console.log('[Greeting] Raw:', fullText);

    const parts = fullText.split('|||').map((p: string) => p.trim());
    const opener = parts[0] || `${market.opener}, ${userInitial}.`;
    const hook = parts[1] || null;

    console.log('[Greeting] Parsed:', { opener, hook });

    return NextResponse.json({
      opener,
      hook,
      hookType: detectHookType(hook || ''),
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
