// ─── Onboarding Quiz Logic ──────────────────────────────────
// Scoring engine for the 5-question investor style quiz.
//
// Questions 1-4 determine investor style (buffett/lynch/livermore/munger/soros)
// Question 5 determines risk tolerance (conservative/moderate/aggressive)
//
// Tiebreak: last question's answer wins among tied styles.

import type { InvestorStyle } from '@/types';

// ─── Types ────────────────────────────────────────────────────

export interface QuizResult {
  style: InvestorStyle;
  riskTolerance: 'Conservative' | 'Moderate' | 'Aggressive';
  votes: Record<InvestorStyle, number>;
  winningVoteCount: number;
}

// ─── Question → Style Mappings ────────────────────────────────

// Q1: "You find a promising company nobody's talking about..."
const Q1: Record<string, InvestorStyle> = {
  A: 'buffett',
  B: 'livermore',
  C: 'soros',
  D: 'munger',
  E: 'lynch',
};

// Q2: "You made a conviction bet. Early signs suggest you might be wrong..."
// B and D both map to livermore (counts as one vote)
const Q2: Record<string, InvestorStyle> = {
  A: 'buffett',
  B: 'livermore',
  C: 'munger',
  D: 'livermore',
  E: 'soros',
};

// Q3: "You have capital but five great ideas. How do you allocate?"
const Q3: Record<string, InvestorStyle> = {
  A: 'buffett',
  B: 'lynch',
  C: 'lynch',
  D: 'livermore',
  E: 'munger',
};

// Q4: "What information moves the needle most in your decisions?"
const Q4: Record<string, InvestorStyle> = {
  A: 'munger',
  B: 'lynch',
  C: 'buffett',
  D: 'livermore',
  E: 'soros',
};

// Q5 Risk: "How much volatility can you handle?"
const Q5_RISK: Record<string, 'Conservative' | 'Moderate' | 'Aggressive'> = {
  A: 'Conservative',
  B: 'Moderate',
  C: 'Aggressive',
};

const QUESTION_MAPS = [Q1, Q2, Q3, Q4];

// ─── Scoring ─────────────────────────────────────────────────

/**
 * Score the quiz from an array of answer letters (A-E).
 * answers[0-3] = Q1-Q4 (style), answers[4] = Q5 (risk)
 *
 * Tiebreak: when multiple styles have the same top count,
 * the last question (Q4) decides — if its mapping is among
 * the tied styles, winner = Q4's style. Otherwise, use Q3, etc.
 * If all fail to break, takes the first tied style.
 */
export function scoreQuiz(answers: string[]): QuizResult {
  // Count votes per style from Q1-Q4
  const votes: Record<InvestorStyle, number> = {
    buffett: 0,
    lynch: 0,
    livermore: 0,
    munger: 0,
    soros: 0,
  };

  for (let i = 0; i < 4; i++) {
    const answer = answers[i];
    const map = QUESTION_MAPS[i];
    const style = map[answer];
    if (style && style in votes) {
      votes[style] += 1;
    }
  }

  // Find winner
  let maxVotes = 0;
  const tied: InvestorStyle[] = [];

  for (const [style, count] of Object.entries(votes)) {
    if (count > maxVotes) {
      maxVotes = count;
      tied.length = 0;
      tied.push(style as InvestorStyle);
    } else if (count === maxVotes && count > 0) {
      tied.push(style as InvestorStyle);
    }
  }

  let winner: InvestorStyle;

  if (tied.length === 1) {
    winner = tied[0];
  } else {
    // Tiebreak: use last question's answer (Q4, index 3)
    const q4Style = QUESTION_MAPS[3][answers[3]];
    if (q4Style && tied.includes(q4Style)) {
      winner = q4Style;
    } else {
      // Fallback: take the first tied style
      winner = tied[0] || 'buffett';
    }
  }

  // Q5 risk
  const riskTolerance = Q5_RISK[answers[4]] || 'Moderate';

  return {
    style: winner,
    riskTolerance,
    votes,
    winningVoteCount: maxVotes,
  };
}

// ─── Style Descriptions ─────────────────────────────────────

const STYLE_DESCRIPTIONS: Record<InvestorStyle, string> = {
  buffett:
    'You invest in businesses, not tickers. Long-term conviction and patience are your edge.',
  lynch:
    "You find opportunity where others aren't looking. Growth stories before they go mainstream.",
  livermore:
    'You read the tape. Timing, momentum, and discipline define how you move.',
  munger:
    'You think in mental models. Rational analysis and avoiding mistakes beats chasing wins.',
  soros:
    "You spot what the market's getting wrong. Macro trends and reflexivity are your weapons.",
};

const STYLE_NAMES: Record<InvestorStyle, string> = {
  buffett: 'Buffett',
  lynch: 'Lynch',
  livermore: 'Livermore',
  munger: 'Munger',
  soros: 'Soros',
};

export function getStyleDescription(style: InvestorStyle): string {
  return STYLE_DESCRIPTIONS[style] || STYLE_DESCRIPTIONS.buffett;
}

export function getStyleDisplayName(style: InvestorStyle): string {
  return STYLE_NAMES[style] || 'Buffett';
}

// ─── Quiz Questions (hardcoded) ──────────────────────────────

export interface QuizQuestion {
  id: string;
  question: string;
  options: { key: string; text: string }[];
}

export const QUIZ_QUESTIONS: QuizQuestion[] = [
  {
    id: 'q1',
    question: "You find a promising company nobody's talking about. What's your move?",
    options: [
      { key: 'A', text: 'Deep research: cash flow, competitive moat, management quality. Patience wins.' },
      { key: 'B', text: 'Check momentum and technicals. Is there a reason it\'s undervalued right now?' },
      { key: 'C', text: 'Analyze macro environment. Is this a contrarian setup others are missing?' },
      { key: 'D', text: 'Assess competitive position, management incentives, and business rationality.' },
      { key: 'E', text: 'Research the growth story and earnings trajectory. Fundamentals catch up.' },
    ],
  },
  {
    id: 'q2',
    question: 'You made a conviction bet. Early signs suggest you might be wrong. What happens?',
    options: [
      { key: 'A', text: 'Double down if the thesis is intact. Conviction means weathering the noise.' },
      { key: 'B', text: 'Cut losses quickly. Capital efficiency matters more than being right.' },
      { key: 'C', text: 'Deep analysis before deciding. Conviction needs evidence.' },
      { key: 'D', text: 'Wait. The market hasn\'t proven me wrong yet — timing and setup still matter.' },
      { key: 'E', text: 'Look for reflexive patterns. Are others panicking into opportunity?' },
    ],
  },
  {
    id: 'q3',
    question: 'You have capital but five great ideas. How do you allocate?',
    options: [
      { key: 'A', text: 'Concentrate in highest-conviction bets with the best risk/reward ratio.' },
      { key: 'B', text: 'Diversify across all five. Reduce single-position risk.' },
      { key: 'C', text: 'Size by growth trajectory and earnings surprise potential.' },
      { key: 'D', text: 'Size by technical momentum and best entry opportunity.' },
      { key: 'E', text: 'Analyze competitive moats and management quality. Best business wins more capital.' },
    ],
  },
  {
    id: 'q4',
    question: 'What information moves the needle most in your decisions?',
    options: [
      { key: 'A', text: 'Competitive advantages and whether they\'ll persist long-term.' },
      { key: 'B', text: 'Earnings growth and how the market has priced future expectations.' },
      { key: 'C', text: 'Intrinsic value vs. market price. Cheap is enough.' },
      { key: 'D', text: 'Technical patterns and momentum. Price leads fundamentals.' },
      { key: 'E', text: 'Macro trends and where consensus is wrong.' },
    ],
  },
  {
    id: 'q5',
    question: 'You have $10,000 to invest. How much volatility can you handle?',
    options: [
      { key: 'A', text: 'Small swings only. I prioritize stability over returns.' },
      { key: 'B', text: 'Moderate swings are fine. 15-20% annual volatility doesn\'t bother me.' },
      { key: 'C', text: 'I embrace volatility. 30%+ swings are part of the game.' },
    ],
  },
];

// ─── LocalStorage ─────────────────────────────────────────────

const QUIZ_COMPLETE_KEY = 'vantage_quiz_complete';

export function isQuizComplete(): boolean {
  if (typeof window === 'undefined') return true; // Don't block SSR
  try {
    return localStorage.getItem(QUIZ_COMPLETE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function markQuizComplete(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(QUIZ_COMPLETE_KEY, 'true');
  } catch {
    // Ignore storage errors
  }
}
