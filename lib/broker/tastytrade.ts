// ─── Tastytrade Broker Adapter ──────────────────────────────────
// Implements BrokerAdapter for Tastytrade.
// All REST calls route through /api/broker/proxy/ (multi-broker proxy).
// WebSocket streaming uses session token from /api/broker/session.
//
// Tastytrade API docs: https://developer.tastytrade.com/

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
import { apiGet } from '@/lib/api-client';

interface SessionPayload {
  configured: boolean;
  connected: boolean;
  brokerId: string;
  environment: string;
  environmentUrl: string;
  message?: string;
  sessionToken: string;
  streamerUrl: string | null;
  streamerToken: string | null;
  accountPreview: Record<string, unknown> | null;
}

export class TastytradeAdapter implements BrokerAdapter {
  readonly id = 'tastytrade' as const;
  readonly name = 'Tastytrade';

  private config: BrokerConfig | null = null;
  private session: SessionPayload | null = null;
  private accountNumber: string | null = null;
  private ws: WebSocket | null = null;
  private wsCleanup: (() => void) | null = null;

  // ─── Connection ────────────────────────────────────────────

  async connect(config: BrokerConfig): Promise<void> {
    this.config = config;

    // Get session from multi-broker session endpoint
    const res = await apiGet('/api/broker/session');

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Session init failed' }));
      throw new Error(err.message || `Session init failed: ${res.status}`);
    }

    this.session = await res.json() as SessionPayload;

    if (!this.session.connected) {
      throw new Error(
        `Failed to connect to Tastytrade: ${this.session.message || 'Unknown error'}`
      );
    }

    // Fetch account number for subsequent API calls
    try {
      const acctData = await this.api<Record<string, unknown>>('customers/me/accounts');
      const items = (acctData.items || acctData.data) as Array<Record<string, unknown>> | undefined;
      if (items && items.length > 0) {
        const acct = (items[0].account || items[0]) as Record<string, unknown>;
        this.accountNumber = String(acct.accountNumber || acct.account_number || '');
      }
    } catch (err) {
      console.error('[Tastytrade] Failed to fetch account number:', err);
    }
  }

  disconnect(): void {
    this.wsCleanup?.();
    this.ws?.close();
    this.ws = null;
    this.wsCleanup = null;
    this.session = null;
    this.accountNumber = null;
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

      if (res.status === 429) {
        const retryAfter = res.headers.get('retry-after');
        throw new Error(
          `Tastytrade rate limit reached. Retry after ${retryAfter || 'a moment'}.`
        );
      }

      throw new Error(data.message || data.error || `API error ${res.status}`);
    }

    return res.json();
  }

  // ─── Account ───────────────────────────────────────────────

  async getAccount(): Promise<BrokerAccount> {
    if (!this.accountNumber) {
      throw new Error('Account number not available. Call connect() first.');
    }

    const raw = await this.api<Record<string, unknown>>(
      `accounts/${this.accountNumber}/balances`
    );

    const balances = (raw.data || raw) as Record<string, unknown>;

    // Tastytrade balance fields
    const netLiquidatingValue = parseFloat(String(balances['net-liquidating-value'] || 0));
    const cashBalance = parseFloat(String(balances['cash-balance'] || 0));
    const totalCash = parseFloat(String(balances['total-cash'] || cashBalance));
    const maintenanceExcess = parseFloat(String(balances['maintenance-excess'] || 0));
    const equityBuyingPower = parseFloat(String(balances['equity-buying-power'] || 0));
    const dayTradeCount = parseInt(String(balances['day-trades'] || 0), 10);

    return {
      id: this.accountNumber,
      equity: netLiquidatingValue,
      cash: totalCash,
      buyingPower: equityBuyingPower || maintenanceExcess || netLiquidatingValue * 2,
      dayTradeCount,
      dayPnl: 0, // requires separate calculation
      dayPnlPercent: 0,
      totalPnl: 0,
      totalPnlPercent: 0,
      portfolioValue: netLiquidatingValue,
      currency: 'USD',
      status: 'active',
    };
  }

  // ─── Positions ─────────────────────────────────────────────

  async getPositions(): Promise<BrokerPosition[]> {
    if (!this.accountNumber) {
      return [];
    }

    try {
      const raw = await this.api<Record<string, unknown>>(
        `accounts/${this.accountNumber}/positions`
      );

      const items = (raw.items || raw.data || []) as Array<Record<string, unknown>>;

      return items.map((p) => {
        const qty = parseFloat(String(p.quantity || 0));
        const avgPrice = parseFloat(String(p['average-open-price'] || p.averagePrice || 0));
        const markPrice = parseFloat(String(p['mark-price'] || p.markPrice || 0));
        const marketValue = Math.abs(qty * markPrice);
        const costBasis = Math.abs(qty * avgPrice);
        const dayPnl = parseFloat(String(p['day-pnl'] || p.dayPnl || 0));

        return {
          symbol: (p.symbol as string) || '',
          name: (p.symbol as string) || '',
          assetType: 'stock',
          qty,
          avgCost: avgPrice,
          currentPrice: markPrice,
          marketValue,
          costBasis,
          dayChange: dayPnl,
          dayChangePercent:
            costBasis > 0 ? (dayPnl / costBasis) * 100 : 0,
          totalPnl: parseFloat(String(p['unrealized-pl'] || p.unrealizedPl || 0)),
          totalPnlPercent:
            parseFloat(String(p['unrealized-pl-percent'] || p.unrealizedPlPercent || 0)) * 100 || 0,
          portfolioPercent: 0,
          currency: 'USD',
          exchange: '',
        };
      });
    } catch (err) {
      console.error('[Tastytrade] getPositions error:', err);
      return [];
    }
  }

  async getPosition(symbol: string): Promise<BrokerPosition | null> {
    if (!this.accountNumber) return null;

    try {
      const raw = await this.api<Record<string, unknown>>(
        `accounts/${this.accountNumber}/positions/${encodeURIComponent(symbol)}`
      );
      const p = (raw.data || raw) as Record<string, unknown>;
      const qty = parseFloat(String(p.quantity || 0));
      const avgPrice = parseFloat(String(p['average-open-price'] || p.averagePrice || 0));
      const markPrice = parseFloat(String(p['mark-price'] || p.markPrice || 0));
      const marketValue = Math.abs(qty * markPrice);
      const costBasis = Math.abs(qty * avgPrice);
      const dayPnl = parseFloat(String(p['day-pnl'] || p.dayPnl || 0));

      return {
        symbol: (p.symbol as string) || symbol,
        name: (p.symbol as string) || symbol,
        assetType: 'stock',
        qty,
        avgCost: avgPrice,
        currentPrice: markPrice,
        marketValue,
        costBasis,
        dayChange: dayPnl,
        dayChangePercent: costBasis > 0 ? (dayPnl / costBasis) * 100 : 0,
        totalPnl: parseFloat(String(p['unrealized-pl'] || p.unrealizedPl || 0)),
        totalPnlPercent:
          parseFloat(String(p['unrealized-pl-percent'] || p.unrealizedPlPercent || 0)) * 100 || 0,
        portfolioPercent: 0,
        currency: 'USD',
        exchange: '',
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
    if (!this.accountNumber) return [];

    try {
      const raw = await this.api<Record<string, unknown>>(
        `accounts/${this.accountNumber}/orders`
      );

      const items = (raw.items || raw.data || []) as Array<Record<string, unknown>>;

      return items.map((o) => this.mapOrder(o));
    } catch (err) {
      console.error('[Tastytrade] getOrders error:', err);
      return [];
    }
  }

  async getOrder(orderId: string): Promise<BrokerOrder | null> {
    if (!this.accountNumber) return null;

    try {
      const raw = await this.api<Record<string, unknown>>(
        `accounts/${this.accountNumber}/orders/${orderId}`
      );
      return this.mapOrder((raw.data || raw) as Record<string, unknown>);
    } catch {
      return null;
    }
  }

  async placeOrder(params: OrderParams): Promise<BrokerOrder> {
    if (!this.accountNumber) {
      throw new Error('Account not connected');
    }

    const body: Record<string, unknown> = {
      'time-in-force': params.timeInForce === 'day' ? 'Day' : 'GTC',
      'order-type': this.mapOrderType(params.type),
      price: '0.0',
      'price-effect': 'Debit',
      leg: [
        {
          action: params.side === 'buy' ? 'Buy to Open' : 'Sell to Close',
          quantity: params.qty,
          symbol: params.symbol,
          'instrument-type': 'Equity',
        },
      ],
    };

    if (params.limitPrice) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (body as any).price = String(params.limitPrice);
      (body as Record<string, unknown>)['price-effect'] = 'Debit';
    }

    if (params.stopPrice) {
      body['stop-trigger'] = String(params.stopPrice);
    }

    const raw = await this.api<Record<string, unknown>>(
      `accounts/${this.accountNumber}/orders`,
      { method: 'POST', body }
    );

    return this.mapOrder((raw.data || raw) as Record<string, unknown>);
  }

  async cancelOrder(orderId: string): Promise<void> {
    if (!this.accountNumber) return;
    await this.api(`accounts/${this.accountNumber}/orders/${orderId}`, {
      method: 'DELETE',
    });
  }

  async cancelAllOrders(): Promise<void> {
    if (!this.accountNumber) return;
    await this.api(`accounts/${this.accountNumber}/orders`, {
      method: 'DELETE',
    });
  }

  // ─── Quotes ────────────────────────────────────────────────

  async getQuote(symbol: string): Promise<BrokerQuote> {
    // Tastytrade quotes are available via market-metrics endpoint
    const raw = await this.api<Record<string, unknown>>(
      `market-metrics?symbols=${encodeURIComponent(symbol)}`
    );

    const items = (raw.items || raw.data || []) as Array<Record<string, unknown>>;
    const q = items[0] || {};

    return {
      symbol,
      bid: parseFloat(String(q.bid || 0)),
      ask: parseFloat(String(q.ask || 0)),
      last: parseFloat(String(q.last || q['last-trade-price'] || 0)),
      change: parseFloat(String(q.change || 0)),
      changePercent: parseFloat(String(q['change-percent'] || 0)),
      volume: parseInt(String(q.volume || 0), 10),
      high: parseFloat(String(q.high || 0)),
      low: parseFloat(String(q.low || 0)),
      open: parseFloat(String(q.open || 0)),
      previousClose: parseFloat(String(q['previous-close'] || 0)),
      high52w: parseFloat(String(q['high52-week'] || 0)),
      low52w: parseFloat(String(q['low52-week'] || 0)),
      timestamp: Date.now(),
    };
  }

  async getQuotes(symbols: string[]): Promise<BrokerQuote[]> {
    const quotes: BrokerQuote[] = [];
    for (const sym of symbols) {
      try {
        quotes.push(await this.getQuote(sym));
      } catch {
        // Skip failed quotes
      }
    }
    return quotes;
  }

  async getBars(symbol: string, params: BarParams): Promise<Bar[]> {
    // Tastytrade historical prices
    const query = new URLSearchParams({
      symbol: encodeURIComponent(symbol),
    });
    if (params.start) query.set('start', params.start);
    if (params.end) query.set('end', params.end);

    try {
      const raw = await this.api<Record<string, unknown>>(
        `price-history?${query}`
      );

      const items = (raw.items || raw.data || []) as Array<Record<string, unknown>>;

      return items.map((item) => ({
        timestamp: (item.time || item.timestamp || '') as string,
        open: parseFloat(String(item.open || 0)),
        high: parseFloat(String(item.high || 0)),
        low: parseFloat(String(item.low || 0)),
        close: parseFloat(String(item.close || 0)),
        volume: parseInt(String(item.volume || 0), 10),
      }));
    } catch {
      return [];
    }
  }

  async getMarketStatus(): Promise<MarketStatus> {
    // Tastytrade doesn't have a direct market clock endpoint.
    // Use rough ET-based calculation.
    const now = new Date();
    const day = now.getUTCDay();
    const hourET = now.getUTCHours() - 4; // rough ET conversion
    const isWeekday = day >= 1 && day <= 5;
    const isMarketHours = hourET >= 4 && hourET < 20;
    const isOpen = isWeekday && isMarketHours;

    return {
      isOpen,
      session: isOpen ? 'regular' : 'closed',
    };
  }

  async getHistoricalData(
    symbol: string,
    params: HistoricalParams
  ): Promise<HistoricalBar[]> {
    // Use price-history endpoint
    const query = new URLSearchParams({
      symbol: encodeURIComponent(symbol),
      start: params.start,
      end: params.end,
    });

    try {
      const raw = await this.api<Record<string, unknown>>(
        `price-history?${query}`
      );

      const items = (raw.items || raw.data || []) as Array<Record<string, unknown>>;

      return items.map((item) => ({
        date: (item.time || item.timestamp || '') as string,
        open: parseFloat(String(item.open || 0)),
        high: parseFloat(String(item.high || 0)),
        low: parseFloat(String(item.low || 0)),
        close: parseFloat(String(item.close || 0)),
        volume: parseInt(String(item.volume || 0), 10),
      }));
    } catch {
      return [];
    }
  }

  // ─── WebSocket Streaming ───────────────────────────────────

  subscribe(
    symbols: string[],
    onQuote: (q: BrokerQuote) => void
  ): () => void {
    if (!this.session?.streamerUrl || !this.session?.sessionToken) {
      console.error('[Tastytrade WS] No streamer info — call connect() first');
      return () => {};
    }

    // Tastytrade uses DXLink for streaming
    const wsUrl = this.session.streamerUrl;
    const ws = new WebSocket(wsUrl);
    this.ws = ws;
    let authenticated = false;
    let setupComplete = false;

    ws.onopen = () => {
      // Send SETUP message with session token
      ws.send(
        JSON.stringify({
          type: 'SETUP',
          version: '0.1-js/1.0.0',
          keepaliveTimeout: 60,
          acceptKeepaliveTimeout: 60,
          token: this.session!.sessionToken,
        })
      );
    };

    ws.onmessage = (event) => {
      try {
        const raw = JSON.parse(event.data);

        // Handle SETUP response
        if (raw.type === 'SETUP' && raw.result === 'success') {
          setupComplete = true;
          // Authenticate
          ws.send(
            JSON.stringify({
              type: 'AUTH',
              token: this.session!.sessionToken,
            })
          );
          return;
        }

        // Handle AUTH response
        if (raw.type === 'AUTH_STATE' && raw.state === 'AUTHORIZED') {
          authenticated = true;
          // Subscribe to quote feed
          symbols.forEach((symbol) => {
            ws.send(
              JSON.stringify({
                type: 'FEED_SUBSCRIPTION',
                channel: 0,
                add: [
                  {
                    type: 'Quote',
                    symbol,
                  },
                ],
              })
            );
          });
          return;
        }

        // Handle quote feed data
        if (raw.type === 'FEED_DATA') {
          const feedData = raw.data || [];
          for (const item of feedData) {
            if (item.eventType === 'Quote') {
              onQuote({
                symbol: item.symbol || '',
                bid: parseFloat(item.bidPrice || 0),
                ask: parseFloat(item.askPrice || 0),
                last: parseFloat(item.lastPrice || 0),
                change: parseFloat(item.change || 0),
                changePercent: parseFloat(item.changePercent || 0),
                volume: parseInt(item.volume || 0, 10),
                high: parseFloat(item.highPrice || 0),
                low: parseFloat(item.lowPrice || 0),
                open: parseFloat(item.openPrice || 0),
                previousClose: parseFloat(item.previousClose || 0),
                high52w: 0,
                low52w: 0,
                timestamp: Date.now(),
              });
            }
          }
        }
      } catch {
        // Skip unparseable messages
      }
    };

    ws.onerror = (err) => {
      console.error('[Tastytrade WS] Error:', err);
    };

    ws.onclose = () => {
      console.log('[Tastytrade WS] Connection closed');
    };

    const cleanup = () => {
      if (authenticated && ws.readyState === WebSocket.OPEN) {
        symbols.forEach((symbol) => {
          ws.send(
            JSON.stringify({
              type: 'FEED_SUBSCRIPTION',
              channel: 0,
              remove: [{ type: 'Quote', symbol }],
            })
          );
        });
      }
      ws.close();
    };

    this.wsCleanup = cleanup;
    return cleanup;
  }

  // ─── Helpers ───────────────────────────────────────────────

  private mapOrderType(type: string): string {
    const map: Record<string, string> = {
      market: 'Market',
      limit: 'Limit',
      stop: 'Stop',
      stop_limit: 'Stop Limit',
    };
    return map[type] || 'Market';
  }

  private mapStatus(status: string): OrderStatus {
    const map: Record<string, OrderStatus> = {
      Received: 'new',
      Routed: 'pending',
      Live: 'open',
      Filled: 'filled',
      Cancelled: 'cancelled',
      Rejected: 'rejected',
      Expired: 'expired',
      PartiallyFilled: 'partially_filled',
    };
    return map[status] || 'new';
  }

  private mapOrder(o: Record<string, unknown>): BrokerOrder {
    const legs = (o.legs || o['underlying-orders']) as Array<Record<string, unknown>> | undefined;
    const leg = legs?.[0] || {};

    return {
      id: (o.id || o['order-id'] || '') as string,
      clientOrderId: o['client-order-id'] as string | undefined,
      symbol: (leg.symbol as string) || (o.symbol as string) || '',
      side:
        leg.action === 'Sell to Open' || leg.action === 'Sell to Close'
          ? 'sell'
          : 'buy',
      type: this.mapOrderTypeFromTastytrade(
        String(o['order-type'] || o.orderType || 'Market')
      ),
      status: this.mapStatus(String(o.status || 'Received')),
      qty: parseFloat(String(leg.quantity || o.quantity || 0)),
      filledQty: parseFloat(String(o['filled-quantity'] || o.filledQuantity || 0)),
      limitPrice: o['limit-price'] || o.limitPrice
        ? parseFloat(String(o['limit-price'] || o.limitPrice))
        : undefined,
      stopPrice: o['stop-trigger'] || o.stopTrigger
        ? parseFloat(String(o['stop-trigger'] || o.stopTrigger))
        : undefined,
      filledPrice: o['filled-price'] || o.filledPrice
        ? parseFloat(String(o['filled-price'] || o.filledPrice))
        : undefined,
      timeInForce: this.mapTimeInForce(
        String(o['time-in-force'] || o.timeInForce || 'GTC')
      ),
      assetType: 'stock',
      createdAt: (o['created-at'] || o.createdAt || new Date().toISOString()) as string,
      updatedAt: (o['updated-at'] || o.updatedAt) as string | undefined,
      filledAt: (o['filled-at'] || o.filledAt) as string | undefined,
      cancelledAt: (o['cancelled-at'] || o.cancelledAt) as string | undefined,
    };
  }

  private mapOrderTypeFromTastytrade(tt: string): BrokerOrder['type'] {
    const map: Record<string, BrokerOrder['type']> = {
      Market: 'market',
      Limit: 'limit',
      Stop: 'stop',
      'Stop Limit': 'stop_limit',
    };
    return map[tt] || 'market';
  }

  private mapTimeInForce(tif: string): BrokerOrder['timeInForce'] {
    const map: Record<string, BrokerOrder['timeInForce']> = {
      Day: 'day',
      GTC: 'gtc',
      IOC: 'ioc',
      FOK: 'fok',
    };
    return map[tif] || 'day';
  }
}
