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
import { writeFact } from '@/lib/ai/facts';
import { beginGenLog } from '@/lib/ai/generation-log';

// Static analysis instructions — cached across all snapshot requests
const SNAPSHOT_STATIC: SystemBlock = {
  type: 'text',
  text: `You are Vantage AI portfolio health analyst.
Generate a Weekly Portfolio Snapshot framed for the user's specific
investor style and risk tolerance (provided in the message).

VOICE: Write this like a sharp analyst texting their notes to a friend, not a Bloomberg terminal report.
Use real numbers. Call out what's actually wrong. Don't soften bad news — surface it clearly with a specific recommended action.

FORMAT RULES:
- Use bullet points starting with -. No long paragraphs.
- Keep each bullet focused — one clear point per bullet.
- No generic fluff. Every bullet must name a specific ticker, dollar amount, or percentage.

─── FACTS-AWARE CROSS-CHECK (CRITICAL) ───
Before finalizing your Risks section, check the "AI FACTS" grounding context provided in the prompt:
1. If any active [question·*] fact exists for a subject (e.g. "AXP drawdown cause unconfirmed"), any analysis touching that same subject MUST defer to the question — e.g. "cause still unconfirmed" — do NOT assert a confident conclusion contradicting an open question.
2. If an active [observation·*] fact exists about portfolio-level concentration (e.g. "financials concentration 59%, flagged as watch item"), the Risks section must explicitly acknowledge it.
3. Facts marked [tentative] or [unconfirmed] must NOT be treated as definitive. If a fact says "Pending verification: …", surface the uncertainty rather than acting on it.

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

## RISKS (list 2-3):
Format each risk EXACTLY like this (use these exact sub-headers):
- **Risk:** [single sentence — what is happening]
- **Affects:** [which ticker(s) / position(s)]
- **Watch:** [what to monitor or investigate — frame as vigilance, not as imperative command]
Use - bullets (not numbered). Separate each risk with a blank line.

## SUMMARY:

Lead with the dollar amounts at stake when relevant. Make every benefit concrete and specific.

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

// ── Facts extraction helper ────────────────────────────────

/**
 * Parse the generated Weekly Snapshot content and write extracted
 * Observations, Questions, and Recommendations back as ai_facts.
 * Generic pattern — other surfaces (Daily Brief, greeting, chat)
 * will use the same writeFact() function with their own extraction.
 */
async function writeSnapshotFacts(
  supabase: any,
  userId: string,
  content: string,
  symbols: string[],
): Promise<Array<{ subject: string; claim: string; fact_type: string; id?: string }>> {
  const written: Array<{ subject: string; claim: string; fact_type: string; id?: string }> = [];
  try {
    // Extract RISKS section
    const riskRe = new RegExp(
      '(?:##\s*)?RISKS?\s*\n([\s\S]*?)(?=##\s*SUMMARY)',
      'i',
    );
    const riskMatch = content.match(riskRe);
    const riskText = riskMatch?.[1] || '';

    // Parse risks into facts: each risk block starts with **Risk:**
    // Split on lines that begin a new risk block (containing **Risk:**)
    const riskBlocks = riskText.split(/\n(?=\s*[-•*]\s+\*\*Risk:\*\*)/).filter(Boolean);

    for (const block of riskBlocks) {
      const riskLine = block.match(/\*\*Risk:\*\*\s*(.+?)(?:\n|$)/i);
      const affectsLine = block.match(/\*\*Affects:\*\*\s*(.+?)(?:\n|$)/i);

      if (riskLine) {
        const claim = riskLine[1].trim();
        const affected = affectsLine?.[1]?.trim() || '';

        // Determine subject from affected tickers
        const tickerMatch = affected.match(/\b([A-Z]{1,5})\b/);
        const subject = tickerMatch ? tickerMatch[1] : symbols[0] || 'portfolio';

        const r = await writeFact(userId, {
          subject,
          fact_type: 'observation',
          claim,
          confidence: 'unconfirmed', // risks need investigation
          source: 'weekly_snapshot',
        });

        if (r.fact) {
          written.push({ subject, claim, fact_type: 'observation', id: r.fact.id });
        }
      }
    }

    return written;
  } catch (err) {
    // Facts writing is non-critical — don't fail the snapshot
    console.error('[weekly-snapshot] writeSnapshotFacts error:', err);
  }
}

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

    const { searchParams } = new URL(req.url);
    const forceRegen = searchParams.get('forceRegen') === 'true';
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

      if (existing.content && (healthScore == null || riskLevel == null)) {
        const reHealthMatch = existing.content.match(/(?:OVERALL HEALTH|PORTFOLIO HEALTH):?\s*(?:\(score\s*)?(\d+\.?\d*)\s*\/\s*10/i);
        if (healthScore == null && reHealthMatch) healthScore = parseFloat(reHealthMatch[1]);

        const reRiskMatch = existing.content.match(/(?:OVERALL RISK|RISK LEVEL)[\s\S]*?\b(LOW|MEDIUM|HIGH)\b/i);
        if (riskLevel == null && reRiskMatch) riskLevel = reRiskMatch[1].toUpperCase();
        // Fallback: try RL: format
        if (riskLevel == null) {
          const rlMatch = existing.content.match(/^RL:\s*(LOW|MEDIUM|HIGH)/im);
          if (rlMatch) riskLevel = rlMatch[1].toUpperCase();
        }

        // Update DB with corrected values
        (supabase as any).from('weekly_snapshots').update({
          health_score: healthScore,
          risk_level: riskLevel,
        }).eq('user_id', userId).eq('week_start', weekStartStr).then(() => {}).catch(() => {});
      }

      return NextResponse.json({
        content: existing.content,
        healthScore,
        riskLevel,
        weekStart: weekStartStr,
        generatedAt: existing.generated_at || null,
        cached: true,
      });
    }

    // No cache — only regenerate if explicitly requested (user tapped ↻)
    if (!forceRegen) {
      return NextResponse.json({
        content: null,
        healthScore: null,
        riskLevel: null,
        weekStart: weekStartStr,
        generatedAt: null,
        cached: false,
      });
    }

    // ─── forceRegen: generate fresh snapshot ───
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
      timezone: req.nextUrl.searchParams.get('tz') || 'America/New_York',
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
      `AUTHORITATIVE CURRENT DATE: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`,
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
      'Within each section, use bullet points (starting with -). Bold key phrases with **.',
      'In the RISK section, put the risk level on its own line like: RL: MEDIUM',
      'Include "OVERALL HEALTH: X/10" on one line. Put the risk level on its own line: RL: MEDIUM (or LOW/HIGH).',
      'For OPPORTUNITIES: use - **What:** / - **Why:** / - **Consider at:** sub-headers exactly as shown in system instructions.',
      'For RISKS: use - **Risk:** / - **Affects:** / - **Watch:** sub-headers exactly as shown in system instructions.',
      'CRITICAL: Read the AI FACTS grounding context below. Cross-check your Opportunities/Risks against it per the FACTS-AWARE CROSS-CHECK rules in system instructions.',
      `Portfolio: ${symbols.join(', ')}`,
      `Style: ${investorStyle} Risk: ${riskTolerance}`,
    ].join('\n');

    // ── Fetch active AI facts for grounding context (with audit logging) ──
    const genLog = await beginGenLog(userId, 'weekly_snapshot');
    const factsContext = genLog.factsPrompt;
    const fullUserContent = factsContext
      ? `${dataBlock}\n\n${factsContext}`
      : dataBlock;

    // Call AI with cached static analysis instructions + explicit model
    const aiResponse = await callChatAI({
      model: 'claude-haiku-4-5',
      messages: [
        {
          role: 'user',
          content: fullUserContent,
        },
      ],
      systemBlocks: [SNAPSHOT_STATIC],
      maxTokens: 2000,
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

    // Save
    await (supabase as any).from('weekly_snapshots').upsert(
      {
        user_id: userId,
        week_start: weekStartStr,
        health_score: healthScore,
        risk_level: riskLevel,
        content,
        generated_at: generatedAt,
      },
      { onConflict: 'user_id,week_start' },
    );

    // ── Step 3: Write generated conclusions back as facts ─────
    const writtenFacts = await writeSnapshotFacts(supabase, userId, content, symbols);

    // Log the generation event (async, non-blocking)
    genLog.flush(writtenFacts);

    return NextResponse.json({
      content,
      healthScore,
      riskLevel,
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
