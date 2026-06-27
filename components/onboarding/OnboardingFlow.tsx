// ─── Onboarding Flow ────────────────────────────────────────
// Single wrapper that manages which onboarding screen shows
// and holds all quiz data in React state (memory only) until
// account creation writes it to Supabase.
//
// Screens: boot → feature → arrival → quiz (5q) → name → reveal → /create-account

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BootSplash } from '@/components/onboarding/BootSplash';
import { FeatureSplash } from '@/components/onboarding/FeatureSplash';
import { ArrivalScreen } from '@/components/onboarding/ArrivalScreen';
import { QuizQuestion } from '@/components/onboarding/QuizQuestion';
import { NameCapture } from '@/components/onboarding/NameCapture';
import { StyleReveal } from '@/components/onboarding/StyleReveal';
import { QUIZ_QUESTIONS, scoreQuiz } from '@/lib/onboarding/quiz-logic';
import type { InvestorStyleKey, RiskTolerance } from '@/lib/onboarding/onboarding-state';

// ── Types ───────────────────────────────────────────────────

type OnboardingScreen =
  | 'boot'
  | 'feature'
  | 'arrival'
  | 'quiz'
  | 'name'
  | 'reveal'
  | 'create-account';

type QuizDirection = 'forward' | 'back';

interface OnboardingState {
  screen: OnboardingScreen;
  firstName: string;
  lastName: string;
  quizAnswers: string[];
  currentQuizQuestion: number;
  investorStyle: InvestorStyleKey | null;
  riskTolerance: RiskTolerance | null;
  direction: QuizDirection;
}

// ── Component ──────────────────────────────────────────────

interface OnboardingFlowProps {
  initialScreen?: OnboardingScreen;
}

export default function OnboardingFlow({ initialScreen }: OnboardingFlowProps) {
  const router = useRouter();

  const [state, setState] = useState<OnboardingState>({
    screen: initialScreen || 'boot',
    firstName: '',
    lastName: '',
    quizAnswers: [],
    currentQuizQuestion: 0,
    investorStyle: null,
    riskTolerance: null,
    direction: 'forward',
  });

  // ── Navigation helper ────────────────────────────────────

  function goTo(
    screen: OnboardingScreen,
    direction: QuizDirection = 'forward',
    updates: Partial<OnboardingState> = {},
  ) {
    setState((prev) => ({
      ...prev,
      ...updates,
      screen,
      direction,
    }));
  }

  // ── Screen transitions ───────────────────────────────────

  // boot → feature (first time)
  function handleBootComplete() {
    goTo('feature');
  }

  // feature → arrival
  function handleFeatureComplete() {
    goTo('arrival');
  }

  // arrival → quiz Q1
  function handleArrivalCTA() {
    goTo('quiz', 'forward', {
      currentQuizQuestion: 0,
      quizAnswers: [],
    });
  }

  // arrival → sign in
  function handleSignIn() {
    router.push('/login');
  }

  // quiz answer selected
  function handleQuizAnswer(answer: string) {
    // Preserve answers before AND after current question (back-button safety)
    const newAnswers = [
      ...state.quizAnswers.slice(0, state.currentQuizQuestion),
      answer,
      ...state.quizAnswers.slice(state.currentQuizQuestion + 1),
    ];

    if (state.currentQuizQuestion < 4) {
      // Advance to next question
      setState((prev) => ({
        ...prev,
        quizAnswers: newAnswers,
        currentQuizQuestion: prev.currentQuizQuestion + 1,
        direction: 'forward',
      }));
    } else {
      // Q5 complete — score quiz
      const { style, risk } = scoreQuiz(newAnswers);
      goTo('name', 'forward', {
        quizAnswers: newAnswers,
        investorStyle: style,
        riskTolerance: risk,
      });
    }
  }

  // quiz back button
  function handleQuizBack() {
    if (state.currentQuizQuestion === 0) {
      goTo('arrival', 'back');
    } else {
      setState((prev) => ({
        ...prev,
        currentQuizQuestion: prev.currentQuizQuestion - 1,
        direction: 'back',
      }));
    }
  }

  // name capture complete
  function handleNameComplete(firstName: string, lastName: string) {
    goTo('reveal', 'forward', {
      firstName,
      lastName,
    });
  }

  // name back → Q5
  function handleNameBack() {
    goTo('quiz', 'back', {
      currentQuizQuestion: 4,
    });
  }

  // reveal → create account (navigate to dedicated page with sessionStorage bridge)
  function handleCreateAccount(data: {
    style: InvestorStyleKey;
    risk: RiskTolerance;
    firstName: string;
    lastName: string;
  }) {
    try {
      sessionStorage.setItem('vantage_onboarding_data', JSON.stringify(data));
    } catch {}
    router.push('/create-account');
  }

  // reveal back → name
  function handleRevealBack() {
    goTo('name', 'back');
  }

  // ── Render ───────────────────────────────────────────────

  const currentQuestion = QUIZ_QUESTIONS[state.currentQuizQuestion];

  switch (state.screen) {
    case 'boot':
      return <BootSplash onComplete={handleBootComplete} />;

    case 'feature':
      return <FeatureSplash onComplete={handleFeatureComplete} />;

    case 'arrival':
      return (
        <ArrivalScreen
          onFindStyle={handleArrivalCTA}
          onSignIn={handleSignIn}
        />
      );

    case 'quiz':
      if (!currentQuestion) return null;
      return (
        <QuizQuestion
          key={currentQuestion.id}
          question={currentQuestion}
          questionNumber={state.currentQuizQuestion + 1}
          totalQuestions={QUIZ_QUESTIONS.length}
          onAnswer={handleQuizAnswer}
          onBack={state.currentQuizQuestion > 0 ? handleQuizBack : undefined}
          onSignIn={handleSignIn}
        />
      );

    case 'name':
      return (
        <NameCapture
          onSubmit={handleNameComplete}
          onBack={handleNameBack}
        />
      );

    case 'reveal':
      if (!state.investorStyle || !state.riskTolerance) return null;
      return (
        <StyleReveal
          style={state.investorStyle}
          risk={state.riskTolerance}
          firstName={state.firstName}
          lastName={state.lastName}
          onCreateAccount={handleCreateAccount}
          onBack={handleRevealBack}
        />
      );

    case 'create-account':
      // Handled by navigation to /create-account page
      // Fallback: show boot splash while redirecting
      return <BootSplash onComplete={handleBootComplete} />;

    default:
      return <BootSplash onComplete={handleBootComplete} />;
  }
}
