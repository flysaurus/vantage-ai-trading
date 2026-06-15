// ─── Investor Score: Weekly Cron ────────────────────────────
// GET /api/cron/investor-score
// Takes a weekly snapshot of the investor score for all users.
//
// Protected with CRON_SECRET header.
// Scheduled in vercel.json: every Sunday at midnight.

import { NextRequest, NextResponse } from 'next/server';
import { takeWeeklySnapshot, getAllActiveScores } from '@/lib/investor-score/snapshot';

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Auth: CRON_SECRET header required
  const cronSecret = request.headers.get('x-cron-secret') || request.headers.get('authorization')?.replace('Bearer ', '');
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret || cronSecret !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const scores = await getAllActiveScores();

    if (scores.length === 0) {
      return NextResponse.json({ processed: 0, message: 'No active scores found' });
    }

    // Process in parallel with a concurrency cap of 5
    const CONCURRENCY = 5;
    let processed = 0;

    for (let i = 0; i < scores.length; i += CONCURRENCY) {
      const batch = scores.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async ({ anonymous_id }) => {
          await takeWeeklySnapshot(anonymous_id);
        })
      );
      processed += batch.length;
    }

    console.log(`[cron/investor-score] Processed ${processed} snapshots`);

    return NextResponse.json({
      processed,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[cron/investor-score] Error:', err.message);
    return NextResponse.json(
      { error: 'Internal server error', message: err.message },
      { status: 500 }
    );
  }
}
