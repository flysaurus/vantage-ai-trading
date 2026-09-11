// ─── PATCH/GET /api/user/preferences ──────────────────────
// Update/read user preferences (risk_tolerance, investor_style).
// Uses Supabase JWT Bearer auth.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';

const VALID_RISK_VALUES = ['conservative', 'moderate', 'aggressive'];

export async function PATCH(req: NextRequest) {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const userId = authUser!.id;

  const body = await req.json();
  const updates: Record<string, any> = {};

  if (body.risk_tolerance) {
    if (!VALID_RISK_VALUES.includes(body.risk_tolerance)) {
      return NextResponse.json({ error: 'Invalid risk_tolerance value' }, { status: 400 });
    }
    updates.risk_tolerance = body.risk_tolerance;
  }

  if (body.investor_style) {
    updates.investor_style = body.investor_style;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid preferences to update' }, { status: 400 });
  }

  updates.updated_at = new Date().toISOString();

  const supabase = createServerClient() as any;
  const { error } = await supabase.from('users').update(updates).eq('id', userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

export async function GET(req: NextRequest) {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const userId = authUser!.id;

  const supabase = createServerClient() as any;
  const { data } = await supabase.from('users').select('risk_tolerance, investor_style, target_return_pct, target_loss_pct, conc_single_pct, conc_top3_pct').eq('id', userId).single();

  return NextResponse.json({
    risk_tolerance: data?.risk_tolerance || 'moderate',
    investor_style: data?.investor_style || null,
    // Target-return/-loss ladder + concentration thresholds: consumed by the
    // inline threshold-crossing badges (Holdings rows) so they use the SAME
    // user-configured bands as the Noticed trigger engine.
    target_return_pct: data?.target_return_pct ?? null,
    target_loss_pct: data?.target_loss_pct ?? null,
    conc_single_pct: data?.conc_single_pct ?? null,
    conc_top3_pct: data?.conc_top3_pct ?? null,
  });
}
