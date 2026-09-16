// ─── Admin API: Test Coverage ─────────────────────────────────
// GET /api/admin/coverage            → coverage for all ACTIVE cycles (admin only)
// GET /api/admin/coverage?cycleId=…  → coverage for one cycle (admin only)

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin-check';
import { createServerClient } from '@/lib/supabase';
import { getCoverage, listCycles } from '@/lib/qa/test-runner';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth.adminError) return auth.adminError;

  try {
    const { searchParams } = new URL(request.url);
    const cycleId = searchParams.get('cycleId');

    if (cycleId) {
      const coverage = await getCoverage(cycleId);
      return NextResponse.json({ coverage: [coverage] });
    }

    const cycles = await listCycles();
    const active = cycles.filter((c) => c.active !== false);
    const coverage = await Promise.all(active.map((c) => getCoverage(c.id)));
    return NextResponse.json({ coverage });
  } catch (err: any) {
    const msg = err?.message || 'Server error';
    if (msg.includes('does not exist') || msg.includes('42P01')) {
      return NextResponse.json({
        coverage: [],
        note: 'test_* tables not created yet. Run migration 076.',
      });
    }
    console.error('[admin/coverage] GET error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
