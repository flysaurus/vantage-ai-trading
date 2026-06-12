// ─── POST /api/baskets/generate ──────────────────────────────
// Cron-driven bi-weekly basket generation. Generates 6 thematic
// baskets via Anthropic Sonnet, fetches real Finnhub performance
// (3m/ytd/1y) per stock, computes weighted basket performance,
// generates changelog vs previous baskets, and deactivates/inserts.
//
// Auth: Authorization: Bearer <CRON_SECRET>
//
// Cron: 0 10 * * 1 (bi-weekly Monday 6am ET)

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServerClient } from '@/lib/supabase';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  defaultHeaders: {
    'anthropic-beta': 'prompt-caching-2024-07-31',
  },
});

// ── Fetch Finnhub performance data for a stock ────────────────
// NOT called during cron generation (too many calls for Vercel's
// 60s timeout). Performance is fetched separately by the client
// or a lighter dedicated endpoint.

async function fetchStockPerformance(symbol: string): Promise<{
  '3m': number; ytd: number; '1y': number;
  price: number; best_timeframe: string;
}> {
  try {
    const [quoteRes, metricRes] = await Promise.all([
      fetch(
        `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${process.env.FINNHUB_IO_API_KEY}`,
        { signal: AbortSignal.timeout(5000) },
      ).then(r => r.ok ? (r.json() as any) : { c: 0 }).catch(() => ({ c: 0 })),
      fetch(
        `https://finnhub.io/api/v1/stock/metric?symbol=${symbol}&metric=all&token=${process.env.FINNHUB_IO_API_KEY}`,
        { signal: AbortSignal.timeout(5000) },
      ).then(r => r.ok ? (r.json() as any) : { metric: {} }).catch(() => ({ metric: {} })),
    ]);

    const currentPrice = quoteRes.c || 0;
    const m = metricRes.metric || {};

    // Use metric data if available, else fallback to 0
    const threeMonthReturn = m['13WeekPriceReturnDaily'] ?? 0;
    const ytdReturn = m.ytdPriceReturnDaily ?? m.ytdReturnDaily ?? 0;
    const oneYearReturn = m['52WeekPriceReturnDaily'] ?? 0;
    const high52 = m['52WeekHigh'] || currentPrice;
    const low52 = m['52WeekLow'] || currentPrice;
    const high52return = low52 > 0 ? ((currentPrice - low52) / low52) * 100 : 0;

    // Use the best available metric for 1y, fallback to 52-week range return
    const ret1y = oneYearReturn !== 0 ? oneYearReturn : high52return;
    const retYtd = ytdReturn;
    const ret3m = threeMonthReturn;

    const performances = {
      '3m': Math.round(ret3m * 10) / 10,
      'ytd': Math.round(retYtd * 10) / 10,
      '1y': Math.round(ret1y * 10) / 10,
    };

    const best = (Object.entries(performances) as [string, number][])
      .sort(([, a], [, b]) => b - a)[0][0];

    return {
      ...performances,
      price: currentPrice,
      best_timeframe: best,
    };
  } catch {
    return { '3m': 0, ytd: 0, '1y': 0, price: 0, best_timeframe: '1y' };
  }
}

// ── Basket generation system prompt ───────────────────────────

const BASKET_GENERATION_PROMPT = `You are Vantage AI, a portfolio construction expert. Generate 6 thematic investment baskets that are relevant for the current market environment.

For each basket return ONLY valid JSON. No markdown, no explanation, just the JSON array.

Required format:
[
  {
    "theme": "ai_infrastructure",
    "emoji": "🤖",
    "name": "AI Infrastructure",
    "thesis": "One sentence — why this theme NOW. Be specific about current catalyst.",
    "risk_note": "One sentence — key risk to watch.",
    "stocks": [
      {
        "symbol": "TICKER",
        "name": "Full Company Name",
        "allocation": 20,
        "rationale": "One line — why this stock for this theme."
      }
    ]
  }
]

RULES:
- Exactly 6 baskets
- Each basket has 5-7 stocks
- Allocations per basket must sum to exactly 100
- Use only liquid US-listed stocks
- Each stock rationale must be specific, not generic
- Thesis must reference current market conditions
- Risk note must be honest and specific
- Never include the same stock in multiple baskets

REQUIRED BASKET THEMES (always include these 6, but update stocks based on current conditions):
1. AI Infrastructure (compute, networking, data)
2. GLP-1 & Healthcare Innovation
3. Financial Sector Winners
4. Defense & Aerospace
5. Quality Compounders (boring but reliable)
6. Emerging Market Leaders`;

// ─── POST handler ─────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log('[Baskets] Starting generation...');

    const supabase = createServerClient();

    // Get previous baskets for changelog
    const { data: prevBaskets } = await (supabase as any)
      .from('baskets')
      .select('id, theme, stocks')
      .eq('is_active', true);

    // Generate baskets with Sonnet
    const today = new Date().toLocaleDateString();
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: [
        {
          type: 'text' as const,
          text: BASKET_GENERATION_PROMPT,
          cache_control: { type: 'ephemeral' as const },
        },
      ],
      messages: [{
        role: 'user' as const,
        content: `Generate the 6 baskets for ${today}. Current market context: pre-market futures flat, tech sector leading YTD. Return ONLY the JSON array.`,
      }],
    });

    const text = response.content[0]?.type === 'text'
      ? (response.content[0] as any).text
      : '';

    // Parse JSON — strip any markdown if present
    const clean = text
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    let baskets: any[];
    try {
      baskets = JSON.parse(clean);
      if (!Array.isArray(baskets)) throw new Error('Not an array');
    } catch {
      console.error('[Baskets] Failed to parse JSON. Raw:', text.slice(0, 500));
      return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 });
    }

    // ── Build baskets (fast path, no Finnhub — VPS cron enriches perf later) ──
    console.log('[Baskets] Building', baskets.length, 'baskets (performance via VPS cron)...');

    const weekOf = new Date().toISOString().split('T')[0];

    const enrichedBaskets = baskets.map((basket: any) => {
      const stocks = (basket.stocks || []).map((stock: any) => ({
        ...stock,
        price: 0,
        shares: +(stock.allocation / 100).toFixed(4),
        performance: { '3m': 0, ytd: 0, '1y': 0 },
      }));

      return {
        theme: basket.theme,
        emoji: basket.emoji,
        name: basket.name,
        thesis: basket.thesis || '',
        risk_note: basket.risk_note || '',
        stocks,
        performance: { '3m': 0, ytd: 0, '1y': 0, best_timeframe: '1y' },
        week_of: weekOf,
        is_active: true,
      };
    });

    // ── Generate changelog vs previous baskets ──
    let changelog: string | null = null;
    if (prevBaskets && prevBaskets.length > 0) {
      try {
        const prevSummary = prevBaskets
          .filter((b: any) => b.stocks?.length > 0)
          .map((b: any) => ({
            theme: b.theme,
            stocks: (Array.isArray(b.stocks) ? b.stocks : []).map((s: any) => s.symbol),
          }));

        const newSummary = enrichedBaskets.map(b => ({
          theme: b.theme,
          stocks: b.stocks.map((s: any) => s.symbol),
        }));

        const changelogRes = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 300,
          messages: [{
            role: 'user' as const,
            content: `Previous baskets stocks: ${JSON.stringify(prevSummary)}

New baskets stocks: ${JSON.stringify(newSummary)}

Write a 1-2 sentence changelog describing what changed and why. Be specific about ticker changes.
Example: "Replaced TSLA with RIVN in EV basket on margin improvement. Added PLTR to AI Infrastructure on government contract momentum."

If nothing changed write: "No changes this refresh."`,
          }],
        });

        changelog = changelogRes.content[0]?.type === 'text'
          ? (changelogRes.content[0] as any).text?.trim()
          : null;
      } catch (err: any) {
        console.error('[Baskets] Changelog generation failed:', err.message);
      }
    }

    // ── Deactivate old active baskets ──
    const { error: deactivateErr } = await (supabase as any)
      .from('baskets')
      .update({ is_active: false })
      .eq('is_active', true);

    if (deactivateErr) {
      console.error('[Baskets] Deactivate error:', deactivateErr.message);
    }

    // ── Insert new baskets ──
    const insertData = enrichedBaskets.map(b => ({
      ...b,
      stocks: JSON.stringify(b.stocks),
      performance: JSON.stringify(b.performance),
      changelog: changelog || undefined,
    }));

    const { data: inserted, error: insertErr } = await (supabase as any)
      .from('baskets')
      .insert(insertData)
      .select('id, theme');

    if (insertErr) {
      console.error('[Baskets] Insert error:', insertErr.message);
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    // ── Insert changelog records ──
    if (changelog && inserted) {
      const changelogEntries = inserted.map((b: any) => ({
        basket_id: b.id,
        week_of: weekOf,
        changes: changelog,
      }));

      await (supabase as any)
        .from('basket_changelogs')
        .insert(changelogEntries)
        .then(() => {})
        .catch((err: any) => console.error('[Baskets] Changelog insert error:', err.message));
    }

    console.log('[Baskets] Generated', enrichedBaskets.length, 'baskets');

    return NextResponse.json({
      success: true,
      count: enrichedBaskets.length,
      weekOf,
      changelog,
    });
  } catch (error: any) {
    console.error('[Baskets] Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
