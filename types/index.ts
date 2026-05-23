// ─── Market Data ───
export interface Quote {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  change: number;
  changePercent: number;
  volume: number;
  high52w: number;
  low52w: number;
}

export interface MarketIndex {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
}

// ─── Portfolio ───
export interface AccountSummary {
  equity: number;
  buyingPower: number;
  cash: number;
  dayPnl: number;
  dayPnlPercent: number;
  totalPnl: number;
  totalPnlPercent: number;
  positions: Position[];
}

export interface Position {
  symbol: string;
  name?: string;
  qty: number;
  avgCost: number;
  currentPrice: number;
  marketValue: number;
  dayChange: number;
  dayChangePercent: number;
  totalPnl: number;
  totalPnlPercent: number;
  profitLossPct?: number;
  portfolioPercent: number;
  sector?: string;
}

export interface SectorAllocation {
  sector: string;
  percent: number;
  color: string;
}

// ─── Orders ───
export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit' | 'trailing_stop';
export type OrderStatus = 'open' | 'filled' | 'cancelled' | 'rejected' | 'pending';
export type TimeInForce = 'day' | 'gtc' | 'ioc' | 'fok';

export interface Order {
  id: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  status: OrderStatus;
  qty: number;
  filledQty?: number;
  limitPrice?: number;
  stopPrice?: number;
  filledPrice?: number;
  totalValue?: number;
  timeInForce: TimeInForce;
  createdAt: string;
  updatedAt?: string;
  bracketOrder?: {
    stopLoss?: number;
    takeProfit?: number;
  };
}

export interface OrderFormState {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  qty: number;
  qtyType: 'shares' | 'dollars';
  limitPrice?: number;
  stopPrice?: number;
  timeInForce: TimeInForce;
  extendedHours: boolean;
  bracketOrder: boolean;
  stopLoss?: number;
  takeProfit?: number;
}

// ─── AI / Chat ───
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  components?: AICardComponent[];
  timestamp: number;
}

export type AICardType = 'buy_signal' | 'sell_signal' | 'risk_analysis' | 'insight' | 'rebalance';

export interface AICardComponent {
  type: AICardType;
  symbol?: string;
  title: string;
  conviction?: number;
  reason?: string;
  price?: number;
  metrics?: Record<string, number | string>;
  actions?: AIAction[];
}

export interface AIAction {
  label: string;
  action: 'buy' | 'sell' | 'view_chart' | 'details' | 'rebalance';
  params?: Record<string, string | number>;
}

// ─── Portfolio Confidence ───
export interface ConfidenceBreakdown {
  overall: number;
  components: {
    diversification: number;
    technicalHealth: number;
    volatilityExposure: number;
    macroAlignment: number;
    positionQuality: number;
  };
  explanation: string;
  warnings: string[];
}

// ─── Watchlist ───
export interface WatchlistItem {
  symbol: string;
  change?: number;
  changePercent?: number;
}

// ─── Auth ───
export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  createdAt: string;
}

export interface VantageSession {
  token: string;
  expiresAt: number; // Unix timestamp in seconds
  userId: string;
}
