// ─── GET /api/cron/trigger-execution ──────────────────────────
// Client-triggered order execution for Option C hybrid approach.
// Allows authenticated users to trigger the pending order
// execution cycle without waiting for the daily Vercel cron.
//
// Protected by Supabase user auth (cookie-based, same as all
// other app API routes). Service role key used only server-side.
//
// Idempotent: safe to call multiple times. If no open orders
// exist, it's a no-op. Client should self-throttle to ≤1 per 5 min.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/auth/get-server-user';
import { processAllPendingOrders } from '@/lib/broker/order-processor';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const maxDuration = 55;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { authUser, authError } = await requireAuth(req);
  if (authError) return authError;

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`[trigger-execution] User ${authUser.id} triggered execution cycle`);

  try {
    const result = await processAllPendingOrders(supabase);

    return NextResponse.json({
      success: true,
      triggeredBy: authUser.id,
      timestamp: new Date().toISOString(),
      ...result,
    });
  } catch (err: any) {
    console.error('[trigger-execution] Error:', err.message);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
