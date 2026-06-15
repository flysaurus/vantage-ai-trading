// ─── /onboarding ───────────────────────────────────────────
// Full-screen onboarding quiz flow.
// Renders if no quiz completion flag in localStorage.
//
// Screen order:
//  0. Splash (auto-advances after 2s)
//  1-5. Q1 → Q2 → Q3 → Q4 → Q5
//  6. Name capture
//  7. Result screen
//
// On completion: saves style, name, risk to localStorage;
// syncs to Supabase; navigates to /

'use client';

import React, { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { SplashScreen } from '@/components/onboarding/SplashScreen';
import { QuizQuestion } from '@/components/onboarding/QuizQuestion';
import { NameCapture } from '@/components/onboarding/NameCapture';
import { ResultScreen } from '@/components/onboarding/ResultScreen';
import {
  QUIZ_QUESTIONS,
  scoreQuiz,
  isQuizComplete,
  markQuizComplete,
} from '@/lib/onboarding/quiz-logic';
import { getOrCreateAnonymousId } from '@/lib/session/anonymous';
import type { InvestorStyle } from '@/types';

type Screen = 'splash' | 'quiz' | 'name' | 'result';

export default function OnboardingPage() {
  const router = useRouter();

  // If already complete, redirect to main app immediately
  if (typeof window !== 'undefined' && isQuizComplete()) {
    router.replace('/');
    return null;
  }

  const [screen, setScreen] = useState<Screen>('splash');
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [userName, setUserName] = useState('');
  const [result, setResult] = useState<ReturnType<typeof scoreQuiz> | null>(null);

  // ── Splash done ────────────────────────────────────────────

  const handleSplashDone = useCallback(() => {
    setScreen('quiz');
  }, []);

  // ── Answer a quiz question ─────────────────────────────────

  const handleAnswer = useCallback((key: string) => {
    const newAnswers = [...answers, key];
    setAnswers(newAnswers);

    if (newAnswers.length < QUIZ_QUESTIONS.length) {
      // Next question
      setTimeout(() => {
        setQuestionIndex(newAnswers.length);
      }, 100);
    } else {
      // All questions answered — score it and go to name capture
      const quizResult = scoreQuiz(newAnswers);
      setResult(quizResult);
      setTimeout(() => {
        setScreen('name');
      }, 400);
    }
  }, [answers]);

  // ── Name captured ──────────────────────────────────────────

  const handleNameSubmit = useCallback((name: string) => {
    setUserName(name);
    if (name) {
      try {
        localStorage.setItem('vantage_user_name', name);
      } catch {}
    }
    setTimeout(() => setScreen('result'), 300);
  }, []);

  const handleNameSkip = useCallback(() => {
    setUserName('');
    setTimeout(() => setScreen('result'), 300);
  }, []);

  // ── Enter Vantage ──────────────────────────────────────────

  const handleEnter = useCallback(async (style: InvestorStyle, riskTolerance: string) => {
    // Save to localStorage
    try {
      localStorage.setItem('vantage:investorStyle', style);
      localStorage.setItem('vantage:riskTolerance', riskTolerance);
      localStorage.setItem('vantage:onboarded', 'true');
      if (userName) {
        localStorage.setItem('vantage_user_name', userName);
      }
    } catch {}

    // Sync to Supabase anonymously
    try {
      const anonymousId = getOrCreateAnonymousId();
      await fetch('/api/onboarding/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          anonymousId,
          investorStyle: style,
          riskTolerance,
          firstName: userName || undefined,
        }),
      });
    } catch (err) {
      console.warn('[onboarding] Supabase sync failed (non-blocking):', err);
    }

    // Mark complete and navigate
    markQuizComplete();

    // Dispatch navigation event for bottom nav
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('vantage-navigate', { detail: { tab: 'portfolio' } })
      );
    }

    router.push('/');
  }, [userName, router]);

  // ── Render current screen ──────────────────────────────────

  if (screen === 'splash') {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: '#0a0f1e' }}>
        <SplashScreen onDone={handleSplashDone} />
      </div>
    );
  }

  // Quiz screen (fixed background for smooth transitions)
  if (screen === 'quiz' && questionIndex < QUIZ_QUESTIONS.length) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 100,
          background: '#0a0f1e',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-start',
          paddingTop: 'env(safe-area-inset-top)',
        }}
      >
        {/* Back button (only after Q1) */}
        {questionIndex > 0 && (
          <button
            onClick={() => {
              setAnswers(prev => prev.slice(0, -1));
              setQuestionIndex(prev => prev - 1);
            }}
            style={{
              position: 'absolute',
              top: 'max(16px, env(safe-area-inset-top, 16px))',
              left: '16px',
              background: 'none',
              border: 'none',
              color: '#64748b',
              fontSize: '14px',
              cursor: 'pointer',
              padding: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              zIndex: 10,
            }}
          >
            ← Back
          </button>
        )}

        <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
          <QuizQuestion
            key={QUIZ_QUESTIONS[questionIndex].id}
            question={QUIZ_QUESTIONS[questionIndex]}
            questionNumber={questionIndex + 1}
            totalQuestions={QUIZ_QUESTIONS.length}
            onAnswer={handleAnswer}
            direction="forward"
          />
        </div>
      </div>
    );
  }

  // Name capture screen
  if (screen === 'name') {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 100,
          background: '#0a0f1e',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-start',
          paddingTop: 'env(safe-area-inset-top)',
        }}
      >
        <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
          <NameCapture onSubmit={handleNameSubmit} onSkip={handleNameSkip} />
        </div>
      </div>
    );
  }

  // Result screen
  if (screen === 'result' && result) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 100,
          background: '#0a0f1e',
          overflowY: 'auto',
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <ResultScreen
          result={result}
          userName={userName}
          onEnter={handleEnter}
        />
      </div>
    );
  }

  // Fallback: redirect to main app
  return null;
}
