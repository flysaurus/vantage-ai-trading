// ─── POST /api/ai/greeting ───────────────────────────────────
// Generates a personalized two-part greeting (opener ||| hook)
// using durable portfolio data only — no intraday prices/P&L.
// Now includes: category rotation (7 types incl macro), AI facts
// grounding, and post-generation fact write-back.
// Uses Anthropic Claude Haiku with prompt caching.
//
// Body: {
//   userInitial, investorStyle, riskTolerance,
//   totalPnLPct, cashBalance, cashPct, totalInvested,
//   positions: [{ symbol, totalPnLPct, totalPnL, marketValue }],
//   upcomingEarnings: [...],
//   includeStyleAck: boolean (first session with style assigned),
// }

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { writeFact } from '@/lib/ai/facts';
import { beginGenLog } from '@/lib/ai/generation-log';
import { getOptionalUserId } from '@/lib/auth/get-server-user';

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

// ─── Style descriptions for first-session greeting ────────────

const STYLE_GREETINGS: Record<string, string> = {
  buffett: "I'll focus your analysis on long-term value and business fundamentals.",
  lynch: "I'll surface growth opportunities before they become obvious to the market.",
  livermore: "I'll keep your momentum signals sharp and your timing precise.",
  munger: "I'll frame every decision in clear mental models and rational analysis.",
  soros: "I'll flag macro shifts and contrarian opportunities others are missing.",
};

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

TONE: Sound like a sharp friend checking in, not a financial advisor filing a report. One observation. One hook. That's it. No corporate language. No hedging. If a position is bleeding — say so directly. If something's crushing it — own it. Warm, direct, punchy.
One hook sentence max — never two ideas.
Never mention Claude, Anthropic, or any AI model.

VARIETY RULE: You have a rotating insight lens (position, cash, events, structure, risk, market, macro). Use it. Don't default to the same stock comparison every time. If the previous hooks (shown in ANTI-REPETITION) mention specific tickers, deliberately pick different positions or a different framing.

FACTS-AWARE CROSS-CHECK:
The prompt includes an "AI FACTS" grounding section if active facts exist. If it contains a [question] or [observation] about a subject your greeting mentions, do NOT contradict it. If a fact says "AXP drawdown cause unconfirmed," do not dismiss it as "nothing to worry about." Defer or stay silent on unresolved facts — do not confidently overrule them.`;

// ─── Insight category rotation ─────────────────────────────────

const INSIGHT_CATEGORIES = [
  'position',   // winner/laggard performance contrast
  'cash',       // idle cash deployment observations
  'events',     // upcoming earnings, FOMC, macro calendar
  'structure',  // portfolio composition, sector mix, position count
  'risk',       // concentration, correlation between holdings
  'market',     // market context relevant to holdings
  'macro',      // live index data tied back to actual holdings
] as const;

type InsightCategory = (typeof INSIGHT_CATEGORIES)[number];

const CATEGORY_GUIDANCE: Record<InsightCategory, string> = {
  position: 'Focus on individual position performance: biggest winner vs biggest laggard, or the position with the most dramatic total return story. Compare a standout performer to a struggling one.',
  cash: 'Focus on cash deployment: how much idle cash sits in the portfolio, what percentage of the total it represents, and whether that cash could be working harder.',
  events: 'Focus on upcoming events: earnings reports, Fed meetings, or other scheduled catalysts that affect held positions in the coming days.',
  structure: 'Focus on portfolio structure: number of positions, sector composition, diversification level, balance between holdings.',
  risk: 'Focus on risk and concentration: how correlated are the holdings, is there sector concentration, does the portfolio lean too heavily into one area?',
  market: 'Focus on market context: how the portfolio relates to broader market conditions, or frame the portfolio against what the market is doing this week.',
  macro: 'Focus on macro indices and how the portfolio is positioned: describe the observed PATTERN using real index data that was fetched and provided (e.g. "Tech is under pressure — QQQ down 1.2%, but your financial-heavy book is holding up"). Always tie the macro observation back to the user\'s actual holdings — never present as a disconnected market-news blurb. GUARDRAIL: describe the pattern without inventing an unverified causal story (no "this is a safety rotation" or "traders are de-risking" unless the fetched data includes a news-driven reason). If no clear cause is available, describe the pattern only.',
};

function pickCategory(lastCategories: string[] | null | undefined): InsightCategory {
  const recent = (lastCategories || [])
    .filter((c) => INSIGHT_CATEGORIES.includes(c as InsightCategory))
    .slice(0, 3); // track up to last 3
  // If no history, pick random to avoid always starting from position
  if (recent.length === 0) {
    return INSIGHT_CATEGORIES[Math.floor(Math.random() * INSIGHT_CATEGORIES.length)];
  }
  // Pick first category NOT in recent set; if all are recent, just take the next after the most recent
  for (const cat of INSIGHT_CATEGORIES) {
    if (!recent.includes(cat)) return cat;
  }
  // All categories recently used — rotate past the most recent
  const idx = INSIGHT_CATEGORIES.indexOf(recent[0] as InsightCategory);
  return INSIGHT_CATEGORIES[(idx + 1) % INSIGHT_CATEGORIES.length];
}

// ─── Hook type detection ───────────────────────────────────────

function detectHookType(hook: string): string {
  if (!hook) return 'signal';
  if (hook.includes('report') || hook.includes('earnings')) return 'event';
  if (hook.includes('cash') || hook.includes('% of your portfolio') || hook.includes('sitting on')) return 'structure';
  if (hook.includes('SPY') || hook.includes('QQQ') || hook.includes('DIA') || hook.includes('VIX') || hook.includes('IWM')) return 'macro';
  if (hook.includes('market') || hook.includes('inflation') || hook.includes('Fed') || hook.includes('sector')) return 'market';
  return 'signal';
}

// ─── Macro index quotes fetcher ──────────────────────────────

async function fetchMacroQuotes(): Promise<Record<string, { c: number; dp: number }>> {
  const key = process.env.FINNHUB_IO_API_KEY;
  if (!key) return {};
  const indices = ['SPY', 'QQQ', 'DIA', 'IWM', '^VIX'];
  const results: Record<string, { c: number; dp: number }> = {};
  await Promise.all(indices.map(async (sym) => {
    try {
      const r = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${key}`,
        { signal: AbortSignal.timeout(5000) },
      );
      const q = await r.json();
      if (q.c != null) {
        results[sym === '^VIX' ? 'VIX' : sym] = { c: q.c, dp: q.dp ?? 0 };
      }
    } catch {
      // index unavailable — skip
    }
  }));
  return results;
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
      includeStyleAck = false,
      lastCategory = null,
      lastCategories = [], // array of last 2-3 categories used
      lastHooks = [], // array of last 1-2 hook texts to avoid repeating
    } = body;

    // Backward-compat: if frontend sends lastCategory (string), wrap in array
    const recentCategories: string[] = (lastCategories && lastCategories.length > 0)
      ? lastCategories
      : (lastCategory ? [lastCategory] : []);

    // ── Auth: get userId for facts read/write ──────────────
    const userId = await getOptionalUserId();

    // ── Fetch AI facts for grounding context (with audit logging) ──
    const genLog = await beginGenLog(userId, 'greeting');
    const factsContext = genLog.factsPrompt;

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

    // ── Style acknowledgment for first session ──
    const styleKey = (investorStyle as string).toLowerCase();
    const styleAck = includeStyleAck && STYLE_GREETINGS[styleKey]
      ? `You identified as a ${investorStyle} — ${STYLE_GREETINGS[styleKey]}\n\n`
      : '';

    // ── Pick insight category (avoid last 3 used) ──
    const category = pickCategory(recentCategories);

    // ── Build category context block ──
    let categoryContext = '';
    switch (category) {
      case 'position':
        if (biggestWinner || biggestLaggard) {
          categoryContext = `
KEY POSITION SIGNALS:
${biggestWinner ? `Top performer: ${biggestWinner.symbol} (+${(biggestWinner.totalPnLPct || 0).toFixed(1)}% total, $${((biggestWinner.marketValue || 0)).toLocaleString()} value)` : ''}
${biggestLaggard && biggestLaggard.symbol !== biggestWinner?.symbol ? `Weakest performer: ${biggestLaggard.symbol} (${(biggestLaggard.totalPnLPct || 0).toFixed(1)}% total, $${((biggestLaggard.marketValue || 0)).toLocaleString()} value)` : ''}
Largest position: ${largestPosition?.symbol || 'N/A'} ($${((largestPosition?.marketValue || 0)).toLocaleString()})
`;
        }
        break;
      case 'cash':
        categoryContext = `
CASH FOCUS:
Idle cash: $${cashBalance.toLocaleString()}
Cash as % of portfolio: ${cashPct.toFixed(1)}%
Total invested: $${positions.reduce((sum: number, p: any) => sum + (p.marketValue || 0), 0).toLocaleString()}
`;
        break;
      case 'events':
        categoryContext = `
UPCOMING CATALYSTS:
${upcomingEarnings.length > 0
  ? upcomingEarnings.map((e: any) => `${e.symbol} earnings ${e.date}`).join('\n')
  : 'No earnings scheduled for held positions'}
`;
        break;
      case 'structure':
        categoryContext = `
PORTFOLIO STRUCTURE:
Position count: ${positions.length}
Total market value: $${positions.reduce((sum: number, p: any) => sum + (p.marketValue || 0), 0).toLocaleString()}
Cash % vs invested %: ${cashPct.toFixed(1)}% / ${(100 - cashPct).toFixed(1)}%
Top 3 by value: ${positions.slice(0, 3).map((p: any) => `${p.symbol} ($${((p.marketValue || 0)).toLocaleString()})`).join(', ')}
`;
        break;
      case 'risk':
        categoryContext = `
RISK & CONCENTRATION:
Position count: ${positions.length}
Largest position: ${largestPosition?.symbol || 'N/A'} at $${((largestPosition?.marketValue || 0)).toLocaleString()} (${positions.length > 0 && largestPosition?.marketValue ? ((largestPosition.marketValue / positions.reduce((sum: number, p: any) => sum + (p.marketValue || 0), 1)) * 100).toFixed(1) : '0'}% of portfolio)
${positions.length <= 3 ? '⚠️ Very concentrated — fewer than 4 positions' : positions.length <= 6 ? 'Moderate diversification' : 'Well diversified across multiple positions'}
`;
        break;
      case 'market':
        categoryContext = `
MARKET CONTEXT:
Holdings: ${positions.map((p: any) => p.symbol).join(', ') || 'None'}
Portfolio total return: ${totalPnLPct >= 0 ? '+' : ''}${totalPnLPct.toFixed(1)}%
Cash on sidelines: ${cashPct.toFixed(1)}%
`;
        break;
      case 'macro': {
        const macroQuotes = await fetchMacroQuotes();
        const indexLines = Object.entries(macroQuotes)
          .map(([sym, q]) => `${sym}: $${q.c.toFixed(2)} (${q.dp >= 0 ? '+' : ''}${q.dp.toFixed(2)}%)`)
          .join('\n');
        categoryContext = `
MACRO CONTEXT (REAL LIVE INDEX DATA — use these exact figures, do not invent):
${indexLines || 'No index data available — skip this category.'}
Holdings: ${positions.map((p: any) => p.symbol).join(', ') || 'None'}
GUARDRAIL: Describe the observed pattern (e.g. "QQQ down 1.2%, but your financial-heavy book is holding up"). Do NOT invent a causal explanation unless a real news headline from the fetched data supports it. Pattern only — no narrative fabrication.
`;
        break;
      }
    }

    // ── Build dynamic context (durable data only — NO intraday) ──
    const currentDate = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const dynamicContext = `
CURRENT CONTEXT:
Today: ${currentDate}
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

${categoryContext}

FOCUS INSTRUCTION: Generate a hook centered on the "${CATEGORY_GUIDANCE[category]}" category.
HOWEVER — if there is genuinely nothing interesting or actionable in that category (e.g. zero cash to comment on, no upcoming events), fall back to whatever IS most interesting. Do not force a boring observation.

ANTI-REPETITION:
${lastHooks && lastHooks.length > 0 ? `You recently said these:
${lastHooks.map((h: string) => `- "${h}"`).join('\n')}

Your new hook MUST be genuinely different. Do NOT rephrase the same observation about the same stocks. Pick a different position to highlight, or a different structural angle, or tie in macro context — anything fresh. If the last hook was about KO/AXP, mention something else entirely.` : ''}
Opener to use: "${market.opener}"
`;

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
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
        ...(factsContext ? [{
          type: 'text' as const,
          text: factsContext,
        }] : []),
      ],
      messages: [{
        role: 'user' as const,
        content: styleAck
          ? `${styleAck}[FACTS NOTE: Grounding facts are provided in system context. Cross-check your response against them — do not contradict active facts.]\n\nNow generate my regular greeting.`
          : '[FACTS NOTE: Grounding facts are provided in system context. Cross-check your response against them — do not contradict active facts.]\n\nGenerate my greeting now.',
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

    // ── Step 4: Write greeting observation back as a fact ────
    if (userId && hook) {
      // Determine subject: use the most relevant ticker mentioned in the hook
      let subject = 'portfolio';
      const symbols = positions.map((p: any) => p.symbol);
      for (const sym of symbols) {
        if (hook.toUpperCase().includes(sym.toUpperCase())) {
          subject = sym;
          break;
        }
      }
      // If hook mentions cash/portfolio-level, use portfolio
      if (subject === 'portfolio' || !symbols.some((s: string) => hook.toUpperCase().includes(s.toUpperCase()))) {
        // Check if it's about cash or general portfolio structure
        if (/cash.*idle|idle.*cash|sitting on|% cash/i.test(hook)) {
          subject = 'portfolio';
        }
      }
      const r = await writeFact(userId, {
        subject,
        fact_type: 'observation',
        claim: hook,
        confidence: 'tentative',
        source: 'greeting',
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24h
      }).catch(err => { console.error('[greeting] writeFact error:', err); return { fact: null }; });

      // Log the generation event
      genLog.flush(r?.fact ? [{ subject, claim: hook, fact_type: 'observation', id: r.fact.id }] : []);
    }

    return NextResponse.json({
      opener,
      hook,
      category,
      categoriesUsed: [category, ...recentCategories].slice(0, 3), // last 3 used
      hookType: detectHookType(hook || ''),
      styleAcknowledged: includeStyleAck && !!STYLE_GREETINGS[styleKey],
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
