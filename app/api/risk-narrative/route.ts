/**
 * POST /api/risk-narrative
 *
 * Computes portfolio risk metrics, evaluates triggers, and — only when
 * triggers fire AND we don't have a cached narrative — calls Claude Haiku
 * for a single-plain-language-sentence summary.
 *
 * Caches narratives in the ai_facts table (subject: 'risk_narrative',
 * source: 'risk-narrative') keyed by a SHA-256 hash of the trigger
 * metrics so the same risk profile returns instantly.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { requireAuth } from '@/lib/auth/get-server-user';
import { computeRiskMetrics, evaluateRiskTriggers } from '@/lib/risk-narrative';
import { callChatAI } from '@/lib/ai-provider';
import { writeFact } from '@/lib/ai/facts';
import { checkUsageLimit, incrementUsage } from '@/lib/ai-guard';
import { createServerClient } from '@/lib/supabase';

// ── Types ─────────────────────────────────────────────────────

interface PositionPayload {
  symbol: string;
  qty: number;
  currentPrice: number;
  sector?: string;
  avgCost: number;
}

interface RequestBody {
  positions: PositionPayload[];
  investorStyle?: string;
}

// ── Helpers ───────────────────────────────────────────────────

function metricsHash(triggers: ReturnType<typeof evaluateRiskTriggers>): string {
  const compact = triggers.map((t) => ({
    type: t.type,
    severity: t.severity,
    metrics: t.metrics,
  }));
  return createHash('sha256').update(JSON.stringify(compact, Object.keys(compact).sort())).digest('hex');
}

function buildPrompt(triggers: ReturnType<typeof evaluateRiskTriggers>, metrics: ReturnType<typeof computeRiskMetrics>): string {
  const sectorLines = metrics.sectorConcentration
    .slice(0, 5)
    .map((s) => `  ${s.sector}: ${s.pct}%`)
    .join('\n');

  const driftLines = metrics.styleDrift
    .slice(0, 5)
    .map((d) => `  ${d.sector}: ${d.currentPct}% (target ${d.targetPct}%, diff ${d.deviation > 0 ? '+' : ''}${d.deviation}%)`)
    .join('\n');

  return [
    'Turn these portfolio risk metrics into ONE plain-language sentence.',
    'No hedging. No disclaimers. No markdown. Be direct.',
    '',
    `Top-3 concentration: ${metrics.top3Concentration.pct}% (${metrics.top3Concentration.symbols.join(', ')})`,
    `Top-5 concentration: ${metrics.top5Concentration.pct}%`,
    metrics.singlePositionRisk
      ? `Largest position: ${metrics.singlePositionRisk.symbol} at ${metrics.singlePositionRisk.pct}%`
      : 'No single position over 20%',
    '',
    'Sector breakdown:',
    sectorLines || '  (no sector data)',
    '',
    driftLines.length > 0
      ? ['Style drift vs benchmark:', driftLines].join('\n')
      : 'No style benchmark to compare.',
    '',
    'Sentence:',
  ].join('\n');
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── Auth ──
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const userId = authUser!.id;

  // ── Parse body ──
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  if (!body.positions || !Array.isArray(body.positions)) {
    return NextResponse.json(
      { error: 'positions array is required' },
      { status: 400 },
    );
  }

  try {
    // ── Layer 4a: Compute metrics ──
    const metrics = computeRiskMetrics(body.positions, body.investorStyle);

    // ── Layer 4b: Evaluate triggers ──
    const triggers = evaluateRiskTriggers(metrics);

    // ── No triggers → well diversified, no AI needed ──
    if (triggers.length === 0) {
      return NextResponse.json({
        narrative: null,
        triggers: [],
        cached: false,
        sectorCount: new Set(
          body.positions
            .map((p) => p.sector)
            .filter((s): s is string => !!s),
        ).size || metrics.sectorConcentration.length,
      });
    }

    // ── Build cache key ──
    const hash = metricsHash(triggers);

    // ── Check ai_facts for existing narrative ──
    const supabase = createServerClient();
    const { data: existingFacts } = await (supabase as any)
      .from('ai_facts')
      .select('*')
      .eq('user_id', userId)
      .eq('subject', 'risk_narrative')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1);

    // Quick cache-key match in the claim field (we store hash there for exact-match)
    if (existingFacts && existingFacts.length > 0) {
      const fact = existingFacts[0];
      // Check if the stored hash matches current metrics
      if (fact.claim?.startsWith(hash + '|')) {
        const narrative = fact.claim.slice(hash.length + 1);
        return NextResponse.json({
          narrative,
          triggers,
          cached: true,
        });
      }
    }

    // ── Cache miss → check tier limits ──
    const limitCheck = await checkUsageLimit(userId, 'deepAnalysis');
    if (!limitCheck.allowed) {
      // Return triggers without narrative — client can show raw trigger messages
      return NextResponse.json({
        narrative: null,
        triggers,
        cached: false,
        limitReached: true,
        limitReason: limitCheck.reason,
      });
    }

    // ── Call Claude Haiku ──
    const prompt = buildPrompt(triggers, metrics);

    let narrative: string;
    try {
      const aiResponse = await callChatAI({
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        maxTokens: 120,
        temperature: 0.3,
      });

      narrative = aiResponse.content.trim();

      // Track usage
      await incrementUsage(
        userId,
        'deepAnalysis',
        aiResponse.tokensUsed || 0,
        0,
      );
    } catch (aiErr: any) {
      console.error('[risk-narrative] AI call failed:', aiErr?.message || aiErr);
      // Return triggers without narrative on AI failure
      return NextResponse.json({
        narrative: null,
        triggers,
        cached: false,
        aiError: true,
      });
    }

    // ── Cache the narrative in ai_facts ──
    try {
      await writeFact(userId, {
        subject: 'risk_narrative',
        fact_type: 'observation',
        claim: `${hash}|${narrative}`,
        source: 'risk-narrative',
        confidence: 'tentative',
      });
    } catch (factErr: any) {
      console.error('[risk-narrative] Fact write failed:', factErr?.message || factErr);
      // Narrative still valid, just not cached
    }

    return NextResponse.json({
      narrative,
      triggers,
      cached: false,
    });
  } catch (err: any) {
    console.error('[risk-narrative] Unexpected error:', err?.message || err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
