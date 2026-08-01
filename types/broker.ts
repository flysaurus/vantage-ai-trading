// ─── Broker Abstraction Layer ──────────────────────────────────
// Vantage supports multiple broker APIs. All broker-specific logic
// is encapsulated behind this interface. The app never talks directly
// to Alpaca, Interactive Brokers, etc. — only through BrokerAdapter.
//
// Adding a new broker = implementing this interface + registering it.

export type BrokerId = 'alpaca' | 'ibkr' | 'schwab' | 'robinhood' | 'tastytrade' | 'snaptrade';

// ─── Broker Credential Types ──────────────────────────────────

export interface AlpacaCredentials {
  brokerId: 'alpaca';
  apiKey: string;
  secretKey: string;
  environment: 'paper' | 'live';
}

export interface TastytradeCredentials {
  brokerId: 'tastytrade';
  apiKey: string;
  secretKey: string;
  environment: 'sandbox' | 'live';
}

export interface IBKRCredentials {
  brokerId: 'ibkr';
  username: string;
  password: string;
  gatewayUrl: string;
}

export interface SchwabCredentials {
  brokerId: 'schwab';
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface RobinhoodCredentials {
  brokerId: 'robinhood';
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export type BrokerCredentials =
  | AlpacaCredentials
  | TastytradeCredentials
  | IBKRCredentials
  | SchwabCredentials
  | RobinhoodCredentials;

export interface VaultEntry {
  userId: string;
  brokerId: BrokerId;
  encryptedCredentials: string;
  credentialHash: string;
  isConnected: boolean;
  connectedAt: string;
}

export interface BrokerConfig {
  id: BrokerId;
  name: string;
  logo?: string;
  apiKeyId?: string;
  apiSecretEncrypted?: string;
  environment: 'paper' | 'live';
  baseUrl?: string;
  extra?: Record<string, string>; // broker-specific config
}

// ─── Broker-agnostic entities ───

export interface BrokerAccount {
  id: string;
  equity: number;
  cash: number;
  buyingPower: number;
  dayTradeCount: number;
  dayPnl: number;
  dayPnlPercent: number;
  totalPnl: number;
  totalPnlPercent: number;
  portfolioValue: number;
  currency: string;
  status: 'active' | 'closed' | 'margin_call';
}

export interface BrokerPosition {
  symbol: string;
  name?: string;
  assetType: AssetType;
  qty: number;
  avgCost: number;
  currentPrice: number;
  marketValue: number;
  costBasis: number;
  dayChange: number;
  dayChangePercent: number;
  totalPnl: number;
  totalPnlPercent: number;
  portfolioPercent: number;
  sector?: string;
  currency: string;
  exchange?: string;
}

export type AssetType = 'stock' | 'etf' | 'crypto' | 'option' | 'forex' | 'future';

export interface BrokerQuote {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  change: number;
  changePercent: number;
  volume: number;
  high: number;
  low: number;
  open: number;
  previousClose: number;
  high52w: number;
  low52w: number;
  timestamp: number;
}

export interface BrokerOrder {
  id: string;
  clientOrderId?: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: OrderType;
  status: OrderStatus;
  qty: number;
  filledQty: number;
  limitPrice?: number;
  stopPrice?: number;
  filledPrice?: number;
  totalValue?: number;
  timeInForce: TimeInForce;
  assetType: AssetType;
  bracketOrder?: {
    stopLoss?: { stopPrice: number; limitPrice?: number };
    takeProfit?: { limitPrice: number };
  };
  createdAt: string;
  updatedAt?: string;
  filledAt?: string;
  cancelledAt?: string;
}

export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit' | 'trailing_stop';
export type OrderStatus = 'new' | 'pending' | 'filled' | 'partially_filled' | 'cancelled' | 'rejected' | 'expired' | 'open';
export type TimeInForce = 'day' | 'gtc' | 'ioc' | 'fok';

export interface OrderParams {
  symbol: string;
  side: 'buy' | 'sell';
  type: OrderType;
  qty: number;
  timeInForce: TimeInForce;
  limitPrice?: number;
  stopPrice?: number;
  trailPrice?: number;
  bracketOrder?: {
    stopLoss?: number;
    takeProfit?: number;
  };
}

// ─── Broker Adapter Interface ───
// Every broker integration MUST implement every method.

export interface BrokerAdapter {
  readonly id: BrokerId;
  readonly name: string;

  // Connection
  connect(config: BrokerConfig): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;

  // Account
  getAccount(): Promise<BrokerAccount>;

  // Positions
  getPositions(): Promise<BrokerPosition[]>;
  getPosition(symbol: string): Promise<BrokerPosition | null>;

  // Orders
  getOrders(params?: { status?: OrderStatus; limit?: number }): Promise<BrokerOrder[]>;
  getOrder(orderId: string): Promise<BrokerOrder | null>;
  placeOrder(params: OrderParams): Promise<BrokerOrder>;
  cancelOrder(orderId: string): Promise<void>;
  cancelAllOrders(): Promise<void>;

  // Quotes & Market Data
  getQuote(symbol: string): Promise<BrokerQuote>;
  getQuotes(symbols: string[]): Promise<BrokerQuote[]>;
  getBars(symbol: string, params: BarParams): Promise<Bar[]>;
  getMarketStatus(): Promise<MarketStatus>;

  // History
  getHistoricalData(symbol: string, params: HistoricalParams): Promise<HistoricalBar[]>;

  // Streaming
  subscribe(symbols: string[], onQuote: (q: BrokerQuote) => void): () => void;

  // Fractional Support
  supportsFractional(symbol: string): Promise<boolean>;
}

// ─── Market Data ───

export interface BarParams {
  timeframe: '1Min' | '5Min' | '15Min' | '1H' | '1D' | '1W';
  start?: string;
  end?: string;
  limit?: number;
}

export interface Bar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface HistoricalParams {
  timeframe: '1D' | '1W' | '1M';
  start: string;
  end: string;
}

export interface HistoricalBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketStatus {
  isOpen: boolean;
  nextOpen?: string;
  nextClose?: string;
  session?: 'pre' | 'regular' | 'after' | 'closed';
}

// ─── Broker Factory ───

export interface BrokerRegistry {
  register(adapter: BrokerAdapter): void;
  get(id: BrokerId): BrokerAdapter | undefined;
  list(): BrokerAdapter[];
}
