// ─── Canonical broker types ────────────────────────────────
// Every broker adapter (SnapTrade, Demo, future providers) maps
// into these interfaces. No UI component should ever branch on
// "is this Demo vs SnapTrade" — only on whether a field is present.
//
// Capabilities and status are read LIVE per-connection, never
// hardcoded by broker name. See rules in lib/broker/capabilities.ts.

// ─── Account ──────────────────────────────────────────────

export interface CanonicalAccount {
  /** account.balance.total.amount from SnapTrade, or computed from cash + positions */
  totalValue: number;
  cash: number;
  /** null = non-margin account — UI hides field, never renders "$0.00" */
  buyingPower: number | null;
  invested: number;
  marketValue: number;
  dayChange: number;
  dayChangePct: number;
  totalPnl: number;
  totalPnlPct: number;
  currency: string;
  /** open | closed | archived | null (null = not meaningful, e.g. Demo) */
  accountStatus: 'open' | 'closed' | 'archived' | null;
  /** sync_status.holdings.last_successful_sync — null for Demo or unknown */
  lastSynced: string | null;
  /** sync_status.holdings.holdings_unavailable — read live, varies per account */
  holdingsUnavailable: boolean;
  positions: CanonicalPosition[];
  orders: CanonicalOrder[];
}

// ─── Position ─────────────────────────────────────────────

export interface CanonicalPosition {
  /** position.symbol.symbol.symbol (3 levels deep in SnapTrade) */
  symbol: string;
  /** position.symbol.symbol.description */
  name: string;
  /** position.units */
  quantity: number;
  price: number;
  /** computed as average_purchase_price × quantity — never trust open_pnl directly per SnapTrade docs */
  costBasis: number | null;
  marketValue: number;
  openPnl: number;
  dayChange: number;
  dayChangePct: number;
  portfolioPercent: number;
  assetType: 'stock' | 'etf' | 'crypto' | 'option' | 'other';
  currency: string;
}

// ─── Order ────────────────────────────────────────────────

export interface CanonicalOrder {
  /** order.universal_symbol.symbol — 2 levels, NOT same depth as positions */
  symbol: string;
  name: string;
  /** mapped: EXECUTED→filled, CANCELED→cancelled, etc. */
  status: 'filled' | 'cancelled' | 'rejected' | 'pending' | 'partial' | 'open';
  /** BUY | SELL */
  action: 'BUY' | 'SELL';
  type: 'market' | 'limit' | 'stop' | 'stop_limit' | 'other';
  quantity: number;
  filledQuantity: number;
  executionPrice: number | null;
  totalValue: number | null;
  timePlaced: string;
  timeExecuted: string | null;
  assetType: 'stock' | 'etf' | 'crypto' | 'option' | 'other';
}

// ─── Capabilities (per-connection, LIVE) ──────────────────

/**
 * Every field is derived from the live API response, never hardcoded.
 * holdingsUnavailable varies WITHIN a broker (e.g. some Vanguard
 * accounts have it, not all) — must be read per connection.
 */
export interface BrokerCapabilities {
  tradingEnabled: boolean;
  holdingsAvailable: boolean;     // false when holdingsUnavailable=true
  ordersAvailable: boolean;       // false when activities endpoint returns empty/410
  isPaperAccount: boolean;
  brokerageName: string;          // e.g. "Alpaca Paper", "Robinhood"
}
