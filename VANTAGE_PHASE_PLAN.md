# Vantage — Master Phase Plan
*Paste this into any new Claude chat to restore full project context*

## Product Vision
Vantage is a mobile-first AI portfolio analysis platform.
AI is the operating system, not a feature.
Target user: beginner to intermediate investor.
Competitor positioning: beats Robinhood/Fidelity on AI intelligence,
beats generic AI tools on financial specificity.

## Live App
- URL: vantage-ai-trading.vercel.app
- Repo: github.com/flysaurus/vantage-ai-trading (master branch)
- Stack: Next.js 15, React 19, TypeScript, Tailwind CSS 4, Supabase, Vercel
- Data: Finnhub API, SearXNG (85.239.230.26:8888)
- AI: Claude Haiku 4.5 (chat), Claude Sonnet 4.6 (deep analysis)
- Agent: OpenClaw on VPS 85.239.230.26 via Telegram

## Tier Structure

### TIER 1: DEMO (30 days free, no account required)
- Full app with simulated portfolio (real Finnhub prices)
- Demo trading updates portfolio/cash in real time
- 25 AI messages/day (Supabase-persisted)
- Daily Brief (real SearXNG news) + Weekly Snapshot (Sonnet)
- All 5 investor styles (Lynch/Buffett/Livermore/Munger/Soros)
- After 30 days → upgrade prompt

### TIER 2: SILVER ($12/month suggested)
- Connect real broker via Snaptrade (50+ brokerages, read-only)
- OR CSV import (AI-parsed holdings)
- OR Alpaca OAuth (read-only)
- Real portfolio, real P&L — NO trade execution
- 25 AI messages/day
- Daily Brief + Weekly Snapshot
- Target: Fidelity/Schwab/Vanguard users who won't leave their broker

### TIER 3: GOLD ($24/month suggested)
- Everything in Silver
- Real trade execution via Alpaca
- 50 AI messages/day
- Sonnet for ALL queries (not just deep analysis)
- Advanced alerts
- Target: active traders wanting AI-assisted execution

## Broker Strategy
- Primary aggregator: Snaptrade (Silver)
  → 50+ brokerages via OAuth, ~$0.20/account/month
  → Users keep existing broker, connect read-only
- Trade execution: Alpaca (Gold)
- Fallback: CSV import (always available, any tier)
- Future: Tradier, Tastytrade, IBKR (v0.2+)

## AI Personalization (Core Differentiator)
- Investor Style drives AI voice, recommendations, risk framing
  Lynch: GARP, invest in what you know, cut losers
  Buffett: value, moat, long-term, margin of safety
  Livermore: momentum, technical, aggressive entries
  Munger: mental models, quality businesses, patience
  Soros: macro, reflexivity, asymmetric bets
- Risk Tolerance (Conservative/Moderate/Aggressive) filters all advice
- Both injected into EVERY AI prompt, every feature
- AI remembers across sessions (Supabase)

## Design System
- Navy background: #0a0f1e
- Card background: #1a2235
- Cyan accent: #22d3ee
- Gains: #10b981 (emerald)
- Losses: #ef4444 (red)
- Border radius: rounded-lg (not rounded-2xl)
- App name: Vantage (drop "AI" from product name)
- Identity: "Vantage AI" in chat only — never mention Claude/Anthropic

## Message Limit UX
- At 23/25: subtle banner "2 analyses remaining — upgrade for 50"
- At 25/25: input disabled, upgrade CTA shown
- Hard reset at midnight, per Supabase account
- Soft upsell, never hard wall

---

## Phase Plan

### PHASE 1 — Data & Foundation
- Portfolio seed data rebuild (10 positions, math validated)
- Finnhub price cache fix (60s market hours, 5min after hours)
- Demo trading — buy/sell updates portfolio + cash in real time
- Shared PortfolioContext as single source of truth
- Order history rebuild (correct orders, years in dates, total cost)
- Market value on portfolio cards (shares × live price)
- Account value = positions + cash, consistent everywhere

### PHASE 2 — AI Core
- Investor style + risk tolerance injected into every AI prompt
- Style-driven AI personality per investor type
- Weekly Snapshot → Sonnet model
- Daily Brief → real SearXNG news, no static content
- Greeting message → personalized, real data
- AI memory across sessions (Supabase)
- Message counter → Supabase per account
- Conversational AI screener

### PHASE 3 — Onboarding & Auth
- Supabase auth (email/password, Google/Apple post-launch)
- Onboarding flow: investor style quiz + risk tolerance
- Anonymous → authenticated session migration
- Demo 30-day timer
- First initial from auth profile (replaces hardcoded "M")
- Tier state management (Demo/Silver/Gold gating)

### PHASE 4 — Portfolio Chart + UI Polish
- Portfolio performance chart: 1D / 1W / 1M / YTD / 1Y (recharts)
- Light mode toggle
- Notification center (bell icon) with real alerts
- Price alerts functional (Supabase-backed)
- Earnings calendar → real Finnhub data
- Chat history modal fix
- UI spacing and polish pass

### PHASE 5 — Upgrade Flow + Paywall
- Soft upsell banner at message 23
- Paywall modal at message 25
- 30-day demo expiry → upgrade prompt
- Stripe integration
- Silver/Gold tier gates in UI

### PHASE 6 — Snaptrade Integration
- Snaptrade OAuth connect flow
- Real portfolio sync replacing demo positions
- CSV import parser (AI-powered)
- Silver tier unlocked on connection
- Portfolio tab switches demo → real data

### PHASE 7 — Invest Tab: Strategies
- Build Basket (theme → budget → AI → review → execute)
- DCA strategy (symbol, amount, frequency → demo trades)
- Rebalance (target allocation → AI suggests → execute)
- Tax Harvest (AI identifies losses → suggest harvests)

### PHASE 8 — Pre-Launch Polish
- Push notification service worker
- Universal search (stocks + portfolio + AI history)
- Notification bell center
- Alpaca Gold tier trading execution
- Remove all stubs or label honestly
- Full tap-target audit
- Mobile Safari safe area fixes
- Performance pass

### POST-LAUNCH
- Google/Apple SSO
- Light/dark mode persistence
- Tradier, Tastytrade, IBKR
- Advanced alerts (volume, momentum)
- Portfolio vs SPY benchmark
- App Store submission

---
*Last updated: June 2026*
