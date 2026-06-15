// ─── Gamification: Increment Trades ─────────────────────────
// POST /api/gamification/increment-trades

import { NextRequest, NextResponse } from 'next/server';
import { incrementTradesExecuted } from '@/app/actions/gamification';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body?.anonymousId) {
      return NextResponse.json({ error: 'Missing anonymousId' }, { status: 400 });
    }

    const result = await incrementTradesExecuted(
      body.anonymousId,
      body.tradeStyle,
      body.investorStyle
    );

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[api/gamification/increment-trades] Error:', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
