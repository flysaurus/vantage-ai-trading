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
import { buildUserProfileContext } from '@/lib/ai/userProfile';
import type { UserProfile } from '@/lib/ai/userProfile';
import { getOptionalUserId } from '@/lib/auth/get-server-user';

// Static analysis instructions — cached across all snapshot requests
const SNAPSHOT_STATIC: SystemBlock = {
  type: 'text',
  text: `You are Vantage AI portfolio health analyst.
Generate a Weekly Portfolio Snapshot framed for the user's specific
investor style and risk tolerance (provided in the message).

VOICE: Write this like a sharp analyst texting their notes to a friend, not a Bloomberg terminal report.
Use real numbers. Call out what's actually wrong. Don't soften bad news — surface it clearly with a specific recommended action.

Health scores must reflect reality: if ADBE is down 60%, the score cannot be above 6/10. Period.

Structure your analysis as:

## OVERALL HEALTH (score X/10):
Score based on:
- Diversification (sector spread)
- Position sizing (no single position >25%)
- Thesis integrity (are all positions still valid?)
- Recent momentum (60-day trend)
Never score above 7 when any position is down >30%
Never score above 5 when any position is down >40%

## RISK LEVEL (output exactly one: LOW, MEDIUM, or HIGH):
On the line right after, write "OVERALL RISK: " followed by your chosen level.
LOW: no sector >40%, no position down >20%
MEDIUM: sector 40-60% OR position down 20-40%
HIGH: sector >60% OR position down >40%

## OPPORTUNITIES (list 2-3):
Each opportunity must include:
- What the opportunity is
- Why it fits the investor's style
- A specific price level to act at

## RISKS (list 2-3):
Each risk must include:
- What the risk is
- Which position(s) it affects
- Recommended action

## SUMMARY:

Lead with the dollar amounts at stake when relevant. "You can harvest $4,094 in losses from ADBE" is better than "ADBE presents a tax loss harvesting opportunity." Make every benefit concrete and specific.

Use actual ticker symbols and dollar amounts from the portfolio context. Never be generic. Frame all analysis through the investor's chosen style lens.

─── POSITION-SPECIFIC RULES ───
Always scan for positions down >25% from cost basis and name them explicitly. For each losing position mention: the ticker, the % loss, and a specific action. Never use generic language like 'some positions' or 'certain holdings' — always name the ticker. If a position is down >40% call it out FIRST before any other risk.
Example: 'ADBE is down 60% from your $560 cost basis — that's a broken story, not a dip. Lynch would have cut this months ago.' NOT: 'There is concentration risk in some technology positions.'

─── RISK LEVEL OVERRIDES ───
Any position down >40% → risk level MEDIUM minimum.
Any position down >60% → risk level HIGH.
ADBE at -60% means this portfolio cannot be LOW risk.
Override any other scoring if these conditions are met.`,
  cache_control: { type: 'ephemeral' },
};

// ─── Auth (same pattern as app/api/chat/route.ts) ──────────────
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
    const userId = await getOptionalUserId();
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
      // Re-parse if cached fields are null but content exists (fix for old busted cache entries)
      let healthScore = existing.health_score;
      let riskLevel = existing.risk_level;
      let opportunitiesCount = existing.opportunities_count;

      if (existing.content && (healthScore == null || riskLevel == null || opportunitiesCount == null || opportunitiesCount === 0)) {
        const reHealthMatch = existing.content.match(/(?:OVERALL HEALTH|PORTFOLIO HEALTH):?\s*(?:\(score\s*)?(\d+\.?\d*)\s*\/\s*10/i);
        if (healthScore == null && reHealthMatch) healthScore = parseFloat(reHealthMatch[1]);

        const reRiskMatch = existing.content.match(/(?:OVERALL RISK|RISK LEVEL)[\s\S]*?\b(LOW|MEDIUM|HIGH)\b/i);
        if (riskLevel == null && reRiskMatch) riskLevel = reRiskMatch[1].toUpperCase();
        // Fallback: try RL: format
        if (riskLevel == null) {
          const rlMatch = existing.content.match(/^RL:\s*(LOW|MEDIUM|HIGH)/im);
          if (rlMatch) riskLevel = rlMatch[1].toUpperCase();
        }

        if (opportunitiesCount == null || opportunitiesCount === 0) {
          const reOppSection = existing.content.match(/(?:##\s*)?OPPORTUNITIES?\s*\n?([\s\S]*?)(?=(?:##\s*)?(?:SUMMARY|RISKS?)|$)/i);
          const reOppContent = reOppSection?.[1] || '';
          const reOppBullets = reOppContent.match(/^[\s]*[-•*]\s|\n[\s]*[-•*]\s/gm);
          if (reOppBullets) opportunitiesCount = reOppBullets.length;
        }

        // Update DB with corrected values
        (supabase as any).from('weekly_snapshots').update({
          health_score: healthScore,
          risk_level: riskLevel,
          opportunities_count: opportunitiesCount,
        }).eq('user_id', userId).eq('week_start', weekStartStr).then(() => {}).catch(() => {});
      }

      return NextResponse.json({
        content: existing.content,
        healthScore,
        riskLevel,
        opportunitiesCount,
        weekStart: weekStartStr,
        generatedAt: existing.generated_at || null,
        cached: true,
      });
    }

    // Fetch live portfolio state from demo_portfolio_state
    const { data: portfolioState } = await (supabase as any)
      .from('demo_portfolio_state')
      .select('positions, cash_balance')
      .eq('user_id', userId)
      .maybeSingle();

    const positions: any[] = portfolioState?.positions || [];
    const cashBalance = portfolioState?.cash_balance ?? 0;

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

    // Build user profile for AI injection
    const profileName = investorStyle.charAt(0).toUpperCase() + investorStyle.slice(1);
    const riskLabel = riskTolerance === 'high' ? 'Aggressive' : riskTolerance === 'low' ? 'Conservative' : 'Moderate';
    const styleMap: Record<string, UserProfile['investorStyle']> = {
      buffett: 'Buffett', lynch: 'Lynch', livermore: 'Livermore',
      munger: 'Munger', soros: 'Soros', growth: 'Lynch', dividend: 'Buffett',
    };
    const profile: UserProfile = {
      investorStyle: styleMap[investorStyle] || 'Lynch',
      riskTolerance: riskLabel,
      name: profileName,
    };
    const profileContext = buildUserProfileContext(profile);

    // Build position data block — with cost basis, total cost, and dollar P&L
    const positionLines = positions.map((p: any) => {
      const q = quotes[p.symbol] || {};
      const avgCost = p.avgCost;
      const currentPrice = q.c ?? 0;
      const shares = p.qty;
      const totalCost = avgCost ? shares * avgCost : 0;
      const marketValue = currentPrice ? shares * currentPrice : 0;
      const totalPnL = avgCost && currentPrice
        ? (currentPrice - avgCost) * shares
        : 0;
      const pnl = avgCost && currentPrice
        ? ((currentPrice - avgCost) / avgCost) * 100
        : null;
      const pnlStr = pnl != null
        ? `${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}%`
        : 'N/A';
      const totalPnLStr = totalPnL !== 0
        ? `${totalPnL >= 0 ? '+' : ''}$${Math.abs(totalPnL).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
        : 'N/A';
      return `  ${p.symbol}: ${shares} shares @ $${avgCost || '?'} | Current: $${currentPrice || '?'}
    Cost basis: $${totalCost.toLocaleString('en-US', { maximumFractionDigits: 0 })} | Market value: $${marketValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}
    P&L: ${pnlStr} (${totalPnLStr})`;
    });

    const dataBlock = [
      `WEEKLY PORTFOLIO HEALTH CHECK — Week of ${weekStartStr}`,
      '',
      `Symbols: ${symbols.join(', ')}`,
      `Style: ${investorStyle} | Risk: ${riskTolerance}`,
      `Total positions: ${positions.length}`,
      `Cash Balance: $${cashBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      '',
      'PORTFOLIO:',
      ...positionLines,
      '',
      profileContext,
    ].join('\n');

    // Build prompt
    const prompt = [
      'Run a complete weekly portfolio health snapshot on this portfolio.',
      'Format as markdown with ## sections: OVERALL HEALTH, RISKS, OPPORTUNITIES, SUMMARY.',
      'Use short bullet points (not dense paragraphs) for analysis within each section.',
      'In the RISK section, put the risk level on its own line like: RL: MEDIUM',
      'Include "OVERALL HEALTH: X/10" on one line. Put the risk level on its own line: RL: MEDIUM (or LOW/HIGH).',
      `Portfolio: ${symbols.join(', ')}`,
      `Style: ${investorStyle} Risk: ${riskTolerance}`,
    ].join('\n');

    // Call AI with cached static analysis instructions + explicit model
    const aiResponse = await callChatAI({
      model: 'claude-sonnet-4-6',
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

    // Parse structured fields from response — support multiple formats
    const healthMatch = content.match(/(?:OVERALL HEALTH|PORTFOLIO HEALTH):?\s*(?:\(score\s*)?(\d+\.?\d*)\s*\/\s*10/i);
    const healthScore = healthMatch ? parseFloat(healthMatch[1]) : null;

    const riskMatch = content.match(/(?:OVERALL RISK|RISK LEVEL)[\s\S]*?\b(LOW|MEDIUM|HIGH)\b/i);
    let riskLevel = riskMatch ? riskMatch[1].toUpperCase() : null;
    // Fallback: explicit RL: format
    if (!riskLevel) {
      const rlMatch = content.match(/^RL:\s*(LOW|MEDIUM|HIGH)/im);
      if (rlMatch) riskLevel = rlMatch[1].toUpperCase();
    }

    // Count opportunities only from the OPPORTUNITIES section (flexible bullet chars)
    const oppSection = content.match(/(?:##\s*)?OPPORTUNITIES?\s*\n?([\s\S]*?)(?=(?:##\s*)?(?:SUMMARY|RISKS?)|$)/i);
    const oppContent = oppSection?.[1] || '';
    const oppBullets = oppContent.match(/^[\s]*[-•*]\s|\n[\s]*[-•*]\s/gm);
    const opportunitiesCount = oppBullets ? oppBullets.length : 0;

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
    const userId = await getOptionalUserId();
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
