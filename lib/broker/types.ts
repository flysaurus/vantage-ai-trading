// ─── Unified Broker Types ─────────────────────────────────────
// Single source of truth for all broker-related types.
// Used by BrokerEngine (PortfolioContext), all broker adapters,
// and the Trading UI layer.
//
// This replaces duplicate type definitions spread across:
//   lib/broker/engine.ts     (BrokerEngine types)
//   types/broker.ts          (BrokerAdapter types)
//   context/PortfolioContext  (inline type casts)

// ─── Enums ────────────────────────────────────────────────

export type OrderSide = 'BUY' | 'SELL';

export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit';

/** Canonical order status lifecycle: SUBMITTED → OPEN → FILLED | PARTIALLY_FILLED | CANCELLED | REJECTED */
export type OrderStatus = 'SUBMITTED' | 'OPEN' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'REJECTED';

export type TimeInForce = 'day' | 'gtc' | 'ioc' | 'fok';

// ─── Order Request / Result ───────────────────────────────

/** Preview result from trade impact check before placing an order */
export interface OrderImpactPreview {
  estimatedTotal: number;
  commission: number;
  buyingPowerAfter: number | null;
  hasSufficientFunds: boolean;
  warnings: string[];
}

export interface OrderRequest {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  shares?: number;
  dollarAmount?: number;
  limitPrice?: number;
  stopPrice?: number;
  timeInForce?: TimeInForce;
  /** Current market price — used for after-hours market→limit conversion. */
  currentPrice?: number;
  basketId?: string;
  basketName?: string;
  basketEmoji?: string;
  basketDisplayName?: string;
}

export interface OrderResult {
  success: boolean;
  orderId: string;
  status: OrderStatus;
  message?: string;
  estimatedShares?: number;
  reservedAmount?: number;
  nextOpenLabel?: string;
  fillPrice?: number;
  filledShares?: number;
  totalCost?: number;
  filledAt?: string;
}

// ─── Basket Orders ────────────────────────────────────────

export interface BasketOrderRequest {
  basketId: string;
  basketName: string;
  basketEmoji: string;
  basketDisplayName: string;
  stocks: Array<{
    symbol: string;
    dollarAmount: number;
    allocationPct: number;
    fallbackPrice?: number;
  }>;
  totalBudget: number;
}

export interface BasketOrderResult {
  success: boolean;
  basketOrderId: string;
  status: OrderStatus;
  orders: OrderResult[];
  totalReserved: number;
  nextOpenLabel?: string;
  message?: string;
  totalSpent?: number;
  executed?: number;
  failed?: number;
}

// ─── Position ─────────────────────────────────────────────

export interface BrokerPosition {
  symbol: string;
  name?: string;
  sector?: string;
  type: 'Stock' | 'ETF';
  shares: number;
  avgCost: number;
  totalCost: number;
  buyDate: string;
  basketId?: string;
  basketName?: string;
  basketEmoji?: string;
  basketDisplayName?: string;
}

// ─── Account Summary ──────────────────────────────────────

export interface BrokerAccountSummary {
  totalValue: number;
  cashBalance: number;
  /** null = non-margin account — never render "$0.00" */
  buyingPower: number | null;
  totalInvested: number;
  totalPnL: number;
  totalPnLPct: number;
  todayPnL: number;
  todayPnLPct: number;
  /** Connection-level metadata — null for Demo */
  lastSynced: string | null;
  accountStatus: 'open' | 'closed' | 'archived' | null;
  holdingsUnavailable: boolean;
}

// ─── Order (lifecycle-tracked) ────────────────────────────

export interface BrokerOrder {
  id: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  status: OrderStatus;
  shares: number;
  submittedPrice: number;
  /** Limit price for limit/stop_limit orders */
  limitPrice?: number;
  /** Stop trigger price for stop/stop_limit orders */
  stopPrice?: number;
  timeInForce?: TimeInForce;
  fillPrice?: number;
  /** Number of shares actually filled (distinct from `shares` on partial fills) */
  filledShares?: number;
  totalCost: number;
  submittedAt: string;
  filledAt?: string;
  cancelledAt?: string;
  basketOrderId?: string;
  basketId?: string;
  basketName?: string;
  basketEmoji?: string;
  basketDisplayName?: string;
  note?: string;
  reservedCost?: number;
  /** For OPEN sell orders: shares reserved to prevent double-selling */
  reservedShares?: number;
}

// ─── Basket Order (lifecycle-tracked) ─────────────────────

export interface BrokerBasketOrder {
  id: string;
  basketId: string;
  basketName: string;
  basketEmoji: string;
  basketDisplayName: string;
  status: OrderStatus;
  orders: BrokerOrder[];
  totalReserved: number;
  totalFilled?: number;
  submittedAt: string;
  filledAt?: string;
  cancelledAt?: string;
  nextOpenLabel?: string;
  note?: string;
}

// ─── Broker Metadata ──────────────────────────────────────
// Used for trading-availability messaging (Phase 5).
// Every BrokerEngine MUST expose this.

export interface BrokerMeta {
  /** Machine-readable broker slug: 'alpaca' | 'snaptrade' | 'demo' */
  slug: string;
  /** Human-readable broker name: 'Alpaca Markets', 'SnapTrade', 'Demo' */
  name: string;
  /** Whether this is a demo/simulation account */
  isDemo: boolean;
  /** Whether the connected broker supports real trade execution.
   *  true  = live trading is enabled — show positive indicator.
   *  false = read-only connection — show warning with broker-specific reason. */
  tradingEnabled: boolean;
  /** When tradingEnabled=false, WHY. Displayed to user.
   *  e.g. "Alpaca Paper is read-only — trading not supported via SnapTrade" */
  tradingDisabledReason?: string;
  /** Environment: 'demo' | 'paper' | 'live' */
  environment: 'demo' | 'paper' | 'live';
  /** True if the broker connection is currently active/healthy */
  isConnected: boolean;
  /** Connected broker display name (for the badge):
   *  e.g. "[ Broker ]" where Broker is "Alpaca" or "Robinhood via SnapTrade" */
  brokerDisplayName: string;
}

// ─── Broker Engine Interface ──────────────────────────────

export interface BrokerEngine {
  readonly name: string;
  readonly isDemo: boolean;
  readonly supportsTrading: boolean;

  /** Broker metadata for UI indicators (Phase 5+) */
  getMeta(): BrokerMeta;

  getAccount(): Promise<BrokerAccountSummary>;
  getPositions(): Promise<BrokerPosition[]>;
  getOrders(status?: OrderStatus): Promise<BrokerOrder[]>;
  getBasketOrders(): Promise<BrokerBasketOrder[]>;

  placeOrder(req: OrderRequest): Promise<OrderResult>;
  placeBasketOrder(req: BasketOrderRequest): Promise<BasketOrderResult>;
  cancelOrder(orderId: string): Promise<{ success: boolean; message?: string }>;
  cancelBasketOrder(basketOrderId: string): Promise<{ success: boolean; message?: string }>;

  /** Preview the impact of an order before placing it (commission, buying power change, etc.)
   *  SnapTrade: POST /trade/impact. Not all brokers support this. */
  previewOrder?(req: OrderRequest): Promise<OrderImpactPreview>;

  isMarketOpen(): boolean;
  getNextOpenLabel(): string;
  executePendingOrders(): Promise<number>;

  /** Poll broker to sync status of tracked in-flight orders.
   *  Returns order IDs whose status changed. */
  syncOrderStatus?(trackedOrders: Map<string, OrderStatus>): Promise<string[]>;

  /** Refresh account positions after detecting fills. */
  refreshAfterTrade?(): Promise<void>;

  loadFromSupabase?(): Promise<boolean>;
}

// ─── Demo State (internal, localStorage shape) ────────────

export interface DemoStateInternal {
  positions: BrokerPosition[];
  cashBalance: number;
  orders: BrokerOrder[];
  basketOrders: BrokerBasketOrder[];
  savedAt: number;
}
