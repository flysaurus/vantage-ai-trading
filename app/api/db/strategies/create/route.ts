// ─── POST /api/db/strategies/create ───────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId: authUserId } = await requireAuth(req);
    const supabase = createServerClient();
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Missing request body' }, { status: 400 });

    const { userId, name, description, investorStyle, targetAllocation, stocks } = body as Record<string, any>;
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });
    if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 });
    if (userId !== authUserId) return NextResponse.json({ error: 'Cannot create strategies for other users' }, { status: 403 });

    const { data, error } = await (supabase as any)
      .from('strategies').insert({
        user_id: userId, name: name.trim(),
        description: description?.trim() || null,
        investor_style: investorStyle || null,
        target_allocation: targetAllocation || {},
        stocks: stocks || [],
      }).select('id, name, description, investor_style, target_allocation, stocks, created_at').single();

    if (error) return NextResponse.json({ error: 'Failed to create strategy', detail: error.message }, { status: 500 });

    return NextResponse.json({ id: data.id, name: data.name, description: data.description, investorStyle: data.investor_style, targetAllocation: data.target_allocation, stocks: data.stocks || [], createdAt: data.created_at });
  } catch (err: any) {
    if (err?.name === 'AuthError') return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
