/**
 * GET /api/ai/facts/test — Manual verification endpoint for the AI facts table.
 *
 * Runs the 4-step test from Step 4 of the build plan:
 *  1. Write a question fact ("AXP drawdown cause unconfirmed")
 *  2. Write an unconfirmed observation fact
 *  3. Attempt to write a recommendation with based_on pointing at the
 *     unconfirmed observation → should be hedged ("Pending verification: …")
 *     with confidence forced to tentative
 *  4. Write a user_action fact → should resolve the question + recommendation
 *
 * Deletes test facts on completion so the DB stays clean.
 *
 * NOT for production use. Accessible from server-side only (Vercel env).
 */

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { writeFact, getActiveFacts } from '@/lib/ai/facts';

interface TestStep {
  name: string;
  passed: boolean;
  detail: string;
}

export async function GET() {
  const results: TestStep[] = [];
  const createdIds: string[] = [];

  // Must have a real user — use the first user in the DB for testing
  const supabase = createServerClient();

  const { data: testUser } = await (supabase as any)
    .from('users')
    .select('id')
    .limit(1)
    .single();

  if (!testUser) {
    return NextResponse.json(
      { error: 'No user found in DB — run this after a user exists' },
      { status: 400 },
    );
  }

  const userId = testUser.id;

  try {
    // ── Step 1: Write a question fact ───────────────────────
    const q1 = await writeFact(userId, {
      subject: 'AXP',
      fact_type: 'question',
      claim: 'AXP drawdown cause unconfirmed as of Jul 6',
      confidence: 'unconfirmed',
      source: 'weekly_snapshot',
    });

    if (q1.fact) {
      createdIds.push(q1.fact.id);
      results.push({
        name: '1. Write question fact',
        passed: true,
        detail: `Created ${q1.fact.id} — "${q1.fact.claim}" [${q1.fact.confidence}]`,
      });
    } else {
      results.push({
        name: '1. Write question fact',
        passed: false,
        detail: `Insert failed: ${JSON.stringify(q1.warnings)}`,
      });
      return finish(supabase, results, createdIds);
    }

    // ── Step 2: Write an unconfirmed observation ─────────────
    const o1 = await writeFact(userId, {
      subject: 'AXP',
      fact_type: 'observation',
      claim: 'AXP drawdown may be caused by macro credit concerns',
      confidence: 'unconfirmed',
      source: 'weekly_snapshot',
    });

    if (o1.fact) {
      createdIds.push(o1.fact.id);
      results.push({
        name: '2. Write unconfirmed observation',
        passed: true,
        detail: `Created ${o1.fact.id} — "${o1.fact.claim}" [${o1.fact.confidence}]`,
      });
    } else {
      results.push({
        name: '2. Write unconfirmed observation',
        passed: false,
        detail: `Insert failed: ${JSON.stringify(o1.warnings)}`,
      });
      return finish(supabase, results, createdIds);
    }

    // ── Step 3: Recommendation BASED ON unconfirmed observation ──
    const r1 = await writeFact(userId, {
      subject: 'AXP',
      fact_type: 'recommendation',
      claim: 'Buy the AXP dip at $350-355',
      confidence: 'confirmed', // caller thinks it's confirmed
      based_on: [o1.fact!.id],  // but references unconfirmed fact
      source: 'weekly_snapshot',
    });

    if (r1.fact) {
      createdIds.push(r1.fact.id);

      const wasHedged = r1.fact.claim.startsWith('Pending verification: ');
      const wasTentative = r1.fact.confidence === 'tentative';
      const hasWarning = r1.warnings.some((w) => w.code === 'UNCONFIRMED_CHAIN');

      const passed = wasHedged && wasTentative && hasWarning;

      results.push({
        name: '3. Recommendation → hedged + tentative',
        passed,
        detail: passed
          ? `CORRECT: claim="${r1.fact.claim}", confidence=${r1.fact.confidence}, warnings=${r1.warnings.length}`
          : `FAILED: hedged=${wasHedged}, tentative=${wasTentative}, warned=${hasWarning}`,
      });
    } else {
      results.push({
        name: '3. Recommendation → hedged + tentative',
        passed: false,
        detail: `Insert failed: ${JSON.stringify(r1.warnings)}`,
      });
      return finish(supabase, results, createdIds);
    }

    // ── Step 4: user_action resolves questions + recommendations ──
    const ua1 = await writeFact(userId, {
      subject: 'AXP',
      fact_type: 'user_action',
      claim: 'User confirmed AXP moat intact after checking Q2 earnings',
      confidence: 'confirmed',
      source: 'chat',
    });

    if (ua1.fact) {
      createdIds.push(ua1.fact.id);

      // Verify the question was resolved
      const { data: resolvedQ } = await (supabase as any)
        .from('ai_facts')
        .select('status')
        .eq('id', q1.fact!.id)
        .single();

      const qResolved = resolvedQ?.status === 'resolved';

      results.push({
        name: '4. user_action resolves question + recommendation',
        passed: qResolved,
        detail: qResolved
          ? `CORRECT: question ${q1.fact!.id} status → 'resolved', superseded=${ua1.superseded.length}`
          : `FAILED: question status=${resolvedQ?.status}`,
      });
    } else {
      results.push({
        name: '4. user_action resolves question + recommendation',
        passed: false,
        detail: `Insert failed: ${JSON.stringify(ua1.warnings)}`,
      });
    }
  } catch (err: any) {
    results.push({
      name: 'ERROR',
      passed: false,
      detail: err?.message || String(err),
    });
  }

  return finish(supabase, results, createdIds);
}

async function finish(
  supabase: any,
  results: TestStep[],
  ids: string[],
) {
  // Clean up test facts
  if (ids.length > 0) {
    await supabase.from('ai_facts').delete().in('id', ids);
  }

  const allPassed = results.every((r) => r.passed);

  return NextResponse.json({
    passed: allPassed,
    steps: results,
    summary: allPassed
      ? '✅ All 4 steps passed — facts table + hedging logic working correctly.'
      : `❌ ${results.filter((r) => !r.passed).length} step(s) failed — see details.`,
  });
}
