// GET /api/strategies/tax-harvest/purchase-dates?connectionId=<uuid>&demo=1
//   &accountId=snaptrade:<conn>:<acct>   (optional active sub-account)
//   &snapAccountId=<acct>               (bare form, alternative)
//
// Account-scoped purchase-date ledger for the Tax Loss Harvesting feature.
// Returns the acquisition lots (FIFO `position_lots`, falling back to raw buy
// `orders`) for ONE account. Without an account scope this intentionally
// refuses rather than leaking the user's other accounts' lots — that silent
// cross-account leak is exactly what this endpoint replaces.
//
// On a shared login (2+ sub-accounts) the active sub-account is forwarded so
// the ledger is scoped to it; without one the loader reports `scope:
// 'unavailable'` rather than merging the siblings.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';
import { loadPurchaseLots } from '@/lib/tax-harvest/purchase-dates';
import { parseAccountScope } from '@/lib/account-scope';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const userId = authUser!.id;

  const { searchParams } = new URL(req.url);
  // Canonical account id ('snaptrade:<conn>:<acct>'), when the caller has one.
  const accountIdParam = searchParams.get('accountId');
  // Raw SnapTrade connection id WITHOUT any `snaptrade:` prefix; fall back to
  // the connection component of the canonical account id.
  const connectionId =
    searchParams.get('connectionId') ||
    parseAccountScope(accountIdParam)?.connectionId ||
    null;
  const isDemo = searchParams.get('demo') === '1';
  // The active sub-account (3-part id form, or a bare snapAccountId param).
  const snapAccountId =
    parseAccountScope(accountIdParam)?.snapAccountId ??
    searchParams.get('snapAccountId') ??
    null;

  if (!connectionId && !isDemo) {
    return NextResponse.json({ error: 'connectionId required' }, { status: 400 });
  }

  try {
    const supabase = createServerClient();
    const { lotsByTicker, source, scope, unattributedLots } = await loadPurchaseLots(supabase, {
      userId,
      connectionId,
      isDemo,
      snapAccountId,
    });

    const lotCount = Object.values(lotsByTicker).reduce(
      (n, lots) => n + lots.length,
      0,
    );

    return NextResponse.json({
      source,
      lotsByTicker,
      lotCount,
      accountScoped: Boolean(connectionId) || isDemo,
      // Disclosure: which scope the lots were read at, and how many legacy
      // lots were excluded for being unattributable (shared login only).
      scope,
      unattributedLots,
    });
  } catch (err: any) {
    console.error('[tax-harvest/purchase-dates] Error:', err?.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
