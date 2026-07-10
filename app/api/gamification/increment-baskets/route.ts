// ─── Gamification: Increment Baskets ────────────────────────
// POST /api/gamification/increment-baskets

import { NextRequest, NextResponse } from 'next/server';
import { incrementBasketsCreated } from '@/app/actions/gamification';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body?.anonymousId) {
      return NextResponse.json({ error: 'Missing anonymousId' }, { status: 400 });
    }

    const result = await incrementBasketsCreated(
      body.anonymousId,
      body.investorStyle,
      body.positionCount,
      body.maxPositionPct
    );

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[api/gamification/increment-baskets] Error:', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
