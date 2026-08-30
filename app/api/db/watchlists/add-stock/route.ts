// ─── POST /api/db/watchlists/add-stock ───────────────────────
// Adds a stock symbol to a watchlist. Prevents duplicates.
// Requires: Authorization header with valid Bearer token.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';
import { accountScopeMatches } from '@/lib/account-scope';

interface StockEntry {
  symbol: string;
  addedAt: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const authUserId = authUser!.id;
    const supabase = createServerClient();

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Missing request body' }, { status: 400 });
    }

    const { watchlistId, symbol, accountId } = body as {
      watchlistId?: string;
      symbol?: string;
      accountId?: string;
    };

    if (!watchlistId) return NextResponse.json({ error: 'watchlistId required' }, { status: 400 });
    if (!symbol || !symbol.trim()) return NextResponse.json({ error: 'symbol required' }, { status: 400 });

    const cleanSymbol = symbol.trim().toUpperCase();

    // Fetch current watchlist with ownership check
    const { data: existing, error: fetchErr } = await (supabase as any)
      .from('watchlists')
      .select('id, user_id, stocks, connection_id, is_demo')
      .eq('id', watchlistId)
      .maybeSingle();

    if (fetchErr || !existing) {
      return NextResponse.json({ error: 'Watchlist not found' }, { status: 404 });
    }
    if (existing.user_id !== authUserId) {
      return NextResponse.json({ error: 'Cannot modify other users watchlists' }, { status: 403 });
    }
    if (!accountScopeMatches(accountId, existing)) {
      return NextResponse.json({ error: 'Watchlist not found for this account' }, { status: 404 });
    }

    // Check for duplicates
    const stocks: StockEntry[] = existing.stocks || [];
    const alreadyExists = stocks.some(
      (s) => s.symbol?.toUpperCase() === cleanSymbol
    );
    if (alreadyExists) {
      return NextResponse.json(
        { error: `${cleanSymbol} is already in this watchlist` },
        { status: 409 }
      );
    }

    // Add stock
    const newEntry: StockEntry = {
      symbol: cleanSymbol,
      addedAt: new Date().toISOString(),
    };
    const updatedStocks = [...stocks, newEntry];
    const now = new Date().toISOString();

    const { data, error } = await (supabase as any)
      .from('watchlists')
      .update({ stocks: updatedStocks, updated_at: now })
      .eq('id', watchlistId)
      .select('id, stocks, updated_at')
      .single();

    if (error) {
      console.error('[watchlists/add-stock] Update failed:', error.message);
      return NextResponse.json({ error: 'Failed to add stock', detail: error.message }, { status: 500 });
    }

    return NextResponse.json({
      id: data.id,
      stocks: data.stocks,
      updatedAt: data.updated_at,
    });
  } catch (err: any) {
    if (err?.name === 'AuthError') {
      return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    }
    console.error('[watchlists/add-stock] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error', detail: err?.message }, { status: 500 });
  }
}
