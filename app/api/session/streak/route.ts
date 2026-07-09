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
    const { anonymousId, localDate } = body as { anonymousId?: string; localDate?: string };

    if (!anonymousId || typeof anonymousId !== 'string') {
      return NextResponse.json(
        { error: 'anonymousId is required' },
        { status: 400 }
      );
    }

    // Use client-provided local date (ISO date string YYYY-MM-DD)
    // Falls back to UTC date if not provided — this prevents server-timezone
    // mismatch bugs where "today" in Berlin ≠ "today" in New York.
    const today = localDate && /^\d{4}-\d{2}-\d{2}$/.test(localDate)
      ? localDate
      : new Date().toISOString().split('T')[0];

    const supabase = createServerClient();

    // Fetch existing streak row
    const { data: existing } = await (supabase as any)
      .from('streaks')
      .select('*')
      .eq('anonymous_id', anonymousId)
      .maybeSingle();

    if (!existing) {
      // First-ever open: create streak row
      const newRow = {
        anonymous_id: anonymousId,
        current_streak: 1,
        longest_streak: 1,
        last_open_date: today,
        total_days_active: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { error: insertErr } = await (supabase as any)
        .from('streaks')
        .insert(newRow);

      if (insertErr) {
        console.error('[api/streak] Insert error:', insertErr.message);
        return NextResponse.json({ error: 'Failed to create streak' }, { status: 500 });
      }

      console.log(`[api/streak] New streak for ${anonymousId.slice(0, 8)}...`);
      return NextResponse.json({
        success: true,
        streak: {
          current_streak: 1,
          longest_streak: 1,
          last_open_date: today,
          total_days_active: 1,
        },
      }, { status: 200 });
    }

    // Already opened today — no change
    if (existing.last_open_date === today) {
      console.log(`[api/streak] Already opened today for ${anonymousId.slice(0, 8)}...`);
      return NextResponse.json({
        success: true,
        streak: {
          current_streak: existing.current_streak || 0,
          longest_streak: existing.longest_streak || 0,
          last_open_date: existing.last_open_date,
          total_days_active: existing.total_days_active || 0,
        },
      }, { status: 200 });
    }

    // Check if consecutive: last_open_date was yesterday
    const lastDate = new Date(existing.last_open_date + 'T12:00:00Z');
    const todayDate = new Date(today + 'T12:00:00Z');
    const diffDays = Math.round((todayDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));

    const isConsecutive = diffDays === 1;
    const newCurrentStreak = isConsecutive ? (existing.current_streak || 0) + 1 : 1;
    const newLongestStreak = Math.max(existing.longest_streak || 0, newCurrentStreak);
    const newTotalDays = (existing.total_days_active || 0) + 1;

    const { error: updateErr } = await (supabase as any)
      .from('streaks')
      .update({
        current_streak: newCurrentStreak,
        longest_streak: newLongestStreak,
        last_open_date: today,
        total_days_active: newTotalDays,
        updated_at: new Date().toISOString(),
      })
      .eq('anonymous_id', anonymousId);

    if (updateErr) {
      console.error('[api/streak] Update error:', updateErr.message);
      return NextResponse.json({ error: 'Failed to update streak' }, { status: 500 });
    }

    console.log(
      `[api/streak] ${anonymousId.slice(0, 8)}... → streak ${newCurrentStreak} (consecutive=${isConsecutive})`
    );

    return NextResponse.json({
      success: true,
      streak: {
        current_streak: newCurrentStreak,
        longest_streak: newLongestStreak,
        last_open_date: today,
        total_days_active: newTotalDays,
      },
    }, { status: 200 });
  } catch (err: any) {
    console.error('[api/streak] Error:', err.message);
    return NextResponse.json(
      { error: 'Failed to sync streak' },
      { status: 500 }
    );
  }
}
