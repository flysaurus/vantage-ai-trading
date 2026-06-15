// ─── Gamification: Get Score ────────────────────────────────
// GET /api/gamification/score?anonymousId=xxx

import { NextRequest, NextResponse } from 'next/server';
import { getInvestorScore, getMilestones } from '@/app/actions/gamification';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const anonymousId = searchParams.get('anonymousId');

    if (!anonymousId) {
      return NextResponse.json({ error: 'Missing anonymousId' }, { status: 400 });
    }

    const score = await getInvestorScore(anonymousId);
    const milestones = await getMilestones(anonymousId);

    return NextResponse.json({
      score,
      milestones,
    });
  } catch (err: any) {
    console.error('[api/gamification/score] Error:', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
