// ─── Investor Score: API ────────────────────────────────────
// POST /api/investor-score
// Returns the current investor score for the given anonymousId.
//
// Body: { anonymousId: string }
// Response: { score: ScoreResult } | { error: string }

import { NextRequest, NextResponse } from 'next/server';
import { getMyScoreWithMetrics } from '@/app/actions/investor-score';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json().catch(() => null);
    if (!body?.anonymousId) {
      return NextResponse.json({ error: 'Missing anonymousId' }, { status: 400 });
    }

    const result = await getMyScoreWithMetrics(body.anonymousId);

    if (!result) {
      return NextResponse.json(
        { error: 'Failed to compute score', hint: 'getMyScoreWithMetrics returned null — check Vercel function logs' },
        { status: 500 },
      );
    }

    return NextResponse.json({ score: result.score, metrics: result.metrics });
  } catch (err: any) {
    console.error('[api/investor-score] Uncaught error:', err?.message || err, err?.stack || '');
    return NextResponse.json(
      { error: 'Internal server error', detail: err?.message || String(err) },
      { status: 500 },
    );
  }
}
