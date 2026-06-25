// ─── Onboarding Flow ────────────────────────────────────────
// Wraps the entire onboarding sequence. Manages in-memory
// state passed between screens. NOT routed — a single component
// that swaps children. All onboarding state in one place.
//
// Screens: boot → feature → arrival → quiz → name → reveal → create-account

'use client';

import React, { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { BootSplash } from '@/components/onboarding/BootSplash';
import { FeatureSplash } from '@/components/onboarding/FeatureSplash';
import { ArrivalScreen } from '@/components/onboarding/ArrivalScreen';
import { QuizQuestion } from '@/components/onboarding/QuizQuestion';
import { NameCapture } from '@/components/onboarding/NameCapture';
import { StyleReveal } from '@/components/onboarding/StyleReveal';
import ScreenTransition from '@/components/layout/ScreenTransition';
import { QUIZ_QUESTIONS, scoreQuiz } from '@/lib/onboarding/quiz-logic';
import type { InvestorStyleKey, RiskTolerance } from '@/lib/onboarding/onboarding-state';

// ── Types ───────────────────────────────────────────────────

type OnboardingScreen = 'boot' | 'feature' | 'arrival' | 'quiz' | 'name' | 'reveal';

interface OnboardingFlowState {
  screen: OnboardingScreen;
  direction: 'forward' | 'back';
  isFirstEver: boolean;
}

// ── Component ──────────────────────────────────────────────

export default function OnboardingFlow() {
  const router = useRouter();

  const [flow, setFlow] = useState<OnboardingFlowState>({
    screen: 'boot',
    direction: 'forward',
    isFirstEver: true, // always true since no localStorage check
  });

  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [quizResult, setQuizResult] = useState<ReturnType<typeof scoreQuiz> | null>(null);

  // ── Transition helper ─────────────────────────────────────

  const goTo = useCallback((screen: OnboardingScreen, direction: 'forward' | 'back' = 'forward') => {
    setFlow((prev) => ({ ...prev, screen, direction }));
  }, []);

  // ── Boot Splash complete ──────────────────────────────────

  const handleBootComplete = useCallback(() => {
    goTo('feature');
  }, [goTo]);

  // ── Feature Splash complete ───────────────────────────────

  const handleFeatureComplete = useCallback(() => {
    goTo('arrival');
  }, [goTo]);

  // ── Arrival screen actions ────────────────────────────────

  const handleFindStyle = useCallback(() => {
    goTo('quiz');
  }, [goTo]);

  const handleSignIn = useCallback(() => {
    router.push('/login');
  }, [router]);

  // ── Quiz answer ───────────────────────────────────────────

  const handleAnswer = useCallback((key: string) => {
    const newAnswers = [...answers, key];
    setAnswers(newAnswers);

    if (newAnswers.length < QUIZ_QUESTIONS.length) {
      setTimeout(() => {
        setQuestionIndex(newAnswers.length);
      }, 100);
    } else {
      const result = scoreQuiz(newAnswers);
      setQuizResult(result);
      setTimeout(() => {
        goTo('name');
      }, 400);
    }
  }, [answers, goTo]);

  // ── Quiz back ─────────────────────────────────────────────

  const handleQuizBack = useCallback(() => {
    setAnswers((prev) => prev.slice(0, -1));
    setQuestionIndex((prev) => prev - 1);
    // Don't change screen — just re-render with previous question
  }, []);

  // ── Name captured ─────────────────────────────────────────

  const handleNameSubmit = useCallback((first: string, last: string) => {
    setFirstName(first);
    setLastName(last);
    setTimeout(() => goTo('reveal'), 300);
  }, [goTo]);

  // ── Name back → Q5 ───────────────────────────────────────

  const handleNameBack = useCallback(() => {
    setQuestionIndex(4);
    setAnswers((prev) => prev.slice(0, 4));
    goTo('quiz', 'back');
  }, [goTo]);

  // ── Reveal back → name ───────────────────────────────────

  const handleRevealBack = useCallback(() => {
    goTo('name', 'back');
  }, [goTo]);

  // ── Create account (pass to /create-account page) ─────────

  const handleCreateAccount = useCallback(
    (data: { style: InvestorStyleKey; risk: RiskTolerance; firstName: string; lastName: string }) => {
      try {
        sessionStorage.setItem('vantage_onboarding_data', JSON.stringify(data));
      } catch {}
      router.push('/create-account');
    },
    [router],
  );

  // ── Render current screen ─────────────────────────────────

  const { screen, direction } = flow;

  const renderScreen = () => {
    switch (screen) {
      case 'boot':
        return <BootSplash onComplete={handleBootComplete} />;

      case 'feature':
        return <FeatureSplash onComplete={handleFeatureComplete} />;

      case 'arrival':
        return <ArrivalScreen onFindStyle={handleFindStyle} onSignIn={handleSignIn} />;

      case 'quiz':
        if (questionIndex < QUIZ_QUESTIONS.length) {
          return (
            <QuizQuestion
              key={QUIZ_QUESTIONS[questionIndex].id}
              question={QUIZ_QUESTIONS[questionIndex]}
              questionNumber={questionIndex + 1}
              totalQuestions={QUIZ_QUESTIONS.length}
              onAnswer={handleAnswer}
              onBack={questionIndex > 0 ? handleQuizBack : undefined}
            />
          );
        }
        return null;

      case 'name':
        return <NameCapture onSubmit={handleNameSubmit} onBack={handleNameBack} />;

      case 'reveal':
        if (quizResult) {
          return (
            <StyleReveal
              style={quizResult.style}
              risk={quizResult.risk}
              firstName={firstName}
              lastName={lastName}
              onCreateAccount={handleCreateAccount}
              onBack={handleRevealBack}
            />
          );
        }
        return null;

      default:
        return null;
    }
  };

  return (
    <ScreenTransition direction={direction} transitionKey={screen}>
      {renderScreen()}
    </ScreenTransition>
  );
}
