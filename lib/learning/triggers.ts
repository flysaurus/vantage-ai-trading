// ─── Learning: Triggers ──────────────────────────────────────
// Learning card definitions keyed by search term (case-insensitive).
// The detector scans AI responses for these terms to surface
// educational moments.
//
// Also exposed as a browsable library via LearningLibrary component.

import type { Level } from '@/lib/theme/tokens';

export interface LearningCard {
  /** Search keyword (matched case-insensitively in AI response) */
  term: string;
  /** Card headline (shown large) */
  headline: string;
  /** Explanation body */
  body: string;
  /** Concrete example */
  example: string;
  /** Difficulty level (shown as pill in level color) */
  level: Level;
  /** XP awarded when user taps "Got it" */
  xp: number;
  /** Category for grouping in library view */
  category?: string;
  /** Investopedia URL slug for "Learn more →" link */
  investopediaSlug?: string;
  /** Emoji icon for library card preview */
  emoji?: string;
}

// ─── Essentials (Apprentice) ─────────────────────────────────

const ESSENTIALS: Record<string, LearningCard> = {
  'P/E ratio': {
    term: 'P/E Ratio',
    headline: 'What is a P/E Ratio?',
    body: 'Price-to-Earnings ratio compares a stock price to its annual earnings per share. A high P/E means investors expect strong future growth. A low P/E may signal undervaluation — or trouble ahead.',
    example: 'If a stock trades at $100 and earns $5/share, P/E = 20x',
    level: 'Apprentice', xp: 2, category: 'Essentials',
    emoji: '📊', investopediaSlug: 'p/pe-ratio',
  },
  'market cap': {
    term: 'Market Cap',
    headline: 'What is Market Cap?',
    body: 'Market capitalization is the total value of all a company\'s outstanding shares. Companies are grouped into large-cap ($10B+), mid-cap ($2B–$10B), and small-cap ($300M–$2B).',
    example: 'If a company has 1 billion shares trading at $50 each, its market cap is $50B — a large-cap stock.',
    level: 'Apprentice', xp: 2, category: 'Essentials',
    emoji: '🏢', investopediaSlug: 'm/marketcapitalization',
  },
  'dividend': {
    term: 'Dividend',
    headline: 'What are Dividends?',
    body: 'Dividends are cash payments companies make to shareholders — typically from profits. They\'re usually paid quarterly. The dividend yield tells you what percentage of the stock price you\'ll receive annually in dividends.',
    example: 'If you own 100 shares of a stock paying $1/share quarterly, you\'ll receive $400/year in dividends. If the stock is priced at $50, the dividend yield is 8%.',
    level: 'Apprentice', xp: 2, category: 'Essentials',
    emoji: '💵', investopediaSlug: 'd/dividend',
  },
  'dividend yield': {
    term: 'Dividend Yield',
    headline: 'What is Dividend Yield?',
    body: 'Dividend yield is the annual dividend payment divided by the stock price — shown as a percentage. It tells you how much income you\'ll earn per dollar invested. A high yield can mean a great income stock… or a falling stock price inflating the percentage.',
    example: 'Stock at $100 paying $4/year in dividends = 4% yield. If the stock drops to $80 but still pays $4, yield jumps to 5% — but the company might be in trouble.',
    level: 'Apprentice', xp: 2, category: 'Essentials',
    emoji: '💰', investopediaSlug: 'd/dividendyield',
  },
  'ETF': {
    term: 'ETF',
    headline: 'What is an ETF?',
    body: 'An Exchange-Traded Fund is a basket of stocks (or bonds, or commodities) that trades like a single stock. ETFs give you instant diversification — one purchase buys you exposure to hundreds of companies.',
    example: 'SPY tracks the S&P 500 — one share gives you a tiny slice of all 500 companies. XLK gives you just the technology sector.',
    level: 'Apprentice', xp: 2, category: 'Essentials',
    emoji: '🧺', investopediaSlug: 'e/etf',
  },
};

// ─── Markets & Cycles (Apprentice-Trader) ────────────────────

const MARKETS: Record<string, LearningCard> = {
  'bull market': {
    term: 'Bull Market',
    headline: 'What is a Bull Market?',
    body: 'A bull market is a sustained period of rising stock prices — typically a 20%+ gain from recent lows. Fueled by economic growth, low unemployment, and investor confidence.',
    example: 'The S&P 500 rose over 400% from 2009 to 2020 — one of the longest bull markets in history.',
    level: 'Apprentice', xp: 2, category: 'Markets & Cycles',
    emoji: '🐂', investopediaSlug: 'b/bullmarket',
  },
  'bear market': {
    term: 'Bear Market',
    headline: 'What is a Bear Market?',
    body: 'A bear market is a sustained decline of 20% or more from recent highs. Triggered by recessions, rising rates, or bubbles bursting. Painful but historically shorter than bull markets.',
    example: 'During the 2020 COVID crash, the S&P 500 dropped 34% in 33 days — then recovered all losses within 5 months.',
    level: 'Apprentice', xp: 2, category: 'Markets & Cycles',
    emoji: '🐻', investopediaSlug: 'b/bearmarket',
  },
  'yield curve': {
    term: 'Yield Curve',
    headline: 'What is the Yield Curve?',
    body: 'The yield curve shows the relationship between bond yields and their maturity dates. Normally, longer-term bonds pay higher yields. An inverted yield curve (short-term yields higher than long-term) has predicted every U.S. recession since 1955.',
    example: 'In 2023, the 2-year Treasury yielded 5.0% while the 10-year yielded 4.0% — a deeply inverted curve that screamed "recession ahead."',
    level: 'Trader', xp: 3, category: 'Markets & Cycles',
    emoji: '📈', investopediaSlug: 'y/yieldcurve',
  },
  'volatility': {
    term: 'Volatility',
    headline: 'What is Volatility?',
    body: 'Volatility measures how much a stock\'s price swings up and down. High volatility = bigger moves (more risk, more potential reward). The VIX index tracks expected S&P 500 volatility — called the "fear gauge."',
    example: 'A stock moving ±3% daily is more volatile than one moving ±0.5%. Options traders love high volatility; buy-and-hold investors, not so much.',
    level: 'Trader', xp: 3, category: 'Markets & Cycles',
    emoji: '🎢', investopediaSlug: 'v/volatility',
  },
};

// ─── Analysis & Metrics (Trader-Investor) ────────────────────

const ANALYSIS: Record<string, LearningCard> = {
  'earnings per share': {
    term: 'Earnings Per Share',
    headline: 'What is Earnings Per Share?',
    body: 'EPS tells you how much profit a company generates per outstanding share. Reported quarterly — analysts compare actual EPS to estimates to gauge performance.',
    example: 'A company earns $1B with 500M shares outstanding → EPS = $2.00. Analysts expected $1.80 → that\'s a "beat" — the stock often rises.',
    level: 'Apprentice', xp: 2, category: 'Analysis & Metrics',
    emoji: '📋', investopediaSlug: 'e/eps',
  },
  'beta': {
    term: 'Beta',
    headline: 'What is Beta?',
    body: 'Beta measures a stock\'s volatility relative to the overall market. A beta of 1.0 means the stock moves with the market. Above 1 = more volatile (higher risk/reward). Below 1 = more stable (defensive).',
    example: 'A utility stock with beta 0.5 tends to move half as much as the S&P 500. A tech stock with beta 1.8 tends to swing nearly twice as much.',
    level: 'Trader', xp: 3, category: 'Analysis & Metrics',
    emoji: '⚖️', investopediaSlug: 'b/beta',
  },
  'alpha': {
    term: 'Alpha',
    headline: 'What is Alpha?',
    body: 'Alpha is the excess return of an investment relative to a benchmark (usually the S&P 500). Positive alpha means you beat the market. It\'s the holy grail of active investing — and very hard to sustain.',
    example: 'If the S&P 500 returns 10% this year and your portfolio returns 13%, your alpha is +3%. If you returned 8%, your alpha is -2%.',
    level: 'Investor', xp: 4, category: 'Analysis & Metrics',
    emoji: '🎯', investopediaSlug: 'a/alpha',
  },
};

// ─── Strategies (Trader-Investor) ────────────────────────────

const STRATEGIES: Record<string, LearningCard> = {
  'mean reversion': {
    term: 'Mean Reversion',
    headline: 'What is Mean Reversion?',
    body: 'Mean reversion is the theory that prices eventually return to their long-term average. When a stock spikes far above its historical trend, mean reversion traders bet it\'ll come back down — and vice versa. It\'s the mathematical backbone of many quantitative strategies.',
    example: 'If KO typically trades at 22x earnings but spikes to 30x after a great quarter, a mean reversion play would bet on the P/E drifting back toward 22x over time.',
    level: 'Trader', xp: 3, category: 'Strategies',
    emoji: '🔄', investopediaSlug: 'm/meanreversion',
  },
  'dollar cost averaging': {
    term: 'Dollar Cost Averaging',
    headline: 'Dollar Cost Averaging',
    body: 'DCA is investing a fixed amount on a regular schedule — regardless of price. When prices are low, your fixed amount buys more shares. When prices are high, it buys fewer. Over time, this smooths out your average purchase price.',
    example: 'Investing $500/month in SPY: January at $500 = 1 share. February at $400 = 1.25 shares. Average cost: $444/share — better than buying all at $500.',
    level: 'Investor', xp: 4, category: 'Strategies',
    emoji: '📅', investopediaSlug: 'd/dollarcostaveraging',
  },
  'short selling': {
    term: 'Short Selling',
    headline: 'What is Short Selling?',
    body: 'Short selling is betting against a stock: borrow shares, sell them, hope to buy back cheaper. Profit = the difference. But if the stock goes up, losses are theoretically unlimited.',
    example: 'You short 100 shares at $50. If stock drops to $40 → buy back for $4,000, return shares, pocket $1,000. If it rises to $80 → $3,000 loss.',
    level: 'Trader', xp: 3, category: 'Strategies',
    emoji: '🔻', investopediaSlug: 's/shortselling',
  },
  'tax loss harvesting': {
    term: 'Tax-Loss Harvesting',
    headline: 'What is Tax-Loss Harvesting?',
    body: 'Tax-loss harvesting means selling investments at a loss to offset capital gains taxes. You can deduct up to $3,000/year in net losses against ordinary income, and carry forward excess losses indefinitely. The key rule: don\'t buy the same or "substantially identical" security within 30 days (wash sale rule).',
    example: 'You sold AMZN for a $10,000 gain but GOOGL is down $4,000. Sell GOOGL → net taxable gain drops to $6,000. You can immediately buy a similar (but not identical) ETF to stay invested.',
    level: 'Investor', xp: 4, category: 'Strategies',
    emoji: '🧾', investopediaSlug: 't/taxgainlossharvesting',
  },
  'compound interest': {
    term: 'Compound Interest',
    headline: 'The Magic of Compounding',
    body: 'Compound interest is earning returns on your returns. Reinvest gains instead of withdrawing — they generate their own gains next period. Over decades, compounding turns modest savings into substantial wealth.',
    example: '$10,000 at 10% annually: Year 1 = $11,000. Year 10 = $25,937. Year 30 = $174,494. The longer your horizon, the more dramatic the effect.',
    level: 'Investor', xp: 4, category: 'Strategies',
    emoji: '⏳', investopediaSlug: 'c/compoundinterest',
  },
};

// ─── Risk & Portfolio (Investor) ─────────────────────────────

const RISK: Record<string, LearningCard> = {
  'portfolio diversification': {
    term: 'Portfolio Diversification',
    headline: 'Why Diversify?',
    body: 'Diversification means spreading investments across assets, sectors, and geographies. The goal isn\'t to maximize returns — it\'s to reduce risk. When one investment falls, others may rise or hold steady, protecting your overall portfolio.',
    example: 'A 100% tech portfolio cratered -33% in 2022. A diversified 60/40 stock/bond portfolio dropped only -16%.',
    level: 'Investor', xp: 4, category: 'Risk & Portfolio',
    emoji: '🛡️', investopediaSlug: 'd/diversification',
  },
  'stop loss': {
    term: 'Stop-Loss',
    headline: 'What is a Stop-Loss?',
    body: 'A stop-loss order automatically sells a stock when it drops to a set price — protecting you from deeper losses. It\'s your emergency exit. But stops can trigger on temporary dips (whipsaws), selling you out right before a recovery.',
    example: 'You buy AAPL at $200 and set a stop-loss at $180 (-10%). If AAPL drops to $180, it auto-sells. Your maximum loss is capped at $20/share.',
    level: 'Trader', xp: 3, category: 'Risk & Portfolio',
    emoji: '🛑', investopediaSlug: 's/stop-loss',
  },
  'wash sale': {
    term: 'Wash Sale',
    headline: 'What is a Wash Sale?',
    body: 'A wash sale occurs when you sell a security at a loss and buy the same or "substantially identical" security within 30 days before or after. The IRS disallows the loss deduction — it gets added to your new cost basis instead. Critical to know for tax-loss harvesting.',
    example: 'You sell SPY at a $5,000 loss on Dec 15 and buy it back on Dec 20. The $5,000 loss is disallowed. Instead, $5,000 gets added to your new SPY cost basis, deferring the tax benefit.',
    level: 'Investor', xp: 4, category: 'Risk & Portfolio',
    emoji: '🚫', investopediaSlug: 'w/washsale',
  },
  'correlation': {
    term: 'Correlation',
    headline: 'What is Correlation?',
    body: 'Correlation measures how two assets move relative to each other, from -1 to +1. +1 = identical movement. 0 = no relationship. -1 = opposite directions. Diversification works by combining assets with low or negative correlation.',
    example: 'Tech stocks and utilities often have low correlation. When tech drops, utilities might hold steady — softening your portfolio\'s overall drawdown.',
    level: 'Investor', xp: 4, category: 'Risk & Portfolio',
    emoji: '🔗', investopediaSlug: 'c/correlation',
  },
};

// ─── Technical Analysis (Trader) ─────────────────────────────

const TECHNICAL: Record<string, LearningCard> = {
  'moving average': {
    term: 'Moving Average',
    headline: 'What is a Moving Average?',
    body: 'A moving average smooths out price data by averaging prices over a set period. The 50-day and 200-day MAs are the most watched. When a shorter MA crosses above a longer one, it\'s a "golden cross" (bullish). Below = "death cross" (bearish).',
    example: 'If SPY\'s 50-day MA crosses above its 200-day MA, technical traders see it as a long-term buy signal. The 200-day often acts as support — stocks frequently bounce off it.',
    level: 'Trader', xp: 3, category: 'Technical Analysis',
    emoji: '〰️', investopediaSlug: 'm/movingaverage',
  },
  'RSI': {
    term: 'RSI',
    headline: 'What is RSI?',
    body: 'The Relative Strength Index (RSI) measures the speed and magnitude of recent price changes on a 0–100 scale. Above 70 = "overbought" (may be due for a pullback). Below 30 = "oversold" (may be due for a bounce). It\'s a momentum oscillator, not a crystal ball.',
    example: 'AAPL\'s RSI hits 82 after a 6-day rally — historically overbought territory. A mean reversion trader might take profits or wait for RSI to cool below 70 before adding.',
    level: 'Trader', xp: 3, category: 'Technical Analysis',
    emoji: '📉', investopediaSlug: 'r/rsi',
  },
  'support and resistance': {
    term: 'Support and Resistance',
    headline: 'Support & Resistance Levels',
    body: 'Support is a price level where a stock tends to stop falling (buyers step in). Resistance is where it tends to stop rising (sellers step in). These levels form from historical price action — previous highs/lows, round numbers, or moving averages.',
    example: 'If AAPL bounced off $195 three times in 6 months, $195 is strong support. If it\'s been rejected at $215 repeatedly, $215 is resistance. Break above resistance = bullish signal.',
    level: 'Trader', xp: 3, category: 'Technical Analysis',
    emoji: '📏', investopediaSlug: 's/support-and-resistance',
  },
  'options': {
    term: 'Options',
    headline: 'What are Options?',
    body: 'Options are contracts giving you the right (not obligation) to buy or sell a stock at a set price by a set date. Calls = right to buy (bullish bet). Puts = right to sell (bearish bet or portfolio insurance). Options amplify both gains AND losses due to leverage.',
    example: 'AAPL at $200. You buy a $210 call expiring in 30 days for $3. If AAPL hits $220, your call is worth ~$10 → 233% gain. If AAPL stays below $210, your $3 expires worthless.',
    level: 'Trader', xp: 3, category: 'Technical Analysis',
    emoji: '🎲', investopediaSlug: 'o/options',
  },
};

// ─── Trading Mechanics (Apprentice) ──────────────────────────

const MECHANICS: Record<string, LearningCard> = {
  'market order': {
    term: 'Market Order',
    headline: 'Market Order vs Limit Order',
    body: 'A market order buys/sells immediately at the best available price — speed over price control. A limit order only executes at your specified price or better — price control over speed. For illiquid stocks or volatile markets, limit orders protect you from bad fills.',
    example: 'AAPL at $200. Market order: you buy instantly at ~$200.05. Limit order at $199: only fills if AAPL drops to $199 or below — you might miss the trade if it keeps rising.',
    level: 'Apprentice', xp: 2, category: 'Trading Mechanics',
    emoji: '⚡', investopediaSlug: 'm/marketorder',
  },
};

// ─── Full Card Set ───────────────────────────────────────────

export const LEARNING_CARDS: Record<string, LearningCard> = {
  ...ESSENTIALS,
  ...MARKETS,
  ...ANALYSIS,
  ...STRATEGIES,
  ...RISK,
  ...TECHNICAL,
  ...MECHANICS,
};

// ─── Grouped for Library UI ──────────────────────────────────

/** Ordered category groups for the library view */
export const LEARNING_CATEGORIES = [
  { id: 'Essentials', label: '📊 Essentials', cards: ESSENTIALS },
  { id: 'Markets & Cycles', label: '📈 Markets & Cycles', cards: MARKETS },
  { id: 'Analysis & Metrics', label: '📐 Analysis & Metrics', cards: ANALYSIS },
  { id: 'Strategies', label: '🎯 Strategies', cards: STRATEGIES },
  { id: 'Risk & Portfolio', label: '🛡️ Risk & Portfolio', cards: RISK },
  { id: 'Technical Analysis', label: '📉 Technical Analysis', cards: TECHNICAL },
  { id: 'Trading Mechanics', label: '⚡ Trading Mechanics', cards: MECHANICS },
];
