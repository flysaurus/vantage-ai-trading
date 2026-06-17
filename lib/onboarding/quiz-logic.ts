// ─── Onboarding Quiz Logic ──────────────────────────────────
// Scoring engine for the 5-question investor style quiz.
//
// Questions 1-4 determine investor style (buffett/lynch/livermore/munger/soros)
// Question 5 determines risk tolerance (conservative/moderate/aggressive)
//
// Tiebreak: last question's answer wins among tied styles.

import { createClient } from '@/lib/supabase';
import type { InvestorStyle } from '@/types';

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
  type InvestorStyleKey,
} from '@/lib/content/investor-styles';

// ─── Types ────────────────────────────────────────────────────

export interface QuizResult {
  style: InvestorStyle;
  riskTolerance: 'Conservative' | 'Moderate' | 'Aggressive';
  votes: Record<InvestorStyle, number>;
  winningVoteCount: number;
}

// ─── Question → Style Mappings ────────────────────────────────

const Q1: Record<string, InvestorStyle> = {
  A: 'buffett',
  B: 'livermore',
  C: 'soros',
  D: 'munger',
  E: 'lynch',
};

// B and D both map to livermore
const Q2: Record<string, InvestorStyle> = {
  A: 'buffett',
  B: 'livermore',
  C: 'munger',
  D: 'livermore',
  E: 'soros',
};

// A→buffett B→lynch C→lynch D→livermore E→munger
const Q3: Record<string, InvestorStyle> = {
  A: 'buffett',
  B: 'lynch',
  C: 'lynch',
  D: 'livermore',
  E: 'munger',
};

// A→munger B→lynch C→buffett D→livermore E→soros
const Q4: Record<string, InvestorStyle> = {
  A: 'munger',
  B: 'lynch',
  C: 'buffett',
  D: 'livermore',
  E: 'soros',
};

// Q5 Risk mapping
const Q5_RISK: Record<string, 'Conservative' | 'Moderate' | 'Aggressive'> = {
  A: 'Conservative',
  B: 'Moderate',
  C: 'Aggressive',
};

const QUESTION_MAPS = [Q1, Q2, Q3, Q4];

// ─── Scoring ─────────────────────────────────────────────────

export function scoreQuiz(answers: string[]): QuizResult {
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
      winner = tied[0] || 'buffett';
    }
  }

  const riskTolerance = Q5_RISK[answers[4]] || 'Moderate';

  return {
    style: winner,
    riskTolerance,
    votes,
    winningVoteCount: maxVotes,
  };
}

// getStyleDisplayName kept for backward compatibility
export function getStyleDisplayName(style: InvestorStyle): string {
  // Capitalize first letter of style id as display name
  const name = style.charAt(0).toUpperCase() + style.slice(1);
  return name;
}

// risk color tokens
export const RISK_COLORS: Record<string, string> = {
  conservative: '#10b981',
  moderate: '#22d3ee',
  aggressive: '#f59e0b',
} as const;

export const RISK_LABELS: Record<string, string> = {
  Conservative: 'CONSERVATIVE',
  Moderate: 'MODERATE',
  Aggressive: 'AGGRESSIVE',
} as const;

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

// ─── LocalStorage ─────────────────────────────────────────────

const QUIZ_COMPLETE_KEY = 'vantage_quiz_complete';

export function isQuizComplete(): boolean {
  if (typeof window === 'undefined') return true;
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

// ─── Async cross-device quiz check ───────────────────────────
// Checks Supabase for authenticated users, falls back to localStorage
// for anonymous users. Hydrates localStorage on success for consistency.

export async function checkQuizComplete(): Promise<{
  complete: boolean;
  style?: string;
  risk?: string;
  name?: string;
}> {
  if (typeof window === 'undefined') return { complete: false };

  try {
    const { createClient } = await import('@/lib/supabase');
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();

    if (session) {
      // Authenticated — check Supabase profile via /api/auth/me
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        if (data?.user?.investorStyleOnboarded) {
          // Hydrate localStorage for cross-device consistency
          localStorage.setItem('vantage_quiz_complete', 'true');
          localStorage.setItem('vantage:investorStyle', data.user.investorStyle);
          localStorage.setItem('vantage:riskTolerance', data.user.riskTolerance || 'Moderate');
          localStorage.setItem('vantage_user_name', data.user.displayName || '');
          return {
            complete: true,
            style: data.user.investorStyle,
            risk: data.user.riskTolerance,
            name: data.user.displayName,
          };
        }
      }
      return { complete: false };
    }

    // Anonymous — check localStorage
    const complete = localStorage.getItem('vantage_quiz_complete') === 'true';
    if (complete) {
      return {
        complete: true,
        style: localStorage.getItem('vantage:investorStyle') || undefined,
        risk: localStorage.getItem('vantage:riskTolerance') || undefined,
        name: localStorage.getItem('vantage_user_name') || undefined,
      };
    }
    return { complete: false };
  } catch {
    return { complete: false };
  }
}
