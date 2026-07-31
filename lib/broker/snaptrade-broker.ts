// ─── SnapTrade Broker Adapter ─────────────────────────────────
// Implements BrokerEngine for any SnapTrade-connected brokerage.
// Fully generic — parameterized by connection ID, works identically
// across trading-enabled and read-only brokers.
//
// Trading methods throw "not available" (Phase 2b).
// Read-only brokers have supportsTrading=false, but ALL methods
// except order execution work normally for viewing.

import { snapTradeFetch } from '@/lib/snaptrade/auth';
import type {
  BrokerEngine, BrokerPosition, BrokerAccountSummary,
  BrokerOrder, BrokerBasketOrder, OrderRequest, OrderResult,
  BasketOrderRequest, BasketOrderResult, OrderStatus,
} from './engine';

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
    this.supportsTrading = params.tradingEnabled;
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
      cashBalance += a.cash ?? 0;
      buyingPower += a.buying_power ?? 0;
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
    // Phase 2b: query SnapTrade order history
    return [];
  }

  async getBasketOrders(): Promise<BrokerBasketOrder[]> {
    return [];
  }

  // ── Trading (Phase 2b) ────────────────────────────────────

  async placeOrder(_req: OrderRequest): Promise<OrderResult> {
    // Phase 2b: route to SnapTrade order execution
    throw new Error(
      `Order execution for ${this.brokerName} is not yet available — coming in Phase 2b. ` +
      'Use your Demo account for trading in the meantime.'
    );
  }

  async placeBasketOrder(_req: BasketOrderRequest): Promise<BasketOrderResult> {
    throw new Error(
      `Basket orders for ${this.brokerName} are not yet available — coming in Phase 2b.`
    );
  }

  async cancelOrder(_orderId: string): Promise<{ success: boolean; message?: string }> {
    throw new Error('Order cancellation not yet available — coming in Phase 2b.');
  }

  async cancelBasketOrder(_basketOrderId: string): Promise<{ success: boolean; message?: string }> {
    throw new Error('Basket cancellation not yet available — coming in Phase 2b.');
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

  async loadFromSupabase?(): Promise<boolean> {
    // SnapTrade broker pulls from live API, not Supabase
    return false;
  }

  // ── Internals ─────────────────────────────────────────────

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
        buying_power,
        total_value: totalValue,
      };
    });
  }
}
