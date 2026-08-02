// ─── SnapTrade Schema Mapping ─────────────────────────────
// Shared extraction functions for SnapTrade's nested response shapes.
//
// POSITIONS (three levels):  pos.symbol.symbol.symbol → "TSLA"
// ORDERS/ACTIVITIES (two levels): act.universal_symbol.symbol → "TSLA"
//
// These are the CONFIRMED real-world SnapTrade response schemas.
// DO NOT reimplement symbol extraction per-route — always use these.

// ─── Position symbol (triple-nested) ──────────────────────

/**
 * Extracts the ticker from a SnapTrade position.
 * Position symbol is triple-nested: position.symbol.symbol.symbol → "TSLA"
 */
export function extractPositionTicker(pos: Record<string, unknown>): string {
  const s1 = (pos as any).symbol as Record<string, unknown> | undefined;
  if (!s1 || typeof s1 !== 'object') return '';

  const s2 = s1.symbol;
  if (!s2 || typeof s2 !== 'object') {
    // s1.symbol might be a flat string (legacy format)
    if (typeof s1.symbol === 'string') return s1.symbol;
    return '';
  }

  // Three levels deep: s2.symbol = "TSLA"
  return String((s2 as any).symbol || '');
}

/**
 * Extracts the human-readable name from a SnapTrade position.
 * position.symbol.symbol.description → "Tesla, Inc."
 */
export function extractPositionName(pos: Record<string, unknown>): string {
  const s1 = (pos as any).symbol as Record<string, unknown> | undefined;
  if (!s1 || typeof s1 !== 'object') return '';

  const s2 = s1.symbol;
  if (s2 && typeof s2 === 'object') {
    // Check the three-level description first
    const desc = (s2 as any).description;
    if (typeof desc === 'string' && desc.length > 0) return desc;
  }

  // Fall back to level-1 description
  if (typeof s1.description === 'string' && s1.description.length > 0) {
    return s1.description;
  }

  return '';
}

// ─── Order/Activity symbol (two levels via universal_symbol) ──

/**
 * Extracts the ticker from a SnapTrade activity (order).
 * Activity symbol uses universal_symbol: activity.universal_symbol.symbol → "TSLA"
 * Falls back to symbol.symbol if universal_symbol is missing.
 */
export function extractOrderSymbol(activity: Record<string, unknown>): string {
  // Primary: universal_symbol.symbol (documented SnapTrade schema)
  const us = (activity as any).universal_symbol;
  if (us && typeof us === 'object') {
    if (typeof us.symbol === 'string' && us.symbol.length > 0) {
      return us.symbol;
    }
  }

  // Fallback: symbol.symbol (seen in some older responses)
  const s = (activity as any).symbol;
  if (s && typeof s === 'object') {
    if (typeof s.symbol === 'string' && s.symbol.length > 0) {
      return s.symbol;
    }
  }

  return '';
}

/**
 * Extracts the human-readable name from a SnapTrade activity.
 * Tries universal_symbol.description first, then symbol.description.
 */
export function extractOrderName(activity: Record<string, unknown>): string {
  const us = (activity as any).universal_symbol;
  if (us && typeof us === 'object') {
    if (typeof us.description === 'string' && us.description.length > 0) return us.description;
  }

  const s = (activity as any).symbol;
  if (s && typeof s === 'object') {
    if (typeof s.description === 'string' && s.description.length > 0) return s.description;
  }

  return '';
}

// ─── Status & Side mapping ─────────────────────────────────

/**
 * Maps SnapTrade activity status to Vantage order status.
 *
 * SnapTrade statuses: NONE, PENDING, ACCEPTED, EXECUTED,
 *   CANCELED, PARTIAL_FILL, PENDING_CANCEL, REJECTED, etc.
 *
 * Vantage statuses: open, filled, cancelled, rejected, pending, partial
 */
export function mapOrderStatus(snapTradeStatus: string): string {
  const s = (snapTradeStatus || '').toUpperCase();
  switch (s) {
    case 'EXECUTED':
    case 'FILLED':
      return 'filled';
    case 'CANCELED':
    case 'CANCELLED':
      return 'cancelled';
    case 'REJECTED':
      return 'rejected';
    case 'PENDING':
    case 'PENDING_CANCEL':
    case 'ACCEPTED':
      return 'pending';
    case 'PARTIAL_FILL':
    case 'PARTIALLY_FILLED':
      return 'partial';
    default:
      return 'open';
  }
}

/**
 * Maps SnapTrade activity type to Vantage order side.
 * BUY/SELL → buy/sell. DIVIDEND_REINVEST → buy.
 */
export function mapOrderSide(activityType: string): 'buy' | 'sell' {
  const t = (activityType || '').toUpperCase();
  if (t === 'SELL' || t === 'SELL_SHORT') return 'sell';
  // BUY, BUY_TO_COVER, DIVIDEND_REINVEST → buy
  return 'buy';
}
