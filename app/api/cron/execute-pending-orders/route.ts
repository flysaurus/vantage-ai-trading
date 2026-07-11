// ─── GET /api/cron/execute-pending-orders ─────────────────────
// Server-side fill cron: processes all OPEN orders across all users
// without requiring any client to be open. Also expires DAY orders
// after market close.
//
// Called by Vercel cron: every 5 minutes during market hours
// (Mon-Fri 13:30-20:00 UTC = 9:30 AM - 4:00 PM ET).
//
// Rate-limit reasoning:
//   Finnhub free tier: 60 calls/minute
//   Expected load: 20-50 demo users, each 0-3 open orders
//   → ~30-50 unique symbols per run
//   → 50ms delay between calls = ~2.5s for 50 symbols
//   → Well within 60/min limit
//   5-minute interval chosen so quotes are reasonably fresh
//   without wasting API calls.
//
// Per-user failure isolation: if one user's state fails to save,
// the error is logged and processing continues for others.
//
// Protected by CRON_SECRET header (same as drawdown-check cron).

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { processAllPendingOrders } from '@/lib/broker/order-processor';

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

  console.log('[cron/execute-pending-orders] Starting fill/expiry cycle...');

  try {
    const result = await processAllPendingOrders(supabase);

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      ...result,
    });
  } catch (err: any) {
    console.error('[cron/execute-pending-orders] Fatal error:', err.message);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
