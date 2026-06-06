# OPENCLAW_CONTEXT.md
# Vantage AI — Master Build Context
# Read this file at the start of EVERY prompt before touching any code.
# Last updated: June 2026

---

## 0. MANDATORY WORKFLOW (no exceptions)

Before every edit:
1. `pwd` → must show `projects/vantage`
2. `cat [file]` → read the full file before changing it
3. Make changes
4. `tsc --noEmit` → fix all TypeScript errors before moving on
5. Show exact diff of what changed

If `pwd` is wrong, run `cd ~/projects/vantage` before anything else.
Never write to `src/components/` — it does not exist.

---

## 1. PROJECT OVERVIEW

| Field       | Value                                      |
|-------------|--------------------------------------------|
| App         | Vantage AI — AI-powered portfolio analysis |
| URL         | https://vantage-ai-trading.vercel.app      |
| Dev port    | 3002                                       |
| Stack       | Next.js 15, React 19, TypeScript 5         |
|             | Tailwind CSS 4, Supabase, Vercel           |
| Active dir  | ~/projects/vantage/                        |

---

## 2. CONFIRMED FILE LOCATIONS

Do not create files at any other path without checking first.

```
components/
  ai/
    AITab.tsx
    AIChat.tsx
    AIThinkingIndicator.tsx
    QuickActions.tsx
    DailyBriefCard.tsx
    WeeklySnapshotCard.tsx
  layout/
    BottomNav.tsx
    Header.tsx
    MarketBar.tsx
  portfolio/
    PortfolioTab.tsx
    PositionRow.tsx
  orders/
    OrdersTab.tsx
  trade/
    TradeTab.tsx
  settings/
    SettingsTab.tsx
  watchlists/          ← needs creation
  shared/
    AccountSummaryCard.tsx
    DemoBanner.tsx
  BuildBasketModal.tsx
  CompassIcon.tsx
  GreetingModal.tsx    ← being removed
  SplashScreen.tsx
  SplashGuard.tsx

app/
  page.tsx
  layout.tsx
  watchlists/page.tsx
  api/
    chat/route.ts
    ai/
      daily-brief/route.ts
      weekly-snapshot/route.ts
    portfolio/
      summary/route.ts
      history/route.ts     ← new
    stock/
      candles/[symbol]/route.ts  ← new

lib/
  ai-provider.ts
  ai-system-prompt.ts
  ai-context.ts
  demo-data.ts
  portfolio-operations.ts
  market-hours.ts
  finnhub.ts

hooks/
  usePortfolio.ts
  useAIChat.ts

store/
  index.ts
```

---

## 3. EVENT BUS

```
'vantage-open-basket-modal'  →  opens BuildBasketModal (full screen)
'vantage-basket-generated'   →  sends result to AI chat
```

---

## 4. DESIGN SYSTEM

### 4.1 Colors

```css
/* Backgrounds */
--bg-page:     #0a0f1e;   /* dark navy — NOT pure black */
--bg-card:     #111827;   /* slate-900 */
--bg-elevated: #1f2937;   /* slate-800 */
--bg-input:    #1f2937;   /* slate-800 */

/* Borders */
--border-subtle: #1f2937; /* slate-800 */
--border-active: #374151; /* slate-700 */
--border-focus:  #22d3ee; /* cyan-400   */

/* Text */
--text-primary:   #ffffff;
--text-secondary: #94a3b8; /* slate-400 */
--text-muted:     #64748b; /* slate-500 */
--text-disabled:  #374151; /* slate-700 */

/* Brand — ONE accent only */
--accent: #22d3ee; /* cyan-400 */

/* Financial */
--gain:    #34d399; /* emerald-400 */
--loss:    #f87171; /* red-400     */
--warning: #fbbf24; /* amber-400   */
--neutral: #94a3b8; /* slate-400   */
```

### 4.2 Left Border Colors (positions, watchlist rows, futures)

```
Up today:   border-l-4 border-emerald-500
Down today: border-l-4 border-red-500
Unchanged:  border-l-4 border-slate-600
```

### 4.3 Typography — 5 sizes, nothing smaller than 12px

| Role             | Class                        |
|------------------|------------------------------|
| Hero value       | text-4xl font-bold           |
| Section header   | text-lg font-semibold        |
| Body (minimum)   | text-base font-normal        |
| Secondary        | text-sm text-slate-400       |
| Metadata         | text-xs font-medium text-slate-500 |
| Nav label        | text-[11px] font-medium      |

Rule: body copy minimum `text-base` (16px). Nothing below `text-xs` (12px).

### 4.4 Spacing — 4px grid only

```
Page margin:   px-4    (16px)
Card padding:  p-4     (16px)
Section gap:   mb-4    (16px)
Element gap:   gap-3   (12px)
Row padding:   py-3 px-4
Touch target:  min-h-[48px]
```

### 4.5 Card Style

```tsx
className="bg-slate-900 rounded-2xl border border-slate-800 p-4"
```

### 4.6 Interactions

```tsx
className="active:scale-95 transition-all duration-150"
// All buttons: min-h-[48px]
// Color transitions: transition-colors duration-200
```

### 4.7 Loading States

Use skeleton loaders, NOT spinners.
```tsx
className="animate-pulse bg-slate-800 rounded"
// Match fixed height to real content
```

### 4.8 Empty States

Always: icon + headline + subtext + CTA button. Tell the user what to do.

---

## 5. NAVIGATION — FINAL STRUCTURE

5 tabs. Raised center AI button. Monarch Money pattern.

```
💼 Portfolio  →  lucide Briefcase
📈 Invest     →  lucide TrendingUp
🧭 AI         →  CompassIcon  (RAISED CENTER BUTTON)
⭐ Watchlist  →  lucide Star
⚙️ Settings   →  lucide Settings
```

### Bottom Nav Bar

```tsx
// Nav bar container
className="bg-slate-900 border-t border-slate-800 h-16 pb-safe"

// Active tab
icon: cyan-400, label: cyan-400

// Inactive tab
icon: slate-400, label: slate-400

// Nav labels
className="text-[11px] font-medium"
```

### Raised AI Button

```tsx
// Raised circle button — always cyan even when inactive
className="w-14 h-14 bg-cyan-500 rounded-full shadow-lg shadow-cyan-500/30"
style={{ marginBottom: '20px' }}  // lifts above nav bar

// CompassIcon inside
<CompassIcon size={28} color="white" />
```

REMOVED: Orders tab (merged into Invest tab)
REMOVED: GreetingModal (AI tab handles context)

---

## 6. MARKET TICKER STRIP

Shown on: Portfolio tab, Invest tab only.
NOT shown on: AI tab, Watchlist tab, Settings tab.

Symbols: SPY · QQQ · IWM · DIA · XLF

```tsx
// Each ticker item
// Up:   text-emerald-400
// Down: text-red-400
// Horizontal scroll, no scrollbar
```

---

## 7. PORTFOLIO TAB

### Account Card
```
bg-slate-900 rounded-2xl border border-slate-800 p-4

ACCOUNT VALUE          (text-xs slate-400 uppercase tracking-wider)
$119,780.10            (text-4xl font-bold white)
● Growth Chaser  Change ›   (inline, cyan-400 "Change")

[Sparkline — recharts, emerald/red based on P&L]
[1D] [1W✓] [1M] [3M] [1Y]   ← pill timeframe selector, default 1W

TODAY P&L      TOTAL P&L
$3,681  -3.0%  $11,336  +10.4%

BUYING POWER   CASH
$179,670.15    $14,373.61
```

All money values: `toLocaleString({ minimumFractionDigits: 2 })`

### Sections (in order)
1. BASKETS — collapsed cards with inline expand
2. CORE HOLDINGS — collapsed position rows with inline expand
3. SECTOR ALLOCATION — horizontal bar chart
4. Sell Entire Portfolio (destructive, requires typing "SELL")

### Position Row (collapsed)
```
[3px left border]  SYMBOL      $VALUE  ›
                   Xsh · Sector  +$P&L (+%)
```

### Position Row (expanded — tap to toggle)
```
[3px left border]  SYMBOL      $VALUE  ▼
                   X shares · Sector  +%

[7-day sparkline — real Finnhub data]

Avg Cost:  $xxx   Current: $xxx
P&L:       +$xxx  Today:   -$xxx

[Buy More]              [Sell]
```

### Select & Sell Mode
- Top-right button: "Select & Sell" (text-sm slate-400)
- Checkboxes appear on all positions
- Bottom bar: "Sell Selected (N) · ~$value"  [Cancel] [Sell Selected]

### Sell Bottom Sheet (individual)
```
SELL [SYMBOL]
X shares available · $price/share

○ All shares (X) — est. $value
○ Partial: [___] shares

ORDER TYPE:      [Market✓] [Limit] [Stop]
TIME IN FORCE:   [Day✓]    [GTC]
LIMIT PRICE:     (shown only if Limit selected)

Est. proceeds: $value
[Cancel]    [Confirm Sell]
```

### Sell Bottom Sheet (basket)
```
Sell 🤖 [Basket Name]
N positions · ~$value

SYMBOL  Xsh  ~$value  market
...

All at market price
[Cancel]    [Confirm & Sell All]
```

---

## 8. INVEST TAB

### Layout (top to bottom)
1. Market ticker strip
2. Symbol search bar (→ search modal)
3. Place Order form
4. STRATEGIES section
5. READY TO EXECUTE (only if pending baskets)
6. ORDER HISTORY

### Place Order Form
```
[BUY ✓]                [SELL]

ORDER TYPE:   [Market✓] [Limit] [Stop]
QUANTITY:     [Shares✓] [Dollars]
              [input]
TIME IN FORCE: [Day✓]  [GTC]
LIMIT PRICE:   (only if Limit)

Buying Power: $179,670.15

[Place Order]   ← large cyan button, min-h-[56px]
```

### Strategies
```
[DCA]  [Rebalance]  [Tax Harvest]
[Momentum Soon]  [Mean Reversion Soon]

Active:  border border-cyan-500/60 bg-cyan-500/10
Soon:    border border-slate-700 text-slate-600
         cursor-not-allowed, shows "Soon" badge
```

### Ready to Execute (pending baskets)
```
Red badge on Invest tab icon when baskets pending

🤖 [Basket Name]   N stocks
[Review & Order →]    [Watch]  [×]
```

### Order History
```
[Open (0)] [Filled (11)] [Cancelled] [All]

Order card:
  [3px green left border — filled]
  SYMBOL  BUY  FILLED
  TYPE: market  QTY: 25  FILL: $price  TIF: DAY
  Date · Time                         [Details]
```

RULE: AI responses must NEVER include rebalancing execution instructions.
      Always direct user to Invest tab → Strategies.

---

## 9. AI TAB

NO market ticker strip.

### Layout (top to bottom)
1. Compact account card
2. Daily Brief card (collapsible)
3. Weekly Snapshot card (collapsible)
4. Divider: "── Ask Vantage AI ──"
5. Chat messages area (flex-1, min-h-[200px])
6. 2×2 Quick Actions grid
7. Input bar

### Compact Account Card
```
$119,780.10          (text-2xl font-bold)
TODAY -3.0% · TOTAL +10.4%   (text-sm slate-400)
```

### Daily Brief Card
```
bg-slate-800 rounded-2xl border border-slate-700

Header: 📡 Daily Brief · Today   (text-xs cached label)

Preview (always visible):
MARKET:    [cyan-400 label]    market summary text
PORTFOLIO: [emerald-400 label] portfolio summary text

▼ Show more

Expanded adds:
WATCH:    [amber-400 label]   watchlist note
EARNINGS: [purple-400 label]  upcoming earnings (if any)

Generated now · Updates tomorrow
```

### Weekly Snapshot Card
```
bg-slate-800/60 rounded-2xl border border-slate-700/60

Header: 📊 Weekly Snapshot   [↻ refresh]

Summary (always visible):
Health 7.2/10  Risk LOW  2 opportunities

Health color:
  ≥7:  emerald-400
  ≥5:  amber-400
  <5:  red-400

▼ Full analysis

Expanded:
  Full ReactMarkdown output
  Generated Jun 6 · 10:15 AM
  [↻ Refresh]  (costs 1 deep analysis)
```

### Chat Messages
```
User:  right-aligned, bg-cyan-500/20 rounded-2xl
AI:    left-aligned, bg-slate-800 rounded-2xl
       ReactMarkdown with tables, bold, lists

Contextual suggestions (when no messages):
Based on real portfolio data — e.g.:
  "NVDA down 4.2% today — want analysis?"
  "META earnings in 3 days — prepare?"
Tap → sends as message
```

### AI Thinking Indicator
```tsx
// Inside chat area only — no wrapper bubble
<CompassIcon size={22} color="white" animated={true} />
<span>Analyzing your portfolio —</span>
// NO "..." anywhere
```

### 2×2 Quick Actions Grid
```tsx
className="grid grid-cols-2 gap-2 px-4"

// Each button:
className="bg-slate-800 border border-slate-700 hover:border-cyan-500/40
           active:scale-95 rounded-xl py-2.5 text-sm font-medium w-full"

[🧺 Build Basket]  [📡 Market Pulse]
[📋 Tax Check   ]  [⚡ Alerts      ]

Build Basket → fires 'vantage-open-basket-modal' event
Others       → sends pre-written message to chat
```

### Input Bar
```
[input pl-5]  [send — cyan]  [trash]
NO hamburger/menu button
```

### Footer
```
Powered by AI · Not financial advice · X messages remaining today
```

### Chat History
- Session-based (new session if >30 min gap)
- "View previous conversations →" link below footer
- Trash button clears current session

### Alerts Mode (when ⚡ Alerts tapped)
System prompt scans for:
- Price moves >5%
- Earnings within 3 days
- Concentration >20% single stock
- Sector weight >50%

Format:
```
🔴 URGENT — [item] — [data point] — [suggested action]
🟡 WATCH  — [item] — [data point]
🟢 INFO   — [item] — [data point]

If nothing: ✅ All clear today
```

---

## 10. BUILD BASKET MODAL

FULL SCREEN — covers entire screen including bottom nav.

### Step 1 — Theme Selection
```
Header: Build a Basket    [✕]

Grid 2 cols (icon + name only, no descriptions):
[🤖 AI Infrastructure]  [🌱 Clean Energy   ]
[🛡️ Cybersecurity    ]  [🧬 Healthcare     ]
[💰 Dividends        ]  [🏭 Reshoring       ]
[💳 Fintech          ]  [🛍️ Consumer        ]
[✏️ Custom Basket — full width, dashed border]
```

### Step 2 — Budget
```
Header: [← back]  [Theme Name]  [✕]

Theme preview card

Budget: $ [large input]
Quick: [$1K] [$5K] [$10K] [$25K]

[Generate 🤖 Basket]   ← pinned to bottom, uses 1 deep analysis
```

### Basket Flow
```
AI generates → badge appears on Invest tab icon
User → Invest tab → Ready to Execute
Taps "Review & Order" → /invest/basket/[id]
Places orders → returns to Invest tab
Portfolio tab → basket appears in positions
```

---

## 11. WATCHLIST TAB

Fidelity-inspired. Color-coded left borders. Dense but readable.

### Header
```
[Tech Stocks ▾]    [+ Add]  [⋯]
```

### List Selector (bottom sheet)
```
● Tech Stocks (4 stocks)
○ Dividend Watch (6 stocks)
[+ Create New List]
```

### Each Row
```
min-h-[56px]
[3px left border — emerald/red/slate]

Left:
  NVDA          (text-base semibold white)
  NVIDIA Corp   (text-sm slate-400, truncated)

Right:
  $124.56       (text-base semibold white)
  -7.1%         (text-sm red-400)
  -$9.42        (text-xs slate-400)

If owned: small "50 shares" badge (text-xs cyan-400/20 bg)

Tap row   → stock detail (future feature)
Swipe left → delete from watchlist
```

### Footer
```
[+ Add Symbol to Watchlist]   ← full-width button
```

### Empty State
```
⭐ No stocks yet
Add symbols to track them here
[+ Add Symbol]
```

---

## 12. SETTINGS TAB

NO market ticker. NO account card.

### Sections

**PROFILE**
```
Investor Style
Lynch · Tap to change           ›   → /investor-style

Risk Tolerance
[Conservative] [Moderate ✓] [Aggressive]
```

**BROKER**
```
Not connected:
  Not connected · [Connect Broker →]   ›

Connected:
  Alpaca · Connected ✓               ›
  [Disconnect]
```

**TOOLS**
```
Watchlists      1 list · 4 symbols    ›
Price Alerts    2 active              ›
Earnings Cal.   10 holdings tracked   ›
News Feed       AI-curated            ›
Trade History   All time activity     ›
```

**ACCOUNT**
```
Preferences     Appearance · Security ›
Help & Support  Docs · Contact        ›
Sign Out        (red text, no background, destructive)
```

**Footer**
```
Vantage v0.1.0
AI-First · Mobile-First · Built with ❤️
```

HIDDEN (do not build, do not show):
- Goals & Targets
- Stock Screener
- Account & Funding

---

## 13. CHARTS — REAL DATA ONLY

### Portfolio Sparkline (account card)

```
API: GET /api/portfolio/history
Params: userId, timeframe (1D | 1W | 1M | 3M | 1Y)

Logic:
  1. Fetch positions (symbol, qty, avg_cost, buy_date)
  2. For each date in timeframe:
       value = Σ(qty × close_price) for positions owned at that date
       Before buy_date: $0 for that position
  3. Return: [{ date, value, pnl, pnl_pct }]

Finnhub endpoints:
  1D:          /stock/candle?resolution=5   (5-min bars)
  1W/1M/3M/1Y: /stock/candle?resolution=D

Cache: 1 hour
Default timeframe: 1W
```

```tsx
// recharts config
<LineChart>
  <Area     // gradient fill, 20% opacity under line
  <Line     // emerald-400 if pnl ≥ 0, red-400 if pnl < 0
  <Tooltip  // shows $value · date on touch
// NO XAxis labels, NO YAxis labels, NO grid lines
```

### Position Mini Chart (expanded position card)

```
API: GET /api/stock/candles/[symbol]
Params: symbol, timeframe
Returns: [{ date, close }]
Cache: 1 hour
Default: 1W

Same visual style as portfolio sparkline.
```

---

## 14. AI SYSTEM

### Models
```
General chat:   claude-haiku-4-5     (fast, cheap)
Deep analysis:  claude-sonnet-4-6    (thorough)
```

### Daily Limits
```
Messages:       75 / day
Deep analyses:  20 / day
Resets:         midnight UTC
```

### Deep Analysis Modes
```
research | theme | health | opportunities | tax | alerts | market_pulse
```

### Finance Guard
Block non-finance queries before AI call:
> "Vantage AI specializes in portfolio analysis and US market research only."

### AI Response Rules

NEVER say:
- "Great question", "Certainly", "Of course"
- "Keep in mind", "Some investors believe"
- Rebalancing execution steps → direct to Invest tab → Strategies

ALWAYS include:
- Specific data points (prices, %, dates)
- Conviction level (High / Medium / Low)
- Reference to user's investor style mandate

---

## 15. DEMO PORTFOLIO SYSTEM

Single source of truth: `lib/portfolio-operations.ts`
Same DB tables as real users. `is_demo` flag on positions and orders.

### 5 Styles × 10 Positions Each

| Style               | Symbols                                      |
|---------------------|----------------------------------------------|
| Lynch (Growth)      | META MSFT GOOGL AMZN NVDA CRM NFLX ADBE UBER SQ |
| Buffett (Value)     | AAPL KO BAC AXP CVX OXY MCO KHC VZ JNJ      |
| Livermore (Momentum)| NVDA AMD TSLA SMCI ARM MSTR COIN PLTR RKLB SOFI |
| Munger (Dividend)   | BRK.B COST V MA MSFT WM UNH SPGI ROL NVO    |
| Soros (Macro)       | GLD TLT EEM FXI GDX USO SPY QQQ UUP BITO    |

### Transitions
```
First login (no positions)  → auto-seed demo portfolio
Style change (demo)         → confirmation modal → reseed
Broker connect              → clear demo → sync real positions
Broker disconnect           → clear real → reseed demo
Any transition              → clear portfolio cache
```

---

## 16. COMPASS ICON SPEC

Custom SVG — NOT a lucide icon. Do not substitute.

```
Shape:     4-pointed star rose
           North point dominant (tall)
           South/East/West points subtle (shorter)
           Circle ring around all 4 points

In nav:    cyan-400 fill, static
In chat:   white fill, animated (needle sweep)
In splash: white fill, settling animation
```

---

## 17. PROMPT EXECUTION ORDER

Send to OpenClaw one at a time. Each prompt must start with:

```
READ FIRST: ~/projects/vantage/OPENCLAW_CONTEXT.md
pwd → confirm projects/vantage
cat [target file(s)] before changing anything
```

### Prompt sequence:
```
Prompt 1 — Bottom nav: 5 tabs + raised AI button
Prompt 2 — Portfolio tab: account card + sparkline + positions + baskets + sell flows
Prompt 3 — Invest tab: order form + strategies + ready to execute + order history
Prompt 4 — AI tab: compact card + daily brief + weekly snapshot + chat + 2×2 grid
Prompt 5 — Watchlist tab: Fidelity-inspired, color borders, list selector
Prompt 6 — Settings tab: cleanup + hide unbuilt sections
Prompt 7 — Design system pass: typography + spacing + colors across all tabs
Prompt 8 — Charts: portfolio sparkline + position mini charts (real Finnhub data)
```

---

## 18. KEY DECISIONS LOG

| # | Decision | Choice |
|---|----------|--------|
| Q1 | Home tab order | Option B — insights first |
| Q2 | Tap position | Option B — inline expand + chart |
| Q3 | Chat history | Option B — session-based |
| Q4 | Empty AI tab | Option B — contextual suggestions |
| Q5 | Basket review | Option A — Invest tab Ready to Execute |
| Q6 | Rebalancing | Option A — stays in Invest Strategies |
| Q7 | Sparkline | Option B — yes, add it |
| Q8 | Tab icons | briefcase / trending / compass / star / gear |
| Q9 | Primary user | Option C — demo + live both |
| Q10 | Portfolio tab | Option A — account + positions + sector |
| Q11 | Sparkline timeframe | Option D — user selectable |
| Q12 | Greeting modal | Option D — remove entirely |
| Q13 | Market ticker | Option B — Portfolio + Invest only |
| Q14 | Basket expand | Option A — inline |
| Q15 | Individual sell | Option A — bottom sheet (qty, type, TIF, limit) |
| Q16 | Sell all portfolio | Option A — type "SELL" |
| Q17 | Sell basket | Option C — bottom sheet with list |
| Q18 | Multi-select | Option C — Select & Sell button |
| Q19 | Sparkline data | Real Finnhub data only |
| Q20 | Position chart | Option C — simple, real data |
| Q21 | Empty basket | Option A — Invest tab only |
| — | Sparkline default | 1W |
| — | Portfolio history | Option B — true history from $0 |
| — | Nav pattern | 5 tabs, raised center AI (Monarch Money) |
| — | Watchlist | Option C — multiple lists, Fidelity-inspired |

---

*End of OPENCLAW_CONTEXT.md*
