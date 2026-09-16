// GET /api/strategies/tax-harvest/wash-sale-check?symbol=AAPL[&connectionId=<id>|&demo=1]
//
// "Is a BUY of this ticker inside the 30-day repurchase window, so harvesting
// this loss would be disallowed?"
//
// ── Caller audit (2026-09-16) ────────────────────────────────────────────────
// Exactly ONE caller: app/strategies/setup/tax-harvesting/page.tsx (the TLH
// planner). It passes `connectionId` (or `demo=1`) so the response could be
// scoped. Nothing about that surface needs a same-connection-only answer: the
// page exists to warn that a harvest will be disallowed, and a repurchase in
// another connected account disallows it just the same. Its own
// `historyAvailable === false` branch ("Not checked — no trade history on file
// for this account") is what Fidelity hit while 4,081 broker-reported fills sat
// unread in `trade_history` — i.e. the narrow scope under-reported and the
// copy claimed the data was missing when it wasn't.
// ⇒ Not a deliberate narrower purpose: it was a stale duplicate of the older
//   orders-only logic. It now reads the SAME window as the Sell-ticket advisory
//   via `fetchRepurchaseFills` + `mergeRepurchaseFills` (lib/wash-sale.ts) —
//   one implementation, orders wins, trade_history gap-fills read-only logins,
//   each fill counted once.
// Genuinely account-scoped surfaces are separate and untouched:
// /api/strategies/tax-harvest/purchase-dates + lib/tax-harvest/purchase-dates.ts
// (`scopedConnectionFilter`), which legitimately answer per-account questions
// (e.g. where a lot was acquired).

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';
import { fetchRepurchaseFills } from '@/lib/wash-sale';
import { buildWashSaleCheck } from '@/lib/tax-harvest/recent-buys';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const userId = authUser!.id;

  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get('symbol') || '').toUpperCase();
  if (!symbol) {
    return NextResponse.json({ error: 'symbol required' }, { status: 400 });
  }

  // The raw SnapTrade connection id (no `snaptrade:` prefix) and/or demo=1.
  // Used to LABEL the answer (is the newest buy in another connection?) and to
  // pick the demo dataset — never to narrow the repurchase window.
  const connectionId = searchParams.get('connectionId') || null;
  const isDemo = searchParams.get('demo') === '1';

  try {
    const supabase = createServerClient();

    const src = await fetchRepurchaseFills(supabase, {
      userId,
      ticker: symbol,
      isDemo,
      withCoverage: true,
    });

    return NextResponse.json(
      buildWashSaleCheck({
        symbol,
        orders: src.orders,
        history: src.history,
        gapConnectionIds: src.gapConnectionIds,
        scopedConnectionId: connectionId,
        isDemo,
        ordersCoverage: src.ordersCoverage,
        historyCoverage: src.historyCoverage,
      }),
    );
  } catch (err: any) {
    console.error('[wash-sale-check] Error:', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
