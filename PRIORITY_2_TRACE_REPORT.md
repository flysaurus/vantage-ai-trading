# Priority 2: Full Pipeline Trace Report
## August 1, 2026 — Ground Truth: Alpaca Paper = $101,794.23

---

## 🔴 CRITICAL DISCOVERY: THREE Parallel Data Paths (Not Two)

The codebase has **three completely independent code paths** loading Alpaca data into different state stores. Previous analysis only identified two.

| Path | State Store | Adapter Class | API Endpoints Used | Used By | Guarded? |
|------|-------------|---------------|-------------------|---------|----------|
| **A** | Zustand `usePortfolioStore` | `SnapTradeAdapter` (`lib/broker/snaptrade.ts`) | `/api/broker/snaptrade/account`<br>`/api/broker/snaptrade/positions`<br>`/api/broker/snaptrade/orders` | PortfolioTab for Alpaca | N/A (always runs) |
| **B** | React `liveAccount` (PortfolioContext) | `SnapTradeAdapter` (`lib/broker/snaptrade.ts`) | `/api/broker/snaptrade/account`<br>`/api/broker/snaptrade/positions` | PortfolioTab for Demo | ✅ `isShowingDemo` (added `ce3c961`) |
| **C** | React `liveAccount` (PortfolioContext) | `SnapTradeBroker` (`lib/broker/snaptrade-broker.ts`) | `/api/snaptrade/portfolio` → direct SnapTrade calls:<br>• `/authorizations/{id}/accounts`<br>• `/authorizations/{id}/accounts/{id}/holdings` | PortfolioTab for Demo | ❌ **NO guard — always runs once** |

### Path C: The Hidden Third Path (PortfolioContext lines 1273–1344)

```typescript
// context/PortfolioContext.tsx, lines 1273-1344
const snapInitDoneRef = useRef(false);
useEffect(() => {
  if (snapInitDoneRef.current) return;
  const uid = user?.id;
  if (!uid) return;
  // ...
  // Calls /api/snaptrade/portfolio → SnapTradeBroker
  // Sets setAccount(Alpaca data) WITH NO isShowingDemo check
  // snapInitDoneRef ensures this only runs ONCE
}, [user?.id]);
```

**This effect:**
- Has **NO `isShowingDemo` guard** — always sets `liveAccount` to Alpaca data on first mount
- Uses `snapInitDoneRef` — runs exactly once, never re-evaluates after tab switches
- Calls `/api/snaptrade/portfolio` → uses `SnapTradeBroker` (DIFFERENT implementation from Path A/B)
- `SnapTradeBroker` uses **deprecated** SnapTrade endpoints (v1 holdings, not v2 positions)

### Implementation Divergence: SnapTradeBroker vs SnapTradeAdapter

| Feature | SnapTradeBroker (Path C) | SnapTradeAdapter (Paths A/B) |
|---------|-------------------------|------------------------------|
| Type | `BrokerEngine` | `BrokerAdapter` |
| File | `lib/broker/snaptrade-broker.ts` | `lib/broker/snaptrade.ts` |
| Positions API | `/authorizations/{id}/accounts/{id}/holdings` (DEPRECATED v1) | `/api/broker/snaptrade/positions` → v2 `/positions/all` (upgraded `5e5a31b`) |
| Account API | Direct `snaptradeFetch` + `getAccountBalances()` | `/api/broker/snaptrade/account` → balances endpoint |
| Orders | **Hardcoded `[]`** (stub!) | `/api/broker/snaptrade/orders` → activities endpoint (fixed `86de8a7`) |
| Cache | 60-second in-memory cache for positions | No client-side cache |
| Provider | Server-side (`/api/snaptrade/portfolio`) | Client-side (`useBroker()` → adapter) |

---

## 🔍 DEMO CONTAMINATION: Root Cause

### Symptom
Demo shows: **total $101,794.23**, cash $98,682.13, invested $0.00 → gap $3,112.10

### Root Cause
**Path C always writes Alpaca data into `liveAccount` on first mount.**

**Sequence:**
1. **Initial load** (Alpaca tab visible, `isShowingDemo = false`):
   - Path C fires → `SnapTradeBroker.getAccount()` → `/api/snaptrade/portfolio` → `setAccount({ equity: 101794.23, cash: 98682.13, positions: possibly-empty })` → `liveAccount` = Alpaca data
   - Path B fires → same or similar data → no conflict
   - Path A fires → `brokerAccount` populated → used by PortfolioTab for Alpaca ✅

2. **User switches to Demo** (`isShowingDemo = true`):
   - Path B returns early (guarded) ✅
   - Path C **already ran** (`snapInitDoneRef = true`) — data persists in `liveAccount` ❌
   - Path A still fetches but PortfolioTab now uses `liveAccount`

3. **Demo-init effect fires** (triggered by `isShowingDemo` change):
   - `refreshStateFromBroker()` → DemoBroker → sets `demoState` → triggers `fetchData` → `recomputeAccount` → **eventually** `setAccount(demo data)` 
   - **Race condition**: If `refreshStateFromBroker()` is slow (Supabase load, network), `liveAccount` STILL has Path C's Alpaca data

4. **The inconsistency** ($101,794.23 ≠ $98,682.13 + $0.00):
   - PortfolioTab computes `displayAccount = liveAccount` (for Demo)
   - `liveAccount.equity` = $101,794.23 (Path C's leftover from step 1)
   - `liveAccount.cash` = $98,682.13 (Path C's leftover)
   - PortfolioTab computes `invested = positions.reduce(...)` = $0 (positions empty from Path C)
   - UI: total $101,794.23 but cash only $98,682.13 and invested $0 ❌

### Why the `ce3c961` fix didn't fully resolve it

The cross-contamination fix added `isShowingDemo` guards to Path B (broker-load effect) and fixed the demo-init guards. But it **missed Path C entirely**. Path C's SnapTrade init effect was invisible because it uses `snapInitDoneRef` instead of reactive deps.

---

## 🔴 ALPACA $0: Diagnosis

### Expected flow (should show $101,794.23):
Path A → `usePortfolio()` → `broker.getAccount()` → `/api/broker/snaptrade/account` → SnapTrade balances → `setAccount({ equity: 101794.23 })` → `brokerAccount` populated

### Possible breakage points (ordered by likelihood):

**1. BrokerProvider `checkStatus()` returns non-connected after Priority 1 cleanup (HIGH)**
The status route (`/api/broker/status`) was cleaned up in `2548742` — Vault fallback removed, only SnapTrade DB query remains. If this query fails (wrong column name, RLS issue, env var missing), `isConnected` stays `false` and `usePortfolio()` never fetches.

**Check**: `/api/broker/status` response — should return `{ connected: true, brokerId: 'snaptrade', underlying_broker: 'ALPACA-PAPER' }`

**2. `clearAccount()` + `refresh()` race (MEDIUM)**
Zustand's `clearAccount()` fires on `isConnected` change, setting account to null. `refresh()` fires right after. If `refresh()` fails (API error, network), account stays null → PortfolioTab shows $0 zero-fallback.

**Check**: Console will show any fetch errors. The `account` route hasn't changed since `b651bdd` when it was confirmed working ($101,794.23).

**3. API route error on production (LOW)**
The `/api/broker/snaptrade/account` route reads encrypted credentials from Supabase. If the `SUPABASE_SERVICE_ROLE_KEY` is missing/invalid in Vercel, the query returns null → route returns `{ equity: 0, cash: 0 }`.

**Check**: Vercel function logs for `/api/broker/snaptrade/account` — any error would be logged.

### Immediate diagnostic: Add error visibility
Currently, silent API failures in `usePortfolio()` leave the account at `null` with no user feedback. The `clearAccount()` + `refresh()` pattern creates a transient null that becomes permanent on failure.

---

## 📊 ORDERS PIPELINE TRACE

| Data Type | Demo Path | Alpaca Path | Status |
|-----------|-----------|-------------|--------|
| Orders | PortfolioContext `demoOrders` → bridge effect → Zustand `useOrderStore` | `useOrders()` → `SnapTradeAdapter.getOrders()` → `/api/broker/snaptrade/orders` → SnapTrade activities | ✅ `86de8a7` + `cce5910` |
| Positions | PortfolioContext `liveAccount.positions` (from DemoBroker) | `usePortfolio()` → Zustand `brokerAccount.positions` (from v2 endpoint) | ✅ `5e5a31b` |
| Account | PortfolioContext `liveAccount` (from recomputeAccount) | `usePortfolio()` → Zustand `brokerAccount` (from balances endpoint) | ⚠️ Possibly silently failing |

**Note**: `SnapTradeBroker.getOrders()` (Path C) returns hardcoded `[]` — but this isn't used for order display. `useOrders()` uses SnapTradeAdapter (Path A).

---

## ✅ Git Sanity Check

No fixes were reverted across commits `d5d50de` through `2548742`. All fixes are cumulative:

| Commit | What | Status |
|--------|------|--------|
| `d5d50de` | Rebase, broker-load effect | Base |
| `40eca12` | BrokerProvider tradingEnabled | Intact |
| `4eccb05` | Cross-account contamination | Intact |
| `a7296a5` | 100K fallback kill for broker | Intact |
| `e08db8d` | Zustand stale wipe | Intact |
| `86de8a7` | Demo orders race + orders stub | Intact |
| `cce5910` | Stale closure useOrders | Intact |
| `b651bdd` | Env var name fix | Intact |
| `ce3c961` | Cross-contamination (Paths B only) | Intact |
| `0d18c4b` | localStorage wipe removal | Intact |
| `5e5a31b` | Positions v2 upgrade | Intact (but only in Path A/B routes!) |
| `2548742` | Priority 1 raw-key removal | Intact |

---

## 🎯 CONSOLIDATED FIX PLAN

### Fix 1: Remove Path C (SnapTrade init effect)
**Delete lines 1273–1344** from `context/PortfolioContext.tsx` — the entire SnapTrade init effect.

**Why**: Path C is a legacy server-side SnapTrade integration that:
- Contaminates `liveAccount` with broker data (no `isShowingDemo` guard)
- Uses deprecated v1 SnapTrade endpoints
- Has hardcoded empty orders
- Duplicates functionality already in Path A (Zustand) and Path B (guarded broker-load)
- Cannot be fixed incrementally (using `SnapTradeBroker` not `SnapTradeAdapter`)

**Migration**: Move `brokerSource` and `brokerMeta` setting to Path B (broker-load effect, lines 535–584).

### Fix 2: Add error logging to usePortfolio()
Add `console.error` when `broker.getAccount()` or `broker.getPositions()` fail in `hooks/usePortfolio.ts`, so silent failures are visible in browser console.

### Fix 3: Add retry/visible error state
When `brokerAccount` is null but `isConnected` is true (data expected but missing), show a "loading" or "retry" state instead of blank $0.

### Fix 4 (optional): Audit status route
Verify `/api/broker/status` correctly returns `connected: true` after Priority 1 cleanup (Vault fallback removal). If this fails, Path A never triggers.

---

## 🔒 PRIORITY 3 PREVIEW: Security Audit Scope

### SnapTrade userSecret storage chain:
1. **At rest**: Encrypted via `lib/vault.ts` (AES-256-GCM) in `broker_connections.snaptrade_user_secret_encrypted`
2. **Key management**: Encryption key stored in `SUPABASE_SERVICE_ROLE_KEY` env var
3. **Transit**: Decrypted only server-side in API routes (`requireAuth` authenticated)
4. **RLS**: Supabase Row-Level Security on `broker_connections` table
5. **Leak paths**: Could `userSecret` appear in:
   - Client-side bundles?
   - Error messages/logs?
   - Network requests (devtools)?
   - SnapTrade API calls (should only be query params)?
6. **Gap analysis**: OWASP Top 10, key rotation, audit logging

Full audit pending Priority 2 fix deployment.
