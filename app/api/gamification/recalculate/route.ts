// ─── Gamification: Recalculate Score ─────────────────────────
// POST /api/gamification/recalculate

import { NextRequest, NextResponse } from 'next/server';
import { recalculateScore } from '@/app/actions/gamification';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body?.anonymousId) {
      return NextResponse.json({ error: 'Missing anonymousId' }, { status: 400 });
    }

    const result = await recalculateScore(
      body.anonymousId,
      body.investorStyle,
      body.positionCount,
      body.maxPositionPct,
      body.diversificationScore,
      body.heldThroughDrawdown
    );

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[api/gamification/recalculate] Error:', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
