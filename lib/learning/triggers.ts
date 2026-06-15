// ─── Learning: Triggers ──────────────────────────────────────
// Learning card definitions keyed by search term (case-insensitive).
// The detector scans AI responses for these terms to surface
// educational moments.

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
  /** Investopedia URL slug for "Learn more →" link */
  investopediaSlug?: string;
}

export const LEARNING_CARDS: Record<string, LearningCard> = {
  'P/E ratio': {
    term: 'P/E Ratio',
    headline: 'What is a P/E Ratio?',
    body: 'Price-to-Earnings ratio compares a stock price to its annual earnings per share. A high P/E means investors expect strong future growth. A low P/E may signal undervaluation — or trouble ahead.',
    example: 'If a stock trades at $100 and earns $5/share, P/E = 20x',
    level: 'Apprentice',
    xp: 2,
    investopediaSlug: 'p/pe-ratio',
  },
  'market cap': {
    term: 'Market Cap',
    headline: 'What is Market Cap?',
    body: 'Market capitalization is the total value of all a company\'s outstanding shares. It\'s how the market prices the entire company — not just one share. Companies are grouped into large-cap ($10B+), mid-cap ($2B–$10B), and small-cap ($300M–$2B).',
    example: 'If a company has 1 billion shares trading at $50 each, its market cap is $50B — a large-cap stock.',
    level: 'Apprentice',
    xp: 2,
    investopediaSlug: 'm/marketcapitalization',
  },
  'volatility': {
    term: 'Volatility',
    headline: 'What is Volatility?',
    body: 'Volatility measures how much a stock\'s price swings up and down. High volatility means bigger price moves (both up and down) — more risk, but also more potential reward. The VIX index tracks expected S&P 500 volatility and is often called the "fear gauge."',
    example: 'A stock that moves ±3% daily is more volatile than one that moves ±0.5% daily. Options traders love high volatility — buy-and-hold investors, not so much.',
    level: 'Trader',
    xp: 3,
    investopediaSlug: 'v/volatility',
  },
  'dividend': {
    term: 'Dividend',
    headline: 'What are Dividends?',
    body: 'Dividends are cash payments companies make to shareholders — typically from profits. They\'re usually paid quarterly. The dividend yield tells you what percentage of the stock price you\'ll receive annually in dividends.',
    example: 'If you own 100 shares of a stock paying $1/share quarterly, you\'ll receive $400/year in dividends. If the stock is priced at $50, the dividend yield is 8%.',
    level: 'Apprentice',
    xp: 2,
    investopediaSlug: 'd/dividend',
  },
  'short selling': {
    term: 'Short Selling',
    headline: 'What is Short Selling?',
    body: 'Short selling is betting against a stock. You borrow shares, sell them at the current price, and hope to buy them back cheaper later to return to the lender. Your profit is the difference — but if the stock goes up, your losses are theoretically unlimited.',
    example: 'You short 100 shares at $50 each. If the stock drops to $40, you buy back for $4,000, return the shares, and pocket $1,000 profit. If it rises to $80? You lose $3,000.',
    level: 'Trader',
    xp: 3,
    investopediaSlug: 's/shortselling',
  },
  'ETF': {
    term: 'ETF',
    headline: 'What is an ETF?',
    body: 'An Exchange-Traded Fund is a basket of stocks (or bonds, or commodities) that trades like a single stock. ETFs give you instant diversification — one purchase buys you exposure to hundreds of companies. They typically have lower fees than mutual funds.',
    example: 'SPY tracks the S&P 500 — buying one share of SPY gives you a tiny slice of all 500 companies in the index. XLK gives you just the technology sector.',
    level: 'Apprentice',
    xp: 2,
    investopediaSlug: 'e/etf',
  },
  'earnings per share': {
    term: 'Earnings Per Share',
    headline: 'What is Earnings Per Share?',
    body: 'EPS tells you how much profit a company generates per outstanding share. It\'s calculated by dividing net income by total shares. Companies report EPS every quarter, and analysts compare actual EPS to estimates to gauge performance.',
    example: 'A company earns $1B with 500M shares outstanding → EPS = $2.00. If analysts expected $1.80, that\'s a "beat" — the stock often rises.',
    level: 'Apprentice',
    xp: 2,
    investopediaSlug: 'e/eps',
  },
  'bull market': {
    term: 'Bull Market',
    headline: 'What is a Bull Market?',
    body: 'A bull market is a sustained period of rising stock prices — typically defined as a 20%+ gain from recent lows. Bull markets are fueled by economic growth, low unemployment, and investor confidence. They can last for years.',
    example: 'The S&P 500 rose over 400% from 2009 to 2020 — one of the longest bull markets in history. "Bulls" are optimistic investors who believe prices will keep climbing.',
    level: 'Apprentice',
    xp: 2,
    investopediaSlug: 'b/bullmarket',
  },
  'bear market': {
    term: 'Bear Market',
    headline: 'What is a Bear Market?',
    body: 'A bear market is a sustained decline of 20% or more from recent highs. They\'re often triggered by recessions, rising interest rates, or market bubbles bursting. Bear markets are painful but historically shorter than bull markets.',
    example: 'During the 2020 COVID crash, the S&P 500 dropped 34% in just 33 days — then recovered all losses within 5 months. "Bears" are pessimistic investors who expect prices to fall.',
    level: 'Apprentice',
    xp: 2,
    investopediaSlug: 'b/bearmarket',
  },
  'portfolio diversification': {
    term: 'Portfolio Diversification',
    headline: 'Why Diversify?',
    body: 'Diversification means spreading your investments across different assets, sectors, and geographies. The goal isn\'t to maximize returns — it\'s to reduce risk. When one investment falls, others may rise or hold steady, protecting your overall portfolio.',
    example: 'A portfolio of 100% tech stocks cratered -33% in 2022. A diversified 60/40 stock/bond portfolio dropped only -16%. The trade-off: diversified portfolios may lag during sector-specific bull runs.',
    level: 'Investor',
    xp: 4,
    investopediaSlug: 'd/diversification',
  },
  'dollar cost averaging': {
    term: 'Dollar Cost Averaging',
    headline: 'Dollar Cost Averaging',
    body: 'DCA is investing a fixed amount on a regular schedule — regardless of price. When prices are low, your fixed amount buys more shares. When prices are high, it buys fewer. Over time, this smooths out your average purchase price.',
    example: 'Investing $500/month in SPY: In January at $500/share you buy 1 share. In February at $400/share you buy 1.25 shares. Average cost: $444/share — better than buying all at $500.',
    level: 'Investor',
    xp: 4,
    investopediaSlug: 'd/dollarcostaveraging',
  },
  'compound interest': {
    term: 'Compound Interest',
    headline: 'The Magic of Compounding',
    body: 'Compound interest is earning returns on your returns. Instead of withdrawing gains, you reinvest them — and they generate their own gains next period. Over decades, compounding turns modest savings into substantial wealth. Einstein reportedly called it the "eighth wonder of the world."',
    example: '$10,000 invested at 10% annually: After 1 year = $11,000. After 10 years = $25,937. After 30 years = $174,494. The longer your time horizon, the more dramatic the compounding effect.',
    level: 'Investor',
    xp: 4,
    investopediaSlug: 'c/compoundinterest',
  },
};
