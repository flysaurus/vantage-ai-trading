# AI Advisor Grounding & Account-Action Design

**Status:** Phase 1 implemented. Phase 2 (account-action tools + intents) **implemented**. Phase 3 (light-path "solid check") **implemented**. Phase 4 (rebalance execution rewire) **implemented**.

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

### Phase 3 — Light-path validation ("solid check", IMPLEMENTED)
Post-generation grounding check for account/portfolio-relative light-path responses. Wired at
`app/api/chat/route.ts` (~line 2255) via `detectPortfolioGroundingMismatch(responseText,
portfolioSnapshot)`, which composes three read-only cross-checks in
`lib/ai/account-actions.ts`:
- **Portfolio total** — `detectPortfolioTotalMismatch(text, equity)`: flags a claimed
  portfolio/account total that deviates >5% from actual equity (pattern fixed to also catch
  "is worth" / "is valued at" phrasings).
- **Cash** — `detectCashMismatch(text, cash)`: flags a fabricated cash-balance claim
  ("your cash is $X" / "$X in cash") >5% off actual cash (or any non-trivial claim when cash is $0).
- **Held tickers** — `detectUnheldTickerClaim(text, heldSymbols)`: flags "you own/hold X",
  "your position in X", "you have N shares of X" for tickers NOT in positions. Only fires when
  holdings data is authoritative (non-empty positions), so it never contradicts an unavailable feed.
  Mixed-case company names ("Apple") and common words (`NOT_TICKERS`) are skipped.

On any mismatch the backstop appends an honest `⚠️ *Correction: …*` note to the streamed answer
(instead of letting the hallucination stand). Test coverage: `tests/grounding-check.test.ts`.

**Known limitation:** the co-reference phrasing "you already own several of those" (no explicit
 ticker) is not caught — only explicit ticker ownership claims are. (Full pipeline already
 validates `[PORTFOLIO:]` blocks.)

### Phase 4 — Rebalance execution rewire (IMPLEMENTED, real orders — explicit go-ahead given)
`/api/strategies/rebalancing/execute` no longer uses the legacy direct-Alpaca path
(`getBrokerContext` + `makeAlpacaRequest`). Rewired to `resolveSnapTradeCredentials` +
`SnapTradeBroker.placeOrder` — the same engine as `/api/broker/execute-trade` and the DCA
scheduler — so rebalance now executes for SnapTrade users. Per-leg order mapping, persist-row
construction, and outcome/error handling are extracted into `lib/broker/rebalance-executor.ts`
(unit-tested in `tests/rebalance-executor.test.ts`).

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
