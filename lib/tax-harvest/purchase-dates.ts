// ═══════════════════════════════════════════════════════════════
// lib/tax-harvest/purchase-dates.ts — Purchase-date ledger (unified)
// ═══════════════════════════════════════════════════════════════
//
// Two code paths used to answer the same question — "when did I acquire
// these shares?" — in the Tax Loss Harvesting feature:
//
//   1. The TLH page queried `position_lots` directly from the browser,
//      scoped per account.
//   2. The wash-sale route queried `orders` server-side, scoped only by
//      user — which silently leaked another account's trades.
//
// This module unifies both read paths behind ONE account-scoped loader and
// one set of pure transforms, so the holding-period math and the wash-sale
// window can never disagree about acquisition dates or account scope again.
//
// Pure functions (no DB / no React) are unit-tested in
// tests/tax-harvest-purchase-dates.test.ts. `loadPurchaseLots` is the only
// async, Supabase-touching export and MUST run server-side.

export type PurchaseDateSource = 'lots' | 'orders' | 'none';

export interface PurchaseDateLotRow {
  id: string;
  ticker: string;
  qty: number;
  remainingQty: number;
  priceAtFill: number;
  filledAt: string;
  source: 'lots' | 'orders';
}

export interface PurchaseDateScope {
  connectionId?: string | null;
  isDemo?: boolean;
}

const BUY_SIDES = new Set(['buy', 'buy_to_cover']);

/**
 * Apply the account-scope filter to a `position_lots` query builder.
 *   • demo        → `.is('account_id', null)`
 *   • connection  → `.eq('account_id', connectionId)`
 *   • neither     → query untouched (NO implicit user-wide read).
 */
export function scopedAccountFilter(query: any, { connectionId, isDemo }: PurchaseDateScope): any {
  if (isDemo) return query.is('account_id', null);
  if (connectionId) return query.eq('account_id', connectionId);
  return query;
}

/**
 * Apply the account-scope filter to an `orders` query builder. The `orders`
 * table stores its account link in `connection_id` (not `account_id`).
 *   • demo        → `.is('connection_id', null)`
 *   • connection  → `.eq('connection_id', connectionId)`
 *   • neither     → query untouched.
 */
export function scopedConnectionFilter(query: any, { connectionId, isDemo }: PurchaseDateScope): any {
  if (isDemo) return query.is('connection_id', null);
  if (connectionId) return query.eq('connection_id', connectionId);
  return query;
}

/** True when the supplied date string parses to a real timestamp. */
function usableTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Convert raw `orders` rows into purchase-date lots. PURE.
 *
 * Keeps only buy-side rows ('buy' / 'buy_to_cover', case-insensitive), uses
 * `filled_qty ?? qty` and `filled_price`, and `filled_at ?? created_at` as the
 * acquisition timestamp. Rows with no positive qty, no positive price, or no
 * usable date are dropped. Result is sorted oldest-first.
 */
export function orderRowsToLots(
  rows:
    | Array<{
        id?: string;
        symbol?: string;
        filled_qty?: number | null;
        qty?: number | null;
        filled_price?: number | null;
        filled_at?: string | null;
        created_at?: string | null;
        status?: string | null;
        side?: string | null;
      }>
    | null
    | undefined,
): PurchaseDateLotRow[] {
  if (!Array.isArray(rows)) return [];

  const lots: PurchaseDateLotRow[] = [];
  for (const row of rows) {
    if (!row) continue;

    const side = String(row.side ?? '').toLowerCase();
    if (!BUY_SIDES.has(side)) continue;

    const filledQty = typeof row.filled_qty === 'number' ? row.filled_qty : null;
    const rawQty = filledQty ?? (typeof row.qty === 'number' ? row.qty : null);
    const qty = rawQty === null ? 0 : Number(rawQty);
    if (!(qty > 0)) continue;

    const price = row.filled_price === null || row.filled_price === undefined ? NaN : Number(row.filled_price);
    if (!(price > 0)) continue;

    const stampRaw = row.filled_at || row.created_at || null;
    const t = usableTime(stampRaw);
    if (t === null) continue;

    const ticker = String(row.symbol ?? '').toUpperCase();

    lots.push({
      id: String(row.id ?? ''),
      ticker,
      qty,
      remainingQty: qty,
      priceAtFill: price,
      filledAt: String(stampRaw),
      source: 'orders',
    });
  }

  lots.sort((a, b) => usableTime(a.filledAt)! - usableTime(b.filledAt)!);
  return lots;
}

/**
 * Group lots by uppercased ticker, skipping blank tickers. PURE. Preserves
 * the incoming (oldest-first) order within each ticker.
 */
export function groupLotsByTicker(
  rows: PurchaseDateLotRow[] | null | undefined,
): Record<string, PurchaseDateLotRow[]> {
  const grouped: Record<string, PurchaseDateLotRow[]> = {};
  if (!Array.isArray(rows)) return grouped;
  for (const row of rows) {
    if (!row) continue;
    const ticker = String(row.ticker || '').toUpperCase().trim();
    if (!ticker) continue;
    if (!grouped[ticker]) grouped[ticker] = [];
    grouped[ticker].push({ ...row, ticker });
  }
  return grouped;
}

/** Map raw `position_lots` rows to the canonical lot shape. PURE. */
function positionLotRowsToLots(rows: any[]): PurchaseDateLotRow[] {
  const out: PurchaseDateLotRow[] = [];
  for (const row of rows) {
    if (!row) continue;
    const ticker = String(row.ticker || '').toUpperCase().trim();
    if (!ticker) continue;
    const qty = Number(row.qty) || 0;
    const remainingQty = Number(row.remaining_qty) || 0;
    if (!(qty > 0) && !(remainingQty > 0)) continue;
    out.push({
      id: String(row.id ?? ''),
      ticker,
      qty,
      remainingQty,
      priceAtFill: Number(row.price_at_fill) || 0,
      filledAt: String(row.filled_at || ''),
      source: 'lots',
    });
  }
  return out;
}

/**
 * Load purchase-date lots for a single account, server-side.
 *
 * Prefers the FIFO lot ledger (`position_lots`); falls back to raw buy
 * `orders` when no lots exist; degrades to `source: 'none'` otherwise.
 * Query errors (incl. PGRST116) are swallowed — this never throws.
 */
export async function loadPurchaseLots(
  supabase: any,
  opts: { userId: string; connectionId?: string | null; isDemo?: boolean },
): Promise<{ lotsByTicker: Record<string, PurchaseDateLotRow[]>; source: PurchaseDateSource }> {
  const { userId, connectionId = null, isDemo = false } = opts || ({} as any);

  // ── 1. FIFO lot ledger ────────────────────────────────────────
  let lotRows: any[] | null = null;
  try {
    let q = supabase
      .from('position_lots')
      .select('id,ticker,qty,remaining_qty,price_at_fill,filled_at')
      .eq('user_id', userId)
      .gt('remaining_qty', 0)
      .order('filled_at', { ascending: true });
    q = scopedAccountFilter(q, { connectionId, isDemo });
    const { data, error } = await q;
    if (!error && Array.isArray(data)) lotRows = data;
  } catch {
    lotRows = null;
  }

  if (lotRows && lotRows.length > 0) {
    const lots = positionLotRowsToLots(lotRows);
    if (lots.length > 0) {
      return { lotsByTicker: groupLotsByTicker(lots), source: 'lots' };
    }
  }

  // ── 2. Fallback: raw buy orders ───────────────────────────────
  try {
    let q = supabase
      .from('orders')
      .select('id,symbol,qty,filled_qty,filled_price,filled_at,created_at,status,side')
      .eq('user_id', userId)
      .order('filled_at', { ascending: true });
    q = scopedConnectionFilter(q, { connectionId, isDemo });
    const { data, error } = await q;
    if (!error && Array.isArray(data)) {
      const lots = orderRowsToLots(data);
      if (lots.length > 0) {
        return { lotsByTicker: groupLotsByTicker(lots), source: 'orders' };
      }
    }
  } catch {
    /* fall through to none */
  }

  return { lotsByTicker: {}, source: 'none' };
}
