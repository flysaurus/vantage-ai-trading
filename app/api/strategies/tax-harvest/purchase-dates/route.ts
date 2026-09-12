// GET /api/strategies/tax-harvest/purchase-dates?connectionId=<uuid>&demo=1
//
// Account-scoped purchase-date ledger for the Tax Loss Harvesting feature.
// Returns the acquisition lots (FIFO `position_lots`, falling back to raw buy
// `orders`) for ONE account. Without an account scope this intentionally
// refuses rather than leaking the user's other accounts' lots — that silent
// cross-account leak is exactly what this endpoint replaces.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';
import { loadPurchaseLots } from '@/lib/tax-harvest/purchase-dates';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const userId = authUser!.id;

  const { searchParams } = new URL(req.url);
  // Raw SnapTrade connection id WITHOUT any `snaptrade:` prefix.
  const connectionId = searchParams.get('connectionId') || null;
  const isDemo = searchParams.get('demo') === '1';

  if (!connectionId && !isDemo) {
    return NextResponse.json({ error: 'connectionId required' }, { status: 400 });
  }

  try {
    const supabase = createServerClient();
    const { lotsByTicker, source } = await loadPurchaseLots(supabase, {
      userId,
      connectionId,
      isDemo,
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
    });
  } catch (err: any) {
    console.error('[tax-harvest/purchase-dates] Error:', err?.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
