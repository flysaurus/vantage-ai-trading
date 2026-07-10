// ─── Gamification: Increment Trades ─────────────────────────
// POST /api/gamification/increment-trades
//
// Accepts trade characteristic data for real style inference,
// plus portfolio-derived skill metrics (risk adherence, diversification).

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
      body.tradeAssetType,
      body.tradeSector,
      body.tradeHoldingDays,
      body.basketStrategy,
      body.investorStyle,
      body.diversificationScore,
      body.positionCount,
      body.maxPositionPct,
      body.heldThroughDrawdown,
      body.currentEquity
    );

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[api/gamification/increment-trades] Error:', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
