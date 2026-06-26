// ─── PATCH/GET /api/user/preferences ──────────────────────
// Update/read user preferences (risk_tolerance, investor_style).
// Uses Supabase JWT Bearer auth.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';

const VALID_RISK_VALUES = ['conservative', 'moderate', 'aggressive'];

export async function PATCH(req: NextRequest) {
  let userId: string;
  try {
    ({ userId } = await requireAuth(req));
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Not authenticated' }, { status: 401 });
  }

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
  let userId: string;
  try {
    ({ userId } = await requireAuth(req));
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Not authenticated' }, { status: 401 });
  }

  const supabase = createServerClient() as any;
  const { data } = await supabase.from('users').select('risk_tolerance, investor_style').eq('id', userId).single();

  return NextResponse.json({
    risk_tolerance: data?.risk_tolerance || 'moderate',
    investor_style: data?.investor_style || null,
  });
}
