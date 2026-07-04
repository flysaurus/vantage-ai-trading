// ─── Broker Engine Types ─────────────────────────────────────
// Unified trading interface used by PortfolioContext.
// DemoBroker (localStorage) and future live brokers all implement BrokerEngine.
// This sits ABOVE the existing BrokerAdapter layer (lib/broker/index.ts).

export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'market' | 'limit';
export type OrderStatus = 'OPEN' | 'FILLED' | 'CANCELLED' | 'REJECTED';

export interface OrderRequest {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  shares?: number;
  dollarAmount?: number;
  limitPrice?: number;
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

export interface BasketOrderRequest {
  basketId: string;
  basketName: string;
  basketEmoji: string;
  basketDisplayName: string;
  stocks: Array<{
    symbol: string;
    dollarAmount: number;
    allocationPct: number;
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

export interface BrokerAccountSummary {
  totalValue: number;
  cashBalance: number;
  buyingPower: number;
  totalInvested: number;
  totalPnL: number;
  totalPnLPct: number;
  todayPnL: number;
  todayPnLPct: number;
}

export interface BrokerOrder {
  id: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  status: OrderStatus;
  shares: number;
  submittedPrice: number;
  fillPrice?: number;
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
}

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

export interface BrokerEngine {
  readonly name: string;
  readonly isDemo: boolean;
  readonly supportsTrading: boolean;

  getAccount(): Promise<BrokerAccountSummary>;
  getPositions(): Promise<BrokerPosition[]>;
  getOrders(status?: OrderStatus): Promise<BrokerOrder[]>;
  getBasketOrders(): Promise<BrokerBasketOrder[]>;

  placeOrder(req: OrderRequest): Promise<OrderResult>;
  placeBasketOrder(req: BasketOrderRequest): Promise<BasketOrderResult>;
  cancelOrder(orderId: string): Promise<{ success: boolean; message?: string }>;
  cancelBasketOrder(basketOrderId: string): Promise<{ success: boolean; message?: string }>;

  isMarketOpen(): boolean;
  getNextOpenLabel(): string;
  executePendingOrders(): Promise<number>;

  loadFromSupabase?(): Promise<boolean>;
}

// Internal state shape used by DemoBroker
export interface DemoStateInternal {
  positions: BrokerPosition[];
  cashBalance: number;
  orders: BrokerOrder[];
  basketOrders: BrokerBasketOrder[];
  savedAt: number;
}
