// ─── Learning: module self-checks ─────────────────────────────
// The 3-question self-check that closes a `check: true` module in
// lib/learning/curriculum.ts.
//
// Design rules (Em's call, 2026-09-12):
//   • THREE questions per module. Not a quiz, a gut-check.
//   • UNSCORED. Nothing is stored, nothing is tracked, no points, no streak.
//     Answer, read why, move on. Reload the app and it's fresh again.
//   • Wrong answers are not "failures" — the `why` explains the reasoning.
//   • Questions test the module's own topics, in plain language.

export interface CheckQuestion {
  /** The question, plain language. */
  q: string;
  /** Exactly three options; exactly one is correct. */
  options: [string, string, string];
  /** Index of the correct option. */
  answer: 0 | 1 | 2;
  /** Shown after answering — why that's right (and, where useful, why the others aren't). */
  why: string;
}

/**
 * Keyed by CurriculumModule.id. Only modules flagged `check: true` appear here.
 * Ids: s1m4 (Numbers on every screen), s2m1 (Company fundamentals),
 * s2m3 (Reading charts), s3m1 (Valuation), s3m3 (Risk), s4m1 (Strategies),
 * s4m3 (Behaviour).
 */
export const MODULE_CHECKS: Record<string, CheckQuestion[]> = {
  // ── Stage 1 · Numbers on every screen ──
  // price quote · market cap · volume · P/E ratio · 52-week range · dividend · dividend yield · settlement T+1
  s1m4: [
    {
      q: 'You want to know what the whole company is worth, not what one share costs. Which number do you want?',
      options: ['Market cap', 'Share price', 'Daily volume'],
      answer: 0,
      why: 'Market cap is share price × shares outstanding — the price tag for the entire company. Share price alone tells you nothing about size, and volume only tells you how much traded today.',
    },
    {
      q: 'A stock climbs 4% on volume that is triple its daily average. What is the market telling you?',
      options: [
        'Far more people than usual are acting on the move — the conviction is real',
        'The move is fake and will reverse by tomorrow',
        'The company just became more valuable',
      ],
      answer: 0,
      why: 'Volume is participation. A big move on heavy volume means many buyers and sellers agree, which usually carries more weight than a big move on thin trading. It never guarantees the move lasts — it just says more people showed up.',
    },
    {
      q: 'You buy a stock on Tuesday morning. Under T+1 settlement, when does the trade officially settle?',
      options: ['Wednesday', 'Tuesday at the close', 'Friday'],
      answer: 0,
      why: 'US equities settle one business day after the trade: T+1. Tuesday\'s fill settles Wednesday. Settlement is the day cash and shares actually change hands — the day the trade is final, not just executed.',
    },
  ],

  // ── Stage 2 · Company fundamentals ──
  // earnings per share · revenue growth · gross margin · operating margin · free cash flow · debt-to-equity · return on equity · earnings guidance
  s2m1: [
    {
      q: 'Which figure shows the cash a business generates after paying to run and maintain itself?',
      options: ['Free cash flow', 'Gross margin', 'Earnings per share'],
      answer: 0,
      why: 'Free cash flow is operating cash minus capital spending — the money left over that a company can reinvest, repay debt, buy back stock, or pay dividends. Profit on paper can flatter a business; free cash flow is harder to dress up.',
    },
    {
      q: 'Two companies earn the same profit. One has debt-to-equity of 0.2, the other 2.5. What is the practical difference?',
      options: [
        'The second leans far more on borrowed money, so its profits are more fragile',
        'The second is simply the better business',
        'It makes no difference — profit is profit',
      ],
      answer: 0,
      why: 'Debt amplifies everything. A highly levered company can post identical profits in good times and still be the one in trouble when rates rise or revenue dips, because the interest bill comes before shareholders get anything.',
    },
    {
      q: 'Revenue grows 40%, but gross margin shrinks every quarter. What should you take from that?',
      options: [
        'Growth is being bought with discounts and higher costs — it is lower quality than it looks',
        'Nothing — 40% growth is 40% growth',
        'The company is about to become profitable',
      ],
      answer: 0,
      why: 'Top-line growth is only worth what it costs to get. If margin falls in step with revenue, the company is paying for each extra dollar of sales. Watch whether margin stabilises before you pay a growth price for it.',
    },
  ],

  // ── Stage 2 · Reading charts ──
  // candlestick · moving average · support and resistance · RSI · MACD · volume analysis · trend vs range · price gap
  s2m3: [
    {
      q: 'A stock has bounced off $48 three separate times over two months. What is that level usually called?',
      options: ['Support', 'Resistance', 'A price gap'],
      answer: 0,
      why: 'A price where buyers have repeatedly stepped in is support. It is a description of behaviour so far, not a promise — levels break, and when they do the move is often sharp.',
    },
    {
      q: 'RSI reads 78. What does that actually mean?',
      options: [
        'The stock has moved up a lot in a short time — it is stretched, not automatically a sell',
        'Sell immediately — the indicator says so',
        'The stock is cheap and about to rally',
      ],
      answer: 0,
      why: 'RSI is momentum, not prophecy. A high reading means recent gains have been large and fast. Strong trends can sit above 70 for a long time, so treat it as a caution flag about how stretched the move is.',
    },
    {
      q: 'What is a moving average actually for?',
      options: [
        'It smooths out day-to-day noise so the underlying direction stands out',
        'It predicts tomorrow\'s price',
        'It measures how much volume is trading',
      ],
      answer: 0,
      why: 'A moving average averages the last N closes, so one wild day can\'t distort the picture. Traders use it to describe trend and as a rough reference line for entries and exits — never as a forecast.',
    },
  ],

  // ── Stage 3 · Valuation ──
  // forward P/E · PEG ratio · price-to-sales · price-to-book · EV/EBITDA · discounted cash flow · margin of safety · value vs growth
  s3m1: [
    {
      q: 'Why might forward P/E be more useful than trailing P/E for a fast-growing company?',
      options: [
        'It uses expected next-12-month earnings, so it reflects where the business is heading',
        'It is always lower, so the stock looks cheaper',
        'It removes the effect of debt',
      ],
      answer: 0,
      why: 'Trailing P/E reads earnings already banked. If earnings are expected to grow, forward P/E shows what you are paying against that future. The catch: it is only as good as the estimate behind it.',
    },
    {
      q: 'A stock trades at a PEG of 2.5. What is that saying?',
      options: [
        'You are paying a lot for each unit of growth',
        'The stock is cheap for its growth',
        'The company has too much debt',
      ],
      answer: 0,
      why: 'PEG divides the P/E by the expected growth rate. A reading near 1 means price roughly matches growth; 2.5 means you are paying a rich multiple for the growth on offer. Useful, but it still trusts the growth estimate.',
    },
    {
      q: 'What is a margin of safety?',
      options: [
        'Buying below your estimate of fair value, so you can be wrong and still come out fine',
        'Setting a stop-loss below your entry price',
        'Only buying stocks with low volatility',
      ],
      answer: 0,
      why: 'Every valuation is an estimate, and estimates are wrong. Buying well under your own fair-value number means you do not need to be exactly right. A stop-loss manages a trade; a margin of safety manages your judgement.',
    },
  ],

  // ── Stage 3 · Risk ──
  // volatility · beta · alpha · max drawdown · sharpe ratio · position sizing · stop loss · risk tolerance
  s3m3: [
    {
      q: 'A fund has a beta of 1.6. What does that mean in practice?',
      options: [
        'It has historically swung more than the market — up bigger, down bigger',
        'It has returned 60% more than the market',
        'It is 60% less risky than the market',
      ],
      answer: 0,
      why: 'Beta measures sensitivity to the market, not performance. At 1.6, a 10% market move has historically come with roughly a 16% move in the same direction. More beta means a bigger ride, both ways.',
    },
    {
      q: 'What does max drawdown tell you that volatility does not?',
      options: [
        'The largest peak-to-trough fall you would have actually had to sit through',
        'How much the price moves on an average day',
        'How the fund performs versus its benchmark',
      ],
      answer: 0,
      why: 'Volatility describes the size of day-to-day wiggles. Max drawdown describes the depth of the worst stretch — the number that decides whether you panic. A strategy is only as good as your ability to hold it to the bottom.',
    },
    {
      q: 'A fund posts positive alpha. What is it being credited with?',
      options: [
        'Return beyond what its risk exposure alone would predict',
        'Return in line with the market',
        'Lower fees than its peers',
      ],
      answer: 0,
      why: 'Alpha is the excess left over after accounting for how much market risk you took. Beta is what the market paid you for showing up; alpha is what the manager added on top. It rarely persists consistently.',
    },
  ],

  // ── Stage 4 · Strategies ──
  // buy and hold · mean reversion · momentum · trend following · covered call · short selling · margin and leverage · tax loss harvesting
  s4m1: [
    {
      q: 'You sell a covered call on stock you own. What are you giving up in exchange for the premium?',
      options: [
        'The upside above the strike price',
        'The dividends on your shares',
        'Your right to sell the shares at all',
      ],
      answer: 0,
      why: 'The premium is real income, but you have capped your gain. If the stock runs past the strike, your shares get called away and you miss everything beyond it. Great for flat markets, painful in a melt-up.',
    },
    {
      q: 'What does tax-loss harvesting actually accomplish?',
      options: [
        'It realises losses to offset gains, cutting this year\'s tax bill while you stay invested',
        'It eliminates the loss from your account',
        'It converts short-term gains into long-term gains',
      ],
      answer: 0,
      why: 'You sell a loser to book the loss, use it to offset gains (or up to $3,000 of ordinary income), then redeploy. The economic loss is real — the point is to make it work for you at tax time. Watch the wash-sale window.',
    },
    {
      q: 'How do momentum and mean reversion differ?',
      options: [
        'Momentum buys what is already working; mean reversion buys what has fallen back',
        'Momentum is short-term, mean reversion is long-term',
        'They are the same strategy with different names',
      ],
      answer: 0,
      why: 'They are opposites, and both have long academic track records. Momentum assumes the move continues; mean reversion assumes it snaps back toward average. The regime decides which one is being punished.',
    },
  ],

  // ── Stage 4 · Behaviour ──
  // loss aversion · recency bias · overconfidence · herd behaviour · anchoring · sequence risk
  s4m3: [
    {
      q: 'Why does a 20% loss hurt more than a 20% gain feels good?',
      options: [
        'Losses are felt roughly twice as strongly as equivalent gains',
        'Losses are taxed more heavily than gains',
        'They are felt equally — people just remember losses longer',
      ],
      answer: 0,
      why: 'Loss aversion. The pain of losing $1,000 outweighs the pleasure of gaining it, which is why people sell winners early and hold losers too long. Knowing the bias is what lets you budget for it.',
    },
    {
      q: 'A sector has run up for four straight months. You now expect it to keep running because that is all you have seen. What is that?',
      options: ['Recency bias', 'Anchoring', 'Sequence risk'],
      answer: 0,
      why: 'Recency bias weights the recent past far too heavily. Anchoring is a different trap — fixating on a specific number like your entry price. Recent hot streaks are exactly when recency bias does the most damage.',
    },
    {
      q: 'Two retirees earn the same average annual return, but one has bad years first. Why can the second end up with far less money?',
      options: [
        'Because the order of returns matters when you are withdrawing',
        'Because average returns are calculated differently',
        'Because of taxes on the earlier withdrawals',
      ],
      answer: 0,
      why: 'Sequence risk. While you are adding money, order is noise. While you are withdrawing, early losses force you to sell more shares to fund the same income — and those shares are never there for the recovery.',
    },
  ],
};

/** True when a module has a complete 3-question self-check. */
export const hasCheck = (moduleId: string): boolean => (MODULE_CHECKS[moduleId]?.length ?? 0) === 3;

/** The questions for a module (empty array when it has no check). */
export const questionsFor = (moduleId: string): CheckQuestion[] => MODULE_CHECKS[moduleId] ?? [];
