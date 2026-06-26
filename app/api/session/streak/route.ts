// ─── POST /api/session/streak ─────────────────────────────────
// Syncs the daily login streak for an anonymous session.
// Called once per day by the client on mount.
//
// Body: { anonymousId: string }
// Returns: { streak: StreakData }

import { NextRequest, NextResponse } from 'next/server';
// syncStreak removed - anonymous sessions deleted
import { createServerClient } from '@/lib/supabase';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(req.url);
    const anonymousId = searchParams.get('anonymousId');

    if (!anonymousId) {
      return NextResponse.json({ error: 'anonymousId is required' }, { status: 400 });
    }

    const supabase = createServerClient();
    const { data, error } = await (supabase as any)
      .from('streaks')
      .select('*')
      .eq('anonymous_id', anonymousId)
      .maybeSingle();

    if (error) {
      console.error('[api/streak] GET error:', error.message);
      return NextResponse.json({ error: 'Failed to fetch streak' }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ streak: null }, { status: 404 });
    }

    return NextResponse.json({ streak: data }, { status: 200 });
  } catch (err: any) {
    console.error('[api/streak] GET exception:', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json().catch(() => ({}));
    const { anonymousId } = body as { anonymousId?: string };

    if (!anonymousId || typeof anonymousId !== 'string') {
      return NextResponse.json(
        { error: 'anonymousId is required' },
        { status: 400 }
      );
    }

    // Streak syncing removed (anonymous sessions deleted).
    // Return a stub so callers don't crash.
    const streak = {
      current_streak: 0,
      longest_streak: 0,
      last_open_date: new Date().toISOString().split('T')[0],
      total_days_active: 0,
    };

    return NextResponse.json({ success: true, streak }, { status: 200 });
  } catch (err: any) {
    console.error('[api/streak] Error:', err.message);
    return NextResponse.json(
      { error: 'Failed to sync streak' },
      { status: 500 }
    );
  }
}
