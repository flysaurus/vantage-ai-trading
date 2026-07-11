// ─── Admin Facts API ─────────────────────────────────────────────
// GET /api/admin/facts?userId=xxx
//
// Returns ALL facts (active, superseded, resolved, stale) for a user
// with based_on resolved to show actual referenced claims.
// Gated behind requireAdmin() (JWT-based, not shared ADMIN_ACCESS_CODE).

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin-check';
import { createServerClient } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const { adminError } = await requireAdmin(request);
  if (adminError) return adminError;

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');

  if (!userId) {
    return NextResponse.json({ error: 'Missing userId parameter' }, { status: 400 });
  }

  const supabase = createServerClient() as any;

  // Fetch ALL facts (all statuses) for this user
  const { data: facts, error } = await supabase
    .from('ai_facts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Resolve based_on: for each fact that has based_on IDs, fetch the referenced claims
  const allReferencedIds = new Set<string>();
  for (const f of facts || []) {
    if (f.based_on && Array.isArray(f.based_on)) {
      f.based_on.forEach((id: string) => allReferencedIds.add(id));
    }
  }

  // Build a lookup of claim text per id
  const claimById: Record<string, string> = {};
  if (allReferencedIds.size > 0) {
    const { data: referenced } = await supabase
      .from('ai_facts')
      .select('id,claim,subject')
      .in('id', Array.from(allReferencedIds));

    for (const r of referenced || []) {
      claimById[r.id] = `[${r.subject}] ${r.claim}`;
    }
  }

  // Enrich facts with resolved based_on claims
  const enriched = (facts || []).map((f: any) => ({
    ...f,
    based_on_resolved: f.based_on?.map((id: string) => ({
      id,
      claim: claimById[id] || '(deleted or inaccessible)',
    })) || [],
  }));

  // Stats
  const statusCounts: Record<string, number> = {};
  for (const f of facts || []) {
    statusCounts[f.status] = (statusCounts[f.status] || 0) + 1;
  }

  return NextResponse.json({
    userId,
    total: enriched.length,
    statusCounts,
    facts: enriched,
  });
}
