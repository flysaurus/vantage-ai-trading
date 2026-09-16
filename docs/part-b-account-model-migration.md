# Part B — Account-model migration plan (REVIEW ONLY — not executed)

Status: **audit complete + plan written, NO DDL run.** Held for Em's review.
Rev 3 (2026-09-16): Em's decisions locked in — **3b approved** (own commit, own tests, flagged), **1:1
heuristic declined permanently** (strict `NULL` + report forever). **Step 1 DDL authored** as
`supabase/migrations/077_broker_accounts.sql` (+ `supabase/verify-077-broker-accounts.sql`) and
**awaiting Em's SQL-editor run** — this environment has no DB/DDL access (no `SUPABASE_ACCESS_TOKEN`,
no connection string), same as every earlier migration.
Rev 2 (2026-09-16): addresses Em's three review points — (1) explicit dual-read contract,
(2) the backfill gap for shared-login accounts, (3) wash-sale checker removed from §6 + stale §7
question dropped. **Still no DDL run.**
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
5. **Wash-sale blind spot (item 3 verification) — CLOSED at the read path; kept here because the
   data model is what forced the workaround.** The repurchase window read only `orders`, which is
   **empty for non-trading connections**, so a repurchase in a connected-but-not-trading account
   (Fidelity) could never be seen. Fixed by the item-3 union (`unionBuyFills()`, commit `d6d7239`):
   the checker now reads `orders` ∪ `trade_history` and is intentionally **taxpayer-wide /
   cross-connection**. ⚠️ It is **NOT** in the §6 conversion list — see §6 for why scoping it to an
   account would re-open this exact blind spot.

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

Derived tables gain a nullable account-scope FK: `positions`, `orders`, `trade_history`
**and** `position_lots`.

⚠️ **Correction (Rev 3, verified in `058_baskets_lots.sql` line 57):** `position_lots.account_id` is
already `UUID REFERENCES broker_connections(id)` — it is the **connection** scope, not a legacy
text string. Retargeting it to `broker_accounts` would be a rename/retype (**not additive**) and
would break every FIFO writer (`lib/fifo-ledger.ts` writes connection ids into it). So the account
FK lands as a **separate nullable column `position_lots.broker_account_id`**; both columns coexist
until the later swap step. What the other three tables need is genuinely new (`account_id`).

## 4. Migration (staged, each step independently revertible)

1. **DDL (additive only, no drops).** `CREATE TABLE broker_accounts …`, add
   `account_id uuid NULL REFERENCES broker_accounts(id)` to the 4 derived tables,
   add indexes `(account_id)`, `(user_id, account_id)`. **No backfill in this step.**
2. **Backfill `broker_accounts`** from each connection's `snaptrade_accounts` JSONB
   (idempotent upsert on `snaptrade_account_id`).
3. **Backfill `account_id`** on derived rows by matching a per-row account discriminator.
   ⚠️ **No such discriminator exists today — see “Backfill reality” below.** Rows that cannot be
   attributed stay `NULL` and are **reported, never guessed**.

   ### Backfill reality (verified live 2026-09-16, read-only REST)

   | table | per-row account field? | live state |
   |---|---|---|
   | `positions` | **none** — `id,user_id,symbol,qty,avg_cost,current_price,market_value,unrealized_pnl,unrealized_pnl_pct,sector,industry,name,is_demo,updated_at,created_at,connection_id` | 51 rows: 26 Alpaca + **25 Fidelity**, all connection-scoped |
   | `orders` | **none** — only `connection_id` (plus free-text `source`/`origin`) | 139 rows: 138 Alpaca + 1 null |
   | `trade_history` | **none** — only `connection_id`; `notes` is `NULL` on every sampled row | 4,157 rows: 4,081 Fidelity + 75 Alpaca + 1 null |
   | `position_lots` | `account_id` **exists** but holds the **connection** id (`ae013e41-…`), not a SnapTrade account id | 28 rows: 26 = connection id, 2 NULL |

   ⇒ **Consequence, stated explicitly (was implicit): backfill cannot split Fidelity's two
   accounts.** Every Fidelity `positions` / `trade_history` row stays `NULL` and remains on the
   legacy connection-scoped fallback **indefinitely**. The original aggregation bug is therefore
   *not* remedied by this migration's data step — what protects those rows is the **Part A
   read-path scoping** (which already refuses to sum a connection) plus the server's ambiguity
   refusal. That is an acceptable outcome; it just must not be sold as “the two-account case gets
   split by backfill”.
   - A **1:1 connection** (Alpaca: exactly one account) *could* be attributed deterministically
     **at backfill time** — but the mapping can change later (adding a 2nd account to that login
     makes the old rows' true owner unknowable). Treat as a **heuristic requiring an explicit Em
     ruling**; default stays `NULL` + report.
   - **Coverage can only improve going forward**, and only if the *writer* stamps `account_id`
     (step 3b). Without 3b, a NULL-coverage table stays NULL forever.

   3b. **(NEW — proposed) Stamp `account_id` at write time** in the sync/write paths
   (`/api/positions/sync`, `/api/db/trade-history/create`, the FIFO ledger lot writes) once the
   active account is resolved. ⚠️ **Write-capable** (INSERT/UPDATE into derived tables) — must be
   flagged per the standing rule. Without 3b, step 4's dual-read has nothing new to read and no
   feature flip ever reaches `NOT NULL` coverage.

4. **Dual-read.** Read paths resolve `account_id` when present, else fall back to the **current**
   connection-scoped behaviour. This is the long pole and is feature-by-feature.
   - 🔒 **Explicit contract (Em's point 1):** the fallback **calls the existing scoped functions
     unchanged** — `getAccount()`, `getPositions()`, `getOrders()` in `lib/broker/snaptrade.ts`
     (already scoped by `connectionId` + `snapAccountId`, and **keeping the ambiguity refusal
     exactly as-is** — `SnapTradeAmbiguousError`, `status = 409`, in `lib/snaptrade/client.ts`).
     It is **not a re-implementation**, and it must not
     duplicate the scope-building logic: there is one implementation, and step 4 only *chooses*
     between “read the new `account_id`” and “call today's function”.
5. **Flip** feature-by-feature once a feature reads cleanly with `account_id NOT NULL`
   coverage; only then stop falling back.
6. **Drop** the legacy scope strings / JSONB reliance (separate, later change).

## 5. Rollback

Every step is additive, so rollback is `DROP COLUMN account_id`, `DROP TABLE broker_accounts`
— no data loss for the current app (it never wrote them). Steps 2–3 are pure INSERT/UPDATE
into new columns and are re-runnable. Step 5's read-flip is a code revert, not a data op.

## 6. Feature scope to convert (dual-read → account-scoped)

trading capability · tax-lot (FIFO) reconstruction · analyst-consensus
resolution · Portfolio Health · chart data resolution · daily/weekly brief context · the
"Rufus Noticed" rollup · account switcher + `/api/accounts` enumeration.

❌ **`wash-sale checker` is deliberately NOT in this list (Em's point 3, approved).** The wash-sale
rule is **taxpayer-wide**, not account-scoped: a repurchase in *any* connected account can trigger
it. Item 3's union fix (`unionBuyFills()`, commit `d6d7239`; live-proven across SPAXX/FDRXX/WDC/
WELL/WFC; TLH route reuses the same helper, `a5eafad`) made the checker read `orders` ∪
`trade_history` across **all** connected accounts. Scoping it to a single `account_id` would
re-open the exact blind spot that fix closed (§2.5). It stays cross-connection **by design**, and
nothing in Part B should narrow its read scope.

## 7. Risks / open questions (need a decision before step 1)

- ~~**0-rows-Fidelity**: is the fix “ingest `trade_history` → `orders` for non-trading
  connections”, or “wash-sale reads `trade_history`”, or both?~~ **RESOLVED — question dropped
  (stale).** The item-3 union already reads `trade_history` (`unionBuyFills()`, `d6d7239`) with
  **no** backfill into `orders` (Em's ruling: structurally different records, no conflation).
  Live proof passed 5/5. Nothing about trade_history ingestion remains open.
- **Backfill attribution** (§4.3) — ✅ **DECIDED, permanently: strict `NULL` + report.** Em declined
the 1:1-connection heuristic **for good**, not just for now: 3b gives new rows a real `account_id`
so inference is unnecessary, and inferring ownership today because the mapping *happens* to be 1:1
is the same shape of assumption that produced the original bug — if Alpaca ever gains a second
sub-account, a heuristic written today would be silently wrong.
- **Writer stamping** (§4.3b) — ✅ **APPROVED.** Own commit, **not** bundled with the DDL/backfill
work. `account_id` must come from the **same resolved active-account context the read path already
uses** (`snapAccountId` / `scopedUrl()`) — never independently re-derived from the payload. Its own
tests, its own review, flagged write-capable.
- **Migration status** — `supabase/migrations/077_broker_accounts.sql` authored (additive, idempotent,
`BEGIN/COMMIT`, RLS-on-no-policies like 076, **no backfill**: table starts empty and all new columns
stay NULL). Verify with `supabase/verify-077-broker-accounts.sql` after applying.
- Do closed/archived accounts keep rows (needed for tax history) or purge? Interacts with
  Part A-2 delete semantics.
- `position_lots.account_id` type change (text → uuid) needs a cast plan for live rows.
- Per-account delete (Part B-2) becomes trivial once `broker_accounts` owns the cascade.

**Nothing here runs until you approve it.**
