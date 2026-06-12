// ─── POST /api/baskets/generate ──────────────────────────────
// Cron-driven weekly basket refresh. Generates thematic baskets via
// Anthropic, compares with previous baskets to produce a changelog,
// deactivates old baskets, and inserts new ones with the changelog.
//
// Auth: Authorization: Bearer <CRON_SECRET>
//
// Called by VPS cron every 2 weeks (Monday 6am ET):
//   0 10 * * 1 [...] curl -X POST .../api/baskets/generate

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServerClient } from '@/lib/supabase';

const CRON_SECRET = process.env.CRON_SECRET;
if (!CRON_SECRET && process.env.NODE_ENV === 'production') {
  console.warn('[Baskets] CRON_SECRET not set — endpoint will reject all requests');
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  defaultHeaders: {
    'anthropic-beta': 'prompt-caching-2024-07-31',
  },
});

const THEMES = [
  { key: 'ai_tech', emoji: '🤖', name: 'AI & Tech' },
  { key: 'clean_energy', emoji: '🌱', name: 'Clean Energy' },
  { key: 'healthcare', emoji: '🏥', name: 'Healthcare' },
  { key: 'financials', emoji: '🏦', name: 'Financials' },
  { key: 'defense', emoji: '🛡️', name: 'Defense' },
  { key: 'consumer', emoji: '🛒', name: 'Consumer' },
  { key: 'infrastructure', emoji: '🏗️', name: 'Infrastructure' },
  { key: 'emerging', emoji: '🌍', name: 'Emerging Markets' },
];

const BASKET_SYSTEM_PROMPT = `You are Vantage AI, a world-class portfolio strategist.
Build a thematic investment basket of 5-8 high-conviction US-listed stocks.

Return ONLY valid JSON — no markdown, no explanation, no code fences.

Format:
{
  "theme": "theme name",
  "rationale": "2-sentence macro thesis for why this theme matters now",
  "stocks": [
    {
      "symbol": "TICKER",
      "name": "Full Company Name",
      "allocation": 20,
      "rationale": "one line — why this stock specifically fits the theme TODAY"
    }
  ]
}

Rules:
- EXACTLY 5-8 stocks. Not less, not more.
- Allocations must sum to exactly 100.
- Use only highly liquid US-listed stocks (no OTC, no ADRs unless essential).
- Weight toward your highest-conviction picks.
- Every stock MUST genuinely fit the theme — no padding.
- Be fresh. Do NOT recommend the same stocks every time. Rotate intelligently.
- Prefer stocks with recent catalysts: earnings beats, upgrades, product launches.
- Avoid stocks with major recent scandals or delisting risk.`;

export async function POST(req: NextRequest) {
  // ── Auth check ──
  if (CRON_SECRET) {
    const auth = req.headers.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (token !== CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const supabase = createServerClient();
    const weekOf = new Date().toISOString().split('T')[0];

    // ── Fetch previous active baskets for changelog ──
    const { data: prevBaskets } = await (supabase as any)
      .from('baskets')
      .select('id, theme, name, emoji, stocks')
      .eq('is_active', true);

    console.log('[Baskets] Generating', THEMES.length, 'themes. Prev baskets:', prevBaskets?.length || 0);

    // ── Generate one basket per theme (sequential to avoid rate limits) ──
    const enrichedBaskets: any[] = [];

    for (const theme of THEMES) {
      try {
        const userMessage = [
          `Build a "${theme.name}" (${theme.emoji}) basket.`,
          `Theme: ${theme.key.replace(/_/g, ' ')}`,
          `Focus on stocks that represent this theme right now — current market conditions, recent catalysts, sector momentum.`,
          `Budget: $10,000 (for reference — allocations are percentage-based).`,
        ].join('\n');

        const response = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          system: [
            {
              type: 'text' as const,
              text: BASKET_SYSTEM_PROMPT,
              cache_control: { type: 'ephemeral' as const },
            },
          ],
          messages: [{ role: 'user' as const, content: userMessage }],
        });

        const text = (response.content as any[])
          .map((block: any) => block.type === 'text' ? block.text : '')
          .join('')
          .trim();

        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          console.warn(`[Baskets] No JSON in response for ${theme.name}. Raw:`, text.slice(0, 200));
          continue;
        }

        const parsed = JSON.parse(jsonMatch[0]);
        if (!parsed.stocks?.length) {
          console.warn(`[Baskets] No stocks in parsed response for ${theme.name}`);
          continue;
        }

        // Validate allocations sum to ~100
        const totalAlloc = parsed.stocks.reduce((sum: number, s: any) => sum + (s.allocation || 0), 0);
        if (Math.abs(totalAlloc - 100) > 1) {
          // Normalize
          parsed.stocks = parsed.stocks.map((s: any) => ({
            ...s,
            allocation: +((s.allocation / totalAlloc) * 100).toFixed(1),
          }));
        }

        enrichedBaskets.push({
          theme: theme.key,
          name: parsed.theme || theme.name,
          emoji: theme.emoji,
          rationale: parsed.rationale || '',
          stocks: parsed.stocks,
          week_of: weekOf,
          is_active: true,
          user_id: 'system', // system-generated basket
          status: 'active' as const,
        });

        console.log(`[Baskets] ✅ ${theme.name}: ${parsed.stocks.length} stocks`);
      } catch (err: any) {
        console.error(`[Baskets] Failed to generate ${theme.name}:`, err.message);
      }
    }

    if (enrichedBaskets.length === 0) {
      return NextResponse.json({ error: 'Failed to generate any baskets' }, { status: 500 });
    }

    // ── Generate changelog vs previous baskets ──
    let changelog: string | null = null;
    if (prevBaskets && prevBaskets.length > 0) {
      try {
        const prevSummary = prevBaskets
          .filter((b: any) => b.stocks?.length > 0)
          .map((b: any) => ({
            theme: b.theme || b.name,
            stocks: (b.stocks || []).map((s: any) => s.symbol),
          }));

        const newSummary = enrichedBaskets.map((b: any) => ({
          theme: b.theme,
          stocks: (b.stocks || []).map((s: any) => s.symbol),
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
    const { error: insertErr } = await (supabase as any)
      .from('baskets')
      .insert(enrichedBaskets.map((b: any) => ({
        ...b,
        changelog: changelog || undefined,
      })));

    if (insertErr) {
      console.error('[Baskets] Insert error:', insertErr.message);
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
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
