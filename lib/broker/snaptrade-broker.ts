// ─── SnapTrade Broker Adapter ─────────────────────────────────
// Implements BrokerEngine for any SnapTrade-connected brokerage.
// Fully generic — parameterized by connection ID, works identically
// across trading-enabled and read-only brokers.
//
// Trading methods throw "not available" (Phase 2b).
// Read-only brokers have supportsTrading=false, but ALL methods
// except order execution work normally for viewing.

import { snapTradeFetch, snapTradeFetchSafe } from '@/lib/snaptrade/auth';
import { getAccountBalances } from '@/lib/snaptrade/client';
import { extractOrderSymbol } from '@/lib/snaptrade/mapping';
import { toStandardSymbol, toBrokerSymbol } from './symbol-resolver';
import type {
  BrokerEngine, BrokerMeta, BrokerPosition, BrokerAccountSummary,
  BrokerOrder, BrokerBasketOrder, OrderRequest, OrderResult,
  BasketOrderRequest, BasketOrderResult, OrderStatus, OrderSide, OrderType,
  TimeInForce, OrderImpactPreview, CancelOrderResult, PendingOrderFill,
} from './types';

// ─── Types ────────────────────────────────────────────────────

interface SnapAccount {
  id: string;
  number: string;
  name: string;
  type: string;
  currency: string;
  cash: number | null;
  buying_power: number | null;
  total_value: number | null;
  account_category: string | null;
}

interface SnapPosition {
  symbol?: string;
  description?: string;
  units?: number;
  price?: number;
  average_purchase_price?: number;
  total_purchase_price?: number;
  open_pnl?: number;
  asset_type?: string;
  sector?: string;
}

/** Raw order from SnapTrade recentOrders / placeOrder responses */
interface SnapOrder {
  brokerage_order_id?: string;
  brokerage_group_order_id?: string | null;
  order_role?: string | null;
  status?: string;
  symbol?: string;
  universal_symbol?: {
    id?: string;
    symbol?: string;
    description?: string;
    currency?: { code?: string };
    type?: { code?: string };
  } | null;
  option_symbol?: unknown;
  action?: string;
  order_type?: string;
  time_in_force?: string;
  price?: number;
  stop_price?: number;
  quantity?: number;
  filled_quantity?: number | string | null;
  average_fill_price?: number | string | null;
  execution_price?: number | string | null;
  total_quantity?: number | string | null;
  open_quantity?: number | string | null;
  canceled_quantity?: number | string | null;
  total_cost?: number | string | null;
  fees?: number | string | null;
  time_placed?: string;
  time_executed?: string;
  trade_date?: string;
  create_date?: string;
}

// ─── Module-level helpers ──────────────────────────────────────

/** Map SnapTrade's verbose status enum to our simplified OrderStatus */
function _mapSnapTradeStatusToOrderStatus(rawStatus: string | undefined): OrderStatus {
  if (!rawStatus) return 'SUBMITTED';
  const s = rawStatus.toUpperCase();
  // Terminal
  if (['EXECUTED', 'FILLED'].includes(s)) return 'FILLED';
  if (['PARTIAL', 'PARTIALLY_FILLED'].includes(s)) return 'PARTIALLY_FILLED';
  if (['CANCELED', 'PARTIAL_CANCELED', 'CANCEL_PENDING', 'PENDING_CANCEL', 'EXPIRED'].includes(s)) return 'CANCELLED';
  if (['REJECTED', 'FAILED', 'SUSPENDED', 'STOPPED'].includes(s)) return 'REJECTED';
  // Submitted — reached the broker, not yet confirmed working/open
  if (['NEW', 'PENDING_NEW', 'SUBMITTED', 'ACCEPTED', 'ACCEPTED_FOR_BIDDING', 'QUEUED', 'PENDING'].includes(s)) return 'SUBMITTED';
  // Open/working — confirmed resting at the venue
  if (['OPEN', 'WORKING', 'DONE_FOR_DAY', 'TRIGGERED', 'ACTIVATED', 'CONTINGENT_ORDER', 'REPLACE_PENDING', 'REPLACED', 'PENDING_REPLACE', 'CALCULATED', 'HELD'].includes(s)) return 'OPEN';
  return 'OPEN';
}

function _mapOrderTypeToSnapTrade(type: import('./types').OrderType): string {
  switch (type) {
    case 'market': return 'Market';
    case 'limit': return 'Limit';
    case 'stop': return 'Stop';
    case 'stop_limit': return 'StopLimit';
    default: return 'Market';
  }
}

function _mapTimeInForceToSnapTrade(tif: string): string {
  switch (tif.toLowerCase()) {
    case 'day': return 'Day';
    case 'gtc': return 'GTC';
    case 'fok': return 'FOK';
    case 'ioc': return 'IOC';
    default: return 'Day';
  }
}

/** True when a mapped status is terminal and NOT a successful cancel. */
function _isTerminalNonCancelled(s: OrderStatus): boolean {
  return s === 'FILLED' || s === 'REJECTED';
}

/** Human label for a terminal status (used in cancel-race messaging). */
function _statusLabel(s: OrderStatus): string {
  switch (s) {
    case 'FILLED': return 'filled';
    case 'REJECTED': return 'rejected';
    case 'CANCELLED': return 'cancelled';
    default: return s.toLowerCase();
  }
}

/** Map SnapTrade order_type → our OrderType (reverse of _mapOrderTypeToSnapTrade) */
function _mapSnapTradeOrderType(rawType?: string): OrderType {
  switch ((rawType || '').toUpperCase()) {
    case 'LIMIT': return 'limit';
    case 'STOP': return 'stop';
    case 'STOPLIMIT':
    case 'STOP_LIMIT': return 'stop_limit';
    default: return 'market';
  }
}

/** Map SnapTrade time_in_force → our TimeInForce (reverse of _mapTimeInForceToSnapTrade) */
function _mapSnapTradeTimeInForce(rawTif?: string): TimeInForce {
  switch ((rawTif || '').toUpperCase()) {
    case 'GTC': return 'gtc';
    case 'FOK': return 'fok';
    case 'IOC': return 'ioc';
    default: return 'day';
  }
}

// ─── Cache ────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

const CACHE_TTL = 60_000; // 1 minute

// ─── Broker ──────────────────────────────────────────────────

export class SnapTradeBroker implements BrokerEngine {
  readonly name = 'snaptrade';
  readonly isDemo = false;
  readonly supportsTrading: boolean;

  private userId: string;
  private userSecret: string;
  private connectionId: string;
  private brokerSlug: string;
  private brokerName: string;
  private tradingEnabled: boolean;

  private accountCache: CacheEntry<BrokerAccountSummary> | null = null;
  private positionsCache: CacheEntry<BrokerPosition[]> | null = null;
  // Cached primary-account lookup. `_fetchAccounts()` is a live HTTP call, so
  // we memoize the RESOLVED id (via an in-flight promise) so parallel basket
  // legs and back-to-back trading ops share ONE accounts round-trip instead of
  // N. TTL keeps it from going stale if the connection's accounts change.
  private primaryAccountIdPromise: Promise<string | null> | null = null;
  private primaryAccountIdFetchedAt = 0;

  constructor(params: {
    userId: string;
    userSecret: string;
    connectionId: string;
    brokerSlug: string;
    brokerName: string;
    tradingEnabled: boolean;
  }) {
    this.userId = params.userId;
    this.userSecret = params.userSecret;
    this.connectionId = params.connectionId;
    this.brokerSlug = params.brokerSlug;
    this.brokerName = params.brokerName;
    this.tradingEnabled = params.tradingEnabled;
    this.supportsTrading = params.tradingEnabled;
  }

  // ── Meta ─────────────────────────────────────────────────

  getMeta(): BrokerMeta {
    return {
      slug: 'snaptrade',
      name: 'SnapTrade',
      isDemo: false,
      tradingEnabled: this.tradingEnabled,
      tradingDisabledReason: this.tradingEnabled
        ? undefined
        : `${this.brokerName} is read-only — re-authorize with trading access`,
      environment: this.tradingEnabled ? 'live' : 'paper',
      isConnected: true,
      brokerDisplayName: `${this.brokerName} via SnapTrade`,
    };
  }

  // ── Account ───────────────────────────────────────────────

  async getAccount(): Promise<BrokerAccountSummary> {
    if (this.accountCache && (Date.now() - this.accountCache.fetchedAt) < CACHE_TTL) {
      return this.accountCache.data;
    }

    const accounts = await this._fetchAccounts();

    let totalValue = 0;
    let cashBalance = 0;
    let buyingPower = 0;

    // `total_value` is authoritative from the accounts-list endpoint, but
    // settled `cash` + `buying_power` are authoritative from the per-account
    // BALANCES endpoint (`/accounts/{id}/balances`) — the accounts payload does
    // NOT reliably surface them (e.g. Alpaca reports buying power / total value
    // in `balance.cash`, so `available cash` would show the wrong figure).
    for (const a of accounts) {
      totalValue += a.total_value ?? 0;
    }

    const perAccount = await Promise.allSettled(
      accounts.map(async (a) => {
        try {
          const balances = await getAccountBalances(a.id, this.userId, this.userSecret);
          return {
            balances,
            fallbackCash: 0,
            fallbackBuyingPower: 0,
            hasBalances: Array.isArray(balances) && balances.length > 0,
          };
        } catch {
          // Balances endpoint unavailable — fall back to accounts-list fields.
          return {
            balances: null,
            fallbackCash: a.cash ?? 0,
            fallbackBuyingPower: a.buying_power ?? 0,
            hasBalances: false,
          };
        }
      }),
    );

    for (const r of perAccount) {
      if (r.status !== 'fulfilled') continue;
      const { balances, fallbackCash, fallbackBuyingPower, hasBalances } = r.value;
      if (hasBalances) {
        for (const b of balances!) {
          cashBalance += b.cash ?? 0;
          buyingPower += b.buying_power ?? 0;
        }
      } else {
        cashBalance += Number(fallbackCash || 0);
        buyingPower += Number(fallbackBuyingPower || 0);
      }
    }

    const summary: BrokerAccountSummary = {
      totalValue,
      cashBalance: Math.max(0, cashBalance),
      buyingPower: Math.max(0, buyingPower),
      totalInvested: totalValue - cashBalance,
      totalPnL: 0,      // SnapTrade positions endpoint has open_pnl per position
      totalPnLPct: 0,
      todayPnL: 0,
      todayPnLPct: 0,
      // Connection-level metadata (populated by full account route, not simple balance fetch)
      lastSynced: null,
      accountStatus: null,
      holdingsUnavailable: false,
    };

    this.accountCache = { data: summary, fetchedAt: Date.now() };
    return summary;
  }

  // ── Positions ─────────────────────────────────────────────

  async getPositions(): Promise<BrokerPosition[]> {
    if (this.positionsCache && (Date.now() - this.positionsCache.fetchedAt) < CACHE_TTL) {
      return this.positionsCache.data;
    }

    const accounts = await this._fetchAccounts();
    const allPositions: BrokerPosition[] = [];

    for (const acct of accounts) {
      try {
        const positions = await snapTradeFetch<SnapPosition[]>(
          `/authorizations/${this.connectionId}/accounts/${acct.id}/holdings`,
          null,
          { userId: this.userId, userSecret: this.userSecret },
        );

        for (const pos of positions) {
          if (!pos.symbol || pos.symbol === '') continue;

          const shares = pos.units ?? 0;
          const avgCost = pos.average_purchase_price ?? pos.price ?? 0;
          const totalCost = shares * avgCost;

          allPositions.push({
            symbol: pos.symbol,
            name: pos.description || pos.symbol,
            sector: pos.sector,
            type: pos.asset_type === 'ETF' ? 'ETF' : 'Stock',
            shares,
            avgCost,
            totalCost,
            buyDate: new Date().toISOString(),
          });
        }
      } catch (err) {
        console.error(
          `[SnapTradeBroker] Failed to fetch positions for account ${acct.id}:`,
          err instanceof Error ? err.message : 'Unknown',
        );
      }
    }

    this.positionsCache = { data: allPositions, fetchedAt: Date.now() };
    return allPositions;
  }

  // ── Orders ────────────────────────────────────────────────

  async getOrders(_status?: OrderStatus): Promise<BrokerOrder[]> {
    // Orders are historical data — always visible regardless of trading permissions.
    // (placeOrder/cancelOrder remain gated behind tradingEnabled.)

    try {
      const accountId = await this._getPrimaryAccountId();
      if (!accountId) return [];

      const rawOrders = await this._fetchOrders(accountId);
      const mapped = rawOrders.map((o) => this._mapOrder(o));
      console.log(
        `[SnapTradeBroker] getOrders: ${mapped.length} orders for ${this.brokerName}`,
      );
      return mapped;
    } catch (err) {
      console.error(
        '[SnapTradeBroker] getOrders failed:',
        err instanceof Error ? err.message : 'Unknown',
      );
      return [];
    }
  }

  async getBasketOrders(): Promise<BrokerBasketOrder[]> {
    return [];
  }

  // ── Trading ───────────────────────────────────────────────

  async placeOrder(req: OrderRequest): Promise<OrderResult> {
    if (!this.tradingEnabled) {
      return {
        success: false,
        orderId: 'readonly',
        status: 'REJECTED',
        message: `${this.brokerName} is read-only — re-authorize with trading access to place orders.`,
      };
    }

    const accountId = await this._getPrimaryAccountId();
    if (!accountId) {
      return {
        success: false,
        orderId: 'no-account',
        status: 'REJECTED',
        message: 'No trading account found for this connection.',
      };
    }

    // Validate and normalize the symbol
    const symbol = toBrokerSymbol(req.symbol, 'snaptrade');
    if (!symbol) {
      return {
        success: false,
        orderId: 'bad-symbol',
        status: 'REJECTED',
        message: 'Invalid symbol.',
      };
    }

    // Map our OrderType → SnapTrade order_type
    let orderType = _mapOrderTypeToSnapTrade(req.type);
    let timeInForce = _mapTimeInForceToSnapTrade(req.timeInForce || 'day');
    let effectiveLimitPrice = req.limitPrice;

    // NOTE: Alpaca (via SnapTrade) accepts market orders 24/7.
    // Orders placed outside market hours queue naturally for the next open.
    // No conversion is needed — market orders stay as market orders.

    const body: Record<string, unknown> = {
      account_id: accountId,
      action: req.side, // our OrderSide (BUY|SELL) matches SnapTrade action
      order_type: orderType,
      time_in_force: timeInForce,
      symbol,
    };

    // Client-supplied idempotency key — forwarded verbatim to the broker as
    // `client_order_id` (Alpaca treats it as an idempotency key). We send our
    // internal order UUID so the broker order maps 1:1 back to Vantage's order.
    if (req.clientOrderId) {
      body.client_order_id = req.clientOrderId;
    }

    // Units (shares) vs notional_value (dollar amount)
    // When dollarAmount is explicitly set (AI Advisor dollar-first mode), prefer notional_value
    // to preserve exact dollar intent rather than converting to shares where rounding can skew.
    if (req.dollarAmount != null && req.dollarAmount > 0) {
      body.notional_value = req.dollarAmount;
    } else if (req.shares != null && req.shares > 0) {
      body.units = req.shares;
    } else {
      return {
        success: false,
        orderId: 'no-qty',
        status: 'REJECTED',
        message: 'Order must specify shares or dollar amount.',
      };
    }

    if (effectiveLimitPrice != null && effectiveLimitPrice > 0) {
      body.price = effectiveLimitPrice;
    }
    if (req.stopPrice != null && req.stopPrice > 0) {
      body.stop = req.stopPrice;
    }

    console.log(
      `[SnapTradeBroker] placeOrder: ${req.side} ${req.shares || '$' + req.dollarAmount} ${symbol} ` +
      `(${orderType}, ${timeInForce}, limit=${effectiveLimitPrice}, currentPrice=${req.currentPrice}) in ${this.brokerName} — marketOpen=${this.isMarketOpen()}`,
    );

    const response = await snapTradeFetchSafe<any>(
      '/trade/place',
      body,
      { userId: this.userId, userSecret: this.userSecret },
    );

    // ── Handle non-2xx (SnapTrade or broker rejection) ──
    if (!response.ok) {
      const statusCode = response.status;
      // Try to extract a brokerage_order_id even from error responses (some
      // brokers still report the order ID on rejection).
      const brokerOrderId: string | undefined =
        response.data?.brokerage_order_id || undefined;
      const errorMsg = response.error || `SnapTrade returned HTTP ${statusCode}`;
      // Include the raw body for debugging — sometimes SnapTrade errors are
      // HTML pages or have non-standard JSON keys.
      const rawDetail = response.rawBody
        ? ` | RAW: ${response.rawBody.slice(0, 200)}`
        : '';

      console.error(
        `[SnapTradeBroker] placeOrder REJECTED (HTTP ${statusCode}):`,
        errorMsg + rawDetail,
      );
      console.error(
        `[SnapTradeBroker] placeOrder SENT body:`,
        JSON.stringify(body),
      );

      return {
        success: false,
        orderId: brokerOrderId || 'error',
        status: 'REJECTED' as const,
        message: errorMsg + rawDetail,
      };
    }

    // ── 2xx success — SnapTrade accepted the order and forwarded to broker ──
    const result = response.data!;

    // SnapTrade returns: { brokerage_order_id, status, universal_symbol, ... }
    const orderId = result.brokerage_order_id || 'unknown';
    const rawSnapStatus = result.status;
    const status = _mapSnapTradeStatusToOrderStatus(rawSnapStatus);

    console.log(
      `[SnapTradeBroker] placeOrder result: ${orderId} → ${status} (raw: ${rawSnapStatus || 'none'})`,
    );

    // All orders are sent to the broker immediately, 24/7.
    // Brokers (Alpaca, Tastytrade, etc.) queue orders placed outside market hours.
    // We return the status as-is.
    const isSuccess = status === 'SUBMITTED' || status === 'OPEN' || status === 'FILLED' || status === 'PARTIALLY_FILLED';
    const nextOpen = !this.isMarketOpen() ? this.getNextOpenLabel() : undefined;

    // ── Fill details (authoritative for immediate FILLED / PARTIALLY_FILLED) ──
    // SnapTrade's order response uses `filled_quantity` + `execution_price`
    // (NOT `filled_price`/`average_fill_price`), and notional (dollar) orders
    // may omit `quantity` entirely — so derive the filled share count from those
    // fields, with a notional_value ÷ execution_price fallback for dollar orders.
    const isFilledNow = status === 'FILLED' || status === 'PARTIALLY_FILLED';
    const rawFilledQty = Number(result.filled_quantity || 0);
    const rawQty = Number(result.quantity || 0);
    const avgFillPx = Number(result.execution_price ?? result.average_fill_price ?? result.filled_price ?? result.price ?? 0);
    const notional = Number(result.notional_value || 0);
    const filledShares = isFilledNow
      ? (rawFilledQty || rawQty || (avgFillPx > 0 && notional > 0 ? notional / avgFillPx : 0))
      : 0;
    // Fill price: actual average fill price when filled; otherwise fall back to
    // the limit price (estimate) so "placed" emails still show a reference.
    const fillPrice = isFilledNow && avgFillPx > 0
      ? avgFillPx
      : (result.price ? Number(result.price) : undefined);
    // Total: actual total_cost when filled; otherwise an estimate (price × shares)
    // so "placed" emails keep their estimated-total row.
    const totalCost = isFilledNow
      ? (Number(result.total_cost || 0) || (fillPrice ? fillPrice * filledShares : 0))
      : (Number(result.total_cost || 0) || (result.price ? Number(result.price) * (req.shares || 0) : 0) || undefined);

    return {
      success: isSuccess,
      orderId,
      status,
      fillPrice,
      filledShares: filledShares || undefined,
      totalCost,
      filledAt: result.time_executed || result.filled_at || (status === 'FILLED' ? new Date().toISOString() : undefined),
      nextOpenLabel: nextOpen,
    };
  }

  /**
   * Place a basket order for a SnapTrade account.
   *
   * SnapTrade has no native "basket" primitive — a basket is realized as N
   * individual market (notional) orders, one per leg, placed sequentially via
   * placeOrder(). We aggregate the per-leg results into a single
   * BasketOrderResult so the UI treats it as one logical submission.
   */
  async placeBasketOrder(req: BasketOrderRequest): Promise<BasketOrderResult> {
    if (!this.tradingEnabled) {
      return {
        success: false,
        basketOrderId: 'readonly',
        status: 'REJECTED',
        orders: [],
        totalReserved: 0,
        message: `${this.brokerName} is read-only — re-authorize with trading access to place orders.`,
      };
    }

    const accountId = await this._getPrimaryAccountId();
    if (!accountId) {
      return {
        success: false,
        basketOrderId: 'no-account',
        status: 'REJECTED',
        orders: [],
        totalReserved: 0,
        message: 'No trading account found for this connection.',
      };
    }

    const basketOrderId = crypto.randomUUID();

    // ── Parallel leg placement ──
    // Fire all N legs concurrently and settle each independently. A single
    // leg's rejection/throw must never abort the others, so we use
    // Promise.allSettled (not Promise.all) and capture each leg's own outcome
    // alongside its identity — completion order is irrelevant to correctness.
    const settled = await Promise.allSettled(
      req.stocks.map(async (stock) => {
        // Per-leg Vantage UUID — sent as client_order_id so each basket leg is
        // traceable back to Vantage's own orders.id (same pattern as single orders).
        const legClientOrderId = crypto.randomUUID();
        try {
          const result = await this.placeOrder({
            symbol: stock.symbol,
            side: 'BUY',
            type: 'market',
            dollarAmount: stock.dollarAmount,
            timeInForce: 'day',
            basketId: req.basketId,
            basketName: req.basketName,
            basketEmoji: req.basketEmoji,
            basketDisplayName: req.basketDisplayName,
            clientOrderId: legClientOrderId,
          });
          return { stock, legClientOrderId, result };
        } catch (err) {
          // placeOrder can throw on unexpected/network errors (snapTradeFetchSafe
          // usually returns a structured rejection instead — don't rely on it).
          return {
            stock,
            legClientOrderId,
            result: {
              success: false,
              orderId: 'error',
              status: 'REJECTED' as const,
              message: err instanceof Error ? err.message : 'Unknown error',
            } satisfies OrderResult,
          };
        }
      }),
    );

    const orders: OrderResult[] = [];
    const errors: string[] = [];
    let totalSpent = 0;
    let totalReserved = 0;

    for (const outcome of settled) {
      if (outcome.status === 'rejected') {
        // Defensive: the map-callback shouldn't reject (it catches internally),
        // but if it ever does, surface the reason instead of crashing the basket.
        const msg = outcome.reason instanceof Error ? outcome.reason.message : 'Unknown error';
        errors.push(msg);
        continue;
      }
      const { stock, legClientOrderId, result } = outcome.value;
      if (!result.success) {
        if (result.message) errors.push(`${stock.symbol}: ${result.message}`);
        continue;
      }
      // Notional orders don't echo reservedAmount back from placeOrder — carry
      // the requested dollar amount so queued legs still report an accurate
      // reserve total. Also stamp symbol + clientOrderId so the caller can map
      // each leg back for per-leg persistence.
      orders.push({ ...result, symbol: stock.symbol, clientOrderId: legClientOrderId, reservedAmount: stock.dollarAmount });
      totalSpent += result.totalCost || 0;
      totalReserved += stock.dollarAmount;
    }

    const executed = orders.length;
    const failed = req.stocks.length - executed;
    const hasWorking = orders.some(o => o.status === 'OPEN' || o.status === 'SUBMITTED');
    const status: OrderStatus = executed === 0
      ? 'REJECTED'
      : hasWorking
        ? 'OPEN'
        : 'FILLED';

    return {
      success: executed > 0,
      basketOrderId,
      status,
      orders,
      totalReserved,
      totalSpent,
      executed,
      failed,
      message: failed > 0 ? errors.join(' · ') : undefined,
    };
  }

  async cancelOrder(orderId: string): Promise<{ success: boolean; message?: string }> {
    if (!this.tradingEnabled) {
      return { success: false, message: 'Trading not enabled for this connection.' };
    }

    const accountId = await this._getPrimaryAccountId();
    if (!accountId) {
      return { success: false, message: 'No trading account found.' };
    }

    try {
      console.log(`[SnapTradeBroker] cancelOrder: ${orderId}`);

      await snapTradeFetch(
        `/accounts/${accountId}/trading/cancel`,
        { brokerage_order_id: orderId },
        { userId: this.userId, userSecret: this.userSecret },
      );

      return { success: true, message: `Order ${orderId} cancelled.` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[SnapTradeBroker] cancelOrder failed:', msg);
      return { success: false, message: msg };
    }
  }

  /**
   * Fetch the current real state of a single order from SnapTrade's
   * recentOrders endpoint. Returns null if the order can't be found.
   * Used to reconcile after an ambiguous cancel (cancel race).
   */
  async getOrderById(orderId: string): Promise<BrokerOrder | null> {
    try {
      const accountId = await this._getPrimaryAccountId();
      if (!accountId) return null;

      const rawOrders = await this._fetchOrders(accountId);
      const found = rawOrders.find(
        (o) =>
          o.brokerage_order_id &&
          o.brokerage_order_id.toLowerCase() === orderId.toLowerCase(),
      );
      return found ? this._mapOrder(found) : null;
    } catch (err) {
      console.error(
        '[SnapTradeBroker] getOrderById failed:',
        err instanceof Error ? err.message : 'Unknown',
      );
      return null;
    }
  }

  /**
   * Cancel an order WITHOUT throwing away the broker's error/status detail.
   *
   * SnapTrade exposes no dedicated "already filled" error code — a cancel of a
   * filled order surfaces as either a generic 4xx/5xx OR a 200 whose
   * `raw_response.status` is a terminal (non-cancelled) state. So we:
   *   1. Always fire the cancel (broker is the final arbiter).
   *   2. On ANY failure — or a 200 with a terminal raw_response — immediately
   *      reconcile THIS order against real broker state via getOrderById().
   */
  async cancelOrderSafe(orderId: string): Promise<CancelOrderResult> {
    if (!this.tradingEnabled) {
      return { success: false, message: 'Trading not enabled for this connection.' };
    }

    const accountId = await this._getPrimaryAccountId();
    if (!accountId) {
      return { success: false, message: 'No trading account found.' };
    }

    console.log(`[SnapTradeBroker] cancelOrderSafe: ${orderId}`);

    const res = await snapTradeFetchSafe<{
      brokerage_order_id?: string;
      raw_response?: { status?: string } | null;
      default_code?: string | number;
      default_detail?: string;
    }>(
      `/accounts/${accountId}/trading/cancel`,
      { brokerage_order_id: orderId },
      { userId: this.userId, userSecret: this.userSecret },
    );

    // Network / HTTP failure → reconcile the real state of this one order.
    if (!res.ok) {
      console.warn(
        `[SnapTradeBroker] cancelOrderSafe failed (HTTP ${res.status}): ${res.error}`,
      );
      const reconciled = await this.getOrderById(orderId).catch(() => null);
      if (reconciled) {
        const terminal = _isTerminalNonCancelled(reconciled.status);
        return {
          success: false,
          alreadyTerminal: terminal,
          reconciledOrder: reconciled,
          httpStatus: res.status,
          message: terminal
            ? `Order is already ${_statusLabel(reconciled.status)} — cancel not applied.`
            : (res.error || 'Cancel failed at broker.'),
        };
      }
      return {
        success: false,
        httpStatus: res.status,
        message: res.error || 'Cancel failed at broker.',
      };
    }

    // 200 OK — but raw_response.status may reveal the order was already terminal.
    const rawStatus = res.data?.raw_response?.status;
    if (rawStatus) {
      const status = _mapSnapTradeStatusToOrderStatus(rawStatus);
      if (_isTerminalNonCancelled(status)) {
        const reconciled = await this.getOrderById(orderId).catch(() => null);
        return {
          success: false,
          alreadyTerminal: true,
          reconciledOrder: reconciled,
          httpStatus: res.status,
          message: `Order is already ${_statusLabel(status)} — cancel not applied.`,
        };
      }
    }

    return {
      success: true,
      httpStatus: res.status,
      message: `Order ${orderId} cancelled.`,
    };
  }

  async cancelBasketOrder(_basketOrderId: string): Promise<{ success: boolean; message?: string }> {
    return { success: false, message: 'Basket orders are not supported via SnapTrade.' };
  }

  // ── Trade Impact Preview ─────────────────────────────────

  async previewOrder(req: OrderRequest): Promise<OrderImpactPreview> {
    if (!this.tradingEnabled) {
      return {
        estimatedTotal: 0,
        commission: 0,
        buyingPowerAfter: null,
        hasSufficientFunds: false,
        warnings: ['Trading not enabled for this connection.'],
      };
    }

    const accountId = await this._getPrimaryAccountId();
    if (!accountId) {
      return {
        estimatedTotal: 0,
        commission: 0,
        buyingPowerAfter: null,
        hasSufficientFunds: false,
        warnings: ['No trading account found.'],
      };
    }

    const symbol = toBrokerSymbol(req.symbol, 'snaptrade');
    const orderType = _mapOrderTypeToSnapTrade(req.type);
    const timeInForce = _mapTimeInForceToSnapTrade(req.timeInForce || 'day');

    const body: Record<string, unknown> = {
      account_id: accountId,
      action: req.side,
      order_type: orderType,
      time_in_force: timeInForce,
      universal_symbol_id: symbol, // SnapTrade impact endpoint uses symbol_id not ticker
    };

    if (req.shares != null && req.shares > 0) body.units = req.shares;
    else if (req.dollarAmount != null && req.dollarAmount > 0) body.notional_value = req.dollarAmount;
    if (req.limitPrice != null && req.limitPrice > 0) body.price = req.limitPrice;
    if (req.stopPrice != null && req.stopPrice > 0) body.stop = req.stopPrice;

    try {
      const result = await snapTradeFetch<any>(
        '/trade/impact',
        body,
        { userId: this.userId, userSecret: this.userSecret },
      );

      const trade = result.trade || result;
      const commission = trade.commission || trade.total_commission || 0;
      const estimatedTotal = trade.total || trade.estimated_total || 0;

      // Extract buying power from the trade leg or account data
      const buyingPowerAfter =
        trade.remaining_cash !== undefined ? trade.remaining_cash :
        trade.buying_power !== undefined ? trade.buying_power :
        null;

      const hasSufficientFunds =
        trade.has_sufficient_funds !== undefined
          ? trade.has_sufficient_funds
          : trade.error === undefined;

      const warnings: string[] = [];
      if (trade.warnings && Array.isArray(trade.warnings)) {
        warnings.push(...trade.warnings);
      }
      if (trade.error) {
        warnings.push(String(trade.error));
      }
      if (!hasSufficientFunds) {
        warnings.push('Insufficient funds for this order.');
      }

      console.log(
        `[SnapTradeBroker] previewOrder: ${req.side} ${req.shares || '$' + req.dollarAmount} ${symbol} → ` +
        `est $${estimatedTotal.toFixed(2)}, commission $${commission.toFixed(2)}, ` +
        `sufficient=${hasSufficientFunds}`,
      );

      return {
        estimatedTotal,
        commission,
        buyingPowerAfter,
        hasSufficientFunds,
        warnings,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[SnapTradeBroker] previewOrder failed:', msg);
      return {
        estimatedTotal: 0,
        commission: 0,
        buyingPowerAfter: null,
        hasSufficientFunds: false,
        warnings: [msg],
      };
    }
  }

  // ── Market hours ──────────────────────────────────────────

  isMarketOpen(): boolean {
    const now = new Date();
    const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const dow = et.getDay(); // 0=Sun, 6=Sat
    const hour = et.getHours() + et.getMinutes() / 60;
    return dow >= 1 && dow <= 5 && hour >= 9.5 && hour < 16; // 9:30 AM – 4:00 PM ET
  }

  getNextOpenLabel(): string {
    const now = new Date();
    const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const dow = et.getDay();
    const hour = et.getHours();

    if (dow === 0 || dow === 6) return 'Mon 9:30 AM ET';
    if (hour >= 16) return dow === 5 ? 'Mon 9:30 AM ET' : 'Tomorrow 9:30 AM ET';
    if (hour < 9.5) return 'Today 9:30 AM ET';
    return 'Market open';
  }

  executePendingOrders(): Promise<{ filled: number; fills: PendingOrderFill[] }> {
    return Promise.resolve({ filled: 0, fills: [] });
  }

  // ── Order Status Polling ───────────────────────────────

  /**
   * Poll SnapTrade recentOrders to sync status of in-flight orders.
   * Returns order IDs whose status changed (for UI refresh).
   */
  async syncOrderStatus(trackedOrders: Map<string, OrderStatus>): Promise<string[]> {
    if (!this.tradingEnabled || trackedOrders.size === 0) return [];

    try {
      const accountId = await this._getPrimaryAccountId();
      if (!accountId) return [];

      const rawOrders = await this._fetchOrders(accountId);

      const changed: string[] = [];
      for (const raw of rawOrders) {
        const orderId = raw.brokerage_order_id;
        if (!orderId || !trackedOrders.has(orderId)) continue;

        const prevStatus = trackedOrders.get(orderId);
        const newStatus = _mapSnapTradeStatusToOrderStatus(raw.status);

        if (prevStatus !== newStatus) {
          changed.push(orderId);
          console.log(
            `[SnapTradeBroker] Order ${orderId.slice(0, 8)}: ${prevStatus} → ${newStatus} (raw: ${raw.status})`,
          );
        }
      }

      return changed;
    } catch (err) {
      console.error(
        '[SnapTradeBroker] syncOrderStatus failed:',
        err instanceof Error ? err.message : 'Unknown',
      );
      return [];
    }
  }

  /**
   * Refresh account positions after a fill. Polls recent orders for fills,
   * then re-fetches positions/account summary if any fills are detected.
   */
  async refreshAfterTrade(): Promise<void> {
    if (!this.tradingEnabled) return;

    try {
      const accountId = await this._getPrimaryAccountId();
      if (!accountId) return;

      const rawOrders = await this._fetchOrders(accountId);

      const hasFill = rawOrders.some(
        (o) => _mapSnapTradeStatusToOrderStatus(o.status) === 'FILLED',
      );

      if (hasFill) {
        console.log('[SnapTradeBroker] Fill detected — refreshing positions & account');
        // Bust caches so next getPositions/getAccount hits live API
        this.positionsCache = null;
        this.accountCache = null;
      }
    } catch (err) {
      console.error(
        '[SnapTradeBroker] refreshAfterTrade failed:',
        err instanceof Error ? err.message : 'Unknown',
      );
    }
  }

  async loadFromSupabase?(): Promise<boolean> {
    // SnapTrade broker pulls from live API, not Supabase
    return false;
  }

  // ── Internals ─────────────────────────────────────────────

  private async _getPrimaryAccountId(): Promise<string | null> {
    const now = Date.now();
    if (this.primaryAccountIdPromise && now - this.primaryAccountIdFetchedAt < CACHE_TTL) {
      return this.primaryAccountIdPromise;
    }
    this.primaryAccountIdFetchedAt = now;
    this.primaryAccountIdPromise = this._resolvePrimaryAccountId();
    return this.primaryAccountIdPromise;
  }

  private async _resolvePrimaryAccountId(): Promise<string | null> {
    try {
      const accounts = await this._fetchAccounts();
      if (accounts.length === 0) return null;
      // Only trade against INVESTMENT accounts (or legacy accounts with no
      // category). SnapTrade can surface DEPOSIT/LOC accounts for some
      // brokers (e.g. Fidelity youth/CMA); those are not orderable.
      const tradable = accounts.filter(
        (a) => a.account_category == null || a.account_category === 'INVESTMENT',
      );
      const pool = tradable.length > 0 ? tradable : accounts;
      // Prefer a margin/cash account; fall back to first
      const primary = pool.find((a) => a.type?.toUpperCase()?.includes('MARGIN'))
        || pool.find((a) => a.type?.toUpperCase()?.includes('CASH'))
        || pool[0];
      return primary.id;
    } catch {
      return null;
    }
  }

  /**
   * Fetch every order for an account from SnapTrade's `/accounts/{id}/orders`
   * endpoint, which returns a BARE ARRAY of all orders (all statuses).
   * `/recentOrders` stopped returning order history for this connection (empty
   * `orders` array), so `/orders` is now the authoritative source for sync.
   */
  private async _fetchOrders(accountId: string): Promise<SnapOrder[]> {
    const raw = await snapTradeFetch<unknown>(
      `/accounts/${accountId}/orders`,
      null,
      { userId: this.userId, userSecret: this.userSecret },
    );
    if (Array.isArray(raw)) return raw as SnapOrder[];
    return (raw as { orders?: SnapOrder[] } | null)?.orders ?? [];
  }

  private _mapOrder(raw: SnapOrder): BrokerOrder {
    const symbol = extractOrderSymbol(raw as unknown as Record<string, unknown>) || 'UNKNOWN';

    // SnapTrade returns numeric fields as strings (e.g. quantity: "10.5"), so
    // coerce every numeric value before it flows into BrokerOrder / the UI.
    const qty = Number(raw.quantity || raw.filled_quantity || 0);
    // Fee-inclusive average fill price is the authoritative cost basis — it
    // matches the broker's avg_entry_price that drives position avg_cost.
    // execution_price is the raw per-fill price and can exclude commissions,
    // which made the FIFO lot ledger's price_at_fill drift from avg_cost.
    const fillPx = Number(raw.average_fill_price ?? raw.execution_price ?? raw.price ?? 0);
    const isFilled = _mapSnapTradeStatusToOrderStatus(raw.status) === 'FILLED';

    return {
      id: raw.brokerage_order_id || '',
      symbol: toStandardSymbol(symbol),
      side: (raw.action?.toUpperCase() === 'SELL' ? 'SELL' : 'BUY') as OrderSide,
      type: _mapSnapTradeOrderType(raw.order_type),
      status: _mapSnapTradeStatusToOrderStatus(raw.status),
      shares: qty,
      filledShares: Number(raw.filled_quantity ?? (isFilled ? qty : 0)),
      submittedPrice: fillPx || 0,
      limitPrice: raw.price != null ? Number(raw.price) : undefined,
      stopPrice: raw.stop_price != null ? Number(raw.stop_price) : undefined,
      fillPrice: fillPx || undefined,
      totalCost: Number(raw.total_cost || (fillPx * qty) || 0),
      timeInForce: _mapSnapTradeTimeInForce(raw.time_in_force),
      submittedAt: raw.time_placed || raw.create_date || raw.trade_date || new Date().toISOString(),
      filledAt: isFilled ? (raw.time_executed || raw.trade_date || new Date().toISOString()) : undefined,
      cancelledAt: _mapSnapTradeStatusToOrderStatus(raw.status) === 'CANCELLED'
        ? new Date().toISOString() : undefined,
      note: raw.order_role || undefined,
    };
  }

  private async _fetchAccounts(): Promise<SnapAccount[]> {
    const raw = await snapTradeFetch<any[]>(
      `/authorizations/${this.connectionId}/accounts`,
      null,
      { userId: this.userId, userSecret: this.userSecret },
    );
    // Normalize SnapTrade's nested balance structure into flat fields
    return raw.map((a) => {
      const bal = a.balance || {};
      const totalValue = a.total_value ?? bal.total?.amount ?? bal.total ?? 0;
      const cash =
        a.cash ?? bal.cash?.amount ?? bal.cash ?? bal.available_cash?.amount ?? bal.available_cash ?? undefined;
      const buyingPower =
        a.buying_power ?? bal.buying_power?.amount ?? bal.buying_power ?? undefined;
      return {
        id: a.id,
        name: a.name,
        number: a.number,
        currency: a.currency,
        type: a.type,
        cash,
        buying_power: buyingPower,
        total_value: totalValue,
        account_category: a.account_category ?? null,
      };
    });
  }
}
