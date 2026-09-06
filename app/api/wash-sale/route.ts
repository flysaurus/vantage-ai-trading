// ─── POST /api/wash-sale ─────────────────────────────────────
// Deterministic wash-sale pre-trade advisory for the Sell TradeTicket.
// Returns { isWashSale, isLoss, fifoCostBasis, matchedQty, hasLots, recentBuy }.
//
// Advisory only — this endpoint never blocks or executes a trade. Any
// failure degrades to "no advisory" so it can never wedge the sell flow.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createClient } from '@supabase/supabase-js';
import { checkWashSale } from '@/lib/wash-sale';

const NO_ADVISORY = {
  isWashSale: false,
  isLoss: false,
  fifoCostBasis: 0,
  matchedQty: 0,
  hasLots: false,
  recentBuy: null,
};

export async function POST(req: NextRequest) {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const symbol = String(body?.symbol || '').trim().toUpperCase();
  const sellQty = Number(body?.sellQty);
  const salePrice = Number(body?.salePrice);
  // null → demo account; string → broker_connections.id for a live account.
  const accountId = body?.accountId ?? null;
  const isDemo = Boolean(body?.isDemo);

  if (!symbol || !Number.isFinite(sellQty) || sellQty <= 0 || !Number.isFinite(salePrice) || salePrice <= 0) {
    return NextResponse.json(
      { error: 'symbol, sellQty (number > 0), and salePrice (number > 0) are required' },
      { status: 400 },
    );
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  try {
    const result = await checkWashSale(supabase, {
      userId: authUser!.id,
      accountId,
      isDemo,
      ticker: symbol,
      sellQty,
      salePrice,
    });
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[wash-sale] check failed:', err?.message || err);
    return NextResponse.json({ ...NO_ADVISORY, error: 'check unavailable' }, { status: 200 });
  }
}
