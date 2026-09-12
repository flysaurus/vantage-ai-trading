// ─── Learning: Stage 4 cards — Strategy, Taxes & Behaviour ───
// Card keys must match curriculum.ts. Content rules: plain language, no gamification,
// concrete $ example on every card.

import type { LearningCard } from '@/lib/learning/triggers';

export const STAGE4_CARDS: Record<string, LearningCard> = {
  // ─── Strategies ────────────────────────────────────────────
  'buy and hold': {
    term: 'Buy and Hold',
    headline: 'What is Buy and Hold?',
    body: 'Buy and hold means buying a diversified position and sitting on it for years instead of trading in and out. Time lets compounding and dividends do the work, while trading frequently racks up costs, taxes, and bad timing. The hard part is doing nothing when the market drops.',
    example: '$10,000 in a broad index fund at ~8%/yr for 20 years grows to about $46,600 — selling in a panic at the bottom would have cut that short.',
    level: 'Trader', category: 'Strategy, Taxes & Behaviour',
    emoji: '🪨', investopediaSlug: 'b/buyandhold',
  },
  'momentum': {
    term: 'Momentum',
    headline: 'What is Momentum?',
    body: 'Momentum is the tendency of recent winners to keep winning and recent losers to keep falling over the next few months. Traders buy what has been rising and avoid what has been sinking, betting the trend persists. It works until it reverses hard, so exits matter as much as entries.',
    example: 'A stock up 40% over six months keeps climbing; a momentum fund adds it and rides another 15% before the trend breaks.',
    level: 'Trader', category: 'Strategy, Taxes & Behaviour',
    emoji: '🚀', investopediaSlug: 'm/momentum',
  },
  'trend following': {
    term: 'Trend Following',
    headline: 'What is Trend Following?',
    body: 'Trend following is a rules-based style: buy when price rises above a moving average, sell when it falls back below. No forecasts — you just follow the tape and let the rules cut losers. It bleeds slowly in choppy sideways markets, so patience is built into the strategy.',
    example: 'Buy when price closes above its 200-day average, sell when it closes below; one 30% trend pays for ten small 3% whipsaws.',
    level: 'Trader', category: 'Strategy, Taxes & Behaviour',
    emoji: '📈',
  },
  'covered call': {
    term: 'Covered Call',
    headline: 'What is a Covered Call?',
    body: 'A covered call means owning 100 shares and selling someone else the right to buy them at a set price (the strike) by a set date. You collect the premium as cash today, but you cap your upside if the stock rockets past the strike. It suits flat-to-slightly-up stocks, not ones you expect to soar.',
    example: 'You own 100 shares at $50 and sell a $55 call for $2 — you pocket $200 now, but give up gains above $55.',
    level: 'Investor', category: 'Strategy, Taxes & Behaviour',
    emoji: '📜', investopediaSlug: 'c/coveredcall',
  },
  'margin and leverage': {
    term: 'Margin and Leverage',
    headline: 'What is Margin and Leverage?',
    body: 'Margin is money borrowed from your broker to buy more stock; leverage is any use of debt to amplify returns. Gains and losses both multiply. If the position falls, you get a margin call to add cash or the broker sells your shares — often at the worst possible moment.',
    example: 'With $10,000 cash and 2x margin you buy $20,000 of stock; a 10% drop is a $2,000 loss — 20% of your own money.',
    level: 'Investor', category: 'Strategy, Taxes & Behaviour',
    emoji: '⚖️', investopediaSlug: 'm/margin',
  },

  // ─── Taxes ─────────────────────────────────────────────────
  'capital gains': {
    term: 'Capital Gains',
    headline: 'What are Capital Gains?',
    body: 'Capital gains are the profit when you sell an asset for more than you paid. Hold over a year and it is long-term, taxed at lower rates; under a year it is short-term, taxed like ordinary income. Realised losses can offset gains, which is why your sale date matters as much as your price.',
    example: 'Buy at $40, sell at $60 a year later: a $20 long-term gain, taxed at 15% instead of your ordinary income rate.',
    level: 'Trader', category: 'Strategy, Taxes & Behaviour',
    emoji: '💰', investopediaSlug: 'c/capitalgain',
  },
  'cost basis': {
    term: 'Cost Basis',
    headline: 'What is Cost Basis?',
    body: 'Cost basis is what you originally paid for an investment — price plus fees — and it is the number the tax man subtracts from your sale price to figure your gain. Reinvested dividends and stock splits adjust it, so sloppy records mean wrong taxes. Your broker usually tracks it for you.',
    example: 'Buy 100 shares at $30 ($3,000 basis) and sell at $45 ($4,500): your taxable gain is $1,500.',
    level: 'Trader', category: 'Strategy, Taxes & Behaviour',
    emoji: '🧾', investopediaSlug: 'c/costbasis',
  },
  'FIFO vs specific identification': {
    term: 'FIFO vs Specific Identification',
    headline: 'FIFO vs Specific Identification',
    body: 'FIFO (first in, first out) means when you sell, your oldest shares are treated as sold first. Specific identification lets you pick which lots to sell — often the highest-cost ones, to shrink the taxable gain. This app uses FIFO on every sell surface, so the oldest lot always goes first.',
    example: 'You bought at $20 then $50; selling at $45 under FIFO shows a $25 gain — picking the $50 lot would show a $5 loss.',
    level: 'Investor', category: 'Strategy, Taxes & Behaviour',
    emoji: '🗂️', investopediaSlug: 'f/fifo',
  },
  'qualified dividends': {
    term: 'Qualified Dividends',
    headline: 'What are Qualified Dividends?',
    body: 'Qualified dividends are ordinary dividends that meet IRS holding rules — you must own the stock for more than 60 days around the ex-dividend date. They are taxed at the lower long-term capital gains rates instead of your income rate. Miss the holding window and the same cash is taxed as ordinary income.',
    example: '$1,000 in dividends held long enough is taxed at 15%; held too briefly, it could cost 22% or more in income tax.',
    level: 'Investor', category: 'Strategy, Taxes & Behaviour',
    emoji: '✅', investopediaSlug: 'q/qualifieddividend',
  },
  'tax-advantaged accounts': {
    term: 'Tax-Advantaged Accounts',
    headline: 'What are Tax-Advantaged Accounts?',
    body: 'Tax-advantaged accounts are wrappers like 401(k)s and IRAs where investments grow without annual tax drag — and Roth versions grow tax-free. You trade off contribution limits and, for traditional accounts, taxes later on withdrawal. Put your highest-turnover or income-heavy holdings here.',
    example: '$6,000 a year in a Roth growing at 8% for 30 years reaches about $680,000 — your gains stay tax-free if rules are met.',
    level: 'Investor', category: 'Strategy, Taxes & Behaviour',
    emoji: '🏦',
  },

  // ─── Behaviour ─────────────────────────────────────────────
  'loss aversion': {
    term: 'Loss Aversion',
    headline: 'Why Losses Sting Twice as Much',
    body: 'Loss aversion is the human tendency to feel a loss about twice as sharply as an equal gain. It makes people hold losers too long hoping to break even, and sell winners too early to lock in a good feeling. Both habits quietly drain returns.',
    example: 'You refuse to sell a stock down $3,000, hoping to recover — it slides to $6,000 down while you cashed out a winner early.',
    level: 'Trader', category: 'Strategy, Taxes & Behaviour',
    emoji: '😖', investopediaSlug: 'l/loss-aversion',
  },
  'recency bias': {
    term: 'Recency Bias',
    headline: 'Why You Assume the Last Move Continues',
    body: 'Recency bias is overweighting the latest stretch of performance and assuming it keeps going. After a strong year people pile into whatever just worked; after a crash they flee at the bottom. Markets rarely repeat their most recent move, so the instinct usually costs money.',
    example: 'After a fund returns 40% in a year you buy in — it then trails by 15% over the next 12 months on your $10,000.',
    level: 'Trader', category: 'Strategy, Taxes & Behaviour',
    emoji: '🔁',
  },
  'overconfidence': {
    term: 'Overconfidence',
    headline: 'Why Being Sure Costs You',
    body: 'Overconfidence is believing your calls are better than they are, usually after a few wins. It shows up as oversized positions, too much trading, and ignored risk. The market charges for it — frequent traders tend to underperform, and position sizing is where the damage lands.',
    example: 'Convinced you have cracked it, you put 40% in one stock — a 50% drop is a $10,000 hit on a $50,000 portfolio.',
    level: 'Trader', category: 'Strategy, Taxes & Behaviour',
    emoji: '🎯',
  },
  'herd behaviour': {
    term: 'Herd Behaviour',
    headline: 'Why Following the Crowd Backfires',
    body: 'Herd behaviour is copying the crowd — buying because everyone is buying, selling because everyone is selling. It feels safe but usually means you buy high and sell low, since crowds are most confident near the top. Independent thinking, not consensus, is the edge.',
    example: 'You buy a meme stock at the peak with the crowd; when it halves, you sell with them too — a $4,000 loss on $8,000 in.',
    level: 'Trader', category: 'Strategy, Taxes & Behaviour',
    emoji: '🐑',
  },
  'anchoring': {
    term: 'Anchoring',
    headline: 'Why Your Entry Price Isn\'t the Real Price',
    body: 'Anchoring is fixating on a single reference number — often what you paid — and judging everything against it. "I will sell when I am back to $50" ignores whether $50 was ever realistic. The market does not know your entry price, so it should not decide your exit.',
    example: 'A stock you bought at $80 falls to $40; you refuse to sell below $80 and hold as it slides to $15.',
    level: 'Trader', category: 'Strategy, Taxes & Behaviour',
    emoji: '⚓',
  },
  'sequence risk': {
    term: 'Sequence Risk',
    headline: 'Why the Order of Returns Matters',
    body: 'Sequence risk is the danger that the order of returns — not the average — wrecks your plan. Two portfolios with identical average returns can end very differently if the bad years land while you are withdrawing. It hits hardest just before and early in retirement.',
    example: 'A 20% drop in year one on a $500,000 pot wipes $100,000 — and you are also withdrawing. The same crash later hurts far less.',
    level: 'Trader', category: 'Strategy, Taxes & Behaviour',
    emoji: '🎲',
  },
};
