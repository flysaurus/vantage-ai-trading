// ─── trade_history: the table's real shape, in one place ────────────────────
//
// Every route under app/api/db/trade-history was written against a schema the
// table has never had. Verified against PostgREST on 2026-09-12, the real
// columns are:
//
//   action, commission, connection_id, created_at, executed_at, id, is_demo,
//   notes, price, quantity, symbol, updated_at, user_id
//
// The routes asked for `total_value`, `side`, `qty`, `filled_price`, `status`,
// `filled_at` and `alpaca_order_id` — none of which exist. PostgREST rejects a
// query naming an unknown column, so GET /get-all, POST /create, /get-single
// and /sync all returned 500 on every request (both the read and the write
// path were dead), and the trade-history page rendered empty. Nothing in the
// UI could tell the difference between "no trades" and "the endpoint is
// broken", which is why it went unnoticed.
//
// Keeping the column list here means a route can't drift from the table again
// without a test failing: tests/trade-history-schema.test.ts pins these names.

/** Columns that exist on `trade_history`, as returned by PostgREST. */
export const TRADE_HISTORY_COLUMNS = [
  'action',
  'commission',
  'connection_id',
  'created_at',
  'executed_at',
  'id',
  'is_demo',
  'notes',
  'price',
  'quantity',
  'symbol',
  'updated_at',
  'user_id',
] as const;

/** Column list to select for API reads (no `*`, so the shape is explicit). */
export const TRADE_HISTORY_SELECT = [
  'id',
  'user_id',
  'symbol',
  'action',
  'quantity',
  'price',
  'commission',
  'notes',
  'executed_at',
  'created_at',
  'is_demo',
  'connection_id',
].join(', ');

export interface TradeHistoryRow {
  id: string;
  user_id: string;
  symbol: string;
  action: string | null;
  quantity: number | string | null;
  price: number | string | null;
  commission: number | string | null;
  notes: string | null;
  executed_at: string | null;
  created_at: string | null;
  is_demo: boolean | null;
  connection_id: string | null;
}

/** The API shape the client consumes (`totalValue` is derived, not stored). */
export interface TradeRecord {
  id: string;
  symbol: string;
  action: string | null;
  quantity: number;
  price: number;
  totalValue: number;
  commission: number | null;
  notes: string | null;
  executedAt: string | null;
  createdAt: string | null;
  isDemo: boolean;
  connectionId: string | null;
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : null;
}

/** DB row → API record. `totalValue` is quantity × price (no such column). */
export function toTradeRecord(row: Partial<TradeHistoryRow>): TradeRecord {
  const quantity = numOrNull(row.quantity) ?? 0;
  const price = numOrNull(row.price) ?? 0;
  return {
    id: String(row.id ?? ''),
    symbol: String(row.symbol ?? '').toUpperCase(),
    action: row.action ?? null,
    quantity,
    price,
    totalValue: quantity * price,
    commission: numOrNull(row.commission),
    notes: row.notes ?? null,
    executedAt: row.executed_at ?? null,
    createdAt: row.created_at ?? null,
    isDemo: row.is_demo === true,
    connectionId: row.connection_id ?? null,
  };
}

export interface TradeInsertInput {
  symbol?: unknown;
  action?: unknown;
  side?: unknown; // legacy alias for `action`
  quantity?: unknown;
  qty?: unknown; // legacy alias for `quantity`
  price?: unknown;
  filledPrice?: unknown; // legacy alias for `price`
  filled_price?: unknown;
  commission?: unknown;
  notes?: unknown;
  executedAt?: unknown;
  executed_at?: unknown;
  filledAt?: unknown;
  filled_at?: unknown;
}

/**
 * API body → insert row, carrying ONLY real columns. Legacy alias fields are
 * accepted (older callers and the Alpaca sync send `side`/`qty`/
 * `filled_price`/`filled_at`) and folded into the real ones so a rename never
 * breaks a write again.
 */
export function toTradeInsert(
  input: TradeInsertInput,
  opts: { userId: string; connectionId?: string | null; isDemo?: boolean },
): Record<string, unknown> {
  const action = input.action ?? input.side ?? null;
  const quantity = numOrNull(input.quantity ?? input.qty);
  const price = numOrNull(input.price ?? input.filledPrice ?? input.filled_price);
  const executedAt =
    (input.executedAt as string) ??
    (input.executed_at as string) ??
    (input.filledAt as string) ??
    (input.filled_at as string) ??
    null;

  return {
    user_id: opts.userId,
    symbol: String(input.symbol ?? '').toUpperCase(),
    action: action == null ? null : String(action),
    quantity,
    price,
    commission: numOrNull(input.commission),
    notes: input.notes == null ? null : String(input.notes),
    executed_at: executedAt,
    is_demo: opts.isDemo === true,
    connection_id: opts.connectionId ?? null,
  };
}

/**
 * Dedupe key for a trade. There is no broker-order-id column to key on, so a
 * re-synced order is recognised by what it actually is: the same symbol, side,
 * size, price and execution timestamp for the same user.
 */
export function tradeDedupeKey(t: {
  symbol?: unknown;
  action?: unknown;
  side?: unknown;
  quantity?: unknown;
  qty?: unknown;
  price?: unknown;
  executed_at?: unknown;
  executedAt?: unknown;
  filled_at?: unknown;
  filledAt?: unknown;
}): string {
  const action = String(t.action ?? t.side ?? '').toLowerCase();
  const quantity = numOrNull(t.quantity ?? t.qty) ?? 0;
  const price = numOrNull(t.price) ?? 0;
  const at = String(t.executed_at ?? t.executedAt ?? t.filled_at ?? t.filledAt ?? '').slice(0, 19);
  return [String(t.symbol ?? '').toUpperCase(), action, quantity, price.toFixed(4), at].join('|');
}
