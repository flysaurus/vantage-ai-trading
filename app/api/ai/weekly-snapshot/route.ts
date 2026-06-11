/**
 * GET  /api/ai/weekly-snapshot  — Weekly portfolio health analysis.
 * DELETE /api/ai/weekly-snapshot — Force-refresh this week's snapshot.
 *
 * Caches result per-user per-week (Monday start) in weekly_snapshots table.
 * Uses Finnhub for position quotes + callChatAI for analysis.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { callChatAI } from '@/lib/ai-provider';
import type { SystemBlock } from '@/lib/ai-provider';

// Static analysis instructions — cached across all snapshot requests
const SNAPSHOT_STATIC: SystemBlock = {
  type: 'text',
  text: `You are Vantage AI portfolio health analyst.
Analyze the portfolio data provided.

Respond in markdown with these sections:
## OVERALL HEALTH
Include "OVERALL HEALTH: X/10" on its own line.
[Brief explanation of the health score]

## RISKS
Include "OVERALL RISK: LOW|MEDIUM|HIGH" on its own line.
[Brief analysis of risk factors]

## OPPORTUNITIES
[List each as a bullet point "• description" — count these]

## SUMMARY
[1 sentence overall assessment]

Be specific. Use real numbers provided. Never invent. Be honest if data is incomplete.`,
  cache_control: { type: 'ephemeral' },
};

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
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
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
      .maybeSingle();

    if (existing) {
      return NextResponse.json({
        content: existing.content,
        healthScore: existing.health_score,
        riskLevel: existing.risk_level,
        opportunitiesCount: existing.opportunities_count,
        weekStart: weekStartStr,
        generatedAt: existing.generated_at || null,
        cached: true,
      });
    }

    // Fetch positions from DB
    const { data: positions } = await (supabase as any)
      .from('positions')
      .select('symbol, qty, market_value, avg_cost')
      .eq('user_id', userId)
      .gt('qty', 0);

    if (!positions || positions.length === 0) {
      return NextResponse.json({
        content: null,
        healthScore: null,
        riskLevel: null,
        opportunitiesCount: 0,
        weekStart: weekStartStr,
        generatedAt: null,
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

    // Get investor style
    let investorStyle = 'buffett';
    let riskTolerance = 'medium';
    try {
      const { data: userData } = await (supabase as any)
        .from('users')
        .select('investor_style')
        .eq('id', userId)
        .maybeSingle();
      if (userData?.investor_style) {
        investorStyle = userData.investor_style;
        const styleRiskMap: Record<string, string> = {
          growth: 'medium-high',
          buffett: 'medium',
          lynch: 'medium',
          livermore: 'high',
          soros: 'high',
          dividend: 'low',
        };
        riskTolerance = styleRiskMap[investorStyle] || 'medium';
      }
    } catch {
      // use defaults
    }

    // Build position data block
    const positionLines = positions.map((p: any) => {
      const q = quotes[p.symbol] || {};
      const avgCost = p.avg_cost;
      const currentPrice = q.c ?? 0;
      const pnl = avgCost && currentPrice
        ? ((currentPrice - avgCost) / avgCost) * 100
        : null;
      const pnlStr = pnl != null
        ? `${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}%`
        : 'N/A';
      return `  ${p.symbol}: ${p.qty} shares @ $${avgCost || '?'} | Current: $${currentPrice || '?'} | P&L: ${pnlStr}`;
    });

    const dataBlock = [
      `WEEKLY PORTFOLIO HEALTH CHECK — Week of ${weekStartStr}`,
      '',
      `Symbols: ${symbols.join(', ')}`,
      `Style: ${investorStyle} | Risk: ${riskTolerance}`,
      `Total positions: ${positions.length}`,
      '',
      'PORTFOLIO:',
      ...positionLines,
      '',
    ].join('\n');

    // Build prompt
    const prompt = [
      'Run a complete weekly portfolio health snapshot on this portfolio.',
      'Format as markdown with sections: OVERALL HEALTH, RISKS, OPPORTUNITIES, SUMMARY.',
      'Include OVERALL HEALTH: X/10 and OVERALL RISK: LOW|MEDIUM|HIGH.',
      `Portfolio: ${symbols.join(', ')}`,
      `Style: ${investorStyle} Risk: ${riskTolerance}`,
    ].join('\n');

    // Call AI with cached static analysis instructions
    const aiResponse = await callChatAI({
      messages: [
        {
          role: 'user',
          content: dataBlock,
        },
      ],
      systemBlocks: [SNAPSHOT_STATIC],
      maxTokens: 500,
      temperature: 0.2,
    });

    const content = aiResponse.content.trim();
    const generatedAt = new Date().toISOString();

    // Parse structured fields from response
    const healthMatch = content.match(/OVERALL HEALTH:\s*(\d+\.?\d*)\/10/i);
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
        generated_at: generatedAt,
      },
      { onConflict: 'user_id,week_start' },
    );

    return NextResponse.json({
      content,
      healthScore,
      riskLevel,
      opportunitiesCount,
      weekStart: weekStartStr,
      generatedAt,
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
