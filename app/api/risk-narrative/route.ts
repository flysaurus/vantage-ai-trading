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
import { resolveEtfWeightsForPositions } from '@/lib/etf-sectors';
import { callChatAI } from '@/lib/ai-provider';
import { writeFact } from '@/lib/ai/facts';
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
  forceRegen?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────

function metricsHash(
  triggers: ReturnType<typeof evaluateRiskTriggers>,
  positions: PositionPayload[],
): string {
  // Include the sorted symbol list so ANY ticker change invalidates the cache —
  // otherwise selling one set of names and buying others within the same rounded
  // sector % keeps the same hash and serves a stale, symbol-specific narrative.
  const compact = {
    symbols: positions.map((p) => p.symbol.toUpperCase()).sort(),
    triggers: triggers.map((t) => ({
      type: t.type,
      severity: t.severity,
      metrics: t.metrics,
    })),
  };
  return createHash('sha256').update(JSON.stringify(compact)).digest('hex');
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

  const positionNames = metrics.top3Concentration.symbols.join(', ');
  const topSector = metrics.sectorConcentration[0];
  const topSectorLine = topSector
    ? `Dominant sector: ${topSector.sector} at ${topSector.pct}%`
    : '';

  return [
    'You are a portfolio risk advisor. Based on the metrics below, produce:',
    '',
    '1. DIAGNOSIS: ONE plain-language sentence describing the current risk situation.',
    '   No hedging. No disclaimers. No markdown. Be direct.',
    '',
    '2. SUGGESTION: ONE concrete, actionable step the investor could take.',
    `   Be specific — mention actual symbol names or sectors from the data.`,
    '   Examples: "Trim NVDA to below 20% allocation" or "Add a healthcare position to balance tech-heavy portfolio"',
    '   Do NOT repeat the diagnosis. Do NOT just say "review your allocation."',
    '',
    'Respond in exactly this format:',
    'DIAGNOSIS: <sentence>',
    'SUGGESTION: <suggestion>',
    '',
    'Metrics:',
    `Top-3 concentration: ${metrics.top3Concentration.pct}% (${positionNames})`,
    `Top-5 concentration: ${metrics.top5Concentration.pct}%`,
    metrics.singlePositionRisk
      ? `Largest position: ${metrics.singlePositionRisk.symbol} at ${metrics.singlePositionRisk.pct}%`
      : 'No single position over 20%',
    topSectorLine,
    '',
    'Sector breakdown:',
    sectorLines || '  (no sector data)',
    '',
    driftLines.length > 0
      ? ['Style drift vs benchmark:', driftLines].join('\n')
      : 'No style benchmark to compare.',
    '',
    'Response:',
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
    // ── Resolve dynamic ETF sector weights (Yahoo → Supabase cache) ──
    // Best-effort; falls back to static profile / single sector on failure.
    let etfWeights = new Map<string, Record<string, number>>();
    try {
      const supabase = createServerClient();
      etfWeights = await resolveEtfWeightsForPositions(body.positions, supabase);
    } catch (err: any) {
      console.warn('[risk-narrative] ETF weight resolve failed:', err?.message || err);
    }

    // ── Layer 4a: Compute metrics ──
    const metrics = computeRiskMetrics(body.positions, body.investorStyle, etfWeights);

    // ── Layer 4b: Evaluate triggers ──
    const triggers = evaluateRiskTriggers(metrics);

    // ── No triggers → well diversified, no AI needed ──
    if (triggers.length === 0) {
      return NextResponse.json({
        narrative: null,
        triggers: [],
        cached: false,
        generatedAt: null,
        sectorCount: new Set(
          body.positions
            .map((p) => p.sector)
            .filter((s): s is string => !!s),
        ).size || metrics.sectorConcentration.length,
      });
    }

    // ── Build cache key ──
    const hash = metricsHash(triggers, body.positions);

    // ── Check ai_facts for existing narrative (skipped on manual regenerate) ──
    const supabase = createServerClient();
    if (!body.forceRegen) {
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
          const cached = fact.claim.slice(hash.length + 1);
          const diagMatch = cached.match(/^DIAGNOSIS:\s*(.+?)(?:\n|$)/m);
          const suggMatch = cached.match(/^SUGGESTION:\s*(.+?)(?:\n|$)/m);
          const narrative = diagMatch?.[1]?.trim() || cached;
          const suggestion = suggMatch?.[1]?.trim() || null;
          return NextResponse.json({
            narrative,
            suggestion,
            triggers,
            cached: true,
            generatedAt: fact.created_at,
          });
        }
      }
    }

    // ── Cache miss → generate narrative (unmetered — risk analysis is free) ──
    const prompt = buildPrompt(triggers, metrics);

    let narrative: string;
    let suggestion: string | null = null;
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

      const raw = aiResponse.content.trim();

      // Parse DIAGNOSIS / SUGGESTION format
      const diagMatch = raw.match(/^DIAGNOSIS:\s*(.+?)(?:\n|$)/m);
      const suggMatch = raw.match(/^SUGGESTION:\s*(.+?)(?:\n|$)/m);
      narrative = diagMatch?.[1]?.trim() || raw;
      suggestion = suggMatch?.[1]?.trim() || null;
    } catch (aiErr: any) {
      console.error('[risk-narrative] AI call failed:', aiErr?.message || aiErr);
      // Return triggers without narrative on AI failure
      return NextResponse.json({
        narrative: null,
        suggestion: null,
        triggers,
        cached: false,
        aiError: true,
        generatedAt: null,
      });
    }

    // ── Cache the narrative in ai_facts ──
    try {
      const cachePayload = suggestion
        ? `${hash}|DIAGNOSIS: ${narrative}\nSUGGESTION: ${suggestion}`
        : `${hash}|${narrative}`;
      await writeFact(userId, {
        subject: 'risk_narrative',
        fact_type: 'observation',
        claim: cachePayload,
        source: 'risk-narrative',
        confidence: 'tentative',
      });
    } catch (factErr: any) {
      console.error('[risk-narrative] Fact write failed:', factErr?.message || factErr);
      // Narrative still valid, just not cached
    }

    return NextResponse.json({
      narrative,
      suggestion,
      triggers,
      cached: false,
      generatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[risk-narrative] Unexpected error:', err?.message || err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
