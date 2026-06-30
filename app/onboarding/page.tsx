// ─── /onboarding ───────────────────────────────────────────
// Full-screen onboarding quiz flow with splash sequence.
//
// Screen order:
//  0. Boot Splash (every open, 1.5s, compass burst + wordmark)
//  1. Feature Splash (first-time only, 3 auto-advancing lines)
//  2. Arrival (typewriter text, "Find my style →")
//  3-7. Q1 → Q2 → Q3 → Q4 → Q5 (stacked answer cards)
//  8. Style reveal (burst, typewriter, override pills)
//  9. → Create account (names captured on create-account page)
//
// State: all quiz data held in React state only — no
// localStorage, no Supabase writes until account creation.

'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { BootSplash } from '@/components/onboarding/BootSplash';
import { FeatureSplash } from '@/components/onboarding/FeatureSplash';
import { ArrivalScreen } from '@/components/onboarding/ArrivalScreen';
import { QuizQuestion } from '@/components/onboarding/QuizQuestion';
import { StyleReveal } from '@/components/onboarding/StyleReveal';
import { QUIZ_QUESTIONS, scoreQuiz, checkQuizComplete } from '@/lib/onboarding/quiz-logic';
import type { InvestorStyleKey, RiskTolerance } from '@/lib/onboarding/onboarding-state';

type Screen = 'boot' | 'feature' | 'arrival' | 'quiz' | 'reveal';

export default function OnboardingPage() {
  const router = useRouter();

  // Don't redirect — let app/page.tsx handle routing via useAppState.
  // Redirecting here creates an infinite loop when the state machine
  // sends us to /onboarding but checkQuizComplete says we're done.
  useEffect(() => {
    checkQuizComplete().then(({ complete }) => {
      if (complete) {
        // Don't redirect — let app/page.tsx
        // handle routing via useAppState
        // Redirecting here creates a loop
        return;
      }
    });
  }, [router]);

  const [screen, setScreen] = useState<Screen>(() => {
    // Check for retake flag (set from Settings → Retake quiz / Change style)
    if (typeof window !== 'undefined') {
      const retake = sessionStorage.getItem('vantage_onboarding_retake');
      if (retake === 'quiz') {
        sessionStorage.removeItem('vantage_onboarding_retake');
        return 'quiz';
      }
      if (retake === 'reveal') {
        sessionStorage.removeItem('vantage_onboarding_retake');
        return 'reveal';
      }
    }
    return 'boot';
  });
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [quizResult, setQuizResult] = useState<ReturnType<typeof scoreQuiz> | null>(null);

  // ── Boot Splash complete ──────────────────────────────────

  const handleBootComplete = useCallback(() => {
    setScreen('feature');
  }, []);

  // ── Feature Splash complete ───────────────────────────────

  const handleFeatureComplete = useCallback(() => {
    setScreen('arrival');
  }, []);

  // ── Arrival: find style → quiz, sign in → /login ──────────

  const handleFindStyle = useCallback(() => {
    setScreen('quiz');
  }, []);

  const handleSignIn = useCallback(() => {
    router.push('/login');
  }, [router]);

  // ── Answer a quiz question ─────────────────────────────────

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
        setScreen('reveal');
      }, 400);
    }
  }, [answers]);

  // ── Back navigation ────────────────────────────────────────

  const handleBack = useCallback(() => {
    setAnswers((prev) => prev.slice(0, -1));
    setQuestionIndex((prev) => prev - 1);
  }, []);

  // ── Create account (passes style + risk to create-account) ─

  const handleCreateAccount = useCallback(
    (data: { style: InvestorStyleKey; risk: RiskTolerance }) => {
      try {
        sessionStorage.setItem('vantage_onboarding_data', JSON.stringify(data));
      } catch {}
      router.push('/create-account');
    },
    [router],
  );

  // ── Render current screen ──────────────────────────────────

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
            onBack={questionIndex > 0 ? handleBack : undefined}
            onSignIn={handleSignIn}
          />
        );
      }
      return null;

    case 'reveal':
      if (quizResult) {
        return (
          <StyleReveal
            style={quizResult.style}
            risk={quizResult.risk}
            onCreateAccount={handleCreateAccount}
            onSignIn={handleSignIn}
          />
        );
      }
      return null;

    default:
      return null;
  }
}
