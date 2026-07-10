// ─── GET /api/cron/drawdown-check ───────────────────────────
// Daily cron: updates peak/trough/drawdown tracking for all active
// accounts and awards Weathered a Storm milestones on recovery.
//
// Called by Vercel cron: daily at 10:15 AM ET (14:15 UTC) Mon-Fri.
// Offsets 15min from the main 10:00 AM cron to avoid overlap.
// Protected by CRON_SECRET header.
//
// Per-user failure handling: if equity resolution fails for a single
// user, the error is logged and processing continues. Only a total
// Supabase outage stops the batch.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runDailyDrawdownCheck } from '@/lib/gamification/drawdown';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CRON_SECRET = process.env.CRON_SECRET || '';

export const maxDuration = 55;

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Validate cron secret
  const authHeader = req.headers.get('authorization');
  const expectedAuth = `Bearer ${CRON_SECRET}`;
  if (!CRON_SECRET || authHeader !== expectedAuth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log('[cron/drawdown-check] Starting daily drawdown tracking...');

  try {
    const result = await runDailyDrawdownCheck(supabase);

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      ...result,
    });
  } catch (err: any) {
    console.error('[cron/drawdown-check] Fatal error:', err.message);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
