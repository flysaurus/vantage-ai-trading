// ─── SnapTrade Adapter ──────────────────────────────────────
// Implements BrokerAdapter for SnapTrade-connected brokers.
// Read-only adapter — trading methods throw clear errors.
//
// Data flows:
//   Client (this adapter) → /api/broker/snaptrade/account
//                          → /api/broker/snaptrade/positions
//                          → /api/market/quotes (existing quote API)
//
// SnapTrade credentials (userId, userSecret) are stored encrypted
// in broker_connections. API routes decrypt server-side.
//
// Dev mode: returns synthetic data when SnapTrade API keys are
// not configured, enabling end-to-end testing.

import type {
  BrokerAdapter,
  BrokerConfig,
  BrokerAccount,
  BrokerPosition,
  BrokerOrder,
  BrokerQuote,
  OrderParams,
  OrderStatus,
  BarParams,
  Bar,
  HistoricalParams,
  HistoricalBar,
  MarketStatus,
} from '@/types/broker';

const READ_ONLY_ERROR = 'This broker is read-only via SnapTrade — trading is not supported.';

interface SnaptradeConfig extends BrokerConfig {
  /** The underlying broker (fidelity, robinhood, schwab, vanguard) */
  underlyingBrokerId?: string;
}

export class SnapTradeAdapter implements BrokerAdapter {
  readonly id = 'snaptrade' as const;
  readonly name = 'SnapTrade (Multi-Broker)';

  private config: SnaptradeConfig | null = null;
  private _connected = false;
  private underlyingBroker: string = '';

  // ─── Connection ──────────────────────────────────────────

  async connect(config: BrokerConfig): Promise<void> {
    this.config = config as SnaptradeConfig;
    this.underlyingBroker = this.config.extra?.brokerId || this.config.underlyingBrokerId || '';
    this._connected = true;
  }

  disconnect(): void {
    this._connected = false;
    this.config = null;
    this.underlyingBroker = '';
  }

  isConnected(): boolean {
    return this._connected;
  }

  // ─── Account ─────────────────────────────────────────────

  async getAccount(): Promise<BrokerAccount> {
    const data = await this.snaptradeFetch<{
      equity: number;
      cash: number;
      buying_power: number;
      status: string;
      currency: string;
    }>('/api/broker/snaptrade/account');

    return {
      id: `snaptrade-${this.underlyingBroker || 'unknown'}`,
      equity: data.equity ?? 0,
      cash: data.cash ?? 0,
      buyingPower: data.buying_power ?? 0,
      dayTradeCount: 0,
      dayPnl: 0,
      dayPnlPercent: 0,
      totalPnl: 0,
      totalPnlPercent: 0,
      portfolioValue: data.equity ?? 0,
      currency: data.currency || 'USD',
      status: data.status === 'ACTIVE' ? 'active' : 'active',
    };
  }

  // ─── Positions ───────────────────────────────────────────

  async getPositions(): Promise<BrokerPosition[]> {
    const raw = await this.snaptradeFetch<Array<{
      symbol: string;
      name?: string;
      quantity: number;
      price: number;
      market_value: number;
      cost_basis: number;
      day_change: number;
      day_change_pct: number;
      total_pnl: number;
      total_pnl_pct: number;
      asset_type?: string;
    }>>('/api/broker/snaptrade/positions');

    if (!Array.isArray(raw) || raw.length === 0) return [];

    const totalValue = raw.reduce((sum, p) => sum + (p.market_value || 0), 0) || 1;

    return raw.map((p) => ({
      symbol: p.symbol || '',
      name: p.name || p.symbol || '',
      assetType: p.asset_type === 'crypto' ? 'crypto' : 'stock',
      qty: p.quantity || 0,
      avgCost: p.price || 0,
      currentPrice: p.price || 0,
      marketValue: p.market_value || 0,
      costBasis: p.cost_basis || 0,
      dayChange: p.day_change || 0,
      dayChangePercent: p.day_change_pct || 0,
      totalPnl: p.total_pnl || 0,
      totalPnlPercent: p.total_pnl_pct || 0,
      portfolioPercent: (p.market_value || 0) / totalValue * 100,
      sector: undefined,
      currency: 'USD',
      exchange: undefined,
    }));
  }

  async getPosition(symbol: string): Promise<BrokerPosition | null> {
    const positions = await this.getPositions();
    return positions.find(p => p.symbol === symbol) || null;
  }

  // ─── Orders ─────────────────────────────────────────────

  async getOrders(_params?: { status?: OrderStatus; limit?: number }): Promise<BrokerOrder[]> {
    const raw = await this.snaptradeFetch<Array<{
      id: string;
      symbol: string;
      name: string;
      side: 'buy' | 'sell';
      type: string;
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
    }>>('/api/broker/snaptrade/orders');

    if (!Array.isArray(raw)) return [];

    return raw.map((o) => ({
      id: o.id,
      symbol: o.symbol,
      side: o.side,
      type: (o.type || 'market') as BrokerOrder['type'],
      status: (o.status || 'filled') as BrokerOrder['status'],
      qty: o.qty || 0,
      filledQty: o.filledQty || 0,
      limitPrice: o.limitPrice,
      stopPrice: o.stopPrice,
      filledPrice: o.filledPrice,
      totalValue: o.totalValue,
      timeInForce: (o.timeInForce || 'day') as BrokerOrder['timeInForce'],
      assetType: 'stock' as BrokerOrder['assetType'],
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
      bracketOrder: undefined,
    }));
  }

  async getOrder(_orderId: string): Promise<BrokerOrder | null> {
    return null;
  }

  async placeOrder(_params: OrderParams): Promise<BrokerOrder> {
    throw new Error(READ_ONLY_ERROR);
  }

  async cancelOrder(_orderId: string): Promise<void> {
    throw new Error(READ_ONLY_ERROR);
  }

  async cancelAllOrders(): Promise<void> {
    throw new Error(READ_ONLY_ERROR);
  }

  // ─── Quotes & Market Data ────────────────────────────────

  async getQuote(symbol: string): Promise<BrokerQuote> {
    const quotes = await this.getQuotes([symbol]);
    if (quotes.length === 0) {
      throw new Error(`No quote available for ${symbol}`);
    }
    return quotes[0];
  }

  async getQuotes(symbols: string[]): Promise<BrokerQuote[]> {
    const res = await fetch('/api/market/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols }),
      credentials: 'include',
    });

    if (!res.ok) {
      throw new Error(`Quote fetch failed: ${res.status}`);
    }

    const data = await res.json();
    const quotes = data.quotes || {};

    return symbols.map((sym) => {
      const q = quotes[sym];
      if (!q) {
        // Return stub — caller can display "no data"
        return {
          symbol: sym,
          bid: 0, ask: 0, last: 0,
          change: 0, changePercent: 0,
          volume: 0, high: 0, low: 0, open: 0,
          previousClose: 0, high52w: 0, low52w: 0,
          timestamp: Date.now(),
        };
      }
      return {
        symbol: sym,
        bid: q.bid || 0,
        ask: q.ask || 0,
        last: q.last || q.price || 0,
        change: q.change || 0,
        changePercent: q.changePercent || 0,
        volume: q.volume || 0,
        high: q.high || 0,
        low: q.low || 0,
        open: q.open || 0,
        previousClose: q.previousClose || 0,
        high52w: q.high52w || 0,
        low52w: q.low52w || 0,
        timestamp: Date.now(),
      };
    });
  }

  async getBars(symbol: string, params: BarParams): Promise<Bar[]> {
    const query = new URLSearchParams({
      bars: params.timeframe,
      symbol: encodeURIComponent(symbol),
    });
    if (params.start) query.set('start', params.start);
    if (params.end) query.set('end', params.end);
    if (params.limit) query.set('limit', String(params.limit));

    const res = await fetch(`/api/broker/proxy/market?${query}`, {
      credentials: 'include',
    });

    if (!res.ok) {
      throw new Error(`Bars fetch failed: ${res.status}`);
    }

    const data = await res.json();
    return data.bars || [];
  }

  async getMarketStatus(): Promise<MarketStatus> {
    try {
      const res = await fetch('/api/market/status', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        return {
          isOpen: data.isOpen ?? false,
          nextOpen: data.nextOpen,
          nextClose: data.nextClose,
          session: data.isOpen ? 'regular' : 'closed',
        };
      }
    } catch {
      // Fall through to default
    }
    return { isOpen: false, session: 'closed' };
  }

  // ─── Historical ──────────────────────────────────────────

  async getHistoricalData(_symbol: string, _params: HistoricalParams): Promise<HistoricalBar[]> {
    return []; // Read-only broker — chart data comes from Finnhub via /api/portfolio/chart
  }

  // ─── Streaming ───────────────────────────────────────────

  subscribe(_symbols: string[], _onQuote: (q: BrokerQuote) => void): () => void {
    // SnapTrade has no streaming — use polling via getQuotes instead
    return () => {};
  }

  // ─── Fractional ──────────────────────────────────────────

  async supportsFractional(_symbol: string): Promise<boolean> {
    return false;
  }

  // ─── Internal ────────────────────────────────────────────

  private async snaptradeFetch<T>(url: string): Promise<T> {
    const res = await fetch(url, { credentials: 'include' });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(err.error || err.message || `SnapTrade API error ${res.status}`);
    }

    const data = await res.json();

    // Log the raw API response for debugging
    if (url.includes('/account')) {
      console.error('[SnapTradeAdapter] ACCOUNT response:', JSON.stringify(data));
    } else if (url.includes('/positions')) {
      console.error('[SnapTradeAdapter] POSITIONS response — count:', Array.isArray(data) ? data.length : data.results?.length ?? 'not array');
    }

    if (data.error) {
      throw new Error(data.error);
    }

    return data as T;
  }
}
