# Vantage AI — OpenClaw Project Context
# READ THIS BEFORE EVERY CHANGE
# Last updated: June 2026

## Active Directory
projects/vantage/
ALWAYS confirm with: pwd

## Tech Stack
- Next.js 15 App Router (NOT pages router)
- React 19
- TypeScript 5
- Tailwind CSS 4
- Supabase (PostgreSQL + Auth)
- Vercel deployment
- Port 3002 (dev)

## MANDATORY FIRST STEP
Before changing ANY file run:
pwd
Confirm output ends with: projects/vantage

## COMPLETE FILE MAP (verified June 2026)

### Pages (app/ directory)
app/page.tsx ← root/home
app/layout.tsx ← root layout
app/login/page.tsx
app/signup/page.tsx
app/forgot-password/page.tsx
app/reset-password/page.tsx
app/verify-email/page.tsx
app/investor-style/page.tsx
app/account/page.tsx
app/preferences/page.tsx
app/security/page.tsx
app/help/page.tsx
app/help/broker-keys/page.tsx
app/news-feed/page.tsx
app/watchlists/page.tsx
app/price-alerts/page.tsx
app/earnings-calendar/page.tsx
app/goals/page.tsx
app/trade-history/page.tsx
app/stock-screener/page.tsx
app/strategies/page.tsx
app/strategies/setup/dca/page.tsx
app/strategies/setup/rebalancing/page.tsx
app/strategies/setup/tax-harvesting/page.tsx
app/trade/basket/[id]/page.tsx
app/error.tsx
app/global-error.tsx

### Tab Components (NOT pages — these are components)
components/ai/AITab.tsx ← AI tab (129 lines)
components/ai/AIChat.tsx ← chat UI
components/ai/AIThinkingIndicator.tsx
components/ai/QuickActions.tsx ← prompt pills
components/ai/DailyBriefCard.tsx
components/ai/WeeklySnapshotCard.tsx
components/ai/ConfidenceRing.tsx
components/ai/ConvictionCard.tsx
components/portfolio/PortfolioTab.tsx
components/portfolio/PositionRow.tsx
components/orders/OrdersTab.tsx
components/trade/TradeTab.tsx
components/trade/SymbolSearch.tsx
components/settings/SettingsTab.tsx

### Shared Components
components/shared/AccountSummaryCard.tsx
components/shared/DemoBanner.tsx

### Modals + Overlays
components/BuildBasketModal.tsx ← NOT in ai/
components/GreetingModal.tsx
components/SplashScreen.tsx
components/SplashGuard.tsx
components/StrategySheet.tsx
components/SuggestionTracker.tsx
components/CompassIcon.tsx ← custom SVG icon

### Layout
components/layout/BottomNav.tsx
components/layout/Header.tsx
components/layout/MarketBar.tsx
components/layout/WatchlistBar.tsx
components/layout/DesktopSidebar.tsx

### Onboarding
components/onboarding/BrokerCredentials.tsx
components/onboarding/BrokerGate.tsx
components/onboarding/BrokerSelection.tsx
components/onboarding/InvestorStyleOnboarding.tsx
components/onboarding/OnboardingConfirmation.tsx
components/onboarding/OnboardingStyleSelection.tsx
components/onboarding/OnboardingWelcome.tsx

### Providers
components/providers/AuthGuard.tsx
components/providers/AuthProvider.tsx
components/providers/BrokerProvider.tsx
components/providers/InactivityWarning.tsx

### Advisor
components/advisor/ConflictAlert.tsx
components/advisor/StockRecommendationCard.tsx

### Dashboard
components/dashboard/PortfolioDashboard.tsx

### API Routes
app/api/chat/route.ts ← main AI chat
app/api/chat/history/route.ts
app/api/chat/history/save/route.ts
app/api/ai/daily-brief/route.ts
app/api/ai/weekly-snapshot/route.ts
app/api/ai/suggestions/route.ts
app/api/ai/suggestions/track/route.ts
app/api/ai/cache/clear/route.ts
app/api/portfolio/summary/route.ts
app/api/baskets/route.ts
app/api/baskets/[id]/route.ts
app/api/baskets/[id]/execute/route.ts
app/api/baskets/positions/route.ts
app/api/broker/connect/route.ts
app/api/broker/disconnect/route.ts
app/api/broker/proxy/[...path]/route.ts
app/api/broker/session/route.ts
app/api/broker/status/route.ts
app/api/demo/switch-style/route.ts
app/api/usage/remaining/route.ts
app/api/user/preferences/route.ts
app/api/market/quotes/route.ts
app/api/stock/details/route.ts
app/api/sectors/route.ts
app/api/news/route.ts
app/api/earnings/route.ts
app/api/screener/search/route.ts
app/api/symbols/search/route.ts
app/api/notifications/list/route.ts
app/api/notifications/mark-read/route.ts
app/api/notifications/unread/route.ts
app/api/alerts/check/route.ts
app/api/alpaca/[...path]/route.ts
app/api/alpaca/history/route.ts
app/api/alpaca/market/route.ts
app/api/alpaca/sectors/route.ts
app/api/alpaca/session/route.ts
app/api/alpaca/symbols/route.ts
app/api/strategies/dca/create/route.ts
app/api/strategies/dca/delete/route.ts
app/api/strategies/dca/get-all/route.ts
app/api/strategies/dca/update/route.ts
app/api/strategies/rebalancing/execute/route.ts
app/api/strategies/rebalancing/save/route.ts
app/api/strategies/rebalancing/saved/route.ts
app/api/strategies/rebalancing/session/route.ts
app/api/strategies/tax-harvest/execute/route.ts
app/api/strategies/tax-harvesting/execute/route.ts
app/api/advisor/recommendations/route.ts

### DB Routes (Supabase wrappers)
app/api/db/users/[create|get|update|delete]/route.ts
app/api/db/chat-history/[all CRUD]/route.ts
app/api/db/watchlists/[all CRUD]/route.ts
app/api/db/alerts/[all CRUD]/route.ts
app/api/db/strategies/[all CRUD]/route.ts
app/api/db/trade-history/[all CRUD]/route.ts
app/api/db/vault/[get|save]/route.ts
app/api/db/sessions/[all CRUD]/route.ts
app/api/db/metrics/[all CRUD]/route.ts
app/api/db/notifications/[create|get]/route.ts
app/api/db/market-cache/[get|upsert|delete]/route.ts
app/api/db/daily-suggestions/[create|get]/route.ts
app/api/db/scanner-recommendations/[create|get]/route.ts

### Auth Routes
app/api/auth/login/route.ts
app/api/auth/logout/route.ts
app/api/auth/signup/route.ts
app/api/auth/me/route.ts
app/api/auth/verify-email/route.ts
app/api/auth/resend-verification/route.ts
app/api/auth/request-password-reset/route.ts
app/api/auth/reset-password/route.ts
app/api/auth/login-2fa/route.ts
app/api/auth/2fa/[generate|enable|disable|verify]/route.ts
app/api/auth/verify-user/route.ts

### Hooks
hooks/useAIChat.ts ← AI chat state
hooks/useBrokerData.ts
hooks/useLiveQuotes.ts
hooks/useMarketData.ts
hooks/useOrders.ts
hooks/usePortfolio.ts
hooks/useStockRecommendations.ts

### Libraries
lib/ai-provider.ts ← Claude Haiku/Sonnet
lib/ai-system-prompt.ts ← system prompts
lib/ai-context.ts ← portfolio context
lib/ai.ts
lib/demo-data.ts ← demo portfolio data
lib/demo-orders.ts ← demo order history
lib/portfolio-operations.ts ← portfolio transitions
lib/market-hours.ts ← OPEN/CLOSED logic
lib/finnhub.ts ← market data
lib/external-data.ts
lib/stock-scorer.ts
lib/stock-universe.ts
lib/stock-analyst.ts
lib/broker-service.ts
lib/broker/alpaca.ts
lib/broker/tastytrade.ts
lib/broker/index.ts
lib/alpaca.ts
lib/auth.ts
lib/auth-service.ts
lib/supabase.ts
lib/supabase-auth.ts
lib/supabase/[all modules].ts
lib/vault.ts
lib/crypto.ts
lib/email.ts
lib/confidence.ts
lib/scheduler.ts
lib/schemas.ts
lib/sectors.ts
lib/sector-leaders.ts
lib/investor-style-targets.ts
lib/market-data.ts
lib/advisor/engine.ts
lib/advisor/conflict-detection.ts
lib/middleware/auth.ts

### Store + Types
store/index.ts ← Zustand store
types/index.ts
types/broker.ts
types/supabase.ts

### Key Packages (from package.json)
next: 15.5.19
react: 19.2.4
typescript: 5
tailwindcss: 4
lucide-react: 1.14.0 ← icon library
react-markdown: 10.1.0
remark-gfm: 4.0.1
recharts: 3.8.1
zustand: 5.0.13
date-fns: 4.1.0
@supabase/supabase-js: 2.106.1

## CRITICAL NOTES

### lucide-react is installed
Many components use lucide-react icons.
CompassIcon.tsx is a CUSTOM component —
do NOT replace it with lucide Compass.
They look different.
Our CompassIcon = 4-pointed star ✦
Lucide Compass = diamond ◇

### Event Bus (custom window events)
'vantage-open-basket-modal'
 → dispatched by QuickActions + AIChat
 → listened by AITab (mounts modal)

'vantage-basket-generated'
 → dispatched by AITab (after modal)
 → listened by AIChat (shows result)

### Demo vs Live
User is demo when: portfolio_mode = 'demo'
 OR broker_connected = false
Same DB tables used for both.
is_demo flag on positions + orders tables.

### No src/ directory
Everything is at root level:
components/ app/ lib/ hooks/ store/ types/
NEVER write to src/

### Tab Architecture
Tabs are NOT Next.js pages.
They are components rendered by app/page.tsx
or app/layout.tsx via tab switching logic.
Check app/page.tsx to see how tabs mount.

## WORKFLOW (mandatory every prompt)

Step 1: pwd → confirm projects/vantage
Step 2: cat the file before changing it
Step 3: make changes
Step 4: tsc --noEmit → fix ALL errors
Step 5: show exact diff of what changed

## NEVER DO THIS
❌ Write to src/components/ (doesn't exist)
❌ Guess file paths
❌ Change files without reading first
❌ Skip tsc --noEmit
❌ Use lucide Compass instead of CompassIcon
❌ Replace window event bus with props
❌ Create new files that duplicate existing ones
 (check if it exists first)

## ALWAYS DO THIS
✅ pwd first
✅ cat file before editing
✅ tsc --noEmit after
✅ Show exact file path in confirmation
✅ Check OPENCLAW_CONTEXT.md for correct path
 before creating any new file
