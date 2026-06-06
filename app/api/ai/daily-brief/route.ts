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

// ─── Auth (same pattern as app/api/chat/route.ts) ──────────────

async function getUserIdFromSession(req: NextRequest): Promise<string | null> {
  const sessionCookie = req.cookies.get('session')?.value || '';
  if (!sessionCookie) return null;

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
      .eq('session_token_hash', sessionHash)
      .maybeSingle();
    return data?.user_id || null;
  } catch {
    return null;
  }
}

// ─── GET handler ───────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    // 1. Auth
    const userId = await getUserIdFromSession(req);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Check cache
    const today = new Date().toISOString().split('T')[0];
    const supabase = createServerClient();

    const { data: existing } = await (supabase as any)
      .from('daily_briefs')
      .select('content, market_summary, generated_at')
      .eq('user_id', userId)
      .eq('date', today)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({
        content: existing.content,
        marketSummary: existing.market_summary,
        generatedAt: existing.generated_at,
        cached: true,
      });
    }

    // 3. Get positions from DB
    const { data: positions } = await (supabase as any)
      .from('positions')
      .select('symbol, qty, market_value')
      .eq('user_id', userId)
      .gt('qty', 0);

    if (!positions || positions.length === 0) {
      return NextResponse.json({
        content: null,
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
    }

    const positionsWithQuotes: PositionQuote[] = positions.map((p: any) => {
      const q = quotesMap[p.symbol] || {};
      return {
        symbol: p.symbol,
        qty: p.qty,
        price: q.c ?? 0,
        changePct: q.dp ?? 0,
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

    // 6. Get investor style
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

    // 7. Build data block for AI
    const dateStr = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'America/New_York',
    });

    const dataLines: string[] = [
      `DAILY BRIEF DATA — ${dateStr}`,
      `Investor Style: ${investorStyle} | Portfolio Mode: ${portfolioMode}`,
      `Total Positions: ${positions.length}`,
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

    const dataBlock = dataLines.join('\n');

    // 8. Call AI with strict format prompt
    const aiResponse = await callChatAI({
      messages: [
        {
          role: 'system',
          content: `You are Vantage AI daily briefing engine.
Write a concise daily brief using ONLY the data provided.
NEVER invent numbers. NEVER say "no positions held."
Use the actual holdings data provided.

FORMAT (exactly 4 lines, no headers, no bullets):
Line 1 - MARKET: One sentence on market direction with specific index numbers
Line 2 - PORTFOLIO: One sentence mentioning 1-2 specific holdings and their move today
Line 3 - WATCH: One sentence on the most important thing to monitor today
Line 4 - EARNINGS: Only include if earnings exist for holdings this week. Skip this line if no earnings.

Keep each line under 15 words.
Start each line with the label: MARKET: PORTFOLIO: WATCH: EARNINGS:`,
        },
        {
          role: 'user',
          content: dataBlock,
        },
      ],
      maxTokens: 200,
      temperature: 0.2,
    });

    const content = aiResponse.content.trim();
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
