// ─── Learning: Stage 3 cards — Analysis & Risk ───
// Card keys must match curriculum.ts. Content rules: plain language, no gamification,
// concrete $ example on every card.

import type { LearningCard } from '@/lib/learning/triggers';

export const STAGE3_CARDS: Record<string, LearningCard> = {
  // ── Valuation ──
  'forward P/E': {
    term: 'Forward P/E',
    headline: 'What is a Forward P/E?',
    body: 'Forward P/E divides a stock price by next year\'s expected earnings per share instead of trailing results. It leans on analyst forecasts, so it\'s a bet that those estimates are right. It\'s most useful for fast-growing companies where the last twelve months say little about what\'s next.',
    example: 'A stock at $120 with next-year EPS forecast of $6 trades at a forward P/E of 20x. If guidance is cut to $4, that jumps to 30x overnight.',
    level: 'Trader', category: 'Valuation',
    emoji: '🔭', investopediaSlug: 'f/forwardpe',
  },
  'PEG ratio': {
    term: 'PEG Ratio',
    headline: 'What is the PEG Ratio?',
    body: 'The PEG ratio divides a P/E by the expected earnings growth rate. It asks whether you\'re paying fairly for growth: around 1.0 is often called fair, below 1 cheap, above 1 rich. It only works if the growth estimate behind it is believable.',
    example: 'A stock at 30x earnings growing 30% a year has a PEG of 1.0. At 60x with the same growth, the PEG is 2.0 — twice as expensive per unit of growth.',
    level: 'Trader', category: 'Valuation',
    emoji: '⚖️', investopediaSlug: 'p/pegratio',
  },
  'price-to-sales': {
    term: 'Price-to-Sales',
    headline: 'What is Price-to-Sales?',
    body: 'Price-to-Sales compares a company\'s market cap to its annual revenue. It\'s handy for young or unprofitable companies where earnings are negative or meaningless. A lower ratio can mean cheap, but a very low P/S often reflects thin margins or a business that\'s struggling.',
    example: 'A company worth $2B with $1B in sales trades at 2x sales. A rival worth $8B on the same $1B sits at 8x — investors are pricing in far bigger growth.',
    level: 'Trader', category: 'Valuation',
    emoji: '🏷️', investopediaSlug: 'p/price-to-sales-ratio',
  },
  'price-to-book': {
    term: 'Price-to-Book',
    headline: 'What is Price-to-Book?',
    body: 'Price-to-Book compares a company\'s market value to its accounting net worth — assets minus liabilities. A P/B under 1 means the market values it below its books, which can be a bargain or a warning. It\'s most useful for banks and asset-heavy firms.',
    example: 'A bank with $50B of book value trading at $35B has a P/B of 0.7 — the market believes its loan book is worth less than the balance sheet claims.',
    level: 'Trader', category: 'Valuation',
    emoji: '📚', investopediaSlug: 'p/price-to-book-ratio',
  },
  'EV/EBITDA': {
    term: 'EV/EBITDA',
    headline: 'What is EV/EBITDA?',
    body: 'EV/EBITDA compares a company\'s total value — debt plus equity, minus cash — to its earnings before interest, taxes, depreciation, and amortization. It\'s a debt-aware take on valuation, useful when comparing companies with very different capital structures.',
    example: 'Company A: $90B enterprise value on $9B EBITDA → 10x. Company B: $120B EV on $8B EBITDA → 15x. Same industry, very different price tags.',
    level: 'Trader', category: 'Valuation',
    emoji: '🏭', investopediaSlug: 'e/ev-ebitda',
  },
  'discounted cash flow': {
    term: 'Discounted Cash Flow',
    headline: 'What is Discounted Cash Flow?',
    body: 'A discounted cash flow values a company by projecting its future cash flows and discounting them back to today\'s dollars. The discount rate reflects risk and opportunity cost. Change the growth or rate assumptions slightly and the answer swings wildly — it\'s a model, not a fact.',
    example: 'Project $100M of cash flow growing 5% a year, discounted at 10%, and you get roughly $2B of value today. Nudge the rate to 12% and it falls near $1.5B.',
    level: 'Trader', category: 'Valuation',
    emoji: '🔮', investopediaSlug: 'd/dcf',
  },
  'margin of safety': {
    term: 'Margin of Safety',
    headline: 'Why You Want a Margin of Safety',
    body: 'Margin of safety means buying an asset for meaningfully less than your estimate of its value, so errors in your math don\'t sink you. It\'s the gap between price and intrinsic value. The more uncertain the business, the wider that gap should be.',
    example: 'You value a stock at $100/share. Instead of paying $95, you wait for $70 — giving yourself a 30% cushion in case your valuation is wrong.',
    level: 'Investor', category: 'Valuation',
    emoji: '🛡️', investopediaSlug: 'm/marginofsafety',
  },
  'value vs growth': {
    term: 'Value vs Growth',
    headline: 'Value vs Growth Investing',
    body: 'Value investors hunt for cheap, established businesses; growth investors pay up for companies expanding fast. The labels describe styles, not guarantees — cheap can stay cheap and fast growth can stall. Most portfolios blend both, and the market rotates between them over years.',
    example: 'In 2022, value names like energy and banks trounced growth stocks. By 2023, megacap tech had flipped the script. Neither style wins forever.',
    level: 'Investor', category: 'Valuation',
    emoji: '↔️',
  },

  // ── Portfolio construction ──
  'asset allocation': {
    term: 'Asset Allocation',
    headline: 'What is Asset Allocation?',
    body: 'Asset allocation is how you split a portfolio across categories — stocks, bonds, cash, real estate — and it drives most of your returns and swings. It\'s the big decision; picking individual holdings matters less. The app\'s sector-allocation chart shows this split at a glance.',
    example: 'A 70/30 portfolio holds 70% stocks and 30% bonds. In a crash the bonds soften the blow; in a rally they drag slightly. That trade-off is the whole point.',
    level: 'Investor', category: 'Portfolio construction',
    emoji: '🥧', investopediaSlug: 'a/assetallocation',
  },
  'rebalancing': {
    term: 'Rebalancing',
    headline: 'What is Rebalancing?',
    body: 'Rebalancing means selling what\'s grown and buying what\'s lagged to restore your target allocation. It forces you to trim winners and add to losers — uncomfortable, but it keeps your risk from drifting. The app\'s rebalance plan export spells out exactly what to trade.',
    example: 'Your 60/40 target drifts to 75/25 after a stock rally. Rebalancing sells 15% of the stock side and buys bonds, locking in gains and resetting your risk.',
    level: 'Trader', category: 'Portfolio construction',
    emoji: '🔄', investopediaSlug: 'r/rebalancing',
  },
  'expense ratio': {
    term: 'Expense Ratio',
    headline: 'What is an Expense Ratio?',
    body: 'An expense ratio is the annual fee a fund charges investors, taken automatically from your assets. It sounds tiny, but it compounds against you over decades — a 1% fee can quietly cost you a large slice of your returns. Index funds often charge a fraction of active ones.',
    example: 'A $50,000 investment at 0.03% costs $15/year. At 1%, it costs $500/year. Over 30 years, that gap can run into tens of thousands of dollars.',
    level: 'Trader', category: 'Portfolio construction',
    emoji: '🧾', investopediaSlug: 'e/expenseratio',
  },
  'concentration risk': {
    term: 'Concentration Risk',
    headline: 'What is Concentration Risk?',
    body: 'Concentration risk is the danger of a single holding, sector, or bet being large enough to dictate your outcome. If one position is 40% of your portfolio, its bad day is your bad day. The app raises a concentration notice when one holding gets too large.',
    example: 'A portfolio that\'s 60% in one tech stock loses 30% if that stock halves. Spread across 20 holdings, the same crash would cost just 3%.',
    level: 'Trader', category: 'Portfolio construction',
    emoji: '🎯',
  },

  // ── Risk ──
  'max drawdown': {
    term: 'Max Drawdown',
    headline: 'What is Max Drawdown?',
    body: 'Max drawdown is the largest peak-to-trough drop a portfolio has ever suffered, measured as a percentage. It shows the worst paper loss you\'d have had to stomach — and it\'s usually bigger than people expect. The app\'s health subscores include it for a reason.',
    example: 'A portfolio worth $100,000 peaks, falls to $65,000, then recovers. Its max drawdown was 35% — you\'d have watched $35,000 vanish before it came back.',
    level: 'Trader', category: 'Risk',
    emoji: '📉', investopediaSlug: 'm/maximum-drawdown-mdd',
  },
  'sharpe ratio': {
    term: 'Sharpe Ratio',
    headline: 'What is the Sharpe Ratio?',
    body: 'The Sharpe ratio measures return earned per unit of risk taken, using volatility as the risk measure. Higher is better: a fund with a Sharpe of 1.5 earned its gains with less risk than one at 0.5. It makes performance comparable across very different portfolios.',
    example: 'Fund A returns 12% with 8% volatility → Sharpe 1.5. Fund B returns 12% with 24% volatility → Sharpe 0.5. Same return, three times the ride.',
    level: 'Investor', category: 'Risk',
    emoji: '⚡', investopediaSlug: 's/sharperatio',
  },
  'position sizing': {
    term: 'Position Sizing',
    headline: 'What is Position Sizing?',
    body: 'Position sizing is deciding how much capital each trade gets. It\'s the lever that controls how much a single mistake or winner matters. Risking 1–2% of your portfolio per trade keeps one bad call from ending your run, no matter how right you are over time.',
    example: 'With a $20,000 portfolio risking 2% per trade, you\'d put $400 at risk on each idea — not the whole account on a hunch, however good it feels.',
    level: 'Trader', category: 'Risk',
    emoji: '📐',
  },
  'risk tolerance': {
    term: 'Risk Tolerance',
    headline: 'What is Risk Tolerance?',
    body: 'Risk tolerance is how much loss and volatility you can actually endure — financially and emotionally — without panic-selling. It\'s not just a number; it\'s about sleep and behavior. Your allocation should match it, because a plan you abandon in a crash isn\'t a plan.',
    example: 'Two investors both hold stocks. One stays calm through a 30% drop; the other sells. Same market, different tolerance — and the second one locks in the loss.',
    level: 'Trader', category: 'Risk',
    emoji: '🧗',
  },
};
