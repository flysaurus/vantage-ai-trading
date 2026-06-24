// ─── Onboarding Quiz Logic ──────────────────────────────────
// Scoring engine for the 5-question investor style quiz.
//
// Questions 1-4 determine investor style (buffett/lynch/livermore/munger/soros)
// Question 5 determines risk tolerance (conservative/moderate/aggressive)
//
// Tiebreak: Q4 answer wins among tied styles. If Q4 also tied, Q3 wins, etc.
//
// NO localStorage — data stays in React state until account creation.

import type { InvestorStyleKey, RiskTolerance } from './onboarding-state';

// Re-export style content from shared source
export {
  INVESTOR_STYLES,
  getStyleContent,
  getStyleTrait,
  getStyleTag,
  getStyleEmoji,
  getStyleDescription,
  PILL_TRAITS,
  ALL_STYLES,
  ALL_STYLE_KEYS,
} from '@/lib/content/investor-styles';

export type { InvestorStyleKey } from './onboarding-state';

// ─── Types ────────────────────────────────────────────────────

export interface QuizResult {
  style: InvestorStyleKey;
  risk: RiskTolerance;
  votes: Record<InvestorStyleKey, number>;
  winningVoteCount: number;
}

// ─── Question → Style Mappings ────────────────────────────────

const Q1: Record<string, InvestorStyleKey> = {
  A: 'buffett',
  B: 'livermore',
  C: 'soros',
  D: 'munger',
  E: 'lynch',
};

// B and D both map to livermore — intentional, not a bug
const Q2: Record<string, InvestorStyleKey> = {
  A: 'buffett',
  B: 'livermore',
  C: 'munger',
  D: 'livermore',
  E: 'soros',
};

// A→buffett B→lynch C→lynch D→livermore E→munger
const Q3: Record<string, InvestorStyleKey> = {
  A: 'buffett',
  B: 'lynch',
  C: 'lynch',
  D: 'livermore',
  E: 'munger',
};

// A→munger B→lynch C→buffett D→livermore E→soros
const Q4: Record<string, InvestorStyleKey> = {
  A: 'munger',
  B: 'lynch',
  C: 'buffett',
  D: 'livermore',
  E: 'soros',
};

// Q5 Risk mapping
const Q5_RISK: Record<string, RiskTolerance> = {
  A: 'conservative',
  B: 'moderate',
  C: 'aggressive',
};

const QUESTION_MAPS = [Q1, Q2, Q3, Q4];

// ─── Scoring ─────────────────────────────────────────────────

export function scoreQuiz(answers: string[]): QuizResult {
  const votes: Record<InvestorStyleKey, number> = {
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
  const tied: InvestorStyleKey[] = [];

  for (const [style, count] of Object.entries(votes)) {
    if (count > maxVotes) {
      maxVotes = count;
      tied.length = 0;
      tied.push(style as InvestorStyleKey);
    } else if (count === maxVotes && count > 0) {
      tied.push(style as InvestorStyleKey);
    }
  }

  let winner: InvestorStyleKey;

  if (tied.length === 1) {
    winner = tied[0];
  } else {
    // Tiebreak cascade: Q4 → Q3 → Q2
    const q4Style = QUESTION_MAPS[3][answers[3]];
    if (q4Style && tied.includes(q4Style)) {
      winner = q4Style;
    } else {
      const q3Style = QUESTION_MAPS[2][answers[2]];
      if (q3Style && tied.includes(q3Style)) {
        winner = q3Style;
      } else {
        const q2Style = QUESTION_MAPS[1][answers[1]];
        if (q2Style && tied.includes(q2Style)) {
          winner = q2Style;
        } else {
          winner = tied[0] || 'buffett';
        }
      }
    }
  }

  const risk = Q5_RISK[answers[4]] || 'moderate';

  return {
    style: winner,
    risk,
    votes,
    winningVoteCount: maxVotes,
  };
}

// ─── Quiz Questions ──────────────────────────────────────────

export interface QuizQuestion {
  id: string;
  label: string;
  question: string;
  options: { key: string; text: string }[];
}

export const QUIZ_QUESTIONS: QuizQuestion[] = [
  {
    id: 'q1',
    label: 'HOW YOU THINK',
    question: "You spot a promising company nobody's talking about yet. What's your instinct?",
    options: [
      { key: 'A', text: "I dig deep — cash flow, competitive moat, management. If it checks out, I'm patient." },
      { key: 'B', text: 'I check the setup. If momentum and technicals line up, timing is everything.' },
      { key: 'C', text: 'I look for the contrarian angle. What is everyone else missing here?' },
      { key: 'D', text: 'I assess the business rationally — competitive position, incentives, and long-term logic.' },
      { key: 'E', text: "I follow the growth story. Strong earnings trajectory means the market will catch up eventually." },
    ],
  },
  {
    id: 'q2',
    label: 'HOW YOU HANDLE BEING WRONG',
    question: 'You made a conviction bet. Early signs suggest you might be wrong. What happens next?',
    options: [
      { key: 'A', text: 'I hold if the thesis is intact. Real conviction means weathering the noise.' },
      { key: 'B', text: 'I cut quickly. Being wrong fast is better than being wrong slowly.' },
      { key: 'C', text: 'I go back to first principles before doing anything. Conviction needs proof.' },
      { key: 'D', text: "I wait for the market to show me more. One data point isn't a verdict." },
      { key: 'E', text: "I look at who's panicking and why. Others' fear might be my opportunity." },
    ],
  },
  {
    id: 'q3',
    label: 'HOW YOU SIZE UP',
    question: 'You have capital ready and five genuinely great ideas. How do you decide where the money goes?',
    options: [
      { key: 'A', text: 'Heavy into my top one or two. Concentration is how you win big.' },
      { key: 'B', text: "Spread across all five. I'd rather reduce risk than maximize any single bet." },
      { key: 'C', text: 'Largest position in the one with the best earnings surprise potential.' },
      { key: 'D', text: 'I follow the momentum. Best technical setup gets the most capital.' },
      { key: 'E', text: 'The one with the strongest competitive moat and best management gets the most.' },
    ],
  },
  {
    id: 'q4',
    label: 'WHAT YOU TRUST',
    question: "When it's time to make a big decision, what actually moves the needle?",
    options: [
      { key: 'A', text: 'Whether the competitive advantages will still be there in 10 years.' },
      { key: 'B', text: 'Earnings growth and how much of it the market has already priced in.' },
      { key: 'C', text: "The gap between intrinsic value and price. If it's cheap enough, I don't need to be clever." },
      { key: 'D', text: 'Price action and momentum. The tape usually knows before the news does.' },
      { key: 'E', text: 'Where macro consensus is wrong. The biggest trades live in that gap.' },
    ],
  },
  {
    id: 'q5',
    label: 'HOW YOU SLEEP AT NIGHT',
    question: "You have $10,000 invested. Markets get rough. What's your honest reaction?",
    options: [
      { key: 'A', text: 'I check my positions carefully and lose some sleep. Stability matters more to me than upside.' },
      { key: 'B', text: 'I keep an eye on things but stay calm. 15-20% swings are part of the game.' },
      { key: 'C', text: 'I barely flinch. Volatility is just opportunity in disguise.' },
    ],
  },
];

// ─── Cross-Device Completion Check (Supabase only) ──────────
// Used by the main app to decide whether to redirect to onboarding.
// No localStorage — for authenticated users, state lives in Supabase.

export async function checkQuizComplete(): Promise<{
  complete: boolean;
  style?: string;
  risk?: string;
  name?: string;
}> {
  if (typeof window === 'undefined') return { complete: false };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    let res: Response;
    try {
      res = await fetch('/api/auth/me', { signal: controller.signal });
    } catch {
      return { complete: false };
    }
    clearTimeout(timeoutId);

    if (res?.ok) {
      const data = await res.json();
      if (data?.user?.investorStyleOnboarded) {
        return {
          complete: true,
          style: data.user.investorStyle,
          risk: data.user.riskTolerance,
          name: data.user.displayName,
        };
      }
    }

    return { complete: false };
  } catch {
    return { complete: false };
  }
}

// ─── Risk Display Helpers ────────────────────────────────────

export const RISK_COLORS: Record<RiskTolerance, string> = {
  conservative: 'var(--gain)',
  moderate: 'var(--accent)',
  aggressive: 'var(--warning)',
};

export const RISK_LABELS: Record<RiskTolerance, string> = {
  conservative: 'CONSERVATIVE',
  moderate: 'MODERATE',
  aggressive: 'AGGRESSIVE',
};
