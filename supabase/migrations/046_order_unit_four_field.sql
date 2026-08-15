-- 046_order_unit_four_field.sql
-- Four-field requested-vs-filled order model.
--
-- Adds a denomination flag (order_unit) and two independent "requested" columns
-- so a dollar-based (notional) order can show its AUTHORITATIVE dollars plus a
-- LABELED share estimate, and a share-based order can show the inverse.
--
--   order_unit       'dollars' | 'shares'  — which field the user actually specified
--   requested_amount dollars                  — authoritative when order_unit='dollars'
--   requested_qty    shares                   — authoritative when order_unit='shares'
--
-- filled_qty / filled_price already exist and are ALWAYS real broker data.
-- filled_amount is computed (filled_qty × filled_price), not stored.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_unit text CHECK (order_unit IN ('dollars', 'shares')),
  ADD COLUMN IF NOT EXISTS requested_amount numeric,
  ADD COLUMN IF NOT EXISTS requested_qty numeric;

-- ── Backfill existing rows ──────────────────────────────────
-- Dollar orders: notional is authoritative → order_unit='dollars',
-- requested_amount = notional, requested_qty = qty (share estimate).
UPDATE public.orders
SET order_unit = 'dollars',
    requested_amount = notional,
    requested_qty = qty
WHERE (notional IS NOT NULL AND notional > 0);

-- Share orders: qty is authoritative → order_unit='shares',
-- requested_qty = qty, requested_amount = derived estimate (null when no price).
UPDATE public.orders
SET order_unit = 'shares',
    requested_qty = qty,
    requested_amount = CASE
      WHEN filled_price IS NOT NULL AND filled_price > 0
        THEN ROUND(qty * filled_price, 2)
      ELSE NULL
    END
WHERE order_unit IS NULL;
