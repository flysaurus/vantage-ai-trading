# Part B — Account-model migration plan (REVIEW ONLY — not executed)

Status: **audit complete + plan written, NO DDL run.** Held for Em's review.
Owner: Rufus · written 2026-09-16 · scope: connections → accounts normalisation.

This is the root-cause fix behind items **1** (slow/failed first load), **2** (deleted
account's data surfacing) and **4** (multi-account display/switch) — each of those was
patched at the read path because the data model has no first-class account row.

---

## 1. What the live schema actually is (verified via REST, 2026-09-16)

`broker_connections` — one row per **broker login**, not per account:

```
id, user_id, connection_type, brokerage_slug, status,
snaptrade_connection_id, snaptrade_user_id, snaptrade_user_secret_encrypted,
snaptrade_accounts (JSONB), trading_enabled, sync_started_at, sync_completed_at,
error_message, created_at, updated_at
```

- **There is no `accounts` table** (`/rest/v1/accounts` → 404).
- **Connection and account are conflated.** One SnapTrade login legitimately exposes
  many accounts; they are currently only a JSONB array on the connection row.
- `positions`, `orders`, `trade_history` are keyed by **`connection_id`** (connection-level).
  Verified: `orders` holds 138 rows, **all** from the Alpaca connection — the connected
  Fidelity login has **0** rows (it is `trading_enabled = false`, so Vantage never places
  orders there; its activity is imported into `trade_history` only).
- `position_lots.account_id` already carries a scope **string**, but live values are the
  **connection** id (`ae013e41-…`), not the 3-part canonical id.

Live rows for the real user (3 logins, 3 accounts):

| login | slug | status | trading_enabled | accounts in JSONB |
|---|---|---|---|---|
| `ae013e41-…` | ALPACA-PAPER | connected | true | 1 |
| `0bf72384-…` | FIDELITY | connected | false | 2 (Taxable SMA + ANIKET-YOUTH) |
| `8c502621-…` | ETRADE | pending | null | 0 |

## 2. Bugs this model causes (all observed, not theoretical)

1. **Aggregation leak (item 2 walkthrough).** Fidelity's two accounts share one connection
   row, so any query scoped only by `connection_id` sums both — the deleted "Aniket Youth"
   balance appears inside the standalone "Taxable SMA" view ($400,355 total). Patched by
   threading a `snapAccountId` through the broker adapter + account/positions routes.
2. **First-load latency (item 1).** `1 + N` sequential live SnapTrade calls for one login
   are unbounded; patched with an 8 s timeout + 30 s snapshot fallback.
3. **Ambiguous "active account".** With N accounts per row, "the account" is undefined, so
   every feature re-invents a rule (first-wins / sum / snapshot) — the source of items 1, 2, 4.
4. **No cascade on delete.** Derived rows are connection-scoped, so deleting one account
   inside a login is impossible (Part B-2 — correctly blocked on this work).
5. **Wash-sale blind spot (item 3 verification).** The repurchase window reads `orders`,
   which is **empty for non-trading connections**, so a repurchase in a connected-but-not-
   trading account (Fidelity) can never be seen. Cross-connection widening alone does not fix it.

## 3. Target model (additive)

```
broker_connections      -- 1 login (unchanged meaning; still the auth/secret owner)
  └── broker_accounts   -- 1 row per sub-account
        id                     uuid pk
        connection_id          fk → broker_connections(id) on delete cascade
        snaptrade_account_id   text  UNIQUE            -- upstream id
        name / type / currency
        is_default             bool
        status ('open'|'closed'|'archived')
        raw                    jsonb (last seen snapTrade payload)
        created_at / updated_at
```

Derived tables gain a nullable `account_id` FK: `positions`, `orders`, `trade_history`,
`position_lots` (`position_lots.account_id` changes type text → uuid fk, from the legacy
connection-id string).

## 4. Migration (staged, each step independently revertible)

1. **DDL (additive only, no drops).** `CREATE TABLE broker_accounts …`, add
   `account_id uuid NULL REFERENCES broker_accounts(id)` to the 4 derived tables,
   add indexes `(account_id)`, `(user_id, account_id)`. **No backfill in this step.**
2. **Backfill `broker_accounts`** from each connection's `snaptrade_accounts` JSONB
   (idempotent upsert on `snaptrade_account_id`).
3. **Backfill `account_id`** on derived rows by matching the legacy connection-scope string
   / `snaptrade_account_id` in the row payload; rows that can't be attributed stay `NULL`
   and are reported, never guessed.
4. **Dual-read.** Read paths resolve `account_id` when present, else fall back to the
   current connection-scoped behaviour. This is the long pole and is feature-by-feature.
5. **Flip** feature-by-feature once a feature reads cleanly with `account_id NOT NULL`
   coverage; only then stop falling back.
6. **Drop** the legacy scope strings / JSONB reliance (separate, later change).

## 5. Rollback

Every step is additive, so rollback is `DROP COLUMN account_id`, `DROP TABLE broker_accounts`
— no data loss for the current app (it never wrote them). Steps 2–3 are pure INSERT/UPDATE
into new columns and are re-runnable. Step 5's read-flip is a code revert, not a data op.

## 6. Feature scope to convert (dual-read → account-scoped)

trading capability · wash-sale checker · tax-lot (FIFO) reconstruction · analyst-consensus
resolution · Portfolio Health · chart data resolution · daily/weekly brief context · the
"Rufus Noticed" rollup · account switcher + `/api/accounts` enumeration.

## 7. Risks / open questions (need a decision before step 1)

- **0-rows-Fidelity** finding above: is the fix "ingest `trade_history` → `orders` for
  non-trading connections", or "wash-sale reads `trade_history`", or both?
- Do closed/archived accounts keep rows (needed for tax history) or purge? Interacts with
  Part A-2 delete semantics.
- `position_lots.account_id` type change (text → uuid) needs a cast plan for live rows.
- Per-account delete (Part B-2) becomes trivial once `broker_accounts` owns the cascade.

**Nothing here runs until you approve it.**
