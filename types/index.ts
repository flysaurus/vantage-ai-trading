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
  /** null = non-margin account — UI hides field entirely */
  buyingPower: number | null;
  cash: number;
  dayPnl: number;
  dayPnlPercent: number;
  totalPnl: number;
  totalPnlPercent: number;
  positions: Position[];
  /** Connection-level metadata (null for Demo) */
  lastSynced?: string | null;
  accountStatus?: 'open' | 'closed' | 'archived' | null;
  holdingsUnavailable?: boolean;
}

export interface BasketInfo {
  basketId?: string;
  basketName?: string;
  basketEmoji?: string;
  basketDisplayName?: string;
}

export interface Position extends BasketInfo {
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
  weekHigh52?: number;
  weekLow52?: number;
  type?: 'Stock' | 'ETF';
  /** Shares reserved by OPEN sell orders (not available to sell) */
  reservedShares?: number;
  totalCost?: number;
  buyDate?: string;
  exchange?: string;
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
  /** Dollar amount for notional_value orders (null for share-based orders) */
  notional?: number | null;
  /** SnapTrade/Alpaca brokerage_order_id — allows dedup against broker-fetched orders */
  brokerageOrderId?: string;
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
  role: 'user' | 'assistant' | 'system';
  content: string;
  type?: string;
  basketName?: string;
  basketId?: string;
  stocks?: Array<{
    symbol: string;
    company: string;
    subTheme: string;
    compositeScore: number;
    conviction: string;
    currentPrice: number;
  }>;
  components?: AICardComponent[];
  rebalanceSession?: RebalanceSession;
  timestamp: number;
}

export interface RebalanceSession {
  sessionId: string;
  summary: string;
  trades: Array<{ symbol: string; action: string; shares: number; estimatedValue: number }>;
  targetSource?: 'saved' | 'style_default';
  styleName?: string;
  targets?: Array<{ symbol: string; targetPercent: number }>;
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
  data?: Record<string, any>;
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

// ─── Investor Styles ───
export type InvestorStyle = 'buffett' | 'lynch' | 'livermore' | 'soros' | 'munger';

export interface StyleRecommendation {
  recommendation: 'BUY_MORE' | 'HOLD' | 'SELL';
  confidence: number; // 0-1
  reasoning: string;
}

export interface PositionStyleRecommendations {
  buffett: StyleRecommendation;
  lynch: StyleRecommendation;
  livermore: StyleRecommendation;
  soros: StyleRecommendation;
  munger: StyleRecommendation;
}

export interface AllStylesRecommendation {
  buffett: 'BUY_MORE' | 'HOLD' | 'SELL';
  lynch: 'BUY_MORE' | 'HOLD' | 'SELL';
  livermore: 'BUY_MORE' | 'HOLD' | 'SELL';
  soros: 'BUY_MORE' | 'HOLD' | 'SELL';
  munger: 'BUY_MORE' | 'HOLD' | 'SELL';
}

export interface PortfolioAnalysis {
  id: string;
  userId: string;

  // Portfolio metrics
  totalValue: number;
  totalGain: number;
  totalReturn: number;
  positionCount: number;

  // Selected style analysis
  selectedStyle: InvestorStyle;
  styleScore: number; // 0-100
  styleRecommendation: 'BUY_MORE' | 'HOLD' | 'SELL' | 'REBALANCE';
  styleInsights: string[];

  // Conflict detection
  hasConflict: boolean;
  conflictSeverity?: 'low' | 'medium' | 'high';
  conflictAlert?: string;

  // All styles comparison
  allStylesRecommendation: AllStylesRecommendation;

  // Position-level recommendations (keyed by symbol)
  positionRecommendations: {
    [symbol: string]: PositionStyleRecommendations;
  };

  // Metadata
  analyzedAt: string;
  cachedUntil: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Auth ───
export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  investorStyle: InvestorStyle;
  investorStyleSetAt?: string;
  investorStyleOnboarded: boolean;
  riskTolerance?: 'Conservative' | 'Moderate' | 'Aggressive';
  name?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface VantageSession {
  token: string;
  expiresAt: number; // Unix timestamp in seconds
  userId: string;
}

// ─── Earnings ────────────────────────────────────────────────
export interface EarningsEvent {
  symbol: string;
  name?: string;
  date: string;         // YYYY-MM-DD
  hour: 'bmo' | 'amc' | 'unknown';
  year: number;
  quarter: number;
  epsEstimate: number | null;
  epsActual: number | null;
  revenueEstimate: number | null;
  revenueActual: number | null;
  reportDate: string | null;
  beat: boolean | null;
  source: string;
}
