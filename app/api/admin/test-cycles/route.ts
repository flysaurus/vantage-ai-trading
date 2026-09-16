// ─── Admin API: Test Cycles ───────────────────────────────────
// GET  /api/admin/test-cycles  → list cycles with case counts (admin only)
// POST /api/admin/test-cycles  → create a cycle + assign cases (admin only)
//
// POST body: { name: string, caseIds: string[] }

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin-check';
import { createServerClient } from '@/lib/supabase';
import { listCycles, createCycle } from '@/lib/qa/test-runner';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth.adminError) return auth.adminError;

  try {
    const cycles = await listCycles();
    return NextResponse.json({ cycles });
  } catch (err: any) {
    const msg = err?.message || 'Server error';
    if (msg.includes('does not exist') || msg.includes('42P01')) {
      return NextResponse.json({
        cycles: [],
        note: 'test_cycles table not created yet. Run migration 076.',
      });
    }
    console.error('[admin/test-cycles] GET error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth.adminError) return auth.adminError;

  try {
    const body = await request.json().catch(() => ({}));
    const name: string = typeof body?.name === 'string' ? body.name.trim() : '';
    const caseIds: string[] = Array.isArray(body?.caseIds)
      ? body.caseIds.filter((x: unknown) => typeof x === 'string')
      : [];

    if (!name) {
      return NextResponse.json({ error: 'Cycle name is required.' }, { status: 400 });
    }

    const cycle = await createCycle(name, caseIds);
    return NextResponse.json({ cycle }, { status: 201 });
  } catch (err: any) {
    console.error('[admin/test-cycles] POST error:', err.message);
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
  }
}
