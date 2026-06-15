// ─── Investor Score: API ────────────────────────────────────
// POST /api/investor-score
// Returns the current investor score for the given anonymousId.
//
// Body: { anonymousId: string }
// Response: { score: ScoreResult } | { error: string }

import { NextRequest, NextResponse } from 'next/server';
import { getMyScore } from '@/app/actions/investor-score';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json().catch(() => null);
    if (!body?.anonymousId) {
      return NextResponse.json({ error: 'Missing anonymousId' }, { status: 400 });
    }

    const score = await getMyScore(body.anonymousId);

    if (!score) {
      return NextResponse.json({ error: 'Failed to compute score' }, { status: 500 });
    }

    return NextResponse.json({ score });
  } catch (err: any) {
    console.error('[api/investor-score] Error:', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
