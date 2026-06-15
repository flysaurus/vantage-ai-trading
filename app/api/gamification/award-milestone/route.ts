// ─── Gamification: Award Milestone ──────────────────────────
// POST /api/gamification/award-milestone
// Idempotent — returns 409 if already awarded.

import { NextRequest, NextResponse } from 'next/server';
import { awardMilestone } from '@/app/actions/gamification';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body?.anonymousId || !body?.milestoneKey) {
      return NextResponse.json({ error: 'Missing anonymousId or milestoneKey' }, { status: 400 });
    }

    const result = await awardMilestone(body.anonymousId, body.milestoneKey);

    if (!result.awarded) {
      return NextResponse.json(result, { status: 409 });
    }

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[api/gamification/award-milestone] Error:', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
