/**
 * GET  /api/ai/weekly-snapshot  — Weekly portfolio health analysis.
 * DELETE /api/ai/weekly-snapshot — Force-refresh this week's snapshot.
 *
 * Caches result per-user per-week (Monday start) in weekly_snapshots table.
 * Uses Finnhub for position quotes + Claude Haiku for analysis.
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

/** Get Monday of current week as YYYY-MM-DD */
function getWeekStart(): string {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon, ...
  const diff = day === 0 ? -6 : 1 - day; // Monday of current week
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().split('T')[0];
}

// ─── GET handler ───────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const userId = await getUserIdFromSession(req);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const weekStartStr = getWeekStart();
    const supabase = createServerClient();

    // Check cache
    const { data: existing } = await (supabase as any)
      .from('weekly_snapshots')
      .select('*')
      .eq('user_id', userId)
      .eq('week_start', weekStartStr)
      .single();

    if (existing) {
      return NextResponse.json({
        content: existing.content,
        healthScore: existing.health_score,
        riskLevel: existing.risk_level,
        opportunitiesCount: existing.opportunities_count,
        weekStart: weekStartStr,
        cached: true,
      });
    }

    // Fetch positions from DB (works for both demo and live)
    const { data: positions } = await (supabase as any)
      .from('positions')
      .select('symbol, qty, market_value, avg_cost')
      .eq('user_id', userId)
      .gt('qty', 0);

    if (!positions || positions.length === 0) {
      return NextResponse.json({
        content: 'Portfolio loading. Please try again in a moment.',
        cached: false,
      });
    }

    // Fetch quotes for all position symbols
    const finnhubKey = process.env.FINNHUB_IO_API_KEY;
    const symbols = positions.map((p: any) => p.symbol);
    const quotes: Record<string, any> = {};

    if (finnhubKey) {
      await Promise.all(
        symbols.map(async (sym: string) => {
          try {
            const r = await fetch(
              `https://finnhub.io/api/v1/quote?symbol=${sym}&token=${finnhubKey}`,
              { signal: AbortSignal.timeout(5000) },
            );
            quotes[sym] = await r.json();
          } catch {
            quotes[sym] = {};
          }
        }),
      );
    }

    // Build data block
    const dataBlock = [
      `WEEKLY PORTFOLIO HEALTH CHECK — Week of ${weekStartStr}`,
      '',
      'PORTFOLIO:',
      ...(positions?.length
        ? positions.map((p: any) => {
            const q = quotes[p.symbol];
            const avgCost = p.avg_cost;
            const pnl =
              q?.c && avgCost
                ? ((q.c - avgCost) / avgCost) * 100
                : null;
            const pnlStr =
              pnl != null ? `${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}%` : 'N/A';
            return `  ${p.symbol}: ${p.qty} shares @ $${avgCost || '?'} | Current: $${q?.c || '?'} | P&L: ${pnlStr}`;
          })
        : ['No positions']),
      '',
      'Analyze portfolio health (score /10), risk level (LOW/MEDIUM/HIGH), and count investment opportunities.',
    ].join('\n');

    // Call AI
    const aiResponse = await callChatAI({
      messages: [
        {
          role: 'system',
          content: `You are Vantage AI portfolio health analyst.
Analyze the portfolio data provided.

Respond in this EXACT format:

PORTFOLIO HEALTH: X/10
[1 sentence explanation]

OVERALL RISK: LOW/MEDIUM/HIGH
[1 sentence on risk factors]

KEY STRENGTHS:
[1-2 brief points, each starting with "—"]

WATCHES:
[1-2 brief points, each starting with "—"]

OPPORTUNITIES:
[list each as "• [description]" — count these for opportunities_count]

SUMMARY: [1 sentence overall assessment]

Be specific. Use real numbers provided. Never invent. Be honest if data is incomplete.`,
        },
        {
          role: 'user',
          content: dataBlock,
        },
      ],
      maxTokens: 500,
      temperature: 0.2,
    });

    const content = aiResponse.content.trim();

    // Parse structured fields from response
    const healthMatch = content.match(/(\d+\.?\d*)\/10/);
    const healthScore = healthMatch ? parseFloat(healthMatch[1]) : null;

    const riskMatch = content.match(/OVERALL RISK:\s*(LOW|MEDIUM|HIGH)/i);
    const riskLevel = riskMatch ? riskMatch[1].toUpperCase() : null;

    const oppMatches = content.match(/•\s/g);
    const opportunitiesCount = oppMatches ? oppMatches.length : 0;

    // Save
    await (supabase as any).from('weekly_snapshots').upsert(
      {
        user_id: userId,
        week_start: weekStartStr,
        health_score: healthScore,
        risk_level: riskLevel,
        opportunities_count: opportunitiesCount,
        content,
      },
      { onConflict: 'user_id,week_start' },
    );

    return NextResponse.json({
      content,
      healthScore,
      riskLevel,
      opportunitiesCount,
      weekStart: weekStartStr,
      cached: false,
    });
  } catch (error: any) {
    console.error('[weekly-snapshot] Error:', error?.message || error);
    return NextResponse.json(
      { error: 'Failed to generate weekly snapshot' },
      { status: 500 },
    );
  }
}

// ─── DELETE handler — force-regenerate ────────────────────────

export async function DELETE(req: NextRequest) {
  try {
    const userId = await getUserIdFromSession(req);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const weekStartStr = getWeekStart();
    const supabase = createServerClient();

    await (supabase as any)
      .from('weekly_snapshots')
      .delete()
      .eq('user_id', userId)
      .eq('week_start', weekStartStr);

    return NextResponse.json({ deleted: true });
  } catch (error: any) {
    console.error('[weekly-snapshot] DELETE error:', error?.message || error);
    return NextResponse.json(
      { error: 'Failed to delete weekly snapshot' },
      { status: 500 },
    );
  }
}
