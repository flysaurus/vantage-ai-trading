/**
 * ═══════════════════════════════════════════════════════════
 * ONBOARDING STATE — Single source of truth for all quiz
 * data before account creation. No localStorage, no UUIDs.
 * Held purely in React state / context until account creation.
 * ═══════════════════════════════════════════════════════════
 */

export type InvestorStyleKey = 'buffett' | 'lynch' | 'livermore' | 'munger' | 'soros';

export type RiskTolerance = 'conservative' | 'moderate' | 'aggressive';

export type OnboardingScreen =
  | 'boot'
  | 'feature'
  | 'arrival'
  | 'quiz'
  | 'name'
  | 'reveal'
  | 'create-account';

export type QuizDirection = 'forward' | 'back';

export interface OnboardingState {
  firstName: string;
  lastName: string;
  investorStyle: InvestorStyleKey | null;
  riskTolerance: RiskTolerance | null;
  quizAnswers: string[];
  currentScreen: OnboardingScreen;
  quizDirection: QuizDirection;
}

export const INITIAL_ONBOARDING_STATE: OnboardingState = {
  firstName: '',
  lastName: '',
  investorStyle: null,
  riskTolerance: null,
  quizAnswers: [],
  currentScreen: 'boot',
  quizDirection: 'forward',
};
