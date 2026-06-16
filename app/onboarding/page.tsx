// ─── /onboarding ───────────────────────────────────────────
// Full-screen onboarding quiz flow.
// Renders if no quiz completion flag in localStorage.
//
// Screen order:
//  0. Arrival (compass burst + typewriter, "Find my style →")
//  1-5. Q1 → Q2 → Q3 → Q4 → Q5 (slide transitions)
//  6. Name capture (slide-up)
//  7. Result screen (compass burst + style reveal)
//
// On completion: saves style, name, risk to localStorage;
// syncs to Supabase; navigates to /

'use client';

import React, { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArrivalScreen } from '@/components/onboarding/ArrivalScreen';
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

type Screen = 'arrival' | 'quiz' | 'name' | 'result';

export default function OnboardingPage() {
  const router = useRouter();

  // If already complete, redirect to main app immediately
  if (typeof window !== 'undefined' && isQuizComplete()) {
    router.replace('/');
    return null;
  }

  const [screen, setScreen] = useState<Screen>('arrival');
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [userName, setUserName] = useState('');
  const [result, setResult] = useState<ReturnType<typeof scoreQuiz> | null>(null);

  // ── Arrival done → quiz ────────────────────────────────────

  const handleFindStyle = useCallback(() => {
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
      // All questions answered — score and go to name capture
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

    markQuizComplete();

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('vantage-navigate', { detail: { tab: 'portfolio' } })
      );
    }

    router.push('/');
  }, [userName, router]);

  const quizBackground: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 100,
    background: '#0a0f1e',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-start',
    paddingTop: 'env(safe-area-inset-top)',
    overflow: 'hidden',
  };

  // ── Arrival screen ─────────────────────────────────────────

  if (screen === 'arrival') {
    return <ArrivalScreen onFindStyle={handleFindStyle} />;
  }

  // ── Quiz screen ────────────────────────────────────────────

  if (screen === 'quiz' && questionIndex < QUIZ_QUESTIONS.length) {
    return (
      <div style={quizBackground}>
        {/* Back button (after Q1) */}
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

  // ── Name capture screen ────────────────────────────────────

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
          overflow: 'hidden',
        }}
      >
        <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
          <NameCapture onSubmit={handleNameSubmit} onSkip={handleNameSkip} />
        </div>
      </div>
    );
  }

  // ── Result screen ──────────────────────────────────────────

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

  return null;
}
