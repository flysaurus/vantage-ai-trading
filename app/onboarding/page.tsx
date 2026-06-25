// ─── /onboarding ───────────────────────────────────────────
// Full-screen onboarding quiz flow with splash sequence.
//
// Screen order:
//  0. Boot Splash (every open, 1.5s, compass burst + wordmark)
//  1. Feature Splash (first-time only, 3 auto-advancing lines)
//  2. Arrival (typewriter text, "Find my style →")
//  3-7. Q1 → Q2 → Q3 → Q4 → Q5 (stacked answer cards)
//  8. Name capture (first + last name, required)
//  9. Style reveal (burst, typewriter, override pills)
// 10. Account creation (handled by parent or next prompt)
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
import { NameCapture } from '@/components/onboarding/NameCapture';
import { StyleReveal } from '@/components/onboarding/StyleReveal';
import { QUIZ_QUESTIONS, scoreQuiz, checkQuizComplete } from '@/lib/onboarding/quiz-logic';
import type { InvestorStyleKey, RiskTolerance } from '@/lib/onboarding/onboarding-state';

type Screen = 'boot' | 'feature' | 'arrival' | 'quiz' | 'name' | 'reveal';

export default function OnboardingPage() {
  const router = useRouter();

  // If already complete, redirect to main app
  useEffect(() => {
    checkQuizComplete().then(({ complete }) => {
      if (complete) router.replace('/');
    });
  }, [router]);

  const [screen, setScreen] = useState<Screen>('boot');
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
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
        setScreen('name');
      }, 400);
    }
  }, [answers]);

  // ── Back navigation ────────────────────────────────────────

  const handleBack = useCallback(() => {
    setAnswers((prev) => prev.slice(0, -1));
    setQuestionIndex((prev) => prev - 1);
  }, []);

  const handleNameBack = useCallback(() => {
    // Go back to Q5
    setQuestionIndex(4);
    setAnswers((prev) => prev.slice(0, 4));
    setScreen('quiz');
  }, []);

  // ── Name captured ──────────────────────────────────────────

  const handleNameSubmit = useCallback((first: string, last: string) => {
    setFirstName(first);
    setLastName(last);
    setTimeout(() => setScreen('reveal'), 300);
  }, []);

  // ── Create account (passes all state to CreateAccount screen) ─

  const handleCreateAccount = useCallback(
    (data: { style: InvestorStyleKey; risk: RiskTolerance; firstName: string; lastName: string }) => {
      // Store in sessionStorage temporarily for CreateAccount to pick up
      // (CreateAccount screen will be built in a later prompt)
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
          />
        );
      }
      return null;

    case 'name':
      return (
        <NameCapture onSubmit={handleNameSubmit} onBack={handleNameBack} />
      );

    case 'reveal':
      if (quizResult) {
        return (
          <StyleReveal
            style={quizResult.style}
            risk={quizResult.risk}
            firstName={firstName}
            lastName={lastName}
            onCreateAccount={handleCreateAccount}
          />
        );
      }
      return null;

    default:
      return null;
  }
}
