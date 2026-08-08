// ─── POST /api/broker/execute-trade ──────────────────────────
// Server-side proxy: resolves SnapTrade credentials, creates a
// SnapTradeBroker, and calls placeOrder(). This keeps SnapTrade
// credentials server-side while allowing the client to execute
// real trades through the NEW broker engine (not the old stub).
//
// ═══════════════════════════════════════════════════════════════
// HARD BOUNDARY CHECK (2026-08-08):
// Before ANY order fires, verifyTradeSymbol() re-verifies the
// symbol against Finnhub and confirms the company name matches
// what was shown to the user in the chat. If mismatch → BLOCKED.
// This is defense-in-depth. The primary defense is the merged
// symbol-resolution system; this gate is the permanent last line.
// ═══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import {
  resolveSnapTradeCredentials,
  SnapTradeAuthError,
} from '@/lib/snaptrade/client';
import { SnapTradeBroker } from '@/lib/broker/snaptrade-broker';
import { verifyTradeSymbol } from '@/lib/ai/trade-gate';
import { createClient } from '@supabase/supabase-js';

function formatBrokerName(slug: string | null): string {
  if (!slug) return 'Unknown';
  return slug
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export async function POST(req: NextRequest) {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;

  let body: {
    symbol: string;
    side: 'BUY' | 'SELL';
    shares: number;
    orderType?: 'market' | 'limit' | 'stop' | 'stop_limit';
    /** Optional dollar amount (AI trades default to $500) */
    dollarAmount?: number;
    limitPrice?: number;
    stopPrice?: number;
    timeInForce?: 'day' | 'gtc' | 'ioc' | 'fok';
    /** Chat message ID — enables trade-gate company-name verification */
    messageId?: string | null;
    /** Company name displayed in chat — passed directly for max reliability */
    expectedCompanyName?: string | null;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid request body' },
      { status: 400 },
    );
  }

  const { symbol, side, shares, orderType, dollarAmount, limitPrice, stopPrice, timeInForce, messageId, expectedCompanyName } = body;

  if (!symbol || !side || (shares == null && dollarAmount == null)) {
    return NextResponse.json(
      { success: false, error: 'Missing required fields: symbol, side, and shares or dollarAmount' },
      { status: 400 },
    );
  }

  // ── Supabase client (used for credential lookup + trade gate) ──
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // ═══════════════════════════════════════════════════════════════
  // GATE 1: Trade-gate — re-verify symbol before money moves
  // ═══════════════════════════════════════════════════════════════
  const gateResult = await verifyTradeSymbol(symbol, messageId, supabase, expectedCompanyName);

  if (!gateResult.allowed) {
    console.error(
      `[execute-trade] 🚫 BLOCKED by trade-gate: ${symbol} for user ${authUser!.id}\n` +
      `  Detail: ${gateResult.detail || gateResult.reason}`,
    );
    return NextResponse.json(
      {
        success: false,
        error: gateResult.reason,
        status: 'BLOCKED',
        blockedBy: 'trade-gate',
      },
      { status: 422 },
    );
  }

  console.log(`[execute-trade] trade-gate passed: ${gateResult.reason}`);

  // --- Resolve credentials + connection metadata ---
  let snaptradeUserId: string;
  let snaptradeUserSecret: string;
  let connectionId: string;
  let brokerSlug: string;
  let tradingEnabled: boolean = false;

  try {
    const creds = await resolveSnapTradeCredentials(authUser!.id);
    snaptradeUserId = creds.snaptradeUserId;
    snaptradeUserSecret = creds.snaptradeUserSecret;
    connectionId = creds.connectionId;
    brokerSlug = creds.brokerSlug;

    const { data: conn } = await supabase
      .from('broker_connections')
      .select('trading_enabled')
      .eq('user_id', authUser!.id)
      .eq('connection_type', 'snaptrade')
      .eq('status', 'connected')
      .maybeSingle();

    tradingEnabled = conn?.trading_enabled === true;
  } catch (err) {
    if (err instanceof SnapTradeAuthError) {
      return NextResponse.json(
        { success: false, error: err.message, status: 'REJECTED' },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { success: false, error: 'Failed to load brokerage credentials.', status: 'REJECTED' },
      { status: 502 },
    );
  }

  // --- Place the order ---
  try {
    const broker = new SnapTradeBroker({
      userId: snaptradeUserId,
      userSecret: snaptradeUserSecret,
      connectionId,
      brokerSlug,
      brokerName: formatBrokerName(brokerSlug),
      tradingEnabled,
    });

    const result = await broker.placeOrder({
      symbol,
      side,
      type: orderType || 'market',
      shares,
      dollarAmount,
      limitPrice,
      stopPrice,
      timeInForce: timeInForce || 'day',
    });

    // ── Persist order to database (Phase 6: real broker order lifecycle) ──
    //
    // Decision tree for orderId:
    //   Real UUID       → reached broker    → INSERT with brokerage_order_id
    //   'queued'        → market closed     → INSERT (open, null broker ID) so cron can execute
    //   'error' / other → pre-broker failure → SKIP (phantom order, never reached SnapTrade)
    //
    const PHANTOM_ORDER_IDS = new Set(['error', 'readonly', 'no-account', 'bad-symbol', 'no-qty', 'unknown']);
    const isPhantom = PHANTOM_ORDER_IDS.has(result.orderId || '');
    const isQueued = result.orderId === 'queued';
    const shouldPersist = !isPhantom; // persist both real and queued orders
    let dbOrderId: string | null = null;
    let dbWarnMsg: string | null = null;

    if (shouldPersist) {
      try {
        const now = new Date().toISOString();
        const { data: dbOrder, error: dbErr } = await supabase
          .from('orders')
          .insert({
            user_id: authUser!.id,
            symbol: symbol.toUpperCase(),
            qty: shares,
            filled_qty: result.status === 'FILLED' ? (result.filledShares || shares) : 0,
            side: side.toLowerCase(),
            order_type: (orderType || 'market').toLowerCase(),
            status: (result.status || 'OPEN').toLowerCase(),
            filled_price: result.fillPrice || null,
            filled_at: result.filledAt || (result.status === 'FILLED' ? now : null),
            time_in_force: (timeInForce || 'day').toLowerCase(),
            is_demo: false,
            brokerage_order_id: isQueued ? null : result.orderId,
            created_at: now,
          })
          .select('id')
          .single();
        dbOrderId = dbOrder?.id || null;
        if (dbErr) {
          console.error('[execute-trade] ⚠️ DB order persist failed:', JSON.stringify(dbErr, null, 2));
          dbWarnMsg = `Order queued at ${formatBrokerName(brokerSlug)} but could not be saved locally — it may not appear in history until the next sync.`;
        } else {
          const tag = isQueued ? 'QUEUED (market closed)' : result.orderId;
          console.log(`[execute-trade] 💾 Order persisted to DB: ${dbOrder?.id} (${tag})`);
        }
      } catch (persistErr) {
        console.error('[execute-trade] ⚠️ DB persist exception:', persistErr);
        dbWarnMsg = `Order at ${formatBrokerName(brokerSlug)} but local persist failed — check broker directly if it doesn't appear.`;
      }
    } else {
      console.warn(
        `[execute-trade] ⚠️ SKIPPED DB persist — phantom order (orderId: "${result.orderId}"). ` +
        `Order never reached SnapTrade. Failure: ${result.message || 'unknown'}`
      );
    }

    return NextResponse.json({
      success: result.success,
      status: result.status,
      orderId: result.orderId,
      message: result.message,
      fillPrice: result.fillPrice,
      totalCost: result.totalCost,
      filledShares: result.filledShares,
      filledAt: result.filledAt,
      dbOrderId,
      dbWarnMsg,
    });
  } catch (err) {
    const msg = (err as Error).message || 'Trade execution failed';
    console.error('[execute-trade] Error:', msg);
    return NextResponse.json(
      { success: false, error: msg, status: 'REJECTED' },
      { status: 502 },
    );
  }
}
