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
import { toStandardSymbol, toBrokerSymbol } from './symbol-resolver';
import type {
  BrokerEngine, BrokerMeta, BrokerPosition, BrokerAccountSummary,
  BrokerOrder, BrokerBasketOrder, OrderRequest, OrderResult,
  BasketOrderRequest, BasketOrderResult, OrderStatus, OrderSide, OrderType,
  OrderImpactPreview,
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
  filled_quantity?: number;
  average_fill_price?: number;
  total_cost?: number;
  fees?: number;
  trade_date?: string;
  create_date?: string;
}

// ─── Module-level helpers ──────────────────────────────────────

/** Map SnapTrade's verbose status enum to our simplified OrderStatus */
function _mapSnapTradeStatusToOrderStatus(rawStatus: string | undefined): OrderStatus {
  if (!rawStatus) return 'OPEN';
  const s = rawStatus.toUpperCase();
  if (['EXECUTED', 'FILLED'].includes(s)) return 'FILLED';
  if (['PENDING', 'ACCEPTED', 'QUEUED', 'TRIGGERED', 'ACTIVATED', 'CONTINGENT_ORDER', 'REPLACE_PENDING'].includes(s)) return 'OPEN';
  if (s === 'PARTIAL') return 'PARTIALLY_FILLED';
  if (['CANCELED', 'PARTIAL_CANCELED', 'CANCEL_PENDING'].includes(s)) return 'CANCELLED';
  if (['REJECTED', 'FAILED'].includes(s)) return 'REJECTED';
  if (s === 'EXPIRED') return 'CANCELLED';
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

    for (const a of accounts) {
      totalValue += a.total_value ?? 0;
      // If we already have cash/buying_power from the accounts list, use them
      if (a.cash != null || a.buying_power != null) {
        cashBalance += a.cash ?? 0;
        buyingPower += a.buying_power ?? 0;
      } else {
        // Fall back to the dedicated balances endpoint
        try {
          const balances = await getAccountBalances(
            a.id,
            this.userId,
            this.userSecret,
          );
          for (const b of balances) {
            cashBalance += b.cash ?? 0;
            buyingPower += b.buying_power ?? 0;
          }
        } catch {
          // Balances endpoint unavailable — leave at 0
        }
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

      const response = await snapTradeFetch<{ orders?: SnapOrder[] }>(
        `/accounts/${accountId}/recentOrders`,
        null,
        {
          userId: this.userId,
          userSecret: this.userSecret,
          only_executed: 'false',
        },
      );

      const rawOrders = response.orders || [];
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
    const isSuccess = status === 'OPEN' || status === 'FILLED' || status === 'PARTIALLY_FILLED';
    const nextOpen = !this.isMarketOpen() ? this.getNextOpenLabel() : undefined;
    return {
      success: isSuccess,
      orderId,
      status,
      fillPrice: result.filled_price || result.price,
      totalCost: result.total_cost || (result.filled_price || result.price || 0) * (req.shares || 0),
      filledAt: result.filled_at || (status === 'FILLED' ? new Date().toISOString() : undefined),
      nextOpenLabel: nextOpen,
    };
  }

  async placeBasketOrder(_req: BasketOrderRequest): Promise<BasketOrderResult> {
    return {
      success: false,
      basketOrderId: 'not-implemented',
      status: 'REJECTED',
      orders: [],
      totalReserved: 0,
      message: 'Basket orders are not supported via SnapTrade — place individual orders instead.',
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

  executePendingOrders(): Promise<number> {
    return Promise.resolve(0);
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

      const response = await snapTradeFetch<{ orders?: SnapOrder[] }>(
        `/accounts/${accountId}/recentOrders`,
        null,
        {
          userId: this.userId,
          userSecret: this.userSecret,
          only_executed: 'false',
        },
      );

      const changed: string[] = [];
      for (const raw of response.orders || []) {
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

      const response = await snapTradeFetch<{ orders?: SnapOrder[] }>(
        `/accounts/${accountId}/recentOrders`,
        null,
        {
          userId: this.userId,
          userSecret: this.userSecret,
          only_executed: 'false',
        },
      );

      const hasFill = (response.orders || []).some(
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
    try {
      const accounts = await this._fetchAccounts();
      if (accounts.length === 0) return null;
      // Prefer a margin/cash account; fall back to first
      const primary = accounts.find((a) => a.type?.toUpperCase()?.includes('MARGIN'))
        || accounts.find((a) => a.type?.toUpperCase()?.includes('CASH'))
        || accounts[0];
      return primary.id;
    } catch {
      return null;
    }
  }

  private _mapOrder(raw: SnapOrder): BrokerOrder {
    const symbol =
      raw.symbol
      || raw.universal_symbol?.symbol
      || raw.universal_symbol?.description
      || 'UNKNOWN';

    const qty = raw.quantity || raw.filled_quantity || 0;
    const fillPx = raw.average_fill_price || raw.price || 0;
    const isFilled = _mapSnapTradeStatusToOrderStatus(raw.status) === 'FILLED';

    return {
      id: raw.brokerage_order_id || '',
      symbol: toStandardSymbol(symbol),
      side: (raw.action?.toUpperCase() === 'SELL' ? 'SELL' : 'BUY') as OrderSide,
      type: 'market' as OrderType,
      status: _mapSnapTradeStatusToOrderStatus(raw.status),
      shares: qty,
      submittedPrice: fillPx || 0,
      limitPrice: raw.price ?? undefined,
      stopPrice: raw.stop_price ?? undefined,
      fillPrice: fillPx || undefined,
      totalCost: raw.total_cost || (fillPx * qty) || 0,
      submittedAt: raw.create_date || raw.trade_date || new Date().toISOString(),
      filledAt: isFilled ? (raw.trade_date || new Date().toISOString()) : undefined,
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
      };
    });
  }
}
