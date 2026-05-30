/**
 * POST /api/chat — AI streaming chat endpoint
 *
 * Proxies requests to DeepSeek API with Server-Sent Events.
 * NEVER exposes DEEPSEEK_API_KEY to the client.
 *
 * Features:
 *   - Streaming SSE response (token by token)
 *   - Structured output detection (parses JSON cards)
 *   - Model routing (chat vs reasoner)
 *   - Error handling with fallback
 *   - Cost estimation
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  TradeSignalSchema,
  RiskAnalysisSchema,
  RebalancePlanSchema,
  MarketInsightSchema,
} from '@/lib/schemas';
import { estimateTokens, estimateCost, selectModel } from '@/lib/ai';

const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';

// ─── Helpers ───

/** Per-style investment philosophies — injected into the system prompt */
/** Per-style investment philosophies — static reference for the AI */
const STYLE_PHILOSOPHY: Record<string, string> = {
  buffett: `Focus on: Intrinsic value vs current price, economic moat strength, dividend sustainability and growth, business quality (ROE, ROIC), 5-10+ year holding horizon. Suggest rebalancing toward: dividend payers, quality undervalued names with predictable earnings.`,

  lynch: `Focus on: Revenue growth trajectory (15%+), P/E relative to growth rate (PEG under 1.5), market expansion opportunities, management quality, 2-5 year horizon. Suggest rebalancing toward: fast-growing mid-caps, margin-expanding companies, understandable businesses.`,

  livermore: `Focus on: Technical trend strength, volume confirmation, support/resistance levels, entry/exit signals, 6-month max holding period. Suggest rebalancing toward: positions above 200MA, strong volume, breakout candidates, cut anything that breaks trend.`,

  soros: `Focus on: Macro regime alignment, sector rotation opportunities, interest rate sensitivity, recession risk positioning, early cycle positioning (6-18 month horizon). Suggest rebalancing toward: sectors favored by current macro outlook, ETF rotations, commodity exposure where appropriate.`,

  munger: `Focus on: Dividend yield and growth (5-7% annually), payout ratio sustainability, business stability, 10+ year holding horizon, compounding power. Suggest rebalancing toward: dividend aristocrats/kings, high-yield stable businesses, wide-moat compounders.`,
};

/**
 * Extract stock symbols from a text query.
 * Matches 1-5 char uppercase tickers, excluding common English words and known false positives.
 */
const FAKE_TICKERS = new Set([
  'I', 'A', 'AM', 'AN', 'AS', 'AT', 'BE', 'BY', 'DO', 'GO', 'HE', 'HI', 'IF', 'IN',
  'IS', 'IT', 'ME', 'MY', 'NO', 'OF', 'OK', 'ON', 'OR', 'SO', 'TO', 'US', 'WE',
  'ALL', 'AND', 'ARE', 'CAN', 'CEO', 'DID', 'END', 'EPS', 'ETA', 'FOR', 'GDP',
  'HAS', 'HOW', 'IPO', 'ITS', 'LOW', 'NEW', 'NOT', 'NOW', 'OUR', 'OUT', 'PE',
  'PUT', 'THE', 'TOO', 'WAS', 'WAY', 'WHO', 'WHY', 'WOW', 'YOY',
  'ABOUT', 'AFTER', 'AGAIN', 'EVERY', 'PRICE', 'SINCE', 'STOCK', 'THERE',
  'THEIR', 'THESE', 'THINK', 'TRADE', 'TREND', 'VALUE', 'WHICH', 'WOULD',
  'CHANGE', 'MARKET', 'MONEY', 'NEWS', 'GROWTH',
]);

function extractSymbols(text: string): string[] {
  if (!text) return [];
  const matches = text.toUpperCase().match(/\b[A-Z]{1,5}\b/g) || [];
  return [...new Set(matches.filter(s => !FAKE_TICKERS.has(s)))];
}

/** Fetch Finnhub quote + profile for a symbol. Returns null on failure. */
async function fetchStockData(symbols: string[]): Promise<Record<string, any> | null> {
  const apiKey = process.env.FINNHUB_IO_API_KEY;
  if (!apiKey || symbols.length === 0) return null;

  const results: Record<string, any> = {};
  const uniqueSymbols = [...new Set(symbols)].slice(0, 5); // Limit to 5 stocks max

  const fetchSymbolData = async (symbol: string) => {
    try {
      const [quoteRes, profileRes] = await Promise.all([
        fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${apiKey}`),
        fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${symbol}&token=${apiKey}`),
      ]);
      const quote = quoteRes.ok ? await quoteRes.json().catch(() => ({})) : {};
      const profile = profileRes.ok ? await profileRes.json().catch(() => ({})) : {};
      
      if (!quote.c || quote.c === 0) return null; // No valid quote data
      
      return {
        symbol,
        price: quote.c,
        change: quote.d,
        changePercent: quote.dp,
        high: quote.h,
        low: quote.l,
        open: quote.o,
        prevClose: quote.pc,
        name: profile.name || symbol,
        marketCap: profile.marketCapitalization,
        sector: profile.finnhubIndustry,
        exchange: profile.exchange,
      };
    } catch {
      return null;
    }
  };

  // Fetch sequentially to respect Finnhub rate limits
  for (const symbol of uniqueSymbols) {
    const data = await fetchSymbolData(symbol);
    if (data) results[symbol] = data;
  }

  return Object.keys(results).length > 0 ? results : null;
}

function buildSystemPrompt(context: unknown, format?: string, stockData?: Record<string, any> | null): string {
  const ctx = (context && typeof context === 'object') ? context as Record<string, unknown> : null;
  const style = (ctx?.investorStyle as string) || 'buffett';
  const styleGuidance = STYLE_PHILOSOPHY[style] || STYLE_PHILOSOPHY.buffett;

  // ═══════════════════════════════════════════════════════════
  // VANTAGE AI STOCK ADVISOR — COMPREHENSIVE SYSTEM PROMPT
  // ═══════════════════════════════════════════════════════════
  let prompt = `# VANTAGE AI STOCK ADVISOR — SYSTEM PROMPT

You are the AI Stock Advisor for Vantage, an AI-first trading platform.
You are a VERSATILE financial intelligence — you can analyze ANY stock, ETF, index,
or market topic a user asks about, whether they own it or not.

---

## YOUR IDENTITY & SCOPE

You are a dual-purpose advisor:
1. **Portfolio Advisor** — When users ask about their holdings, you reference actual positions,
   cost basis, P&L, and alignment with their investment style
2. **Stock Research Analyst** — When users ask about ANY stock (in their portfolio or not),
   you research it using provided market data and give informed analysis

You are an expert in:
- Fundamental analysis (PE ratios, revenue growth, margins, FCF, dividends)
- Technical analysis (trends, support/resistance, volume, moving averages)
- 5 investment philosophies: Buffett, Lynch, Livermore, Soros, Munger
- Portfolio strategy (diversification, rebalancing, risk management)
- Market macroeconomics (Fed policy, sector rotation, economic indicators)

## GUARDRAILS — What You MUST Refuse

You are a STOCK MARKET and FINANCIAL advisor ONLY. Politely decline questions about:
- Non-financial topics (science, philosophy, cooking, entertainment, etc.)
- Personal advice (relationships, health, career)
- Political opinions (stick to policy impacts on markets only)
- Anything illegal or unethical

When declining, respond briefly:
"I focus on stock market and investing. Can I help you analyze a stock, review your
portfolio, or discuss market trends?"

## GUARDRAILS — What You MUST Answer

Always answer questions about:
- Any stock, ETF, or index (even if not in the user's portfolio)
- Market analysis, trends, sectors, and economic indicators
- Portfolio strategy, risk assessment, rebalancing
- Trading mechanics (order types, timing, tax considerations)
- Company earnings, news impact, and competitive analysis
- Dividend analysis, yield calculations, growth projections
- Technical indicators and chart patterns

Your perspective is always: **How does this help the user make money or avoid losing it?**

---

## STYLE-SPECIFIC ADVICE FRAMEWORK

### Current User Style: ${style === 'buffett' ? 'Warren Buffett (Value Hunter)' : style === 'lynch' ? 'Peter Lynch (Growth Chaser)' : style === 'livermore' ? 'Jesse Livermore (Momentum Rider)' : style === 'soros' ? 'George Soros (Macro Strategist)' : 'Charlie Munger (Dividend Compounder)'}

${styleGuidance}

### All 5 Styles at a Glance:

**Buffett (Value Hunter):**
Focus: Intrinsic value vs price, moat strength, dividend sustainability, ROE/ROIC, 5-10+ year horizon
Rebalance toward: Dividend payers, quality undervalued names

**Lynch (Growth Chaser):**
Focus: Revenue growth 15%+, PEG under 1.5, market expansion, management quality, 2-5 year horizon
Rebalance toward: Fast-growing mid-caps, margin-expanding companies

**Livermore (Momentum Rider):**
Focus: Technical trend strength, volume confirmation, support/resistance, entry/exit signals, <6 month horizon
Rebalance toward: Above 200MA, strong volume, breakout candidates

**Soros (Macro Strategist):**
Focus: Macro regime, sector rotation, rate sensitivity, recession risk, 6-18 month horizon
Rebalance toward: Sectors favored by macro outlook, ETF rotations

**Munger (Dividend Compounder):**
Focus: Dividend yield/growth, payout ratio sustainability, business stability, 10+ year horizon
Rebalance toward: Dividend aristocrats/kings, wide-moat compounders

---

## LIVE MARKET DATA (use this for your analysis)

`;

  // Inject Finnhub research data if available
  if (stockData && Object.keys(stockData).length > 0) {
    for (const [sym, d] of Object.entries(stockData)) {
      if (!d || !d.price) continue;
      prompt += `### ${sym}${d.name && d.name !== sym ? ` — ${d.name}` : ''}\n`;
      prompt += `- Current Price: $${Number(d.price).toFixed(2)}`;
      if (d.change != null) {
        const signStr = d.change >= 0 ? '+' : '';
        prompt += ` — ${signStr}${Number(d.change).toFixed(2)} (${signStr}${Number(d.changePercent).toFixed(2)}%)\\n`;
      } else {
        prompt += '\n';
      }
      prompt += `- Previous Close: $${Number(d.prevClose || 0).toFixed(2)}\n`;
      prompt += `- Day Range: $${Number(d.low || 0).toFixed(2)} — $${Number(d.high || 0).toFixed(2)}\n`;
      if (d.marketCap) {
        const capB = Number(d.marketCap);
        const capStr = capB >= 1e12 ? `$${(capB/1e12).toFixed(2)}T` : `$${(capB/1e9).toFixed(1)}B`;
        prompt += `- Market Cap: ${capStr}\n`;
      }
      if (d.sector) prompt += `- Sector: ${d.sector}\n`;
      if (d.exchange) prompt += `- Exchange: ${d.exchange}\n`;
      prompt += '\n';
    }
    prompt += `Use this live data in your analysis. Reference specific prices and changes.\n\n`;
  }

  prompt += `---

## THE USER\'S PORTFOLIO

`;

  // ═══════════════════════════════════════════════════════════
  // DYNAMIC CONTEXT INJECTION
  // ═══════════════════════════════════════════════════════════
  if (ctx) {
    // ── Portfolio ──
    if (ctx.portfolio) {
      const p = ctx.portfolio as Record<string, unknown>;
      const totalPnl = typeof p.totalPnlPercent === 'number' ? p.totalPnlPercent : undefined;
      const bp = typeof p.buyingPower === 'number' ? p.buyingPower : undefined;

      prompt += `- Total Equity: $${Number(p.equity || 0).toLocaleString()}
- Cash: $${Number(p.cash || 0).toLocaleString()}`;
      if (bp !== undefined) prompt += `\n- Buying Power: $${Number(bp).toLocaleString()}`;
      prompt += `\n- Day P&L: ${Number(p.dayPnlPercent || 0).toFixed(2)}%`;
      if (totalPnl !== undefined) prompt += `\n- Total Return: ${totalPnl.toFixed(2)}%`;
      prompt += '\n';

      if (Array.isArray(p.positions) && p.positions.length > 0) {
        prompt += `\n### All Positions (${p.positions.length})\n`;
        prompt += `| Symbol | Shares | Avg Cost | Current | P&L% | Weight | Sector |\n`;
        prompt += `|--------|--------|----------|---------|------|--------|--------|\n`;

        const sectors: Record<string, number> = {};
        for (const pos of p.positions as Array<Record<string, unknown>>) {
          const symbol = String(pos.symbol || '?');
          const qty = Number(pos.qty || 0);
          const avg = Number(pos.avgCost || 0);
          const price = Number(pos.currentPrice || 0);
          const pnl = Number(pos.totalPnlPercent || 0).toFixed(1);
          const weight = Number(pos.portfolioPercent || 0).toFixed(1);
          const sector = String(pos.sector || 'Unknown');
          prompt += `| ${symbol} | ${qty} | $${avg.toFixed(2)} | $${price.toFixed(2)} | ${pnl}% | ${weight}% | ${sector} |\n`;

          sectors[sector] = (sectors[sector] || 0) + Number(weight);
        }
        prompt += '\n';

        prompt += '### Sector Allocation\n';
        for (const [sector, weight] of Object.entries(sectors).sort((a, b) => b[1] - a[1])) {
          prompt += `- ${sector}: ${weight.toFixed(1)}%`;
          if (weight > 40) prompt += ' ⚠️ OVER-CONCENTRATED';
          prompt += '\n';
        }
        prompt += '\n';
      } else {
        prompt += '(Portfolio is all cash — no open positions)\n\n';
      }
    }

    // ── Open Orders ──
    if (Array.isArray(ctx.orders) && ctx.orders.length > 0) {
      const ords = ctx.orders as Array<Record<string, unknown>>;
      prompt += `## Open Orders (${ords.length})\n`;
      for (const o of ords) {
        const symbol = String(o.symbol || '?');
        const side = String(o.side || '?').toUpperCase();
        const type = String(o.type || 'market');
        const qty = Number(o.qty || 0);
        const status = String(o.status || '?');
        const limit = o.limitPrice != null ? `limit $${o.limitPrice}` : '';
        const stop = o.stopPrice != null ? `stop $${o.stopPrice}` : '';
        const filled = o.filledQty != null ? `(${o.filledQty}/${qty} filled)` : '';
        prompt += `- ${side} ${qty} ${symbol} ${type} ${limit} ${stop} — ${status} ${filled}\n`.replace(/\s+/g, ' ');
      }
      prompt += '\n';
    }

    // ── Watchlist ──
    if (ctx.watchlist && Array.isArray(ctx.watchlist) && (ctx.watchlist as string[]).length > 0) {
      prompt += `## Watchlist\n${(ctx.watchlist as string[]).join(', ')}\n\n`;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // HOW TO RESPOND
  // ═══════════════════════════════════════════════════════════
  prompt += `---
## HOW TO RESPOND

### When analyzing ANY stock (in portfolio or not):
1. Use the provided market data if available (price, PE, market cap, etc.)
2. If the stock IS in their portfolio: reference their actual position, cost basis, P&L, and whether it fits their investor style
3. If the stock is NOT in their portfolio: analyze it as-is. Don\'t just say "you don\'t own this" — give a real analysis. Explain what the company does, recent performance, risks, and whether it fits their style
4. Frame analysis around their investment style: "For a value investor, SNDK at 12x earnings looks..."
5. Give actionable insight: what would make this stock worth buying? What\'s the bear case?
6. Always provide specific numbers — prices, PE ratios, growth rates, yields

### For Portfolio Analysis:
1. Assess portfolio health relative to their chosen style
2. Calculate what % of holdings align with their philosophy vs. conflict
3. Flag concentration risks: any position >20%, any sector >40%
4. Suggest rebalancing only if there\'s a meaningful gap (>10% drift from target)
5. Never suggest massive one-day overhauls — phase changes over 2-4 weeks

### For Rebalancing Suggestions:
Follow this framework:
- **Trim Winners**: Positions that have appreciated most and/or exceed target weight
- **Cut Losers**: Only if the original thesis is broken (not just because they\'re down)
- **Rotate into Underweights**: Add to underrepresented sectors or style-aligned positions
- **New Opportunities**: Identify stocks that fit the style better than current holdings

### Example Rebalancing Output (Buffett Style):
\`\`\`
PORTFOLIO REBALANCING SUGGESTION
Current State:
- 65% value/dividend stocks (target: 70%)
- 35% growth/speculative (target: 30%)
- Yield: 2.1% (target: 3.0%)
- Concentration: TSLA is 22% (high risk)

Suggested Actions (execute over 3 weeks):
1. Trim TSLA by 50% → Raise ~$45,000
   Reason: Doesn\'t fit value thesis, too concentrated, no dividend
2. Add JNJ 200 shares → Deploy ~$32,000
   Reason: Dividend aristocrat, 2.8% yield, P/E ~20 (fair value)
3. Add KO 150 shares → Deploy ~$9,000
   Reason: Dividend king, stable business, 3.1% yield
4. Hold MSFT (already dividend grower, fits thesis)

Result:
- Value/dividend: 70% ✓
- Growth: 30% ✓
- Yield: 2.9% (near target)
- Concentration: TSLA drops to 11% ✓
\`\`\`

---

## RISK MANAGEMENT & RED FLAGS

Always flag these risks:

1. **Concentration Risk** — "Position is X% of portfolio — consider trimming to Y%"
2. **Style Conflict** — "This position conflicts with your [style] approach" — explain why, suggest action
3. **Broken Thesis** — "Business deteriorated — thesis no longer holds" — explain what changed
4. **Valuation Extremes** — "P/E is X standard deviations above average — consider taking profits"
5. **Macro Headwinds** — "Recession risk rising — your growth allocation exposed"
6. **Technical Breaks** — "Closed below 200-day MA — trend broken" / "Volume declining — weak price action"
7. **Unsustainable Dividends** — "Payout ratio 95% — dividend cut risk rising"

---

## COMMUNICATION STYLE

**Be:**
- Clear & Confident — Explain recommendations decisively, note uncertainty where it exists
- Specific — Use numbers: prices, percentages, ratios. Not "some" or "quite a bit"
- Action-Oriented — Tell them what to DO, not just what to think
- Balanced — Show both bull and bear cases, then state your view
- Educational — Help them understand WHY, not just WHAT
- Respectful — Acknowledge their style choice; don\'t push alternatives

**Avoid:**
- Overconfidence ("This will definitely go to $200")
- Jargon without explanation
- Passive language ("You might consider..." → "Buy X shares of...")
- Generic advice ("It depends")

### Tone Examples:

GOOD:
"AAPL is trading at 15.2x earnings, well below your 18x target. With 6% dividend growth and $100B+ FCF, this fits Buffett perfectly. Buy another 50 shares at current levels."

BAD:
"AAPL is kind of cheap right now, so you might want to think about maybe buying some more if you feel comfortable."

---

## DISCLAIMERS

When appropriate, include:
- "This is AI-generated analysis, not professional financial advice"
- "Past performance doesn\'t guarantee future results"
- "Consider your personal risk tolerance and time horizon"
- "Consult a financial advisor for personalized advice"

Include especially when: recommending concentrated positions, suggesting significant portfolio changes, discussing volatile/speculative stocks, or during extreme market conditions.

---

## HANDLING MISSING DATA

If you don\'t have a metric:
- Don\'t hallucinate — say "Dividend data not available for this stock"
- Work around it — "Without dividend data, I\'ll focus on FCF yield and valuation"
- Ask for clarification — "Do you know the payout ratio? That would help refine this"

If the user asks about something outside your knowledge:
- "I don\'t have [specific data]. Recommend checking [source]"
- "My expertise is portfolio strategy. For [specific topic], consult [relevant expert]"

---

## SPECIAL CASES

**Rebalancing in Down Markets:**
- Don\'t force selling losers (may realize losses at the bottom)
- Instead: Use new contributions to add underweights
- Consider tax-loss harvesting opportunities

**High Concentration Positions (>25%):**
- Flag immediately as risk
- Suggest gradual trimming plan over 4-6 weeks
- Don\'t force panic selling — could trigger wash sales

**Recent Market Crashes:**
- Remind of long-term time horizon (especially for Buffett/Munger styles)
- Highlight buying opportunities for style-appropriate positions
- Suggest rebalancing to add during dips

**Tax Considerations:**
- "Consider tax implications before selling"
- "This is a long-term gain — favorable tax treatment"
- "Tax-loss harvesting opportunity if position is underwater"

---
`;

  // ═══════════════════════════════════════════════════════════
  // CORE RULES + OUTPUT FORMAT
  // ═══════════════════════════════════════════════════════════
  prompt += `## CORE RULES (Always Follow)

1. Answer questions about ANY stock, ETF, or market topic — not just portfolio holdings
2. Never tell the user "you don\'t own this" as your main response — analyze the stock they\'re asking about
3. If the stock IS in their portfolio: reference position, cost basis, P&L, and style alignment
4. Flag style conflicts directly: "You chose Buffett, but 60% of your portfolio is growth stocks — here\'s why that matters"
5. Be direct and data-driven. These users know the risks.
6. If you don\'t have enough data for a confident answer, say so and specify what would help
7. Previous recommendations should be referenced when relevant: "Last week we discussed trimming TSLA..."
8. Portfolio should gradually become more aligned with their style over time

## RESEARCHING STOCKS YOU DON\'T OWN

When a user asks about a stock not in their portfolio:
- DO provide a full analysis based on available data (price, market cap, PE, sector, news if provided)
- DO explain what the company does and its competitive position
- DO evaluate whether it fits their investment style: "As a Lynch-style growth investor, SNDK\'s 15% revenue growth looks attractive"
- DO give a bull/bear case
- DO NOT just say "you don\'t own this" and list their portfolio — that\'s unhelpful
- DO NOT refuse to answer because it\'s not in the portfolio

---

## SUCCESS METRICS

You\'re doing well if the user:
- Gets useful, data-driven analysis about ANY stock they ask about
- Understands the reasoning behind recommendations (not just the conclusion)
- Takes action on suggestions (buys, sells, rebalancing, research)
- Learns something new about stocks or markets
- Reduces concentration risk over time (if they have a portfolio)
- Avoids major mistakes (overconcentration, thesis drift, style theft)
- Portfolio gradually becomes more aligned with their chosen style

---

## FINAL INSTRUCTION

You are the user\'s trusted investment advisor within Vantage.
Provide analysis that\'s rigorous, actionable, and aligned with their chosen philosophy.
Help them build wealth systematically over decades, not make quick bucks.
Flag risks loudly. Celebrate good decisions. Learn from mistakes.

Be the advisor they\'d pay $10,000/year for, delivered free through AI.

`;

  // ── Output Format (optional structured output) ──
  if (format) {
    prompt += `\n## Output Format\nRespond with your analysis followed by a JSON code block using the exact schema below.\nWrap structured data in \`\`\`json ... \`\`\` fenced code blocks.\n\n`;
    switch (format) {
      case 'trade_signal':
        prompt += `Schema: { "type": "trade_signal", "data": { "symbol": "AAPL", "action": "buy|sell|hold", "conviction": 75, "entryPrice": 150.00, "stopLoss": 145.00, "takeProfit": 165.00, "reason": "...", "risks": ["risk 1", "risk 2"] } }`;
        break;
      case 'risk_analysis':
        prompt += `Schema: { "type": "risk_analysis", "data": { "overallRisk": 65, "factors": [{ "name": "Concentration", "score": 70, "explanation": "...", "weight": 0.25 }], "warnings": ["..."], "suggestions": ["..."] } }`;
        break;
      case 'rebalance_plan':
        prompt += `Schema: { "type": "rebalance_plan", "data": { "trades": [{ "symbol": "AAPL", "action": "trim", "qty": 5, "dollarAmount": 750, "reason": "..." }], "summary": "..." } }`;
        break;
    }
  }

  return prompt;
}

function detectModelFromQuery(messages: Array<{ role: string; content: string }>): 'deepseek-chat' | 'deepseek-reasoner' {
  return selectModel(messages);
}

/**
 * Parses structured JSON cards from streaming response text.
 * Called when we detect ```json blocks in the stream.
 */
function tryParseCards(text: string): Array<{
  type: string;
  symbol?: string;
  title: string;
  conviction?: number;
  reason?: string;
  price?: number;
  metrics?: Record<string, number | string>;
  actions?: Array<{ label: string; action: string; params?: Record<string, string | number> }>;
}> {
  const cards: Array<{
    type: string;
    symbol?: string;
    title: string;
    conviction?: number;
    reason?: string;
    price?: number;
    metrics?: Record<string, number | string>;
    actions?: Array<{ label: string; action: string; params?: Record<string, string | number> }>;
  }> = [];

  const jsonBlockRegex = /```json\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = jsonBlockRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const items = Array.isArray(parsed) ? parsed : [parsed];

      for (const item of items) {
        if (!item.type || !item.data) continue;

        switch (item.type) {
          case 'trade_signal': {
            const validated = TradeSignalSchema.safeParse(item.data);
            if (validated.success) {
              const d = validated.data;
              const isBuy = d.action === 'buy';
              cards.push({
                type: isBuy ? 'buy_signal' : 'sell_signal',
                symbol: d.symbol,
                title: isBuy ? `High Conviction Buy: ${d.symbol}` : `Take Profit: ${d.symbol}`,
                conviction: d.conviction,
                reason: d.reason,
                price: d.entryPrice,
                metrics: d.stopLoss || d.takeProfit
                  ? { stopLoss: d.stopLoss || 0, takeProfit: d.takeProfit || 0 }
                  : undefined,
                actions: [
                  { label: isBuy ? 'Buy' : 'Sell', action: isBuy ? 'buy' : 'sell', params: { symbol: d.symbol } },
                  { label: 'Details', action: 'details' },
                ],
              });
            }
            break;
          }
          case 'risk_analysis': {
            const validated = RiskAnalysisSchema.safeParse(item.data);
            if (validated.success) {
              const d = validated.data;
              cards.push({
                type: 'risk_analysis',
                title: `Risk Score: ${d.overallRisk}/100`,
                conviction: d.overallRisk,
                reason: d.factors.map((f: { name: string; score: number; explanation: string }) => `${f.name}: ${f.score}/100`).join(' • '),
                metrics: Object.fromEntries(d.factors.map((f: { name: string; score: number }) => [f.name, f.score])),
                actions: [{ label: 'View Details', action: 'details' }],
              });
            }
            break;
          }
          case 'rebalance_plan': {
            const validated = RebalancePlanSchema.safeParse(item.data);
            if (validated.success) {
              const d = validated.data;
              cards.push({
                type: 'rebalance',
                title: 'Rebalance Plan',
                reason: d.trades.map((t: { symbol: string; action: string; reason: string }) => `${t.symbol}: ${t.action} — ${t.reason}`).join('\n'),
                actions: [{ label: 'Execute Plan', action: 'rebalance' }],
              });
            }
            break;
          }
          case 'market_insight': {
            const validated = MarketInsightSchema.safeParse(item.data);
            if (validated.success) {
              cards.push({
                type: 'insight',
                title: validated.data.headline,
                reason: validated.data.summary,
                actions: [{ label: 'Explore', action: 'details' }],
              });
            }
            break;
          }
        }
      }
    } catch {
      // Skip unparseable blocks
    }
  }

  return cards;
}

/**
 * Stream a single SSE event.
 */
function sendSSE(
  controller: ReadableStreamDefaultController<Uint8Array>,
  event: string,
  data: unknown
): void {
  const line = `data: ${JSON.stringify({ event, ...(typeof data === 'object' ? data : { content: data }) })}\n\n`;
  controller.enqueue(new TextEncoder().encode(line));
}

// ─── Route Handler ───

/**
 * Strip lone surrogates and other invalid Unicode from strings.
 * Prevents DeepSeek 400: "lone leading surrogate in hex escape" errors
 * caused by corrupted data in stored chat history.
 *
 * Uses hex integer comparison (0xD800=55296, 0xDFFF=57343) to avoid storing
 * lone surrogate codepoints in the source file — they are invalid in UTF-8
 * and cause file corruption on disk.
 */
function sanitizeUnicode(str: string): string {
  let result = '';
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= 0xD800 && code <= 0xDFFF) {
      result += String.fromCharCode(0xFFFD);
    } else {
      result += str[i];
    }
  }
  return result;
}

export async function POST(request: NextRequest) {
  const deepseekKey = process.env.DEEPSEEK_API_KEY;

  if (!deepseekKey) {
    console.warn('DeepSeek not configured — using fallback message');
    return handleFallback(request);
  }

  try {
    const { messages, context, format } = await request.json();

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'Messages array is required' }, { status: 400 });
    }

    const model = format
      ? 'deepseek-reasoner'
      : detectModelFromQuery(messages);

    // Extract stock symbols from last user message and fetch live Finnhub data
    const lastUserMsg = [...messages].reverse().find((m: any) => m.role === 'user');
    const symbols = extractSymbols(lastUserMsg?.content || '');
    const stockData = symbols.length > 0 ? await fetchStockData(symbols) : null;

    const systemPrompt = buildSystemPrompt(context, format, stockData);
    const chatMessages = [
      { role: 'system', content: sanitizeUnicode(systemPrompt) },
      ...messages.map((m: { role: string; content: string }) => ({
        role: m.role,
        content: sanitizeUnicode(m.content),
      })),
    ];

    const inputTokens = estimateTokens(systemPrompt) +
      messages.reduce((sum: number, m: { content: string }) => sum + estimateTokens(m.content), 0);

    // Try DeepSeek
    let stream: ReadableStream | null = null;
    let usedModel: string = model;
    let streamError = '';

    try {
      // ── Primary: DeepSeek ──
      if (deepseekKey) {
        try {
          const dsRes = await fetch(DEEPSEEK_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${deepseekKey}`,
            },
            body: JSON.stringify({
              model,
              messages: chatMessages,
              stream: true,
              temperature: model === 'deepseek-reasoner' ? 0.3 : 0.7,
              max_tokens: model === 'deepseek-reasoner' ? 4096 : 2048,
            }),
            signal: AbortSignal.timeout(model === 'deepseek-reasoner' ? 25000 : 60000),
          });

          if (dsRes.ok && dsRes.body) {
            stream = dsRes.body;
            usedModel = model;
          } else {
            const errBody = await dsRes.text().catch(() => '');
            streamError = `DeepSeek ${model} ${dsRes.status}: ${errBody.slice(0, 200)}`;
            console.error(streamError);
            // Retry with chat model if reasoner failed
            if (model === 'deepseek-reasoner') {
              console.error('DeepSeek reasoner failed, trying chat model');
              usedModel = 'deepseek-chat';
              const ds2Res = await fetch(DEEPSEEK_URL, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${deepseekKey}`,
                },
                body: JSON.stringify({
                  model: 'deepseek-chat',
                  messages: chatMessages,
                  stream: true,
                  temperature: 0.7,
                  max_tokens: 2048,
                }),
                signal: AbortSignal.timeout(60000),
              });
              if (ds2Res.ok && ds2Res.body) {
                stream = ds2Res.body;
                streamError = '';
              } else {
                const err2Body = await ds2Res.text().catch(() => '');
                streamError = `DeepSeek chat fallback ${ds2Res.status}: ${err2Body.slice(0, 200)}`;
                console.error(streamError);
              }
            }
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          streamError = `DeepSeek fetch threw: ${msg}`;
          console.error(streamError, e instanceof Error ? e.stack : '');
        }
      }

      // Claude disabled — DeepSeek only (2026-05-25)

      if (!stream) {
        throw new Error(streamError || 'DeepSeek unreachable');
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('AI provider error:', errorMsg);
      return handleFallback(request, errorMsg);
    }

    // Build SSE stream
    const encoder = new TextEncoder();
    let outputTokens = 0;
    let fullResponse = '';
    let cardBuffer = '';

    const readable = new ReadableStream({
      async start(controller) {
        try {
          const reader = stream!.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Parse SSE (DeepSeek — OpenAI-compatible format)
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const data = line.slice(6).trim();
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta?.content;
                if (delta) {
                  outputTokens += estimateTokens(delta);
                  fullResponse += delta;
                  cardBuffer += delta;

                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({ event: 'token', content: delta })}\n\n`
                    )
                  );
                }
              } catch {
                // Skip unparseable lines
              }
            }

            // Check for complete JSON blocks every ~200 chars (both providers)
            if (cardBuffer.length > 200) {
              const cards = tryParseCards(cardBuffer);
              if (cards.length > 0) {
                for (const card of cards) {
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({ event: 'card', card })}\n\n`
                    )
                  );
                }
                cardBuffer = '';
              }
            }
          }

          // Final card parse attempt
          const finalCards = tryParseCards(fullResponse);
          for (const card of finalCards) {
            // Don't re-send cards we already sent
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ event: 'card', card })}\n\n`
              )
            );
          }

          // Send cost info
          const cost = estimateCost(usedModel as any, inputTokens, outputTokens);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ event: 'cost', tokens: { input: inputTokens, output: outputTokens }, cost })}\n\n`
            )
          );

          // Done
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ event: 'done' })}\n\n`)
          );
        } catch (err) {
          console.error('Stream processing error:', err);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ event: 'error', message: 'Stream interrupted' })}\n\n`
            )
          );
        } finally {
          controller.close();
        }
      },
    });

    return new NextResponse(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Model-Used': usedModel,
        'X-Chat-Source': 'live',
        'Access-Control-Expose-Headers': 'X-Chat-Source, X-Model-Used, X-Chat-Error',
      },
    });
  } catch (error) {
    console.error('Chat route error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Graceful fallback when AI provider is not configured.
 * Returns a single honest message — no fake data, no pretending.
 */
async function handleFallback(request: NextRequest, errorDetail?: string): Promise<NextResponse> {
  const deepseekSet = !!process.env.DEEPSEEK_API_KEY;
  
  let responseText: string;
  if (!deepseekSet) {
    responseText = 'AI is not configured. Add a DeepSeek API key to enable portfolio analysis, trade signals, and market insights.\n\nYou can still view your portfolio, monitor trades, and place orders — AI-powered analysis will be available once configured.';
  } else {
    responseText = 'DeepSeek is currently unreachable. This might be a temporary network issue — try again in a moment.\n\nYour portfolio, trades, and orders are unaffected.';
  }

  const encoder = new TextEncoder();
  const words = responseText.split(/(\s+)/);

  const readable = new ReadableStream({
    async start(controller) {
      for (const word of words) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ event: 'token', content: word })}\n\n`
          )
        );
        await new Promise((r) => setTimeout(r, 8));
      }
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ event: 'done' })}\n\n`)
      );
      controller.close();
    },
  });

  return new NextResponse(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Model-Used': 'fallback',
      'X-Chat-Source': 'fallback',
      'X-Chat-Error': errorDetail || 'unknown',
      'Access-Control-Expose-Headers': 'X-Chat-Source, X-Model-Used, X-Chat-Error',
    },
  });
}
