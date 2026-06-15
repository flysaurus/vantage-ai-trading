// ─── POST /api/session/streak ─────────────────────────────────
// Syncs the daily login streak for an anonymous session.
// Called once per day by the client on mount.
//
// Body: { anonymousId: string }
// Returns: { streak: StreakData }

import { NextRequest, NextResponse } from 'next/server';
import { syncStreak } from '@/lib/session/sync';

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

    const streak = await syncStreak(anonymousId);

    return NextResponse.json({ success: true, streak }, { status: 200 });
  } catch (err: any) {
    console.error('[api/streak] Error:', err.message);
    return NextResponse.json(
      { error: 'Failed to sync streak' },
      { status: 500 }
    );
  }
}
