// ─── Public Test Runner: cycle payload ────────────────────────
// GET /api/test-runner/cycle/[cycleId]
//
// PUBLIC — deliberately no auth: testers open the cycle link on a phone and
// shouldn't need an account. Returns the cycle name, its ordered cases, and
// the latest recorded result per case (so an accidental reload doesn't lose
// progress on the page).

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { getCycleWithCases } from '@/lib/qa/test-runner';

export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ cycleId: string }> },
) {
  try {
    const { cycleId } = await params;
    if (!cycleId) {
      return NextResponse.json({ error: 'Cycle id is required.' }, { status: 400 });
    }

    const { cycle, cases } = await getCycleWithCases(cycleId);
    if (!cycle) {
      return NextResponse.json({ error: 'Cycle not found' }, { status: 404 });
    }

    const sb = createServerClient() as any;
    const { data: runs } = await sb
      .from('test_runs')
      .select('*')
      .eq('cycle_id', cycleId)
      .order('created_at', { ascending: false });

    const results: Record<string, any> = {};
    for (const r of runs || []) {
      if (!results[r.test_case_id]) {
        results[r.test_case_id] = {
          result: r.result,
          tester_name: r.tester_name,
          notes: r.notes,
          screenshot_url: r.screenshot_url,
          created_at: r.created_at,
        };
      }
    }

    return NextResponse.json({
      cycle: { id: cycle.id, name: cycle.name },
      cases: cases.map((c) => ({
        id: c.id,
        tc_number: c.tc_number,
        title: c.title,
        steps: c.steps,
        expected_result: c.expected_result,
        area: c.area,
      })),
      results,
    });
  } catch (err: any) {
    console.error('[test-runner/cycle] GET error:', err?.message);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
