// ─── Alpaca Broker Adapter ─────────────────────────────────────
// Implements BrokerAdapter for Alpaca Markets.
// All REST calls route through /api/broker/proxy/ (multi-broker proxy).
// WebSocket streaming uses auth payload from /api/broker/session.
//
// No env var dependencies — credentials come from the vault via
// the session endpoint, which decrypts per-user keys server-side.

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

interface SessionPayload {
  configured: boolean;
  connected: boolean;
  brokerId: string;
  environment: string;
  environmentUrl: string;
  message?: string;
  wsAuth: { key: string; secret: string };
  accountPreview: Record<string, unknown> | null;
  marketOpen: boolean;
}

export class AlpacaAdapter implements BrokerAdapter {
  readonly id = 'alpaca' as const;
  readonly name = 'Alpaca Markets';

  private config: BrokerConfig | null = null;
  private session: SessionPayload | null = null;
  private ws: WebSocket | null = null;
  private wsCleanup: (() => void) | null = null;

  // ─── Connection ────────────────────────────────────────────

  async connect(config: BrokerConfig): Promise<void> {
    this.config = config;

    // Get session from multi-broker session endpoint
    // This decrypts credentials from the vault and verifies connectivity
    const res = await fetch('/api/broker/session');

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Session init failed' }));
      throw new Error(err.message || `Session init failed: ${res.status}`);
    }

    this.session = await res.json() as SessionPayload;

    if (!this.session.connected) {
      throw new Error(
        `Failed to connect to Alpaca: ${this.session.message || 'Unknown error'}`
      );
    }
  }

  disconnect(): void {
    this.wsCleanup?.();
    this.ws?.close();
    this.ws = null;
    this.wsCleanup = null;
    this.session = null;
    this.config = null;
  }

  isConnected(): boolean {
    return this.session?.connected === true;
  }

  // ─── REST API Proxy (multi-broker) ─────────────────────────

  private async api<T>(
    path: string,
    options?: { method?: string; body?: unknown }
  ): Promise<T> {
    const res = await fetch(`/api/broker/proxy/${path.replace(/^\//, '')}`, {
      method: options?.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({ message: 'Request failed' }));

      // Rate limit → exponential backoff hint
      if (res.status === 429) {
        const retryAfter = res.headers.get('retry-after');
        throw new Error(
          `Alpaca rate limit reached. Retry after ${retryAfter || 'a moment'}.`
        );
      }

      throw new Error(data.message || data.error || `API error ${res.status}`);
    }

    return res.json();
  }

  // ─── Account ───────────────────────────────────────────────

  async getAccount(): Promise<BrokerAccount> {
    const raw = await this.api<Record<string, unknown>>('/account');

    return {
      id: (raw.id || raw.account_number || '') as string,
      equity: parseFloat(String(raw.equity)) || 0,
      cash: parseFloat(String(raw.cash)) || 0,
      buyingPower: parseFloat(String(raw.buying_power)) || 0,
      dayTradeCount: (raw.daytrade_count as number) || 0,
      dayPnl:
        parseFloat(String(raw.equity)) -
          parseFloat(String(raw.last_equity)) || 0,
      dayPnlPercent:
        parseFloat(String(raw.last_equity)) > 0
          ? ((parseFloat(String(raw.equity)) -
              parseFloat(String(raw.last_equity))) /
              parseFloat(String(raw.last_equity))) *
            100
          : 0,
      totalPnl: 0,
      totalPnlPercent: 0,
      portfolioValue:
        parseFloat(String(raw.portfolio_value)) ||
        parseFloat(String(raw.equity)) ||
        0,
      currency: (raw.currency as string) || 'USD',
      status:
        raw.status === 'ACTIVE'
          ? 'active'
          : ('closed' as BrokerAccount['status']),
    };
  }

  // ─── Positions ─────────────────────────────────────────────

  async getPositions(): Promise<BrokerPosition[]> {
    const raw = await this.api<Array<Record<string, unknown>>>('/positions');

    return raw.map((p) => ({
      symbol: (p.symbol as string) || '',
      name: (p.symbol as string) || '',
      assetType:
        p.asset_class === 'crypto'
          ? 'crypto'
          : ('stock' as BrokerPosition['assetType']),
      qty: parseFloat(String(p.qty)) || 0,
      avgCost: parseFloat(String(p.avg_entry_price)) || 0,
      currentPrice: parseFloat(String(p.current_price)) || 0,
      marketValue: parseFloat(String(p.market_value)) || 0,
      costBasis: parseFloat(String(p.cost_basis)) || 0,
      dayChange: parseFloat(String(p.change_today)) || 0,
      dayChangePercent:
        (parseFloat(String(p.change_today)) /
          (parseFloat(String(p.cost_basis)) || 1)) *
        100,
      totalPnl: parseFloat(String(p.unrealized_pl)) || 0,
      totalPnlPercent:
        parseFloat(String(p.unrealized_plpc)) * 100 || 0,
      portfolioPercent: parseFloat(String(p.market_value)) || 0,
      sector: undefined,
      currency:
        p.asset_class === 'crypto'
          ? (p.symbol as string).split('/')[1] || 'USD'
          : 'USD',
      exchange: (p.exchange as string) || '',
    }));
  }

  async getPosition(symbol: string): Promise<BrokerPosition | null> {
    try {
      const raw = await this.api<Record<string, unknown>>(
        `/positions/${encodeURIComponent(symbol)}`
      );
      return {
        symbol: (raw.symbol as string) || symbol,
        name: (raw.symbol as string) || symbol,
        assetType: 'stock',
        qty: parseFloat(String(raw.qty)) || 0,
        avgCost: parseFloat(String(raw.avg_entry_price)) || 0,
        currentPrice: parseFloat(String(raw.current_price)) || 0,
        marketValue: parseFloat(String(raw.market_value)) || 0,
        costBasis: parseFloat(String(raw.cost_basis)) || 0,
        dayChange: parseFloat(String(raw.change_today)) || 0,
        dayChangePercent:
          (parseFloat(String(raw.change_today)) /
            (parseFloat(String(raw.cost_basis)) || 1)) *
          100,
        totalPnl: parseFloat(String(raw.unrealized_pl)) || 0,
        totalPnlPercent:
          parseFloat(String(raw.unrealized_plpc)) * 100 || 0,
        portfolioPercent: 0,
        currency: 'USD',
        exchange: (raw.exchange as string) || '',
      };
    } catch {
      return null;
    }
  }

  // ─── Orders ────────────────────────────────────────────────

  async getOrders(params?: {
    status?: OrderStatus;
    limit?: number;
  }): Promise<BrokerOrder[]> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.limit) query.set('limit', String(params.limit));
    query.set('direction', 'desc');

    const qs = query.toString();
    const raw = await this.api<Array<Record<string, unknown>>>(
      `/orders${qs ? `?${qs}` : ''}`
    );

    return raw.map((o) => this.mapOrder(o));
  }

  async getOrder(orderId: string): Promise<BrokerOrder | null> {
    try {
      const raw = await this.api<Record<string, unknown>>(
        `/orders/${orderId}`
      );
      return this.mapOrder(raw);
    } catch {
      return null;
    }
  }

  async placeOrder(params: OrderParams): Promise<BrokerOrder> {
    const body: Record<string, unknown> = {
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      qty: String(params.qty),
      time_in_force: params.timeInForce,
    };

    if (params.limitPrice) body.limit_price = String(params.limitPrice);
    if (params.stopPrice) body.stop_price = String(params.stopPrice);
    if (params.trailPrice) body.trail_price = String(params.trailPrice);

    if (params.bracketOrder?.stopLoss || params.bracketOrder?.takeProfit) {
      body.order_class = 'bracket';
      if (params.bracketOrder.takeProfit) {
        body.take_profit = {
          limit_price: String(params.bracketOrder.takeProfit),
        };
      }
      if (params.bracketOrder.stopLoss) {
        body.stop_loss = {
          stop_price: String(params.bracketOrder.stopLoss),
        };
      }
    }

    const raw = await this.api<Record<string, unknown>>('/orders', {
      method: 'POST',
      body,
    });

    return this.mapOrder(raw);
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.api(`/orders/${orderId}`, { method: 'DELETE' });
  }

  async cancelAllOrders(): Promise<void> {
    await this.api('/orders', { method: 'DELETE' });
  }

  // ─── Quotes ────────────────────────────────────────────────

  async getQuote(symbol: string): Promise<BrokerQuote> {
    return this.api<BrokerQuote>(
      `/stocks/${encodeURIComponent(symbol)}/quotes/latest`
    );
  }

  async getQuotes(symbols: string[]): Promise<BrokerQuote[]> {
    const symList = symbols.map((s) => encodeURIComponent(s)).join(',');
    const res = await fetch(`/api/broker/proxy/market?symbols=${symList}`);

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Quote fetch failed' }));
      throw new Error(err.message || `Quote error ${res.status}`);
    }

    const data = await res.json() as {
      quotes: Record<string, BrokerQuote>;
    };
    return Object.values(data.quotes || {});
  }

  async getBars(symbol: string, params: BarParams): Promise<Bar[]> {
    const query = new URLSearchParams({
      bars: params.timeframe,
      symbol: encodeURIComponent(symbol),
    });
    if (params.start) query.set('start', params.start);
    if (params.end) query.set('end', params.end);
    if (params.limit) query.set('limit', String(params.limit));

    const res = await fetch(`/api/broker/proxy/market?${query}`);

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Bar fetch failed' }));
      throw new Error(err.message || `Bars error ${res.status}`);
    }

    const data = await res.json() as { bars: Bar[] };
    return data.bars || [];
  }

  async getMarketStatus(): Promise<MarketStatus> {
    try {
      const raw = await this.api<Record<string, unknown>>('/clock');
      return {
        isOpen: (raw.is_open as boolean) || false,
        nextOpen: raw.next_open as string | undefined,
        nextClose: raw.next_close as string | undefined,
        session: (raw.is_open ? 'regular' : 'closed') as MarketStatus['session'],
      };
    } catch {
      return {
        isOpen: this.session?.marketOpen ?? false,
        session: this.session?.marketOpen ? 'regular' : 'closed',
      };
    }
  }

  async getHistoricalData(
    symbol: string,
    params: HistoricalParams
  ): Promise<HistoricalBar[]> {
    const query = new URLSearchParams({
      timeframe: params.timeframe,
      start: params.start,
      end: params.end,
    });
    const raw = await this.api<{ bars?: HistoricalBar[] }>(
      `/stocks/${encodeURIComponent(symbol)}/bars?${query}`
    );
    return (raw.bars || []).map((b: HistoricalBar) => ({
      date: b.date,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
    }));
  }

  // ─── WebSocket Streaming ───────────────────────────────────

  subscribe(
    symbols: string[],
    onQuote: (q: BrokerQuote) => void
  ): () => void {
    if (!this.session?.wsAuth) {
      console.error('[Alpaca WS] No session — call connect() first');
      return () => {};
    }

    const wsUrl =
      this.config?.environment === 'live'
        ? 'wss://stream.data.alpaca.markets/v2/iex'
        : 'wss://stream.data.alpaca.markets/v2/iex';

    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          action: 'auth',
          key: this.session!.wsAuth.key,
          secret: this.session!.wsAuth.secret,
        })
      );
    };

    ws.onmessage = (event) => {
      const raw = JSON.parse(event.data);

      if (Array.isArray(raw) && raw[0]?.T === 'success') {
        const msg = raw[0];
        if (msg.msg === 'authenticated') {
          ws.send(
            JSON.stringify({
              action: 'subscribe',
              quotes: symbols,
            })
          );
        }
        return;
      }

      if (Array.isArray(raw)) {
        for (const msg of raw) {
          if (msg.T === 'q') {
            onQuote({
              symbol: msg.S,
              bid: msg.bp || 0,
              ask: msg.ap || 0,
              last: msg.ap || 0,
              change: 0,
              changePercent: 0,
              volume: msg.as || 0,
              high: 0,
              low: 0,
              open: 0,
              previousClose: 0,
              high52w: 0,
              low52w: 0,
              timestamp: Date.now(),
            });
          }
        }
      }
    };

    ws.onerror = (err) => {
      console.error('[Alpaca WS] Error:', err);
    };

    ws.onclose = () => {
      console.log('[Alpaca WS] Connection closed');
    };

    const cleanup = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({ action: 'unsubscribe', quotes: symbols })
        );
      }
      ws.close();
    };

    this.wsCleanup = cleanup;
    return cleanup;
  }

  // ─── Helpers ───────────────────────────────────────────────

  private mapOrder(o: Record<string, unknown>): BrokerOrder {
    const legs = o.legs as Array<Record<string, unknown>> | undefined;
    return {
      id: (o.id as string) || '',
      clientOrderId: o.client_order_id as string | undefined,
      symbol: (o.symbol as string) || '',
      side: (o.side as 'buy' | 'sell') || 'buy',
      type: (o.type as BrokerOrder['type']) || 'market',
      status: this.mapStatus(String(o.status || 'new')),
      qty: parseFloat(String(o.qty)) || 0,
      filledQty: parseFloat(String(o.filled_qty)) || 0,
      limitPrice: o.limit_price
        ? parseFloat(String(o.limit_price))
        : undefined,
      stopPrice: o.stop_price
        ? parseFloat(String(o.stop_price))
        : undefined,
      filledPrice: o.filled_avg_price
        ? parseFloat(String(o.filled_avg_price))
        : undefined,
      totalValue:
        o.filled_avg_price && o.filled_qty
          ? parseFloat(String(o.filled_avg_price)) *
            parseFloat(String(o.filled_qty))
          : undefined,
      timeInForce: (o.time_in_force as BrokerOrder['timeInForce']) || 'day',
      assetType:
        o.asset_class === 'crypto'
          ? 'crypto'
          : ('stock' as BrokerOrder['assetType']),
      bracketOrder: legs ? this.parseBracket(legs) : undefined,
      createdAt: (o.created_at as string) || new Date().toISOString(),
      updatedAt: o.updated_at as string | undefined,
      filledAt: o.filled_at as string | undefined,
      cancelledAt: o.canceled_at as string | undefined,
    };
  }

  private mapStatus(s: string): OrderStatus {
    const map: Record<string, OrderStatus> = {
      new: 'new',
      accepted: 'pending',
      filled: 'filled',
      partially_filled: 'partially_filled',
      canceled: 'cancelled',
      rejected: 'rejected',
      expired: 'expired',
    };
    return map[s] || 'new';
  }

  private parseBracket(
    legs: Array<Record<string, unknown>>
  ): BrokerOrder['bracketOrder'] {
    const bracket: BrokerOrder['bracketOrder'] = {};
    for (const leg of legs) {
      if (leg.side === 'sell' && leg.type === 'stop') {
        bracket.stopLoss = {
          stopPrice: parseFloat(String(leg.stop_price)) || 0,
          limitPrice: leg.limit_price
            ? parseFloat(String(leg.limit_price))
            : undefined,
        };
      }
      if (leg.side === 'sell' && leg.type === 'limit') {
        bracket.takeProfit = {
          limitPrice: parseFloat(String(leg.limit_price)) || 0,
        };
      }
    }
    return Object.keys(bracket).length ? bracket : undefined;
  }
}
