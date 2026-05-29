# QA Test Plan — Vantage Broker Connection Feature

**Version:** 1.0  
**Date:** 2026-05-29  
**Feature:** Multi-broker connection with vault-backed encrypted credential storage  
**Plan Reference:** `BROKER_CONNECTION_PLAN.md`

---

## Pre-Execution Baseline (Current State)

Before implementation begins, here's what QA sees in the current codebase:

| File | Current Issue / Observation |
|------|---------------------------|
| `lib/vault.ts` | Uses pgcrypto RPCs — sends plaintext to DB for encryption (violates app-side-encrypt principle) |
| `app/api/db/vault/save/route.ts` | Uses `crypto-js` (to be replaced), pgcrypto RPC pattern |
| `app/api/db/vault/get/route.ts` | RETURNS DECRYPTED CREDENTIALS TO CLIENT — critical security issue |
| `lib/supabase/vault.ts` | Client-side vault operations — callable from browser |
| `app/page.tsx` | Hardcoded `brokerId="alpaca"` with `environment: 'paper'` |
| `components/settings/SettingsTab.tsx` | Static `BROKERS` array with hardcoded statuses — not dynamic |
| `package.json` | `crypto-js` listed as dependency (must verify it's removed from new code) |
| `supabase/schema.sql` | `vault` table lacks `broker_id`, `credentials`, `credential_hash`, `is_connected`, `connected_at` columns |

---

## 1. Unit Tests (Automated Checks)

### UT-1: encryptData / decryptData Roundtrip
**File:** `lib/crypto.ts`  
**Test:** Encrypt a string, then decrypt it — result must equal original.  
**Variants:**
- Plain text roundtrip
- Long JSON blob roundtrip (simulating credentials object)
- Empty string
- Special characters / unicode (emoji, CJK)
- Verify encrypting the same plaintext twice produces different ciphertexts (unique IVs)

### UT-2: deriveUserKey Determinism
**File:** `lib/crypto.ts`  
**Test:** Call `deriveUserKey(userId)` twice with the same `userId` and same `VAULT_ENCRYPTION_KEY` — outputs must be identical.
**Variants:**
- Different userIds produce different keys
- 32-byte output (AES-256 requirement)

### UT-3: encryptData with deriveUserKey
**File:** `lib/crypto.ts` + `lib/vault.ts`  
**Test:** Use `deriveUserKey(userId)` as the key for `encryptData`, then decrypt with `deriveUserKey(sameUserId)` — must succeed.
**Negative:** Use different userId key — decryption must fail.

### UT-4: vault storeCredentials → getCredentials → clearCredentials
**File:** `lib/vault.ts`  
**Test:** 
1. Store credentials with `storeCredentials(userId, brokerId, credentials)`
2. Retrieve with `getCredentials(userId)` — must return matching data
3. Clear with `clearCredentials(userId)` — must succeed
4. Retrieve again — must return null/empty

### UT-5: vault API — save route returns success
**File:** `app/api/db/vault/save/route.ts`  
**Test:** POST valid payload → 200 with `{ success: true }`  
**Negative:** POST with missing fields → 400

### UT-6: vault API — get route returns status WITHOUT credentials
**File:** `app/api/db/vault/get/route.ts`  
**Test:** GET → response must NOT include decrypted `apiKey`, `secretKey`, or any credential data  
**Test:** GET → response includes `{ connected: true/false, brokerId, hasCredentials: true/false }`  
**Verify:** No route in the entire app returns decrypted credentials to the client

### UT-7: BrokerAdapter Interface Compliance
**File:** `types/broker.ts` + all adapters  
**Test:** Every broker adapter class (`AlpacaAdapter`, `TastytradeAdapter`) must:
- Implement ALL methods in `BrokerAdapter` interface
- Have `readonly id: BrokerId`  
- Have `readonly name: string`  
- TypeScript compilation must not produce errors for adapter files

### UT-8: All New API Routes Require Authentication (401)
**Files:** All new routes in `app/api/broker/*`  
**Test:** Send request to each new route WITHOUT Authorization header → 401  
**Routes to test:**
- `POST /api/broker/connect` → 401
- `POST /api/broker/disconnect` → 401
- `GET /api/broker/status` → 401
- `GET /api/broker/session` → 401
- `GET /api/broker/proxy/[...path]` → 401

### UT-9: Vault API routes require authentication (401)
**Files:** `app/api/db/vault/save/route.ts`, `app/api/db/vault/get/route.ts`  
**Test:** Same as UT-8 — confirm vault routes are not world-readable

---

## 2. Smoke Tests (Build + Basic Load)

### SMK-1: `npm run build` succeeds with zero errors
```bash
cd /root/.openclaw/workspace/projects/vantage && npm run build 2>&1
```
- Exit code must be 0
- No TypeScript errors in build output
- No "Module not found" errors
- No Next.js compilation errors

### SMK-2: No TypeScript errors in strict mode
```bash
npx tsc --noEmit 2>&1
```
- Zero errors

### SMK-3: Main page loads without console errors
- Navigate to `/` in browser
- DevTools console: zero red errors
- No 400/500 API responses in Network tab
- `AppShell` renders correctly

### SMK-4: Login page loads
- Navigate to `/login`
- Form renders
- No console errors

### SMK-5: Onboarding modal opens/closes
- Fresh user → InvestorStyleOnboarding appears
- Can select a style and proceed
- Modal UI works correctly (buttons, transitions)

### SMK-6: `/security` page loads
- Navigate to `/security`
- Page renders with security messaging content
- No console errors
- Page is accessible without login (public info page)
- No implementation details exposed in HTML

### SMK-7: All existing pages still load
- `/earnings-calendar` → renders
- `/news-feed` → renders  
- `/stock-screener` → renders
- `/trade-history` → renders
- `/watchlists` → renders
- `/price-alerts` → renders
- `/investor-style` → renders
- No broken imports or blank screens

---

## 3. Integration Tests

### INT-1: Full Connect Flow
1. Authenticate as user
2. `POST /api/broker/connect` with `{ brokerId: 'alpaca', credentials: { apiKey: '...', secretKey: '...' }, environment: 'paper' }`
3. Response: `{ connected: true, accountPreview: { id, equity, buyingPower, status } }`
4. Verify: credentials stored encrypted in vault DB (check `credentials` column is NOT plaintext)
5. Verify: `credential_hash` column populated

### INT-2: Broker Status Flow
1. Connect broker (INT-1)
2. `GET /api/broker/status`
3. Response: `{ connected: true, brokerId: 'alpaca', accountPreview: {...}, marketOpen: true/false }`
4. Response must NOT contain `apiKey`, `secretKey`, or `credentials`
5. Disconnect broker
6. `GET /api/broker/status` → `{ connected: false }`

### INT-3: Disconnect Flow
1. Connect broker (INT-1)
2. `POST /api/broker/disconnect` with `{ brokerId: 'alpaca' }`
3. Response: `{ success: true }`
4. Verify vault: `credentials`, `credential_hash` columns are NULL/empty
5. Verify vault: `is_connected = false`
6. `GET /api/broker/status` → `{ connected: false }`

### INT-4: Broker Proxy Works with Vault-Stored Keys
1. Connect broker (INT-1)
2. `GET /api/broker/proxy/v2/account`
3. Response: valid Alpaca account data (same structure as pre-refactor)
4. Keys decrypted from vault ONLY in request scope
5. Request completes — keys gone from memory

### INT-5: Vault Isolation (User A ≠ User B)
1. User A connects Alpaca
2. User B's token → `GET /api/broker/status` → `{ connected: false }` (no data leak)
3. User B's token → `POST /api/broker/disconnect` with user A's brokerId → 403 or no-op
4. User B's token → `GET /api/broker/proxy/v2/account` → 400 or 404 (no user A's credentials)
5. User B's token → `GET /api/db/vault/get?userId=<userA_id>` → 403

### INT-6: Session Endpoint for Alpaca
1. Connect Alpaca broker
2. `GET /api/broker/session`
3. Response includes `wsAuth: { key, secret }` for WebSocket streaming
4. Session data matches connected broker
5. After disconnect → `GET /api/broker/session` → `{ configured: false }` or similar

### INT-7: Session Endpoint for Tastytrade
1. Connect Tastytrade broker
2. `GET /api/broker/session`
3. Response includes session token (not wsAuth key/secret)
4. Token format matches Tastytrade API requirements

### INT-8: Broker Selection → Credential Entry Flow
1. Open broker selection UI
2. Select Alpaca → credential form shows API Key + Secret Key + Paper/Live toggle
3. Selection Tastytrade → credential form shows different fields
4. Unavailable brokers (IBKR, Schwab, Robinhood) → greyed out, not selectable
5. "Skip for now" → navigates to dashboard

### INT-9: Wrong Credentials → Clear Error
1. Submit invalid API keys
2. Response must be a user-friendly error message
3. Must NOT expose raw broker API response (no stack traces, no internal endpoints)
4. Error appears inline in the credential form
5. Form remains open, user can retry

---

## 4. UAT Scenarios (Manual — For Human Em)

### UAT-1: Happy Path — New User Full Onboarding
1. Navigate to `/signup`
2. Create account
3. Verify email (if required)
4. Log in → InvestorStyleOnboarding appears
5. Select an investment style
6. BrokerSelection appears → choose Alpaca
7. Enter API Key ID + Secret Key
8. Toggle to Paper trading
9. Click "Connect"
10. Success confirmation → Dashboard loads
11. Portfolio tab shows account equity, buying power, positions
12. Settings → Connected Brokers → shows "Alpaca Markets · Connected"
13. Navigate to Settings → Disconnect
14. Confirm disconnect
15. Dashboard returns to empty state ("Connect your broker")
16. Log out, log back in → still shows empty state (vault wiped)

### UAT-2: Existing User Adds Broker from Settings
1. Log in as existing user (no broker connected)
2. Navigate to Settings → Connected Brokers
3. Select Tastytrade
4. Enter API Key + Secret Key
5. Select Sandbox/Live
6. Click "Connect"
7. Dashboard loads with portfolio data
8. Account data matches Tastytrade (not Alpaca)

### UAT-3: Wrong Credentials
1. Start broker connection flow
2. Enter obviously wrong API keys (e.g., "test123")
3. Click "Connect"
4. Error message appears: human-readable, actionable ("Authentication failed. Please check your API keys and try again.")
5. No raw error: `{"code":40110000,"message":"not authorized"}` SHOULD NOT appear
6. Form stays, user can correct and retry

### UAT-4: Skip Broker Onboarding
1. Complete InvestorStyleOnboarding
2. BrokerSelection appears
3. Click "Skip for now"
4. Dashboard loads with empty portfolio state
5. Empty state shows: "Connect your broker to see your portfolio" with CTA button
6. Settings shows "Not connected" for broker

### UAT-5: Disconnect → Empty State → Reconnect
1. With broker connected → navigate to Settings
2. Click Disconnect → confirm
3. Dashboard immediately shows empty state
4. No stale data remains from previous connection
5. Click "Connect Broker" or go to Settings → re-connect
6. Portfolio data returns
7. Positions, orders, account data all populate correctly

### UAT-6: Browser Refresh Persists Connection State
1. Connect a broker
2. Refresh the browser page (F5)
3. Dashboard still shows connected state
4. Portfolio data loads on refresh
5. No need to re-enter keys

### UAT-7: Mobile Responsiveness
1. Test all UAT scenarios on mobile viewport (375px width)
2. Broker selection cards render correctly
3. Credential forms are usable on narrow screens
4. Disconnect confirmation dialog works on mobile
5. No horizontal scroll or overflow

### UAT-8: Network Failure During Connection
1. Connect with valid keys but kill network mid-request
2. Graceful error message (not a crash)
3. User can retry without losing entered data

---

## 5. Security Validation

### SEC-1: No Accidental `console.log` of Credentials
```bash
cd /root/.openclaw/workspace/projects/vantage
grep -rn "console\.\(log\|debug\|info\)" app/ lib/ components/ \
  | grep -iE "(api.?key|secret.?key|api.?secret|credential|password|token)" \
  | grep -v node_modules | grep -v ".next"
```
**Goal:** Zero results. Any match is a CRITICAL finding.

### SEC-2: No API Route Returns Decrypted Credentials
- Check `app/api/broker/status/route.ts` — response must NOT contain keys
- Check `app/api/broker/session/route.ts` — if it returns WS auth, document the risk
- Check `app/api/db/vault/get/route.ts` — must NOT return decrypted values
- Search for `decryptData(` calls in API routes — any that output to response are SUSPECT

```bash
grep -rn "decryptData\|decrypt\|decrypted" app/api/ --include="*.ts" \
  | grep -v node_modules
```
- All decrypt calls in API routes must feed into broker API requests, NOT into response bodies

### SEC-3: ENCRYPTION_KEY is Required (Not Optional)
**Files:** `lib/crypto.ts`, all vault routes  
**Test:** 
- `lib/crypto.ts` — if `ENCRYPTION_KEY` not set, the module must throw at import time
- No fallback to empty string or default value
- No optional chaining that silently skips encryption
```bash
grep -rn "ENCRYPTION_KEY\s*||\s*['\"]" lib/ app/ --include="*.ts"
```
- Any fallback default is a finding

### SEC-4: No Hardcoded Keys in New Files
```bash
# Search for potential key patterns
grep -rn "PK[A-Z0-9]\{28,\}\|AK[A-Z0-9]\{18,\}\|sk-[a-zA-Z0-9]\{20,\}" \
  app/ lib/ components/ types/ \
  --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v .next
```
**Goal:** Zero matches. Hardcoded keys = CRITICAL.

### SEC-5: `crypto-js` Not Imported in New/Modified Files
```bash
grep -rn "crypto-js\|cryptoJS\|CryptoJS" \
  app/ lib/ components/ types/ \
  --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v .next
```
**Goal:** Only import from Node native `crypto` or `lib/crypto.ts`.  
**Exception:** `crypto-js` may remain in `package.json` if used elsewhere, but must NOT be imported in any vault/broker/encryption file.

### SEC-6: vault.ts Uses Native Node Crypto
**File:** `lib/vault.ts`  
**Check:**
- No `pgp_sym_encrypt` / `pgp_sym_decrypt` RPC calls (pgcrypto removed)
- No `crypto-js` imports
- Imports from `lib/crypto.ts` (encryptData, decryptData, deriveUserKey)
- Uses `createServerClient` for Supabase, never `createClient`
- Decrypted credentials held in memory only (no `global`, no caching)

### SEC-7: Broker Proxy Holds Keys Only for Request Duration
**File:** `app/api/broker/proxy/[...path]/route.ts`  
**Check:**
- Keys decrypted inside the handler function
- Not stored in module-level variables
- Not cached in `global` or any persistent scope
- Decrypted keys naturally garbage-collected after response sent

### SEC-8: credential_hash Uses SHA-256
**File:** `lib/vault.ts`  
**Check:**
- Encrypted credential blob is hashed with SHA-256
- Hash stored alongside encrypted data
- Integrity verified on retrieval

### SEC-9: All Supabase Calls in Vault Use Server Client
```bash
grep -rn "createClient\|supabaseClient" lib/vault.ts app/api/broker/ app/api/db/vault/ \
  --include="*.ts"
```
**Goal:** Only `createServerClient` used in server-side vault code. Zero `createClient`.

### SEC-10: `/security` Page Exposes No Implementation Details
**File:** `app/security/page.tsx`  
**Check:**
- No mention of AES-256-GCM, SHA-256, or specific algorithm names
- No mention of `ENCRYPTION_KEY`, `VAULT_ENCRYPTION_KEY` env vars
- No mention of per-user key derivation technique
- No mention of Supabase, pgcrypto, or database structure
- No mention of crypto libraries or Node.js specifics

### SEC-11: Vault DB Column Security
**Check Supabase schema migration:**
- `credentials` column is TEXT (not JSON/JSONB — avoids exposing structure)
- No plaintext API key columns remain in vault
- `credential_hash` column exists
- RLS policy on vault remains `FOR ALL USING (false)` (no direct access)

---

## 6. File Manifest Validation

### Files That Must Exist (After Implementation)

| File | Type | Check |
|------|------|-------|
| `app/api/broker/connect/route.ts` | CREATE | Must exist, must handle POST |
| `app/api/broker/disconnect/route.ts` | CREATE | Must exist, must handle POST |
| `app/api/broker/status/route.ts` | CREATE | Must exist, must handle GET |
| `app/api/broker/session/route.ts` | CREATE | Must exist, must handle GET |
| `app/api/broker/proxy/[...path]/route.ts` | CREATE | Must exist, must handle GET/POST |
| `lib/broker/tastytrade.ts` | CREATE | Must implement BrokerAdapter |
| `components/onboarding/BrokerSelection.tsx` | CREATE | Must render broker cards |
| `components/onboarding/BrokerCredentials.tsx` | CREATE | Must render dynamic forms |
| `app/security/page.tsx` | CREATE | Must render security info |

### Files That Must Be Modified

| File | Expected Changes |
|------|-----------------|
| `lib/crypto.ts` | `deriveUserKey()` exported; ensure encrypt/decrypt work with per-user keys |
| `lib/vault.ts` | Rewritten: no pgcrypto RPCs, uses `encryptData`/`decryptData` from `lib/crypto.ts`, broker-agnostic |
| `app/api/db/vault/save/route.ts` | Accept `brokerId` + credentials blob, use app-side encryption, no crypto-js |
| `app/api/db/vault/get/route.ts` | Return status without decrypted credentials |
| `types/broker.ts` | `BrokerCredentials` union type added |
| `lib/broker/index.ts` | Multi-broker registry, vault-backed init, Tastytrade registered |
| `lib/broker/alpaca.ts` | Remove env var dependency, accept credentials via constructor/session |
| `app/api/alpaca/session/route.ts` | Per-user keys from vault, not env vars |
| `app/api/alpaca/[...path]/route.ts` | Per-user keys from vault, not env vars |
| `components/providers/BrokerProvider.tsx` | Dynamic adapter selection, handle multiple brokers |
| `components/onboarding/InvestorStyleOnboarding.tsx` | Chain into broker flow after style selection |
| `components/settings/SettingsTab.tsx` | Dynamic broker management, disconnect button, change broker |
| `app/page.tsx` | Broker onboarding state, chain after style onboarding |

---

## 7. Test Execution Order (Phase B)

1. **File existence check** — verify all CREATE files exist, all MODIFY files changed
2. **Build check** — `npm run build`, `npx tsc --noEmit`
3. **Security scan** — run SEC-1 through SEC-11 grep commands
4. **Unit test script** — run Node script testing crypto.ts functions
5. **Code review** — read through new code for obvious bugs
6. **Manual verification** — check key logic paths

---

## 8. Issue Severity Classification

| Severity | Criteria | Action |
|----------|----------|--------|
| **CRITICAL** | Credentials exposed in logs/responses; encryption bypass; hardcoded keys; any SEC finding with matches | BLOCK merge immediately |
| **HIGH** | Build fails; TypeScript errors; missing authentication on API routes; wrong credential flow | Must fix before QA sign-off |
| **MEDIUM** | Missing UX state; unclear error messages; minor regression in existing features | Should fix, won't block |
| **LOW** | Cosmetic issues; console warnings (non-security); minor inconsistencies | Nice to fix |

---

## 9. QA Sign-Off Criteria

- [ ] Zero CRITICAL findings
- [ ] Zero HIGH findings
- [ ] `npm run build` exits 0 with zero errors
- [ ] All unit tests (UT-1 through UT-9) pass
- [ ] All security checks (SEC-1 through SEC-11) pass
- [ ] All CREATE files exist
- [ ] All MODIFY files contain expected changes
- [ ] No `crypto-js` imported in vault/broker/encryption files
- [ ] No pgcrypto RPC calls in `lib/vault.ts` or vault routes
- [ ] `/api/db/vault/get` does NOT return decrypted credentials

---

*This test plan will be executed after the backend and frontend implementation agents complete their work.*
