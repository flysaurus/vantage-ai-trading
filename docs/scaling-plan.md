# Vantage Scaling Plan — Multi-Tenant Broker Data

**Status:** PLAN ONLY — nothing here is implemented. This documents the work needed to scale the current single-user design toward ~1,000 users × ~3 brokers each, plus the known gaps that come with it.

**Owner:** Em (decides when/if to build). **Last updated:** Aug 27, 2026.

---

## 1. Context / current state

Today Vantage is effectively single-user (one live `broker_connections` row + one demo user). The broker data path is:

- **SnapTrade aggregator** (multi-tenant): broker credentials/OAuth live on SnapTrade's infra. Vantage stores only a per-user `userId` + `userSecret` (HMAC-signs API calls) + `connection_id`. Per-user broker secret is AES-256-GCM encrypted at rest.
- **Polling** refreshes positions/orders: account route ~30s, demo `fetchData` ~60s, `MarketOverview` ~60s, basket quotes ~60s (client) + `fetchFinnhubQuotes` (server, 15s per-symbol module cache).
- **Order fills** are discovered by polling only — SnapTrade does **not** emit execution webhooks (its webhook is connection-lifecycle only).
- **Crons** (`vercel.json` / scheduled routes): `sync-orders` already fans out over all in-flight orders grouped by `user_id|connection_id`. Others are user-scoped and need multi-user audit.

---

## 2. Rate limiting / throttling

**Problem:** No per-user rate limit on broker/SnapTrade routes. `withRateLimit` exists in `lib/middleware/auth.ts` but is **not wired** to broker/connections endpoints. At 1,000 users each polling every 30–60s, SnapTrade + Finnhub get hammered.

**Plan:**
1. Wire `withRateLimit` (or a Redis/Upstash-backed limiter) onto:
   - `/api/broker/snaptrade/*` (account, positions, orders, portfolio)
   - `/api/connections/*` (start, init, callback)
   - `/api/snaptrade/*`
2. Per-user (by `auth.uid`) AND per-IP buckets. Tune ceilings below SnapTrade's stated limits (SnapTrade has its own rate limits; confirm current plan tier).
3. Return `429` + `Retry-After`; client should back off (exponential) rather than error.
4. Consider a global concurrency cap on broker fetches (e.g., p-limit / semaphore of N in-flight SnapTrade calls).

---

## 3. Finnhub (60 req/min free tier) — global caching

**Problem:** `lib/finnhub-quote.ts` uses a **per-instance module-level 15s TTL cache**. Serverless instances don't share memory → N cold instances × M symbols can trip Finnhub's 60 req/min free tier instantly at scale.

**Plan:**
1. Move the quote cache to a **global store** (Upstash Redis, or a Postgres-backed cache with a short TTL), keyed by symbol, so all instances share one dedupe layer.
2. Batch quote calls: one request per symbol set (Finnhub supports `/quote?symbol=X` per symbol; if a batch endpoint exists on the paid tier, use it). Otherwise single-flight per symbol globally.
3. If live quotes aren't strictly required for every poll, increase TTL (15s → 60s+) for low-frequency UI.
4. Track Finnhub usage with a counter; alert on approaching the tier limit. Consider the paid tier once volume justifies it.

---

## 4. Polling scale

**Problem:** Each connected user triggers recurring polls. 1,000 users × 3 brokers × (30s account + 60s demo + 60s market + 60s basket) is a large, mostly-idle load.

**Plan:**
1. **Server-driven refresh, not per-client.** Move polling into scheduled jobs (`sync-orders`, a new `sync-positions` cron) that fan out over users, instead of every open browser tab polling independently.
2. **Websocket/SSE push** for live updates to connected clients, replacing client-side intervals.
3. **Stagger** per-user refresh offsets (hash user id → phase) to smooth load.
4. **Idle detection:** pause polling for users with no active session in the last N minutes.

---

## 5. Cron fan-out audit (multi-user correctness)

**Problem:** Several crons are user-scoped or assume a single "current" user; they need to be confirmed to iterate over all users safely.

**Plan (audit each):**
- `sync-orders` — already groups by `user_id|connection_id` ✅ (re-verify edge cases: deleted users, broken connections).
- `portfolio-agent` — verify it resolves each user's connection independently; add per-user error isolation.
- `send-agent-digest` — same; ensure no cross-user data bleed in digest content.
- `investor-score` — confirm scoring keys on `user_id`.
- `drawdown-check` — confirm thresholds are per-user.
- `execute-pending-orders` — add per-user rate/spend guards and idempotency (already order_id-keyed? verify).

**General rule for all crons:** fail **per-user** (log + skip + continue) — never let one user's error abort the whole batch.

---

## 6. Connection expiry / re-auth flow

**Problem:** `getOrCreateSnapTradeUser` **re-registers a new SnapTrade user on decrypt failure**. With the HKDF migration this is now unlikely, but any future key/migration mistake, or a user whose connection lapsed, triggers a re-register storm (mass re-registration, orphaned `connection_id`s).

**Plan:**
1. Make decrypt failure a **hard, logged error** in production (no silent re-register). Surface "reconnect your broker" to the user instead.
2. Track connection health: use the existing SnapTrade webhook (`CONNECTION_BROKEN`/`FIXED`/`DELETED`) to mark `broker_connections.status` and pause polling for broken connections.
3. Add a **re-auth flow**: on `CONNECTION_BROKEN`/auth failure, prompt the user to re-run OAuth (SnapTrade connection can be refreshed via login link).
4. Add per-user reconnect backoff (don't hammer SnapTrade for a user whose broker revoked access).

---

## 7. ⚠️ Key-rotation blast radius (documented known gap)

**Problem:** All per-user broker secrets (and now TOTP secrets) are encrypted with a per-user key derived from a **single master key** `VAULT_ENCRYPTION_KEY`.

- **Losing** `VAULT_ENCRYPTION_KEY` = cannot decrypt any `snaptrade_user_secret_encrypted` → **every user loses broker connectivity** (and TOTP breaks), with no recovery short of re-OAuth for every user.
- **Rotating** the key = must re-encrypt every encrypted row (SnapTrade secrets + TOTP) under the new key, atomically, with the old key still available during the transition.

**Plan (when rotation is ever needed):**
1. Support a **key envelope / versioned keys**: store `key_id` alongside ciphertext, allow multiple active master keys, decrypt with the matching version.
2. **Re-encryption job**: iterate all rows, decrypt with old key, encrypt with new key, with a dual-read window (read old, write new) so the app never drops a credential.
3. **Backup the master key** in a secrets manager (Vercel env + a secure off-platform store); document rotation runbook.
4. **Decrypt-on-read-only** semantics: never cache plaintext secrets; derive per-user keys on demand (already the case).

**This is a known gap, not a bug in the current single-user deployment — but it becomes a hard requirement before multi-tenant production.**

---

## 8. Additional security notes (carried from audit)

- `users.totp_secret` was plaintext → **fixed** (encrypted at rest, HKDF). ✅
- `lib/vault.ts` hardcoded `dev-encryption-key-change-me` fallback → **removed** (throws now). ✅
- `snaptrade_user_secret_encrypted` client SELECT → **revoked** via migration `064` (needs Em to apply DDL). ⏳
- Legacy `vault` table (0 rows) + `/api/db/vault/*` routes + `lib/supabase/vault.ts` are dead-but-wired → consider deleting to reduce attack surface.

---

## Suggested build order (when Em greenlights)

1. Global Finnhub cache + per-user rate limiting (highest immediate risk at scale).
2. Server-driven polling / stagger + cron fan-out audit.
3. Connection health + re-auth flow (removes re-register storm).
4. Key versioning/rotation + master-key backup (prereq for multi-tenant production).
