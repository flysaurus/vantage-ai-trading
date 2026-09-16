// ─── GET /api/reconcile?connectionId=…[&accountId=snaptrade:<conn>:<acct>] ───
// On-demand broker ↔ Vantage reconciliation. The broker (Alpaca via
// SnapTrade) is the single source of truth; this endpoint diffs the broker's
// live cash / orders / positions against Vantage's canonical tables and
// reports any drift. Re-runnable at any time — safe read-only check.
//
// Part B step 4: a login that exposes 2+ accounts MUST be reconciled one
// account at a time (`accountId=`); without it the route refuses rather than
// emitting a merged (wrong-on-every-axis) report.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/auth/get-server-user';
import {
  resolveSnapTradeCredentials,
  SnapTradeAuthError,
  SnapTradeAmbiguousError,
} from '@/lib/snaptrade/client';
import { runReconciliation, ReconcileAccountScopeError } from '@/lib/reconcile';
import { parseAccountScope } from '@/lib/account-scope';

export async function GET(req: NextRequest) {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;

  const connectionId = req.nextUrl.searchParams.get('connectionId');
  // Accept either form: `accountId=snaptrade:<conn>:<acct>` or the bare
  // `snapAccountId=<acct>`; the former is what the app UI already uses.
  const accountIdParam = req.nextUrl.searchParams.get('accountId');
  const snapAccountId =
    parseAccountScope(accountIdParam)?.snapAccountId ??
    req.nextUrl.searchParams.get('snapAccountId') ??
    null;

  // Demo accounts have NO external broker — Vantage itself is the broker there.
  // Reconciliation diffs Vantage against the broker as source of truth, so it is
  // structurally inapplicable to demo. Refuse explicitly rather than emit a
  // misleading "no broker" auth error.
  if (connectionId === 'demo') {
    return NextResponse.json(
      {
        error:
          'Reconciliation is not available for demo accounts — there is no external broker to reconcile against.',
      },
      { status: 422 },
    );
  }

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
      snapAccountId,
    });

    return NextResponse.json(report, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    if (err instanceof ReconcileAccountScopeError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const msg = (err as Error).message;
    const status = /401|403/.test(msg) ? 401 : 502;
    return NextResponse.json(
      { error: msg || 'Reconciliation failed.' },
      { status },
    );
  }
}
