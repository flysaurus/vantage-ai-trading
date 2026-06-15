// ─── Onboarding Sync ────────────────────────────────────────
// POST /api/onboarding/sync
// Syncs investor style, risk tolerance, and name from the
// onboarding quiz to Supabase (anonymous_profiles or users table).
//
// Body: { anonymousId, investorStyle, riskTolerance, firstName }
// Response: { success: boolean }

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { anonymousId, investorStyle, riskTolerance, firstName } = body as {
      anonymousId?: string;
      investorStyle?: string;
      riskTolerance?: string;
      firstName?: string;
    };

    if (!anonymousId) {
      return NextResponse.json({ error: 'anonymousId is required' }, { status: 400 });
    }

    const validStyles = ['buffett', 'lynch', 'livermore', 'munger', 'soros'];
    const validRisks = ['conservative', 'moderate', 'aggressive'];

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.error('[onboarding/sync] Missing Supabase env vars');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const updates: Record<string, string> = {};

    if (investorStyle && validStyles.includes(investorStyle)) {
      updates.investor_style = investorStyle;
    }
    if (riskTolerance && validRisks.includes(riskTolerance)) {
      updates.risk_tolerance = riskTolerance;
    }
    if (firstName && typeof firstName === 'string') {
      updates.first_name = firstName.trim().slice(0, 100);
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ success: true, note: 'No valid fields to sync' });
    }

    // Upsert into anonymous_profiles
    const { error } = await supabase
      .from('anonymous_profiles')
      .upsert(
        {
          anonymous_id: anonymousId,
          ...updates,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'anonymous_id' }
      );

    if (error) {
      console.error('[onboarding/sync] Upsert error:', error.message);
      return NextResponse.json({ error: 'Failed to sync profile' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[onboarding/sync] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
