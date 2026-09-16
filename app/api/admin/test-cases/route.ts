// ─── Admin API: Test Cases ────────────────────────────────────
// GET  /api/admin/test-cases  → list all test cases (admin only)
// POST /api/admin/test-cases  → bulk-add cases from pasted text (admin only)
//
// POST body: { text: string }
// Response:  { inserted, updated, skipped, skipped_blocks }

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin-check';
import { createServerClient } from '@/lib/supabase';
import { parseTestCasePaste } from '@/lib/qa/test-runner';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth.adminError) return auth.adminError;

  try {
    const sb = createServerClient() as any;
    const { data, error } = await sb
      .from('test_cases')
      .select('*')
      .order('tc_number', { ascending: true });

    if (error) {
      if (error.message?.includes('does not exist') || error.code === '42P01') {
        return NextResponse.json({
          cases: [],
          note: 'test_cases table not created yet. Run migration 076.',
        });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ cases: data || [] });
  } catch (err: any) {
    console.error('[admin/test-cases] GET error:', err.message);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth.adminError) return auth.adminError;

  try {
    const body = await request.json().catch(() => ({}));
    const text: string = typeof body?.text === 'string' ? body.text : '';

    if (!text.trim()) {
      return NextResponse.json({ error: 'Paste some test cases first.' }, { status: 400 });
    }

    const parsed = parseTestCasePaste(text);
    if (parsed.cases.length === 0) {
      return NextResponse.json(
        {
          error: 'No test cases found. Each block must start with a TC number (e.g. TC-014: title).',
          skipped: parsed.skipped.length,
          skipped_blocks: parsed.skipped,
        },
        { status: 400 },
      );
    }

    const sb = createServerClient() as any;
    const numbers = parsed.cases.map((c) => c.tc_number);

    const { data: existing, error: selErr } = await sb
      .from('test_cases')
      .select('tc_number')
      .in('tc_number', numbers);
    if (selErr) {
      console.error('[admin/test-cases] select error:', selErr.message);
      return NextResponse.json({ error: selErr.message }, { status: 500 });
    }
    const existingSet = new Set((existing || []).map((r: any) => r.tc_number));

    let inserted = 0;
    let updated = 0;
    for (const c of parsed.cases) {
      if (existingSet.has(c.tc_number)) updated++;
      else inserted++;
    }

    const { error: upErr } = await sb
      .from('test_cases')
      .upsert(parsed.cases, { onConflict: 'tc_number' });
    if (upErr) {
      console.error('[admin/test-cases] upsert error:', upErr.message);
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }

    return NextResponse.json({
      inserted,
      updated,
      skipped: parsed.skipped.length,
      skipped_blocks: parsed.skipped,
      total: parsed.cases.length,
    });
  } catch (err: any) {
    console.error('[admin/test-cases] POST error:', err.message);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
