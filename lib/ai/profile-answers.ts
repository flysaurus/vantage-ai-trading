// ─── Deterministic Profile Answers ────────────────────────────
// "What is my investment style" / "what's my risk tolerance" / "what's my
// profile" are fully answerable from the server-known profile. Answering them
// with a free-form model previously hallucinated a fabricated "$1,000 ETF
// portfolio" + unsolicited ROK/AXON/PLTR recommendations. These helpers route
// pure profile questions to a grounded, deterministic answer (no model call),
// so the reply is always correct and coherent with the app's own style config.
// ──────────────────────────────────────────────────────────────

import type { UserProfile } from '@/lib/ai/userProfile';
import { getInvestorStylePrompt, getRiskTolerancePrompt } from '@/lib/ai/userProfile';
import { getStyleConfig } from '@/lib/investor-style-defaults';

export type ProfileQuestionKind = 'style' | 'risk' | 'profile';

const STYLE_QUESTION_PATTERNS = [
  /what(?:'s|\s+is)\s+my\s+(?:investment|investor|trading|investing)\s+style/i,
  /what\s+(?:investment|investor)\s+style\s+(?:am\s+)?i/i,
  /which\s+(?:investment|investor)\s+style\s+(?:am|do)\s+i\b/i,
  /what\s+style\s+of\s+investor\s+am\s+i/i,
];

const RISK_QUESTION_PATTERNS = [
  /what(?:'s|\s+is)\s+my\s+risk\s+(?:tolerance|level|profile)/i,
  /how\s+(?:risk|aggressive|conservative)\s+(?:tolerant|averse)?\s*am\s+i/i,
];

const PROFILE_QUESTION_PATTERNS = [
  /what(?:'s|\s+is)\s+my\s+(?:investor|investment)\s+profile/i,
  /what\s+do\s+you\s+know\s+about\s+(?:me|my\s+(?:investor|investment)\s+profile)/i,
];

/**
 * Detect a pure profile question. Returns null when the message is a compound
 * request (e.g. "change my style to Lynch and rebalance") so those still route
 * to the model + tools instead of being short-circuited here.
 */
export function detectProfileQuestion(message: string): ProfileQuestionKind | null {
  const m = message.trim();
  if (!m || m.length > 120) return null;

  // Compound / action requests must NOT be intercepted.
  if (/\b(change|switch|set|update|make|turn)\b.*\bstyle\b/i.test(m)) return null;
  if (/\brebalance\b|\bportfolio\b/i.test(m)) return null;

  if (STYLE_QUESTION_PATTERNS.some((p) => p.test(m))) return 'style';
  if (RISK_QUESTION_PATTERNS.some((p) => p.test(m))) return 'risk';
  if (PROFILE_QUESTION_PATTERNS.some((p) => p.test(m))) return 'profile';
  return null;
}

/**
 * Build a grounded profile answer from the server-known profile. Uses the app's
 * own style config (`getStyleConfig`) and lens/risk prompts — no fabricated data.
 */
export function buildProfileAnswer(profile: UserProfile, kind: ProfileQuestionKind): string {
  const styleKey = profile.investorStyle.toLowerCase();
  const config = getStyleConfig(styleKey);
  const lens = getInvestorStylePrompt(profile.investorStyle);
  const risk = profile.riskTolerance;

  if (kind === 'risk') {
    return `Your risk tolerance is **${risk}**.\n\n${getRiskTolerancePrompt(risk)}`;
  }

  return [
    `**Your investor style is ${config.label}**`,
    '',
    config.description,
    '',
    lens,
    '',
    `Your risk tolerance is **${risk}**.`,
    '',
    'This profile drives every screen, score, and recommendation in Vantage. Change it anytime in Settings — or just tell me, e.g. "change my style to Lynch."',
  ].join('\n');
}
