// ─── Gamification: List Milestones ──────────────────────────
// GET /api/gamification/milestones?anonymousId=xxx

import { NextRequest, NextResponse } from 'next/server';
import { getMilestones } from '@/app/actions/gamification';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const anonymousId = searchParams.get('anonymousId');

    if (!anonymousId) {
      return NextResponse.json({ error: 'Missing anonymousId' }, { status: 400 });
    }

    const milestones = await getMilestones(anonymousId);

    return NextResponse.json({ milestones });
  } catch (err: any) {
    console.error('[api/gamification/milestones] Error:', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
