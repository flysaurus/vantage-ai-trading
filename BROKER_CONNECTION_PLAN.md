# Broker Connection Flow — Implementation Plan

## Phase 0: Security Foundation 🔐

### 0.1 Consolidate Encryption
- **Remove** crypto-js from vault API routes
- **Replace** with native Node `crypto` module (aes-256-gcm) from `lib/crypto.ts`
- **Remove** pgcrypto RPC functions from `lib/vault.ts` (sends plaintext to DB)
- **Single encryption path**: all broker credentials encrypted in app code via AES-256-GCM before any DB interaction

### 0.2 Upgrade Vault Table (Supabase Migration)
```
ALTER TABLE vault ADD COLUMN broker_id TEXT;
ALTER TABLE vault ADD COLUMN credentials TEXT;  -- AES-256-GCM encrypted JSON blob
ALTER TABLE vault ADD COLUMN credential_hash TEXT;  -- SHA-256 for integrity verification
ALTER TABLE vault ADD COLUMN is_connected BOOLEAN DEFAULT false;
ALTER TABLE vault ADD COLUMN connected_at TIMESTAMPTZ;
```
- Keep existing columns for backward compatibility during transition
- New `credentials` column stores broker-specific credential JSON as single encrypted blob

### 0.3 Per-User Encryption
- Derive encryption key from: `SHA-256(userId + VAULT_ENCRYPTION_KEY)`
- Each user's keys encrypted with a uniquely derived key
- If the global secret ever leaks, keys can't be decrypted without per-user derivation

### 0.4 Credential Shape (per broker)
```typescript
type BrokerCredentials =
  | { brokerId: 'alpaca'; apiKey: string; secretKey: string; environment: 'paper' | 'live' }
  | { brokerId: 'tastytrade'; apiKey: string; secretKey: string; environment: 'sandbox' | 'live' }
  | { brokerId: 'ibkr'; username: string; password: string; gatewayUrl: string }
  | { brokerId: 'schwab'; accessToken: string; refreshToken: string; expiresAt: number }
  | { brokerId: 'robinhood'; accessToken: string; refreshToken: string; expiresAt: number };
```

---

## Phase 1: API Routes

### 1.1 `POST /api/broker/connect`
- Accept `{ brokerId, credentials, environment? }`
- Derive per-user encryption key
- Encrypt credentials with AES-256-GCM
- Store in vault
- Attempt broker connectivity check (call broker's account endpoint)
- Return `{ connected, accountPreview?, error? }`

### 1.2 `POST /api/broker/disconnect`
- Accept `{ brokerId }`
- Wipe credentials + hash from vault
- Return `{ success: true }`

### 1.3 `GET /api/broker/status`
- Query vault for user's connected broker
- Ping broker for account status
- Return `{ connected, brokerId, accountPreview?, marketOpen? }`
- Does NOT return any credential data

### 1.4 `GET /api/broker/session`
- Returns broker-specific session info for client adapter initialization
- Only returns non-sensitive data (account ID, environment, market status)
- For Alpaca WS: returns the key/secret for streaming (these touch client memory, but only after explicit user consent)

### 1.5 `GET /api/broker/proxy/[...path]`
- Broker-agnostic proxy (replaces `/api/alpaca/[...path]`)
- Decrypts keys from vault per-request
- Routes to correct broker API based on stored `brokerId`
- Keys held in memory only for duration of the request

---

## Phase 2: Broker Adapters

### 2.1 Refactor `BrokerRegistry`
- Dynamic adapter initialization from vault credentials
- Adapters accept credentials at construction, don't read env vars
- Registry queries `/api/broker/status` to determine active broker

### 2.2 Refactor Alpaca Adapter
- Remove env var dependency (`process.env.ALPACA_API_KEY_ID`)
- Accept credentials via constructor or session endpoint
- Session endpoint returns WS auth payload from vault

### 2.3 Build Tastytrade Adapter (New)
- REST proxy pattern matching Alpaca
- Tastytrade API: `https://api.tastytrade.com` (live) / `https://api.cert.tastyworks.com` (sandbox)
- Auth: session token obtained via `/sessions` endpoint using API key + secret
- Streaming: WebSocket with session token

### 2.4 Future Adapters (Phase 3)
- IBKR, Schwab, Robinhood — deferred
- Architecture supports adding them via the same `BrokerAdapter` interface

---

## Phase 3: Onboarding UI

### 3.1 Broker Selection Screen
**File:** `components/onboarding/BrokerSelection.tsx`

- Shows 5 broker cards: Alpaca 🦙, Tastytrade 🍝, IBKR 🏦, Schwab 📊, Robinhood 🌮
- Cards show: logo, name, auth method summary, connection difficulty indicator
- IBKR, Schwab, Robinhood shown as "Coming Soon" with greyed-out state
- Alpaca and Tastytrade are selectable
- "Skip for now" link at bottom → goes to dashboard with empty state

### 3.2 Credential Entry Screen
**File:** `components/onboarding/BrokerCredentials.tsx`

- Dynamic form based on selected broker
- **Alpaca**: API Key ID, Secret Key, Paper/Live toggle
- **Tastytrade**: API Key, Secret Key, Sandbox/Live toggle
- **Security messaging**: short version inline + link to detailed page
- "Connect" button → calls `/api/broker/connect` → verifies → advances
- Error handling: clear messaging if keys are wrong
- Back button to broker selection

### 3.3 Integration with Onboarding Flow
**File:** `components/onboarding/InvestorStyleOnboarding.tsx`

- After style selection → broker selection → credentials → dashboard
- State machine: `style → broker → credentials → done`
- Skip broker: goes straight to dashboard, can connect later in Settings

---

## Phase 4: Dashboard Integration

### 4.1 Refactor BrokerProvider
**File:** `components/providers/BrokerProvider.tsx`

- Mount: call `/api/broker/status` to determine connected broker
- Dynamically load correct adapter
- If no broker connected: show empty portfolio state with "Connect Broker" prompt
- Refresh cycle: poll account/positions/orders every 30s (preserved)

### 4.2 AppShell Changes
**File:** `app/page.tsx`

- Add broker onboarding state after style onboarding
- Chain: `showStyleOnboarding → showBrokerOnboarding → showDashboard`

### 4.3 Empty State When No Broker
- Portfolio tab shows: "Connect your broker to see your portfolio"
- CTA button opens broker connection flow
- Market data / watchlists still work without broker

---

## Phase 5: Settings

### 5.1 Broker Management in Settings
**File:** `components/settings/SettingsTab.tsx`

- Shows current broker: name, logo, connection status, account preview
- "Change Broker" button → reopens broker selection
- "Disconnect" button with confirmation dialog
- Security info link to detailed page

---

## Phase 6: Security Messaging

### 6.1 Short Version (on credential form)
```
🔒 Your keys are encrypted before they leave your device and stored in a way 
that even we can't access them without your account being active. They're never 
sent back to your browser, never stored in plain text, and wiped permanently 
if you disconnect. [Learn more about our security →]
```

### 6.2 Detailed Version (separate info page)
See below — designed to inform without exposing implementation.

---

## File Manifest

| Action | File |
|--------|------|
| **MODIFY** | `lib/crypto.ts` — add `deriveUserKey()`, export encrypt/decrypt for vault |
| **MODIFY** | `lib/vault.ts` — rewrite: single encrypt/decrypt path, broker-agnostic |
| **MODIFY** | `app/api/db/vault/save/route.ts` — accept brokerId + credentials blob |
| **MODIFY** | `app/api/db/vault/get/route.ts` — return per-broker credentials |
| **MODIFY** | `types/broker.ts` — add credential types, BrokerCredentials union |
| **MODIFY** | `lib/broker/index.ts` — multi-broker registry, vault-backed init |
| **MODIFY** | `lib/broker/alpaca.ts` — remove env var dependency |
| **MODIFY** | `app/api/alpaca/session/route.ts` — per-user keys from vault |
| **MODIFY** | `app/api/alpaca/[...path]/route.ts` — per-user keys from vault |
| **MODIFY** | `components/providers/BrokerProvider.tsx` — dynamic adapter selection |
| **MODIFY** | `components/onboarding/InvestorStyleOnboarding.tsx` — chain into broker flow |
| **MODIFY** | `components/settings/SettingsTab.tsx` — broker management |
| **MODIFY** | `app/page.tsx` — broker onboarding state |
| **CREATE** | `app/api/broker/connect/route.ts` |
| **CREATE** | `app/api/broker/disconnect/route.ts` |
| **CREATE** | `app/api/broker/status/route.ts` |
| **CREATE** | `app/api/broker/session/route.ts` |
| **CREATE** | `app/api/broker/proxy/[...path]/route.ts` |
| **CREATE** | `lib/broker/tastytrade.ts` |
| **CREATE** | `components/onboarding/BrokerSelection.tsx` |
| **CREATE** | `components/onboarding/BrokerCredentials.tsx` |
| **CREATE** | `app/security/page.tsx` — detailed security info page |

---

## Execution Order

1. **Phase 0** (security foundation) — do this first, everything builds on it
2. **Phase 1** (API routes) — the backbone
3. **Phase 2** (adapters) — Alpaca refactor, then Tastytrade
4. **Phase 3** (onboarding UI) — visible progress
5. **Phase 4** (dashboard integration) — wires it all together
6. **Phase 5** (settings) — polish
7. **Phase 6** (security messaging) — final text

---

## Security Messaging — User-Facing

### Short Version (Credential Form)

Displayed inline below the credential fields, before the Connect button:

---

🔒 **How we protect your data**

Your broker keys are encrypted before they leave your device. They're stored in a
scrambled format that's useless without your account being active, and they're never
sent back to your browser after you enter them. If you ever disconnect your broker,
everything is permanently wiped — no backups, no archives.

[See full security details →]

---

### Detailed Version (Security Info Page)

Accessible at `/security` or via the link above. Written to inform without exposing
attack surface. No library names, no algorithm modes, no architectural specifics.

---

# How Vantage Protects Your Broker Keys

We take the security of your financial accounts seriously. Here's exactly what happens
when you connect your broker and how your information is protected.

---

## What Happens When You Enter Your Keys

**1. Encryption happens immediately.** The moment you submit the form, your broker
credentials are scrambled into an unreadable format using industry-standard encryption.
This happens before the data leaves your device — no plain text ever travels over the
internet.

**2. Your connection is already secure.** All communication between your browser and
our servers uses HTTPS, the same encryption that protects online banking and payment
systems. Even before our application-level encryption kicks in, the transport layer
prevents anyone from intercepting your data in transit.

**3. Storage: locked, not hidden.** Your encrypted credentials are stored in a way
that requires your active account session to unlock. Without both parts — your
authenticated session and our server-side security — the stored data is useless.
Think of it as a safety deposit box that requires two keys to open.

---

## What We Do With Your Keys

**We use them for exactly what you ask us to do, and nothing else.**

When you check your portfolio, place a trade, or view your positions, our servers
temporarily decrypt your credentials, make the request to your broker, and immediately
discard the decrypted copy. This happens in a fraction of a second, entirely in server
memory — your keys are never written to disk, logs, or any persistent storage in
decrypted form.

We never:
- Use your keys for any purpose other than what you explicitly initiate in the app
- Share, sell, or transfer your credentials to any third party
- Store decrypted copies anywhere
- Access your account without your active session

---

## What Happens When You Disconnect

Disconnecting your broker is a hard delete, not a soft hide. The encrypted data is
permanently destroyed with no recovery path. If you reconnect later, you'll need to
enter your keys again from scratch. There is no archive, no backup, and no way for
us — or anyone else — to recover deleted credentials.

---

## Where Your Keys Never Go

Your raw broker credentials are never:
- Stored in your browser's local storage or cookies
- Sent back to your browser after initial submission
- Included in error logs, analytics, or monitoring systems
- Accessible to our support team or any human operator
- Backed up in recoverable form

If someone gained access to your browser, your phone, or even our database, your
broker credentials would not be accessible.

---

## What You Can Do

- **Disconnect at any time** from Settings → Broker with one tap
- **Use paper trading** (available with Alpaca) to test the platform without exposing
  a funded account
- **Create dedicated API keys** in your broker's settings with only the permissions
  you need (trading, read-only, etc.)

---

## Our Commitment

Security isn't a feature — it's the foundation. We've designed the system so that
even we cannot access your broker keys independently. The encryption happens on your
side, the decryption requires your active session, and the storage is worthless without
both.

If you have questions about our security practices or want to report a concern,
reach out to us directly.

---
```

---

## Ready to Execute

1. Start with Phase 0 (security consolidation)
2. Work through phases in order
3. Each phase produces testable, deployable changes
4. Security page content above is final — no implementation specifics exposed
