# AI Advisor Grounding & Account-Action Design

**Status:** Phase 1 implemented. Phase 2 (account-action tools + intents) **implemented**. Phases 3–4 outstanding (Phase 4 needs explicit go-ahead — real money).

## Problem
The AI Advisor ("Vantage AI") answers account/profile questions on a **light path** with no
grounding guardrails, so it can hallucinate. Confirmed example: on "What is my investment
style", it correctly said "Buffett" then fabricated a **"$1,000 ETF portfolio"** and recommended
**ROK / AXON / PLTR** ("you already own several of those" — false). The user holds none of these
and has no $1,000 ETF; real portfolio ≈ $101K with ~$755 invested.

## Root cause
- `app/api/chat/route.ts` routes via `lib/ai/classifier.ts` (GPT-5 nano) into 8 categories.
  Only `portfolio_construction` + `direct_trade_instruction` take the **full pipeline**
  (screening + `[RECOMMEND:]` markers + `validatePortfolioBlocks`). Everything else —
  including profile questions — takes the **light path**: free-form Claude Haiku, web search +
  market data, but **no screening, no marker validation, no grounding check**.
- The model has exactly ONE tool (`resolveSymbol`). It has **no tools to read the portfolio,
  change style, or compute a rebalance plan**, so for account actions it invents behavior.
- The system prompt is full of concrete example amounts ("$1,000", "$3,500", VOO/QQQ/MSFT)
  that leak into hallucinated output.

## Phases

### Phase 1 — Grounding (implemented, no mutations)
1. **Deterministic profile answers** (`lib/ai/profile-answers.ts`): intercept pure
   "what is my style / risk tolerance / profile" questions and answer from the server-known
   `profile` (style label + description + lens + risk). No model call → zero hallucination.
2. **System-prompt hardening** (`lib/ai-system-prompt.ts`):
   - New rule: profile/account questions → answer ONLY from profile/portfolio context; never
     recommend stocks, never reference/invent a portfolio amount.
   - New rule: never state a portfolio total / position / cash amount not present in
     PORTFOLIO CONTEXT; if context is empty, say so.
   - Annotate example dollar amounts as FORMAT placeholders (stop "$1,000" leaking).

### Phase 2 — Account-action tools + intents (IMPLEMENTED)
Model-facing tools so the advisor can *act* instead of hallucinating. Delivered in three
sub-phases (all committed Aug 2026):
- **Read-only tools** (`lib/ai/readonly-tools.ts`, "2a") — `getPortfolio()`, `getStyleTargets(style)`,
  `getRebalancePlan(style)`, plus `listDcaSchedules`, `listBaskets`, `listAlerts`, `listWatchlist`,
  `listOrders`. All read-only, safe on every intent.
- **Money tools** (`lib/ai/money-tools.ts`, "2b/2c") — `previewBuyStock`, `previewSellStock`,
  `previewExecuteBasket`, `previewDca*`, `previewAlert*`, `previewWatchlist*`. PREVIEW-ONLY: they
  validate + stage a short-lived `pending_action` (5-min TTL, one-outstanding-per-user) and never
  execute. The deterministic confirm gate (`lib/ai/confirm.ts` + `lib/ai/executors.ts`) runs the
  real side effect only after a terse user confirm.
- **Deterministic style/risk mutations** (`app/api/chat/route.ts`, profile_mutation branch) —
  `changeInvestorStyle(style)` is NOT a model tool; it is intercepted by `classify()` →
  `profile_mutation` → `extractStyleTarget` and written to `users.investor_style` directly
  (with `extractRiskTarget` → `users.risk_tolerance`). This is deliberate (Phase 1 design):
  rigid intents never originate outside the classifier. Classifier fallback handles phrasings the
  regex misses (`profileField`/`profileValue` → `normalizeStyle`).
- **Compound detection** — "change my style to X and rebalance" is handled in the same
  profile_mutation branch: it checks `extractRebalanceTarget().rebalance` and chains
  `computeRebalancePlan` after the style write.

Test coverage: `tests/readonly-tools.test.ts` + `tests/money-tools.test.ts` (added 2026-09-04).

### Phase 3 — Light-path validation ("solid check", proposed)
Post-generation grounding check for account/portfolio-relative light-path responses: detect
referenced `$` amounts / portfolio totals / held tickers and cross-check against the injected
`portfolioContext`; on mismatch, inject a correction or regenerate. (Full pipeline already
validates `[PORTFOLIO:]` blocks.)

### Phase 4 — Rebalance execution rewire (proposed, touches REAL orders — report-before-fix)
`/api/strategies/rebalancing/execute` currently uses the **legacy direct-Alpaca path**
(`getBrokerContext` + `makeAlpacaRequest`) — the same dead path DCA had for SnapTrade users.
Rewire to `resolveSnapTradeCredentials` + `SnapTradeBroker.placeOrder` so "rebalance" actually
executes for SnapTrade users. Requires explicit go-ahead (real money).

## Key files
- `app/api/chat/route.ts` — routing, tools, pipeline split.
- `lib/ai/classifier.ts` — GPT-5 nano taxonomy (8 categories).
- `lib/ai/manager.ts` — regex `classifyIntent` (superseded by classifier for routing).
- `lib/ai-system-prompt.ts` — `VANTAGE_SYSTEM_PROMPT` (heavy anti-hallucination rules already;
  gaps: profile-question scoping + invented-portfolio-amount).
- `lib/ai/userProfile.ts` — `buildUserProfileContext`, `getInvestorStylePrompt`, `getRiskTolerancePrompt`.
- `lib/investor-style-defaults.ts` — `getStyleConfig(style)` → `{label, description, screening, allocation, scoring}`.
- `lib/investor-style-targets.ts` — `getInvestorStyleTargets(style)` → ETF targets.
- `lib/chat-response-validation.ts` — `validatePortfolioBlocks`, `detectResponseIncoherence` (full pipeline only).
- `app/api/db/users/update/route.ts` — style change (VALID_STYLES: buffett/lynch/livermore/soros/munger).
- `app/api/strategies/rebalancing/execute/route.ts` — Alpaca-only rebalance execution (dead for SnapTrade).
