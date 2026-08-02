// ─── GET /api/broker/snaptrade/orders ─────────────────────
// Returns order history across all SnapTrade-connected
// brokerage accounts for the authenticated user.
// Uses SnapTrade's activities endpoint filtered for trades.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const SNAPTRADE_API = 'https://api.snaptrade.com/api/v1';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const ALGORITHM = 'aes-256-gcm';

function deriveUserKey(userId: string): Buffer {
  const secret = process.env.VAULT_ENCRYPTION_KEY || 'dev-encryption-key-change-me';
  return crypto.createHash('sha256').update(userId + secret).digest();
}

function decryptSnaptradeSecret(encrypted: string, userId: string): string {
  const { encrypted: enc, iv, authTag } = JSON.parse(encrypted);
  const key = deriveUserKey(userId);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'), {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  return decipher.update(enc, 'base64', 'utf8') + decipher.final('utf8');
}

interface SnapTradeActivity {
  id: string;
  account_id?: string;
  currency?: string;
  symbol?: {
    symbol: string;
    description?: string;
    currency?: string;
  };
  type: string; // BUY, SELL, DIVIDEND, INTEREST, etc.
  trade_date: string;
  settlement_date?: string;
  quantity?: number;
  price?: number;
  amount?: number;
  description?: string;
  option_details?: {
    option_type?: string;
    strike_price?: number;
    expiration_date?: string;
    underlying_symbol?: string;
  };
  order_type?: string;
}

interface BrokerOrder {
  id: string;
  symbol: string;
  name: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop' | 'stop_limit';
  status: string;
  qty: number;
  filledQty: number;
  limitPrice?: number;
  stopPrice?: number;
  filledPrice?: number;
  totalValue?: number;
  timeInForce: string;
  createdAt: string;
  updatedAt: string;
  bracketOrder?: unknown;
}

// Trade types from SnapTrade activities
const TRADE_TYPES = new Set(['BUY', 'SELL', 'SELL_SHORT', 'BUY_TO_COVER', 'DIVIDEND_REINVEST']);

// ─── Dev mode — realistic synthetic orders ─────────────────
const DEV_ORDERS: BrokerOrder[] = [
  {
    id: 'dev-order-001',
    symbol: 'AAPL',
    name: 'Apple Inc.',
    side: 'buy',
    type: 'market',
    status: 'filled',
    qty: 10,
    filledQty: 10,
    filledPrice: 188.45,
    totalValue: 1884.50,
    timeInForce: 'day',
    createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 3).toISOString(),
  },
  {
    id: 'dev-order-002',
    symbol: 'MSFT',
    name: 'Microsoft Corp.',
    side: 'buy',
    type: 'limit',
    status: 'filled',
    qty: 5,
    filledQty: 5,
    limitPrice: 420.00,
    filledPrice: 419.75,
    totalValue: 2098.75,
    timeInForce: 'gtc',
    createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 5).toISOString(),
  },
  {
    id: 'dev-order-003',
    symbol: 'NVDA',
    name: 'NVIDIA Corp.',
    side: 'sell',
    type: 'limit',
    status: 'cancelled',
    qty: 3,
    filledQty: 0,
    limitPrice: 128.00,
    stopPrice: 0,
    totalValue: 0,
    timeInForce: 'gtc',
    createdAt: new Date(Date.now() - 86400000 * 6).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 3).toISOString(),
  },
  {
    id: 'dev-order-004',
    symbol: 'SPY',
    name: 'SPDR S&P 500 ETF',
    side: 'sell',
    type: 'market',
    status: 'filled',
    qty: 2,
    filledQty: 2,
    filledPrice: 538.20,
    totalValue: 1076.40,
    timeInForce: 'day',
    createdAt: new Date(Date.now() - 86400000 * 7).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 7).toISOString(),
  },
];

// ─── Map SnapTrade activity → BrokerOrder ────────────────
function mapActivityToOrder(
  activity: SnapTradeActivity,
  accountId: string,
): BrokerOrder | null {
  const symbol = activity.symbol?.symbol || '';
  if (!symbol || !TRADE_TYPES.has(activity.type)) return null;

  const side = activity.type === 'SELL' || activity.type === 'SELL_SHORT' ? 'sell' : 'buy';
  const qty = activity.quantity || 0;
  const price = activity.price || 0;
  const amount = activity.amount || qty * price;

  let status = 'filled';
  if (activity.type.includes('REINVEST')) status = 'filled';

  // Use a more robust deduplication key: activity_id + symbol + date
  const uniqueId = activity.id
    ? `snaptrade-${accountId}-${activity.id}`
    : `snaptrade-${accountId}-${symbol}-${activity.trade_date}-${activity.type}`;

  return {
    id: uniqueId,
    symbol,
    name: activity.symbol?.description || symbol,
    side,
    type: activity.order_type === 'limit' ? 'limit' : 'market',
    status,
    qty,
    filledQty: qty,
    limitPrice: activity.order_type === 'limit' ? price : undefined,
    stopPrice: activity.order_type === 'stop' ? price : undefined,
    filledPrice: price,
    totalValue: amount,
    timeInForce: 'day',
    createdAt: activity.trade_date,
    updatedAt: activity.settlement_date || activity.trade_date,
    bracketOrder: undefined,
  };
}

export async function GET(_req: NextRequest) {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // ── Get SnapTrade connection + credentials ──────────────
  const { data: conn, error: connErr } = await supabase
    .from('broker_connections')
    .select('snaptrade_user_id, snaptrade_user_secret_encrypted, snaptrade_broker_id, status')
    .eq('user_id', authUser.id)
    .eq('connection_type', 'snaptrade')
    .eq('status', 'connected')
    .single();

  if (connErr || !conn) {
    return NextResponse.json(
      { error: 'No active SnapTrade connection found' },
      { status: 404 },
    );
  }

  // ── Dev mode — return synthetic orders ──────────────────
  const clientId = process.env.SNAPTRADE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(DEV_ORDERS);
  }

  // ── Production — call SnapTrade API ─────────────────────
  const consumerKey = process.env.SNAPTRADE_CONSUMER_KEY || '';
  const snaptradeUserId = conn.snaptrade_user_id || authUser.id;
  // SnapTrade post-OAuth: userId doubles as userSecret for API calls.
  const snaptradeUserSecret = snaptradeUserId;

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'clientId': clientId,
      'consumerKey': consumerKey,
    };

    // Get all accounts
    const accountsRes = await fetch(
      `${SNAPTRADE_API}/accounts?userId=${snaptradeUserId}&userSecret=${snaptradeUserSecret}`,
      { headers },
    );

    if (!accountsRes.ok) {
      console.error('[SnapTrade Orders] Accounts fetch failed:', accountsRes.status);
      return NextResponse.json([]);
    }

    const accounts = await accountsRes.json();

    if (!Array.isArray(accounts) || accounts.length === 0) {
      return NextResponse.json([]);
    }

    // Aggregate order history across all accounts
    const allOrders: BrokerOrder[] = [];
    const seenIds = new Set<string>();

    for (const account of accounts) {
      try {
        // SnapTrade activities endpoint — limited to last 90 days by default
        const activitiesRes = await fetch(
          `${SNAPTRADE_API}/accounts/${account.id}/activities?userId=${snaptradeUserId}&userSecret=${snaptradeUserSecret}`,
          { headers },
        );

        if (!activitiesRes.ok) {
          console.error(
            `[SnapTrade Orders] Activities fetch failed for account ${account.id}:`,
            activitiesRes.status,
          );
          continue;
        }

        const activities: SnapTradeActivity[] = await activitiesRes.json();

        if (!Array.isArray(activities)) continue;

        for (const activity of activities) {
          const order = mapActivityToOrder(activity, account.id);
          if (order && !seenIds.has(order.id)) {
            seenIds.add(order.id);
            allOrders.push(order);
          }
        }
      } catch (err) {
        console.error(`[SnapTrade Orders] Error for account ${account.id}:`, err);
      }
    }

    // Sort by created date, newest first
    allOrders.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return NextResponse.json(allOrders);
  } catch (err) {
    console.error('[SnapTrade Orders] Error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch SnapTrade orders' },
      { status: 502 },
    );
  }
}
