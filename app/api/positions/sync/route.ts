/**
 * POST /api/positions/sync — Upsert broker positions into Supabase positions table.
 * Called by the frontend after fetching live positions from the broker.
 * This keeps the AI routes (daily-brief, weekly-snapshot) supplied with current data.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { getOptionalUserId } from '@/lib/auth/get-server-user';
import {
  resolveBrokerConnection,
  SnapTradeAuthError,
  SnapTradeAmbiguousError,
} from '@/lib/snaptrade/client';
import { canonicalizeSymbol } from '@/lib/sector-resolver';
import { resolvePositionSectors } from '@/lib/portfolio/position-sectors-server';
import { accountIdWritesEnabled, resolveBrokerAccountIdForWrite } from '@/lib/broker/account-id';

export async function POST(req: NextRequest) {
  try {
    const userId = await getOptionalUserId();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { positions, connectionId, snapAccountId } = body;

    if (!Array.isArray(positions)) {
      return NextResponse.json({ error: 'positions array required' }, { status: 400 });
    }

    // Resolve the EXACT broker_connections row these positions belong to.
    // Enforces ownership; requires an explicit id when 2+ brokers are connected
    // (so broker B can never wipe broker A's rows and re-write them as its own).
    let resolvedConnectionId: string;
    try {
      const conn = await resolveBrokerConnection(
        userId,
        typeof connectionId === 'string' ? connectionId : null,
      );
      resolvedConnectionId = conn.id;
    } catch (err) {
      if (err instanceof SnapTradeAuthError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      if (err instanceof SnapTradeAmbiguousError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      return NextResponse.json({ error: 'Failed to resolve broker connection.' }, { status: 502 });
    }

    const supabase = createServerClient();

    // Part B step 3b — stamp the sub-account on every row we are about to write.
    // The account comes from the SAME active-account context the read path used
    // (`snapAccountId` → scopedUrl); it is never re-derived from the payload.
    // Inert until BROKER_ACCOUNT_ID_WRITES=1: returns null, zero queries.
    const writeAccountId = await resolveBrokerAccountIdForWrite(supabase, {
      userId,
      connectionId: resolvedConnectionId,
      snapAccountId: typeof snapAccountId === 'string' ? snapAccountId : null,
    });
    const stampingOn = accountIdWritesEnabled();
    const scopeRequested =
      typeof snapAccountId === 'string' && snapAccountId.length > 0;

    // Enrich positions with sectors before persisting. Single authority:
    // lib/portfolio/position-sectors-server.ts — static symbol map → live
    // Finnhub, plus the SAME ETF look-through the sector-mix donut uses for
    // funds. Runs over every position (not just the ones missing a sector) so a
    // fund-family label is applied even when the broker sent a bare symbol.
    // Never throws; unresolvable symbols persist as null.
    const resolvedSectors = await resolvePositionSectors(
      positions.map((p: any) => ({
        symbol: p.symbol,
        industry: p.industry,
        sector: p.sector,
      })),
      { supabase },
    );

    // Build upsert rows: map BrokerPosition → positions table columns
    const rows = positions.map((p: any) => {
      const knownSector = (p.sector || '').trim();
      const sector = knownSector || resolvedSectors.get(canonicalizeSymbol(p.symbol)) || null;
      return {
        user_id: userId,
        connection_id: resolvedConnectionId,
        account_id: writeAccountId,
        symbol: p.symbol,
        name: p.name ?? p.description ?? null,
        qty: p.shares ?? p.qty ?? 0,
        avg_cost: p.avgCost ?? p.avg_cost ?? 0,
        market_value: p.marketValue ?? p.market_value ?? 0,
        sector,
        updated_at: new Date().toISOString(),
      };
    });

    // Always delete this connection's live positions, then insert fresh.
    // (Even an empty positions array must clear stale rows after a sell-to-zero.)
    //
    // ⚠️ Once rows are account-stamped, the delete MUST narrow with them. A
    // connection-wide delete on a shared login (Fidelity: 2 accounts) would wipe
    // the sibling account's rows on every sync of the active one.
    //
    // The stamped delete therefore keeps (a) this account's own rows' slot and
    // (b) the connection's UNSTAMPED legacy rows — those were produced by the old
    // connection-wide sync, i.e. exactly the mis-scoped row set stamping exists to
    // replace. Without (b) the first stamped sync would leave the legacy NULL rows
    // in place alongside the new ones and every reader would double-count.
    // Legacy rows for a *sibling* account are only cleared once that account syncs.
    let deleteQuery = (supabase as any)
      .from('positions')
      .delete()
      .eq('user_id', userId)
      .eq('is_demo', false)
      .eq('connection_id', resolvedConnectionId);
    if (writeAccountId) {
      deleteQuery = deleteQuery.or(
        `account_id.eq.${writeAccountId},account_id.is.null`,
      );
    } else if (stampingOn && scopeRequested) {
      // Stamping is on and a sub-account WAS named, but it has no broker_accounts
      // row (never registered). Do NOT fall back to a connection-wide delete — on
      // a shared login that would wipe a sibling account's already-stamped rows.
      // Supersede only this connection's unattributed rows and leave the new ones
      // unstamped; the connection is reported rather than guessed.
      console.warn(
        '[positions/sync] no broker_accounts row for requested sub-account — restricting delete to unattributed rows',
      );
      deleteQuery = deleteQuery.is('account_id', null);
    }
    const { error: deleteError } = await deleteQuery;
    if (deleteError) {
      // Never swallow this: a failed delete leaves the previous sync's rows in
      // place and the subsequent insert silently double-counts them.
      console.error('[positions/sync] delete failed:', deleteError.message);
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    if (rows.length > 0) {
      const { error: insertError } = await (supabase as any)
        .from('positions')
        .insert(rows.map(r => ({ ...r, is_demo: false })));
      if (insertError) {
        console.error('[positions/sync] insert failed:', insertError.message);
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }
    }

    console.log(`[positions/sync] Synced ${rows.length} broker positions for user ${userId.slice(0, 8)} connection ${resolvedConnectionId.slice(0, 8)}`);

    return NextResponse.json({ synced: rows.length });
  } catch (err: any) {
    console.error('[positions/sync] Error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
