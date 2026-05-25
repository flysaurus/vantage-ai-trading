// ─── POST /api/db/strategies/update ───────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId: authUserId } = await requireAuth(req);
    const supabase = createServerClient();
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Missing request body' }, { status: 400 });

    const { strategyId, name, description, targetAllocation, stocks, performanceNotes } = body as Record<string, any>;
    if (!strategyId) return NextResponse.json({ error: 'strategyId required' }, { status: 400 });

    const { data: existing } = await (supabase as any).from('strategies').select('id, user_id').eq('id', strategyId).maybeSingle();
    if (!existing) return NextResponse.json({ error: 'Strategy not found' }, { status: 404 });
    if (existing.user_id !== authUserId) return NextResponse.json({ error: 'Cannot update other users strategies' }, { status: 403 });

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name.trim();
    if (description !== undefined) updates.description = description.trim();
    if (targetAllocation !== undefined) updates.target_allocation = targetAllocation;
    if (stocks !== undefined) updates.stocks = stocks;
    if (performanceNotes !== undefined) updates.performance_notes = performanceNotes;

    const { data, error } = await (supabase as any).from('strategies').update(updates).eq('id', strategyId)
      .select('id, name, stocks, updated_at').single();
    if (error) return NextResponse.json({ error: 'Failed to update strategy', detail: error.message }, { status: 500 });

    return NextResponse.json({ id: data.id, name: data.name, stocks: data.stocks, updatedAt: data.updated_at });
  } catch (err: any) {
    if (err?.name === 'AuthError') return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
