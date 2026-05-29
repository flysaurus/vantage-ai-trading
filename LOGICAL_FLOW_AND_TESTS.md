# Vantage App — Complete Logical Flow & Test Cases
Generated: 2026-05-30 00:25 CEST

──────────────────────────────────────────────────────────────
## APP LOGICAL FLOW
──────────────────────────────────────────────────────────────

### PHASE 0: Entry Point & Auth (AuthGuard > AuthProvider > AppShell)

```
BROWSER LOAD /
  │
  ├─ AuthGuard wraps <AppShell>
  │   ├─ isLoading=true → Show full-screen spinner
  │   ├─ isAuthenticated=false → Redirect /login
  │   └─ isAuthenticated=true → Render AppShell
  │
  └─ AuthProvider mounts
      │
      ├─ Fires GET /api/auth/me (HTTP-only cookie)
      │   ├─ 401 → isDataLoaded=true, isLoading=false, user=null
      │   │       → AuthGuard redirects /login
      │   │
      │   └─ 200 → Build User object from response
      │       ├─ investorStyleOnboarded from API (authoritative)
      │       ├─ investorStyle from API > sessionStorage > localStorage > 'buffett'
      │       └─ LOCALSTORAGE SYNC (bidirectional):
      │           ├─ API says onboarded=true  → setItem('vantage:onboarded', 'true')
      │           └─ API says onboarded=false → removeItem('vantage:onboarded')
      │
      ├─ isDataLoaded=true (gates all dashboard rendering)
      └─ isLoading=false
```

### PHASE 1: AppShell — Gate Controller

```
AppShell renders
  │
  ├─ <BrokerProvider>   ← fetches GET /api/broker/status
  │   ├─ connected=true  → init adapter, set isConnected=true
  │   ├─ connected=false → isConnected=false
  │   └─ isInitialized=true (set after check completes)
  │
  └─ <AppShell> checks gates in ORDER:

  ┌─────────────────────────────────────────────────────────┐
  │ GATE 1: isDataLoaded=false OR user=null                 │
  │ → return null (AuthGuard handles loading/redirect)      │
  └─────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────┐
  │ GATE 2: showOnboarding=true                              │
  │ CONDITION: user.investorStyleOnboarded === false         │
  │ → render <InvestorStyleOnboarding> (z-index 9999)       │
  └─────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────┐
  │ GATE 3: showBrokerGate=true                              │
  │ CONDITIONS (ALL must be true):                           │
  │   • user != null                                         │
  │   • isDataLoaded == true                                 │
  │   • showOnboarding == false  (onboarding done)           │
  │   • isInitialized == true    (broker check done)         │
  │   • isConnected == false     (no broker)                 │
  │ → render <BrokerGate> (z-index 9998)                    │
  └─────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────┐
  │ FALLTHROUGH: all gates pass                             │
  │ → render <DashboardContent> (full dashboard)            │
  │   • User IS onboarded                                   │
  │   • Broker IS connected                                 │
  └─────────────────────────────────────────────────────────┘
```

### PHASE 2: InvestorStyleOnboarding (Gate 2)

```
STATE MACHINE: step ∈ {'style', 'broker', 'credentials', complete}

  STEP 1: 'style'
    ├─ <OnboardingStyleSelection>
    ├─ User picks a style (or defaults to 'buffett')
    ├─ User taps "Accept" → handleStyleAccepted()
    │   ├─ Calls POST /api/db/user/update-style (sets investorStyleOnboarded=true)
    │   ├─ Sets localStorage: vantage:onboarded='true', vantage:investorStyle=<style>
    │   └─ Advances to step='broker'
    └─ ERROR: shows inline error, stays on step='style'

  STEP 2: 'broker'
    ├─ <BrokerSelection onSelect=… onSkip=…>
    ├─ 5 broker cards:
    │   ├─ 🦙 Alpaca (active)      ─→ step='credentials'
    │   ├─ 🍝 Tastytrade (active)  ─→ step='credentials'
    │   ├─ 🏦 IBKR (coming soon)   ── disabled
    │   ├─ 🟢 Robinhood (coming soon) ─ disabled
    │   └─ 🔵 Schwab (coming soon) ── disabled
    │
    ├─ User selects active broker → handleBrokerSelect(id) → step='credentials'
    │
    └─ User taps "Skip" → handleBrokerSkip()
        ├─ Sets localStorage: vantage:brokerSkipped='true'
        └─ window.location.href = '/' (FULL reload)

  STEP 3: 'credentials'
    ├─ <BrokerCredentials brokerId=… onConnect=… onBack=…>
    ├─ Dynamic form per broker (API Key + Secret Key + Environment toggle)
    │
    ├─ User taps "Connect" → handleBrokerConnect()
    │   ├─ Calls POST /api/broker/connect { brokerId, apiKey, secretKey, env }
    │   ├─ Server: validates creds → encrypts → stores → returns account preview
    │   ├─ SUCCESS:
    │   │   ├─ Sets localStorage: vantage:brokerConnected='true', vantage:brokerId=…
    │   │   ├─ Sets state: complete=true (shows "✨ All Set!" screen)
    │   │   └─ setTimeout 1.5s → window.location.href = '/' (FULL reload)
    │   │
    │   └─ FAILURE:
    │       ├─ Shows inline error message
    │       └─ User stays on credentials form to retry
    │
    └─ User taps "← Back" → handleBackToBrokers() → step='broker'

  COMPLETE STATE:
    └─ Shows "✨ All Set!" celebration screen → auto-redirects after 1.5s
```

### PHASE 3: BrokerGate (Gate 3 — post-onboarding, every login)

```
STATE MACHINE: step ∈ {'select', 'credentials'}

  STEP 1: 'select'
    ├─ <BrokerSelection onSelect=… onSkip=…>
    ├─ SAME 5 broker cards as onboarding
    │
    ├─ User selects active broker → handleSelectBroker(id) → step='credentials'
    │
    └─ User taps X (top-right) OR "Skip" → handleSkip()
        └─ Calls onDismiss() → setShowBrokerGate(false)
            → Gate DISAPPEARS for this session ONLY
            → WILL reappear on next login (isConnected still false)

  STEP 2: 'credentials'
    ├─ <BrokerCredentials brokerId=… onConnect=… onBack=…>
    │
    ├─ User taps "Connect" → handleConnect()
    │   ├─ Calls POST /api/broker/connect (same endpoint)
    │   ├─ SUCCESS:
    │   │   ├─ Sets localStorage: vantage:brokerConnected='true', vantage:brokerId=…
    │   │   ├─ REMOVES vantage:brokerSkipped (cleanup)
    │   │   └─ window.location.href = '/' (FULL reload)
    │   │       → BrokerProvider detects isConnected=true → gate never shows again
    │   │
    │   └─ FAILURE: shows error, user can retry
    │
    └─ User taps "← Back" → handleBackToBrokers() → step='select'

  KEY DIFFERENCE from onboarding:
    • No style step (user already onboarded)
    • Skip = dismiss for session only (no localStorage.setItem)
    • Onboarding skip = sets vantage:brokerSkipped + full reload
```

### PHASE 4: Dashboard Data Flow (after all gates pass OR gate dismissed)

```
DashboardContent renders
  │
  ├─ Tab components mount → hooks fire
  │
  ├─ usePortfolio() hook:
  │   ├─ isConnected=true:
  │   │   └─ Fetches from broker adapter → populate usePortfolioStore
  │   │
  │   └─ isConnected=false:
  │       └─ Loads getDemoAccount(user.investorStyle || 'buffett')
  │           → populate usePortfolioStore with simulated data
  │
  ├─ useMarketData() hook:
  │   ├─ isConnected=true:
  │   │   ├─ Fetches quotes via broker adapter → populate useMarketStore
  │   │   └─ Sets up WebSocket streaming for live quotes
  │   │
  │   └─ isConnected=false:
  │       ├─ Loads getDemoIndexes() → populate market store
  │       ├─ Loads getDemoQuotes() → populate quote store
  │       └─ Sets isMarketOpen via time-based fallback:
  │           ├─ Mon-Fri, 13:30-20:00 UTC → OPEN
  │           └─ Otherwise → CLOSED
  │
  └─ Tab rendering:
      ├─ isConnected=false → Shows <DemoBanner> at top
      ├─ PortfolioTab: Demo positions, sector allocation, "Connect" CTA
      ├─ AITab: Demo insight text, demo account summary, style badge
      ├─ TradeTab: Demo quotes for order form
      └─ OrdersTab: Demo account summary
```

### PHASE 5: Broker Disconnect (Settings)

```
SettingsTab → Broker Connection row (collapsible)
  ├─ isConnected=true:
  │   ├─ Shows broker account preview (equity, buying power, status)
  │   ├─ "Change Broker" button → clears broker + redirects
  │   └─ "Disconnect" button → confirmation dialog → POST /api/broker/disconnect
  │       → Hard delete from vault (no recovery)
  │       → Reloads → Gate 3 fires on next AppShell render
  │
  └─ isConnected=false:
      ├─ Shows "No broker connected" in collapsed row
      └─ Expand reveals "Connect Broker" button → clears onboarding flags → reload

## COMPLETE LOCALSTORAGE MAP
───────────────────────────────────────────────────────

vantage:onboarded          'true' | absent     ← API is authoritative
vantage:investorStyle      'buffett' | 'lynch' | 'livermore' | 'soros' | 'munger'
vantage:brokerConnected    'true' | absent     ← set on successful connect
vantage:brokerId           'alpaca' | 'tastytrade' | absent
vantage:brokerSkipped      'true' | absent     ← set during ONBOARDING skip only
vantage:watchlist           JSON array          ← persisted watchlist
vantage:indexSymbols        JSON array          ← persisted index list

State cleanup on disconnect:
  removeItem('vantage:brokerConnected')
  removeItem('vantage:brokerId')
  (brokerSkipped stays — irrelevant when brokerConnected absent)
```

──────────────────────────────────────────────────────────────
## TEST CASES
──────────────────────────────────────────────────────────────

### A. AUTH & NAVIGATION

#### A1. Complete New User Signup Flow
```
PRE: No account exists
 1. Navigate to /signup
 2. Enter email + password + display name
 3. Submit → redirected to /login with "Check your email" confirmation
 4. Check inbox → click verification link
 5. Redirected to /login?verified=true
 6. Enter email + password → login succeeds
 7. 🟢 EXPECT: InvestorStyleOnboarding (Gate 2) appears
EXPECTED RESULT: Onboarding overlay visible, style selection screen
```

#### A2. Existing User Login (onboarded, broker connected)
```
PRE: User is onboarded, broker is connected
 1. Navigate to /login
 2. Enter email + password
 3. 🟢 EXPECT: window.location.href='/' (full reload)
 4. Page loads → AuthProvider confirms session via /api/auth/me
 5. isDataLoaded=true, user.investorStyleOnboarded=true
 6. BrokerProvider checks /api/broker/status → isConnected=true
 7. Gate 1: pass (user exists)
 8. Gate 2: pass (onboarded)
 9. Gate 3: pass (broker connected)
10. 🟢 EXPECT: Dashboard renders immediately, no gate, no DemoBanner
EXPECTED RESULT: Full dashboard with live broker data visible
```

#### A3. Existing User Login (onboarded, NO broker)
```
PRE: User is onboarded, NO broker connected
 1. Navigate to /login → login
 2. AppShell: Gate 1 pass, Gate 2 pass
 3. BrokerProvider finishes → isInitialized=true, isConnected=false
 4. 🟢 EXPECT: BrokerGate (Gate 3) appears (z-index 9998)
 5. User taps X/skip → gate dismissed
 6. 🟢 EXPECT: Dashboard renders with DemoBanner on every tab
 7. User refreshes / logs out+in → Gate 3 fires AGAIN
EXPECTED RESULT: Persistent gate every login until broker connected
```

#### A4. Session Expiry (10 min inactivity)
```
PRE: Logged in, idle for 10 minutes
 1. After 9 min: 🟢 EXPECT inactivityWarning=true, countdown=60
 2. After 10 min: 🟢 EXPECT window.location.href='/login'
 3. 🟢 EXPECT: AuthGuard redirects to /login (no session)
```

#### A5. Direct URL Access While Authenticated
```
PRE: Logged in, on / page
 1. Type /security in URL bar
 2. 🟢 EXPECT: Security page loads (not gated — standalone page)
 3. Type /investor-style
 4. 🟢 EXPECT: Shows "All Set!" or redirects (not intended for direct access)
```

### B. ONBOARDING FLOW

#### B1. Style Selection → Default (Buffett)
```
PRE: New user, onboarding shown
 1. Do NOT tap any style card (all unselected)
 2. Tap "Accept Selected Style"
 3. 🟢 EXPECT: API call to updateInvestorStyle(userId, 'buffett', true)
 4. 🟢 EXPECT: localStorage 'vantage:onboarded'='true', 'vantage:investorStyle'='buffett'
 5. 🟢 EXPECT: Step advances to 'broker' (BrokerSelection visible)
EXPECTED RESULT: Buffett style saved, broker selection shown
```

#### B2. Style Selection → Explicit (Lynch)
```
PRE: New user, onboarding shown
 1. Tap Peter Lynch card (📈)
 2. 🟢 EXPECT: Card highlights with accent border
 3. Tap "Accept Selected Style"
 4. 🟢 EXPECT: investorStyle='lynch' saved to DB
 5. 🟢 EXPECT: Step advances to 'broker'
EXPECTED RESULT: Lynch style saved
```

#### B3. Broker Selection → Skip (during onboarding)
```
PRE: On step='broker' in onboarding
 1. Tap "Skip for now" (or scroll past all cards)
 2. 🟢 EXPECT: window.location.href='/' called
 3. 🟢 EXPECT: localStorage 'vantage:brokerSkipped'='true'
 4. Page reloads → Gate 2 pass (onboarded=true)
 5. Gate 3 fires → BrokerGate appears
 6. 🟢 EXPECT: BrokerGate shown (persistent gate — not onboarding's broker step)
EXPECTED RESULT: Onboarding complete, broker gate persists
```

#### B4. Broker Selection → Connect Alpaca (during onboarding)
```
PRE: On step='broker', valid Alpaca paper keys available
 1. Tap "Alpaca" card
 2. 🟢 EXPECT: Step advances to 'credentials'
 3. 🟢 EXPECT: Alpaca form shown (API Key, Secret Key, Paper/Live toggle)
 4. Enter valid keys, toggle to "Paper"
 5. Tap "Connect"
 6. 🟢 EXPECT: POST /api/broker/connect fires
 7. 🟢 EXPECT: Loading spinner on button
 8. Success: 🟢 EXPECT "✨ All Set!" screen → auto-reload after 1.5s
 9. After reload: BrokerProvider detects isConnected=true
10. 🟢 EXPECT: Dashboard renders with LIVE broker data, no DemoBanner
EXPECTED RESULT: Broker connected, live data flowing
```

#### B5. Broker Credentials → Wrong Keys
```
PRE: On step='credentials' for Alpaca
 1. Enter invalid/bogus API keys
 2. Tap "Connect"
 3. 🟢 EXPECT: POST /api/broker/connect returns error
 4. 🟢 EXPECT: Inline red error message appears
 5. 🟢 EXPECT: User stays on credentials form (can retry)
EXPECTED RESULT: Error shown, can retry
```

#### B6. Broker Credentials → Back to Selection
```
PRE: On step='credentials' for Tastytrade
 1. Tap "← Back" link at top
 2. 🟢 EXPECT: Step returns to 'broker'
 3. 🟢 EXPECT: All 5 broker cards visible again
EXPECTED RESULT: Can choose different broker
```

### C. BROKER GATE (every-login persistence)

#### C1. Gate Appears Every Login
```
PRE: User onboarded, NO broker, logged out
 1. Login → Gate 3 fires → BrokerGate appears
 2. Tap X / Skip → Dashboard with demo data
 3. Logout
 4. Login AGAIN
 5. 🟢 EXPECT: BrokerGate appears AGAIN (not a one-time skip)
EXPECTED RESULT: Gate persists across sessions
```

#### C2. Gate Disappears After Connect
```
PRE: BrokerGate showing
 1. Select a broker → enter valid credentials → Connect
 2. Success → window.location.href='/' reloads
 3. BrokerProvider: isConnected=true
 4. Gate 3 check: isConnected=true → setShowBrokerGate(false)
 5. 🟢 EXPECT: Dashboard renders, no gate
 6. Logout → Login → 🟢 EXPECT: No gate (broker still connected)
EXPECTED RESULT: Gate permanently gone once broker connected
```

#### C3. Gate Reappears After Disconnect
```
PRE: Broker connected, dashboard visible
 1. Go to Settings → Broker Connection → Disconnect → Confirm
 2. Page reloads → BrokerProvider: isConnected=false
 3. Gate 3 fires → BrokerGate appears
EXPECTED RESULT: Gate returns after disconnect
```

### D. DEMO DATA

#### D1. No Broker → Demo Portfolio by Style
```
PRE: Onboarded with style='buffett', no broker
 1. Gate dismissed → Dashboard renders
 2. 🟢 EXPECT: DemoBanner on AI, Portfolio, Trade, Orders tabs
 3. 🟢 EXPECT: DemoBanner shows "Demo Data · Warren Buffett · Value Hunter"
 4. Portfolio tab: 🟢 EXPECT 7 positions (AAPL, KO, AXP, BAC, PG, JNJ, BRK.B)
 5. Total value: 🟢 EXPECT ~$148,650
 6. Sector allocation bar shown
EXPECTED RESULT: Buffett-style demo portfolio
```

#### D2. Demo Portfolio Changes With Style
```
PRE: Buffett style → switch to Livermore in Settings
 1. Go to Settings → Investor Style → Change → select Jesse Livermore
 2. Refresh page (style saves to DB, localStorage updates)
 3. 🟢 EXPECT: DemoBanner shows "Demo Data · Jesse Livermore · Momentum Rider"
 4. Portfolio tab: 🟢 EXPECT TSLA, MSTR, SMCI, COIN, RKLB, PLTR
 5. All momentum stocks, higher dayChange volatility
EXPECTED RESULT: Portfolio content changes with style
```

#### D3. DemoBanner Hidden With Broker Connected
```
PRE: Broker connected
 1. AI tab: 🟢 EXPECT NO DemoBanner
 2. Portfolio tab: 🟢 EXPECT NO DemoBanner
 3. Trade tab: 🟢 EXPECT NO DemoBanner
 4. Orders tab: 🟢 EXPECT NO DemoBanner
EXPECTED RESULT: Banner only shows when no broker
```

#### D4. Demo Market Data
```
PRE: No broker connected
 1. 🟢 EXPECT: MarketBar shows SPY $562.80, QQQ $485.40, IWM $218.30, etc.
 2. 🟢 EXPECT: Market status shows correct time-based OPEN/CLOSED
 3. Trade tab: Search for AAPL
 4. 🟢 EXPECT: Quote card shows $195.20, change +$2.30 (+1.19%)
 5. All symbols in the portfolio are quotable
EXPECTED RESULT: Full market data available without broker
```

### E. POST-CONNECT DATA FLOW

#### E1. Live Data Replaces Demo Data
```
PRE: On demo data, connect broker
 1. Connect broker (via Gate or Settings)
 2. After reload: isConnected=true
 3. usePortfolio fires → fetches from broker adapter
 4. 🟢 EXPECT: usePortfolioStore populated with REAL account data
 5. useMarketData fires → fetches live quotes
 6. 🟢 EXPECT: MarketBar shows LIVE index prices
 7. 🟢 EXPECT: No demo positions (replaced by real positions)
EXPECTED RESULT: Clean switch from demo to live
```

#### E2. Portfolio Tab With Positions
```
PRE: Broker connected, portfolio has AAPL 100 shares
 1. Portfolio tab shows AccountSummaryCard with real equity/buyingPower
 2. Positions list shows real market values
 3. Sector Allocation bar reflects real portfolio composition
 4. P&L chart loads from /api/alpaca/history
EXPECTED RESULT: Live portfolio fully rendered
```

#### E3. Trade Tab With Broker
```
PRE: Broker connected
 1. Search for a symbol
 2. 🟢 EXPECT: Live quote card with bid/ask, volume, 52w range
 3. Set side=buy, type=market, qty=100
 4. Tap "Place Order"
 5. 🟢 EXPECT: Order sent to broker, success/failure feedback
EXPECTED RESULT: Real order placement works
```

### F. EDGE CASES & ERROR STATES

#### F1. API /me Fails
```
 1. GET /api/auth/me returns 500
 2. AuthProvider: catch block → isDataLoaded=true, user=null
 3. AuthGuard: isAuthenticated=false → redirect /login
 4. 🟢 EXPECT: User sees login page (graceful degradation)
```

#### F2. API /broker/status Fails
```
PRE: Logged in
 1. GET /api/broker/status returns 500
 2. BrokerProvider: isInitialized=true, isConnected=false
 3. Gate 3 fires → BrokerGate shown
 4. User can retry connecting from gate
EXPECTED RESULT: Falls back to broker gate, doesn't crash
```

#### F3. API /broker/connect Fails Mid-Onboarding
```
PRE: On step='credentials'
 1. Network drops during /api/broker/connect
 2. 🟢 EXPECT: Error message "Network error" or similar
 3. 🟢 EXPECT: User stays on credentials form
 4. 🟢 EXPECT: No partial state — user can retry
EXPECTED RESULT: Graceful error, can retry
```

#### F4. Stale localStorage 'vantage:onboarded' From Prior Session
```
PRE: User previously onboarded (vantage:onboarded='true' in localStorage)
     New account created, API says investorStyleOnboarded=false
 1. Login with new account
 2. AuthProvider: API says not onboarded → calls removeItem('vantage:onboarded')
 3. AppShell: user.investorStyleOnboarded=false → setShowOnboarding(true)
 4. 🟢 EXPECT: InvestorStyleOnboarding appears (Gate 2)
EXPECTED RESULT: BUG FIX VERIFIED — stale localStorage doesn't block onboarding
```

#### F5. Market Status Without Broker (weekend)
```
PRE: No broker, time is Saturday 14:00 UTC
 1. useMarketData: isConnected=false
 2. day=6 (Saturday) → isOpen=false
 3. 🟢 EXPECT: MarketBar shows "CLOSED"
EXPECTED RESULT: Time-based fallback works for weekends
```

#### F6. Market Status Without Broker (weekday)
```
PRE: No broker, time is Tuesday 15:00 UTC
 1. day=2 (Tuesday), h=15 → between 13:30-20:00 → isOpen=true
 2. 🟢 EXPECT: MarketBar shows "OPEN"
EXPECTED RESULT: Time-based fallback works for market hours
```

#### F7. Desktop vs Mobile Layout
```
 1. Resize window to 1200px → 🟢 DesktopSidebar visible
 2. Resize window to 600px  → 🟢 BottomNav visible, sidebar hidden
 3. All gates behavior IDENTICAL on both layouts
EXPECTED RESULT: Responsive layout, same gate logic
```

### G. SECURITY VERIFICATION

#### G1. No Keys in Browser
```
PRE: Broker connected
 1. Open DevTools → Application → Local Storage
 2. 🟢 EXPECT: NO API keys or secret keys stored
 3. Open DevTools → Network → look at /api/broker/session response
 4. 🟢 EXPECT: Response contains NO decrypted credentials (only adapter token)
```

#### G2. Disconnect = Hard Delete
```
PRE: Broker connected
 1. Settings → Broker → Disconnect → Confirm
 2. 🟢 EXPECT: POST /api/broker/disconnect fires
 3. Check Supabase vault table → 🟢 EXPECT: Row deleted (no soft delete)
 4. Page reloads → BrokerProvider: isConnected=false
 5. 🟢 EXPECT: Gate 3 fires (no broker detected)
```

#### G3. Vault GET Never Returns Decrypted Credentials
```
PRE: Broker connected, valid session
 1. In DevTools, manually call: fetch('/api/db/vault/get')
 2. 🟢 EXPECT: Response returns connection status only
 3. 🟢 EXPECT: NO keyId, encryptedData, or any credential data in response
EXPECTED RESULT: Vault route is safe — only returns status
```

### H. UI CONSISTENCY

#### H1. Security Page Scrollable + Close Button
```
 1. Navigate to /security on mobile
 2. 🟢 EXPECT: Page scrolls vertically, smooth on iOS
 3. 🟢 EXPECT: Close (X) button visible at top
 4. Tap Close → 🟢 EXPECT: Navigates to / (dashboard)
```

#### H2. Help/Broker-Keys Page Scrollable + Close Button
```
 1. Navigate to /help/broker-keys on mobile
 2. 🟢 EXPECT: Page scrolls vertically
 3. 🟢 EXPECT: Close button visible at top
 4. 🟢 EXPECT: Alpaca section, Tastytrade section, security reminders all visible
```

#### H3. Verify-Email Page Styling Matches Login
```
 1. On /login?confirmed=true or direct nav to /verify-email
 2. 🟢 EXPECT: Same card width (380px), border-radius (16px), padding, colors
 3. 🟢 EXPECT: No "Email not arriving? Verify Now" banner (removed)
```

──────────────────────────────────────────────────────────────
## TEST EXECUTION ORDER
──────────────────────────────────────────────────────────────

Recommended order for UAT (quickest confidence → edge cases):

QUICK SMOKE (< 5 min):
  A2  — Existing user login with broker
  A3  — Login without broker → gate appears
  C1  — Gate persists across logins
  D1  — Demo portfolio visible

ONBOARDING (< 10 min):
  B1  — Default (Buffett) style
  B2  — Explicit style selection
  B3  — Skip broker during onboarding
  B4  — Connect broker during onboarding

BROKER LIFECYCLE (< 5 min):
  C2  — Gate gone after connect
  C3  — Gate returns after disconnect
  D3  — DemoBanner hidden with broker

DEMO DATA (< 5 min):
  D2  — Style change updates demo portfolio
  D4  — Market data populated
  B5  — Wrong credentials error handling

EDGE CASES:
  F1  — API /me failure
  F4  — Stale localStorage (requires account switch)
  F5  — Weekend market status
  F7  — Desktop/mobile layout

SECURITY:
  G1  — No keys in browser storage
  G2  — Disconnect = hard delete
  G3  — Vault GET safe

UI:
  H1  — Security page scrollable
  H2  — Help page scrollable
  H3  — Verify-email styling
