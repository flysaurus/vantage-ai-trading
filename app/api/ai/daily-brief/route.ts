/**
 * GET /api/ai/daily-brief — Daily market brief tailored to user's portfolio.
 *
 * Caches result per-user per-date in daily_briefs table.
 * Regeneration triggers on the next day's first request.
 *
 * Uses Finnhub for real market data (indices + positions).
 * AI text generation via Claude Haiku (callChatAI).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { callChatAI } from '@/lib/ai-provider';
import type { SystemBlock } from '@/lib/ai-provider';
import { buildUserProfileContext } from '@/lib/ai/userProfile';
import type { UserProfile } from '@/lib/ai/userProfile';
import { getOptionalUserId } from '@/lib/auth/get-server-user';
import { checkUsageLimit, incrementUsage } from '@/lib/ai-guard';

const SEARXNG_URL = process.env.SEARXNG_URL || 'http://85.239.230.26:8888';

// Static format instructions — cached across all daily brief requests
const DAILY_BRIEF_STATIC: SystemBlock = {
  type: 'text',
  text: `You are Vantage AI daily briefing engine.
Write a concise daily brief using real news items AND
portfolio data provided below. NEVER invent numbers.
NEVER say "no positions held."
Use the actual holdings data provided.

VOICE: Sharp analyst texting their notes to a friend, not a Bloomberg terminal report.
Use real numbers. Call out what's actually wrong. Don't soften bad news.
Don't describe the market academically. Tell the user what it means for THEIR portfolio specifically. If tech is selling off and they're 40% tech — say that directly and what it means for their day.

SENTIMENT DATA: Each news headline includes a FinBERT sentiment score (positive/negative/neutral).
Use these to weight your tone. Strongly negative headlines about held positions should make the WATCH or PORTFOLIO line more urgent.
Strongly positive headlines about held positions should be reflected in the PORTFOLIO line.

FORMAT (exactly 4 lines, no headers, no bullets):
Line 1 - MARKET: One sentence on market direction with real index numbers
Line 2 - PORTFOLIO: One sentence mentioning 1-2 specific holdings and their move today
Line 3 - WATCH: One sentence on the most important thing to monitor today (from real news if available)
Line 4 - EARNINGS: Only include if earnings exist for holdings this week. Skip this line if no earnings.

Keep each line under 15 words.
Start each line with the label: MARKET: PORTFOLIO: WATCH: EARNINGS:`,
  cache_control: { type: 'ephemeral' },
};

// ─── Fetch real market news from SearXNG ──────────────
async function fetchMarketNews(
  positions: any[]
): Promise<{ title: string; url: string; source: string }[]> {
  const topTickers = positions
    .sort((a: any, b: any) => (b.marketValue || 0) - (a.marketValue || 0))
    .slice(0, 3)
    .map((p: any) => p.symbol);

  const queries = [
    'stock market news today',
    `${topTickers[0] || 'SPY'} stock news`,
    `${topTickers[1] || ''} ${topTickers[2] || ''} earnings`,
  ].filter(q => q.trim());

  const allNews: { title: string; url: string; source: string }[] = [];

  for (const query of queries) {
    try {
      const res = await fetch(
        `${SEARXNG_URL}/search?q=${encodeURIComponent(query)}&format=json&categories=news&language=en`,
        { signal: AbortSignal.timeout(5000) },
      );
      const data = await res.json();

      if (data.results?.length) {
        allNews.push(
          ...data.results.slice(0, 2).map((r: any) => ({
            title: r.title,
            url: r.url,
            source: r.engine || 'News',
          })),
        );
      }
    } catch {
      console.log('[Brief] SearXNG unavailable for:', query);
    }
  }

  return allNews.slice(0, 5);
}

// ─── Auth (same pattern as app/api/chat/route.ts) ──────────────
// ─── GET handler ───────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    // 1. Auth
    const userId = await getOptionalUserId();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 1. Parse query params
    const { searchParams } = new URL(req.url);
    const forceRegen = searchParams.get('forceRegen') === 'true';
    const today = new Date().toISOString().split('T')[0];
    const supabase = createServerClient();

    // 2. Check cache (no usage check for cached reads)
    const { data: existing } = await (supabase as any)
      .from('daily_briefs')
      .select('content, market_summary, generated_at')
      .eq('user_id', userId)
      .eq('date', today)
      .maybeSingle();

    if (existing && !forceRegen) {
      return NextResponse.json({
        content: existing.content,
        marketSummary: existing.market_summary,
        generatedAt: existing.generated_at,
        cached: true,
      });
    }

    // 3. Usage limit check (only when generating fresh content)
    const usageCheck = await checkUsageLimit(userId, 'dailyBrief');
    if (!usageCheck.allowed) {
      return NextResponse.json(
        { error: 'Daily brief limit reached', reason: usageCheck.reason },
        { status: 429 },
      );
    }

    // 3. Get live portfolio state
    // Check both demo_portfolio_state and broker-backed positions
    let positions: any[] = [];
    let cashBalance = 0;
    let holdingsUnavailable = false;
    let isBrokerConnected = false;

    // Check if user has a connected broker
    try {
      const { data: vault } = await (supabase as any)
        .from('vault')
        .select('provider')
        .eq('user_id', userId)
        .maybeSingle();
      isBrokerConnected = !!vault?.provider;

      if (isBrokerConnected) {
        // For broker users, positions are in the positions table
        const { data: brokerPositions } = await (supabase as any)
          .from('positions')
          .select('*')
          .eq('user_id', userId)
          .neq('qty', 0);
        positions = brokerPositions || [];
        cashBalance = 0; // Will be computed below if we have positions

        // Check if broker holdings are unavailable (from account status)
        const { data: brokerAccounts } = await (supabase as any)
          .from('broker_accounts')
          .select('sync_status')
          .eq('user_id', userId);
        if (brokerAccounts?.length) {
          holdingsUnavailable = brokerAccounts.some(
            (a: any) => a.sync_status?.holdings?.holdings_unavailable === true
          );
        }
      }
    } catch { /* ignore */ }

    // Fallback to demo state
    if (!isBrokerConnected) {
      const { data: demoState } = await (supabase as any)
        .from('demo_portfolio_state')
        .select('positions, cash_balance')
        .eq('user_id', userId)
        .maybeSingle();
      positions = demoState?.positions || [];
      cashBalance = demoState?.cash_balance ?? 0;
    }

    if (holdingsUnavailable) {
      return NextResponse.json({
        content: null,
        reason: 'holdings_unavailable',
        message: 'I can see your total value but not individual holdings for this account.',
        cached: false,
        generatedAt: new Date().toISOString(),
      });
    }

    if (!positions || positions.length === 0) {
      return NextResponse.json({
        content: null,
        reason: 'no_positions',
        cached: false,
        generatedAt: new Date().toISOString(),
      });
    }

    // 4. Fetch market data from Finnhub
    const finnhubKey = process.env.FINNHUB_IO_API_KEY;
    if (!finnhubKey) {
      return NextResponse.json(
        { error: 'Finnhub API key not configured' },
        { status: 500 },
      );
    }

    // Fetch indices
    const indices = await Promise.all(
      ['SPY', 'QQQ', 'IWM'].map(async (sym) => {
        const r = await fetch(
          `https://finnhub.io/api/v1/quote?symbol=${sym}&token=${finnhubKey}`,
          { signal: AbortSignal.timeout(5000) },
        );
        const d = await r.json();
        return { sym, price: d.c, changePct: d.dp };
      }),
    );

    // Fetch quotes for all position symbols
    const positionSymbols = positions.map((p: any) => p.symbol);
    const quotesMap: Record<string, any> = {};

    await Promise.all(
      positionSymbols.map(async (sym: string) => {
        try {
          const r = await fetch(
            `https://finnhub.io/api/v1/quote?symbol=${sym}&token=${finnhubKey}`,
            { signal: AbortSignal.timeout(5000) },
          );
          quotesMap[sym] = await r.json();
        } catch {
          quotesMap[sym] = {};
        }
      }),
    );

    // Build position data with quotes, sort by absolute change
    interface PositionQuote {
      symbol: string;
      qty: number;
      price: number;
      changePct: number;
      avgCost: number;
      name: string;
      sector: string;
      marketValue: number;
    }

    const positionsWithQuotes: PositionQuote[] = positions.map((p: any) => {
      const q = quotesMap[p.symbol] || {};
      const currentPrice = q.c ?? 0;
      return {
        symbol: p.symbol,
        qty: p.qty,
        price: currentPrice,
        changePct: q.dp ?? 0,
        avgCost: p.avgCost ?? 0,
        name: p.name || p.symbol,
        sector: p.sector || 'Unknown',
        marketValue: (p.qty || 0) * currentPrice,
      };
    });

    // Sort by absolute change for top movers
    const sortedByChange = [...positionsWithQuotes].sort(
      (a, b) => Math.abs(b.changePct) - Math.abs(a.changePct),
    );

    const top6 = sortedByChange.slice(0, 6);
    const biggestMover = sortedByChange[0];

    // 5. Get upcoming earnings for user's holdings this week
    const in7 = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
    let relevantEarnings: any[] = [];
    try {
      const earningsRes = await fetch(
        `https://finnhub.io/api/v1/calendar/earnings?from=${today}&to=${in7}&token=${finnhubKey}`,
        { signal: AbortSignal.timeout(5000) },
      );
      const earnings = await earningsRes.json();
      relevantEarnings = (earnings.earningsCalendar || []).filter((e: any) =>
        positions?.some((p: any) => p.symbol === e.symbol),
      );
    } catch {
      relevantEarnings = [];
    }

    // 7. Fetch real market news from SearXNG
    const newsItems = await fetchMarketNews(positionsWithQuotes);

    // 8. Build user profile context
    let investorStyle = 'buffett';
    let portfolioMode = 'demo';
    try {
      const { data: userData } = await (supabase as any)
        .from('users')
        .select('investor_style')
        .eq('id', userId)
        .maybeSingle();
      if (userData?.investor_style) {
        investorStyle = userData.investor_style;
      }
      // Check if connected to broker
      const { data: vaultData } = await (supabase as any)
        .from('vault')
        .select('provider')
        .eq('user_id', userId)
        .maybeSingle();
      if (vaultData?.provider) {
        portfolioMode = vaultData.provider === 'alpaca' ? 'live' : 'demo';
      }
    } catch {
      // use defaults
    }

    const styleMap: Record<string, UserProfile['investorStyle']> = {
      buffett: 'Buffett', lynch: 'Lynch', livermore: 'Livermore',
      munger: 'Munger', soros: 'Soros', growth: 'Lynch', dividend: 'Buffett',
    };
    const profile: UserProfile = {
      investorStyle: styleMap[investorStyle] || 'Lynch',
      riskTolerance: 'Moderate',
      name: investorStyle.charAt(0).toUpperCase() + investorStyle.slice(1),
      timezone: req.nextUrl.searchParams.get('tz') || 'America/New_York',
    };
    const profileContext = buildUserProfileContext(profile);

    // 9. Build data block for AI
    const dateStr = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: req.nextUrl.searchParams.get('tz') || 'America/New_York',
    });

    const cashPct = cashBalance > 0
      ? (cashBalance / (cashBalance + positionsWithQuotes.reduce((s, p) => s + (p.marketValue || 0), 0))) * 100
      : 0;

    const dataLines: string[] = [
      `DAILY BRIEF DATA — ${dateStr}`,
      `Investor Style: ${investorStyle} | Portfolio Mode: ${portfolioMode}`,
      `Total Positions: ${positions.length}`,
      `Cash Balance: $${cashBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })} (${cashPct.toFixed(1)}% of portfolio)`,
      '',
      'MARKET INDICES:',
      ...indices.map(
        (i) =>
          `${i.sym}: $${i.price?.toFixed(2) || '?'} (${i.changePct != null ? (i.changePct > 0 ? '+' : '') + i.changePct.toFixed(2) + '%' : 'N/A'})`,
      ),
      '',
      `TOP ${Math.min(6, top6.length)} HOLDINGS BY MOVEMENT:`,
      ...top6.map(
        (p) =>
          `  ${p.symbol}: $${p.price?.toFixed(2) || '?'} (${p.changePct != null ? (p.changePct > 0 ? '+' : '') + p.changePct.toFixed(2) + '%' : 'N/A'}) · ${p.qty} shares`,
      ),
      '',
    ];

    if (biggestMover) {
      dataLines.push(
        `BIGGEST MOVER: ${biggestMover.symbol} ${biggestMover.changePct > 0 ? 'up' : 'down'} ${Math.abs(biggestMover.changePct || 0).toFixed(2)}%`,
      );
      dataLines.push('');
    }

    dataLines.push('EARNINGS THIS WEEK:');
    if (relevantEarnings.length > 0) {
      dataLines.push(
        ...relevantEarnings.map((e: any) => `  ${e.symbol}: reports ${e.date}`),
      );
    } else {
      dataLines.push('  (none — no holdings reporting earnings this week)');
    }

    // Add real news items with FinBERT sentiment
    if (newsItems.length > 0) {
      dataLines.push('');
      dataLines.push('REAL NEWS HEADLINES (use these — do not fabricate):');

      // Score headlines with FinBERT directly (parallel)
      const FINBERT_URL = process.env.FINBERT_URL || 'http://127.0.0.1:8765';
      let sentimentScores: { overall: string; score: number }[] = [];
      try {
        const results = await Promise.allSettled(
          newsItems.map(async (n) => {
            const res = await fetch(`${FINBERT_URL}/analyze`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: n.title }),
              signal: AbortSignal.timeout(3000),
            });
            if (!res.ok) return { overall: 'neutral', score: 0 };
            const fb = await res.json();
            return {
              overall: fb.label === 'positive' ? 'positive' : fb.label === 'negative' ? 'negative' : 'neutral',
              score: fb.score || 0,
            };
          })
        );
        sentimentScores = results.map(r =>
          r.status === 'fulfilled' ? r.value : { overall: 'neutral', score: 0 }
        );
      } catch {
        sentimentScores = newsItems.map(() => ({ overall: 'neutral', score: 0 }));
      }

      dataLines.push(
        ...newsItems.map((n, i) => {
          const s = sentimentScores[i] || { overall: 'neutral', score: 0 };
          const scoreStr = s.score !== 0 ? ` (${s.score > 0 ? '+' : ''}${s.score.toFixed(2)})` : '';
          return `  [${i + 1}] ${n.title} (${n.source}) — Sentiment: ${s.overall}${scoreStr}`;
        })
      );
    }

    // Add profile context
    dataLines.push('');
    dataLines.push(profileContext);

    const dataBlock = dataLines.join('\n');

    // 8. Call AI with cached static format instructions
    const aiResponse = await callChatAI({
      model: 'claude-haiku-4-5',
      messages: [
        {
          role: 'user',
          content: dataBlock,
        },
      ],
      systemBlocks: [DAILY_BRIEF_STATIC],
      maxTokens: 200,
      temperature: 0.2,
    });

    const content = aiResponse.content.trim();

    // Track usage
    const totalTokens = aiResponse.tokensUsed || 0;
    const cost = (totalTokens / 1_000_000) * 1; // Haiku pricing
    try {
      await incrementUsage(userId, 'dailyBrief', totalTokens, cost);
    } catch (e) {
      console.error('[daily-brief] incrementUsage failed:', e);
    }
    const generatedAt = new Date().toISOString();

    // 9. Save to cache
    await (supabase as any).from('daily_briefs').upsert(
      {
        user_id: userId,
        date: today,
        content,
        market_summary: {
          spy: indices[0],
          qqq: indices[1],
          iwm: indices[2],
        },
        generated_at: generatedAt,
      },
      { onConflict: 'user_id,date' },
    );

    return NextResponse.json({
      content,
      marketSummary: {
        spy: indices[0],
        qqq: indices[1],
        iwm: indices[2],
      },
      generatedAt,
      cached: false,
    });
  } catch (error: any) {
    console.error('[daily-brief] Error:', error?.message || error);
    return NextResponse.json(
      { error: 'Failed to generate daily brief' },
      { status: 500 },
    );
  }
}

/** DELETE /api/ai/daily-brief — Clear today's cached brief for regeneration */
export async function DELETE(req: NextRequest) {
  try {
    const userId = await getOptionalUserId();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const today = new Date().toISOString().split('T')[0];
    const supabase = createServerClient();

    await (supabase as any)
      .from('daily_briefs')
      .delete()
      .eq('user_id', userId)
      .eq('date', today);

    return NextResponse.json({ deleted: true });
  } catch (error: any) {
    console.error('[daily-brief] DELETE error:', error?.message || error);
    return NextResponse.json({ deleted: true });
  }
}
