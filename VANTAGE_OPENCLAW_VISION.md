# Vantage — Product Vision for OpenClaw
*Read this to understand the full product before implementing any feature*
*This supplements OPENCLAW_CONTEXT.md — read both*

## What Vantage Is
Vantage is a mobile-first AI portfolio analysis platform.
The AI chat is the hero feature — everything else supports it.
Think: ChatGPT for investing, not Robinhood with AI bolted on.

Target user: beginner to intermediate investor who wants
intelligent analysis of their portfolio without switching brokers.

## The Three Tiers (Architecture Must Support This)

DEMO (free, 30 days):
  - Simulated portfolio with real market prices (Finnhub)
  - Demo trading: buy/sell updates portfolio and cash balance
  - 25 AI messages/day stored in Supabase
  - No account required to start

SILVER (paid):
  - Connect real broker via Snaptrade (read-only, 50+ brokers)
  - OR CSV import of holdings
  - Real portfolio data replaces demo
  - No trade execution

GOLD (paid, higher tier):
  - Everything in Silver
  - Real trade execution via Alpaca
  - 50 AI messages/day
  - Sonnet model for all queries

## The Most Important Architectural Rules

1. SINGLE SOURCE OF TRUTH
   All portfolio data (positions, prices, cash, P&L) must flow
   from ONE place: PortfolioContext.
   Never calculate account value independently in multiple components.
   Every tab reads from PortfolioContext.

2. AI PERSONALIZATION IS CORE — NOT OPTIONAL
   Every single AI call (chat, Daily Brief, Weekly Snapshot,
   Alerts, Market Pulse, Tax Check, Build Basket, greeting)
   MUST inject:
     - investorStyle (Lynch/Buffett/Livermore/Munger/Soros)
     - riskTolerance (Conservative/Moderate/Aggressive)
   These live in Supabase user profile and localStorage fallback.
   If you write an AI prompt without these, it is wrong.

3. INVESTOR STYLE DRIVES EVERYTHING
   Lynch: GARP focus, cut losers, invest in what you know
   Buffett: value investing, moat, margin of safety, long-term
   Livermore: momentum, aggressive entries, technical levels
   Munger: quality businesses, mental models, concentrated bets
   Soros: macro trends, asymmetric bets, reflexivity
   
   The AI voice, recommendations, and risk framing must
   reflect the user's chosen style in every response.

4. SUPABASE IS THE BACKEND
   - Auth: email/password (Google/Apple SSO coming later)
   - Chat history: 7 rolling days per user
   - Message counts: daily, per user, reset at midnight
   - User profile: investorStyle, riskTolerance, tier, name
   - Price alerts: per user
   Never use localStorage as the primary store for anything
   that needs to persist across devices.

5. FINNHUB PRICES MUST BE FRESH
   Cache TTL: 60 seconds during market hours
   Cache TTL: 5 minutes outside market hours
   Always fetch fresh on tab mount.
   Never serve prices older than TTL without refetch.

6. DEMO TRADING MUST BE REAL
   When user buys: deduct shares × price from cashBalance,
   add position (or increase shares if existing).
   When user sells: add shares × price to cashBalance,
   reduce/remove position.
   All changes persist in Supabase (or localStorage for
   anonymous demo users, migrated on auth).

7. IDENTITY
   The app is "Vantage". The AI assistant is "Vantage AI".
   NEVER mention Claude, Anthropic, or any AI model name.
   NEVER say "I cannot provide financial advice" —
   the disclaimer is in the UI footer.
   BE direct, specific, and use real portfolio numbers.

## AI Models — Use the Right One
   Claude Haiku 4.5: regular chat messages
   Claude Sonnet 4.6: Weekly Snapshot, Alerts, Build Basket,
                      deep analysis, Tax Check, Market Pulse
   NEVER use DeepSeek for user-facing analysis.
   DeepSeek: only for internal routing (needs_search? yes/no)

## Design System (Never Deviate)
   Background: #0a0f1e (navy)
   Cards: #1a2235
   Accent: #22d3ee (cyan)
   Gains: #10b981 (emerald)
   Losses: #ef4444 (red)
   Border radius: rounded-lg
   Mobile-first: all UI designed for 390px width
   Safe area: always account for bottom nav (80px) +
              env(safe-area-inset-bottom)
   No modal or sheet should render behind the bottom nav.

## Current Build Status
   Working: AI chat, portfolio display, watchlist,
            daily brief, weekly snapshot, alerts,
            market pulse, invest tab basics
   Needs work: demo trading persistence, Supabase auth,
               onboarding flow, Snaptrade, chart,
               price alerts, earnings calendar,
               push notifications, light mode
   Coming later: Google/Apple SSO, Tradier/IBKR,
                 App Store submission

## File Structure Reminder
   Always check OPENCLAW_CONTEXT.md for correct file paths.
   Always pwd to confirm you are in ~/projects/vantage
   Always push to master (not main) for Vercel deploys.
   Always run tsc --noEmit before pushing.
