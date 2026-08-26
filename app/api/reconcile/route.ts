// ─── GET /api/reconcile?connectionId=… ───────────────────────
// On-demand broker ↔ Vantage reconciliation. The broker (Alpaca via
// SnapTrade) is the single source of truth; this endpoint diffs the broker's
// live cash / orders / positions against Vantage's canonical tables and
// reports any drift. Re-runnable at any time — safe read-only check.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/auth/get-server-user';
import {
  resolveSnapTradeCredentials,
  SnapTradeAuthError,
  SnapTradeAmbiguousError,
} from '@/lib/snaptrade/client';
import { runReconciliation } from '@/lib/reconcile';

export async function GET(req: NextRequest) {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;

  const connectionId = req.nextUrl.searchParams.get('connectionId');

  let creds;
  try {
    creds = await resolveSnapTradeCredentials(authUser.id, connectionId);
  } catch (err) {
    if (err instanceof SnapTradeAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof SnapTradeAmbiguousError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'Failed to load brokerage credentials.' }, { status: 502 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  try {
    const report = await runReconciliation({
      supabase,
      userId: authUser.id,
      connectionId: creds.connectionId,
      brokerConnectionId: creds.brokerConnectionId,
      brokerSlug: creds.brokerSlug,
      snaptradeUserId: creds.snaptradeUserId,
      snaptradeUserSecret: creds.snaptradeUserSecret,
    });

    return NextResponse.json(report, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    const msg = (err as Error).message;
    const status = /401|403/.test(msg) ? 401 : 502;
    return NextResponse.json(
      { error: msg || 'Reconciliation failed.' },
      { status },
    );
  }
}
