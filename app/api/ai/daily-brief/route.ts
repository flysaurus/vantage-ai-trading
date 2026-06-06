/**
 * GET /api/ai/daily-brief — Daily market brief tailored to user's portfolio.
 *
 * Caches result per-user per-date in daily_briefs table.
 * Regeneration triggers on the next day's first request.
 *
 * Uses Finnhub for real market data (indices + upcoming earnings).
 * AI text generation via Claude Haiku (callChatAI).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { callChatAI } from '@/lib/ai-provider';
import { getDemoPortfolio, isUserInDemo } from '@/lib/demo-data';
import type { Database } from '@/types/supabase';

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
      .select('content, market_summary')
      .eq('user_id', userId)
      .eq('date', today)
      .single();

    if (existing) {
      return NextResponse.json({
        content: existing.content,
        marketSummary: existing.market_summary,
        cached: true,
      });
    }

    // 3. Fetch market data from Finnhub
    const finnhubKey = process.env.FINNHUB_IO_API_KEY;
    if (!finnhubKey) {
      return NextResponse.json(
        { error: 'Finnhub API key not configured' },
        { status: 500 },
      );
    }

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

    // Check if user is in demo mode
    const { data: userProfile } = await (supabase as any)
      .from('users')
      .select('broker_connected, investor_style')
      .eq('id', userId)
      .single();

    const isDemo = isUserInDemo(userProfile);
    const investorStyle = userProfile?.investor_style || 'lynch';

    // Get positions (real or demo)
    let positions: Array<{ symbol: string; qty: number; market_value?: number }> = [];
    
    if (isDemo) {
      const demoData = getDemoPortfolio(investorStyle);
      positions = demoData.positions.map(p => ({
        symbol: p.symbol,
        qty: p.qty,
      }));
    } else {
      const { data: dbPositions } = await (supabase as any)
        .from('positions')
        .select('symbol, qty, market_value')
        .eq('user_id', userId)
        .gt('qty', 0);
      positions = dbPositions || [];
    }

    // Get upcoming earnings for user's holdings
    const in7 = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
    let relevantEarnings: any[] = [];
    try {
      const earningsRes = await fetch(
        `https://finnhub.io/api/v1/calendar/earnings?from=${today}&to=${in7}&token=${finnhubKey}`,
        { signal: AbortSignal.timeout(5000) },
      );
      const earnings = await earningsRes.json();
      relevantEarnings = (earnings.earningsCalendar || []).filter((e: any) =>
        positions?.some((p: { symbol: string }) => p.symbol === e.symbol),
      );
    } catch {
      // Earnings fetch is best-effort
      relevantEarnings = [];
    }

    // 4. Build prompt
    const dataBlock = [
      `DAILY BRIEF DATA — ${new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York' })}`,
      '',
      'MARKET TODAY:',
      ...indices.map(
        (i) =>
          `${i.sym}: $${i.price?.toFixed(2) || '?'} (${i.changePct != null ? (i.changePct > 0 ? '+' : '') + i.changePct.toFixed(2) + '%' : 'N/A'})`,
      ),
      '',
      `PORTFOLIO: ${positions?.length || 0} positions`,
      ...(positions?.length
        ? positions.map((p: { symbol: string; qty: number }) => `  ${p.symbol}: ${p.qty} shares`)
        : ['No positions']),
      '',
      'EARNINGS THIS WEEK:',
      ...(relevantEarnings.length > 0
        ? relevantEarnings.map((e: any) => `  ${e.symbol}: ${e.date}`)
        : ['No earnings for your holdings this week']),
    ].join('\n');

    // 5. Call AI
    const aiResponse = await callChatAI({
      messages: [
        {
          role: 'system',
          content: `You are Vantage AI daily briefing engine.
Write a concise daily brief using ONLY the data provided.
Never invent numbers or fabricate information.
Format EXACTLY:

MARKET: [1 sentence on SPY/QQQ direction — bullish, bearish, flat]
PORTFOLIO: [1 sentence — context about today vs holdings]
WATCH: [1 sentence — most important thing to watch today]
${relevantEarnings.length > 0 ? 'EARNINGS: [symbol] reports [date]' : ''}

Maximum 4 lines total.
Professional but clear.
No bullet points, no markdown — plain short sentences only.`,
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

    // 6. Save to cache
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
