// ─── /onboarding ───────────────────────────────────────────
// Full-screen onboarding quiz flow with splash sequence.
//
// Screen order:
//  0. Boot Splash (every open, ~1100ms, compass burst + wordmark)
//  1. Feature Splash (first-time only, 3 auto-advancing lines)
//  2. Arrival (typewriter text, "Find my style →")
//  3-7. Q1 → Q2 → Q3 → Q4 → Q5 (slide transitions, carousel)
//  8. Name capture (slide-up)
//  9. Result screen (style reveal)
//
// Routing:
//  - BootSplash decides: main / feature-splash / quiz
//  - FeatureSplash decides: arrival / quiz (skip)
//  - Result: saves to localStorage + Supabase, navigates to /

'use client';

import React, { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { BootSplash } from '@/components/onboarding/BootSplash';
import { FeatureSplash } from '@/components/onboarding/FeatureSplash';
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

type Screen = 'boot' | 'feature' | 'arrival' | 'quiz' | 'name' | 'result';

export default function OnboardingPage() {
  const router = useRouter();

  // If already complete, redirect to main app immediately
  if (typeof window !== 'undefined' && isQuizComplete()) {
    router.replace('/');
    return null;
  }

  // Determine initial screen: always BootSplash first
  const [screen, setScreen] = useState<Screen>('boot');
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [userName, setUserName] = useState('');
  const [result, setResult] = useState<ReturnType<typeof scoreQuiz> | null>(null);

  // ── Boot Splash complete ──────────────────────────────────

  const handleBootComplete = useCallback((route: 'main' | 'feature-splash' | 'quiz') => {
    if (route === 'main') {
      router.replace('/');
      return;
    }
    if (route === 'feature-splash') {
      setScreen('feature');
      return;
    }
    if (route === 'quiz') {
      setScreen('quiz');
      return;
    }
  }, [router]);

  // ── Feature Splash complete ───────────────────────────────

  const handleFeatureComplete = useCallback((route: 'arrival' | 'quiz') => {
    if (route === 'arrival') {
      setScreen('arrival');
    } else {
      setScreen('quiz');
    }
  }, []);

  // ── Arrival done → quiz ────────────────────────────────────

  const handleFindStyle = useCallback(() => {
    setScreen('quiz');
  }, []);

  // ── Answer a quiz question ─────────────────────────────────

  const handleAnswer = useCallback((key: string) => {
    const newAnswers = [...answers, key];
    setAnswers(newAnswers);

    if (newAnswers.length < QUIZ_QUESTIONS.length) {
      setTimeout(() => {
        setQuestionIndex(newAnswers.length);
      }, 100);
    } else {
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
      try { localStorage.setItem('vantage_user_name', name); } catch {}
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

    try {
      const anonymousId = getOrCreateAnonymousId();
      await fetch('/api/onboarding/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anonymousId, investorStyle: style, riskTolerance, firstName: userName || undefined }),
      });
    } catch (err) {
      console.warn('[onboarding] Supabase sync failed (non-blocking):', err);
    }

    markQuizComplete();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('vantage-navigate', { detail: { tab: 'portfolio' } }));
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

  // ── Boot Splash ────────────────────────────────────────────

  if (screen === 'boot') {
    return <BootSplash onComplete={handleBootComplete} />;
  }

  // ── Feature Splash ─────────────────────────────────────────

  if (screen === 'feature') {
    return <FeatureSplash onComplete={handleFeatureComplete} />;
  }

  // ── Arrival screen ─────────────────────────────────────────

  if (screen === 'arrival') {
    return <ArrivalScreen onFindStyle={handleFindStyle} />;
  }

  // ── Quiz screens ───────────────────────────────────────────

  if (screen === 'quiz' && questionIndex < QUIZ_QUESTIONS.length) {
    return (
      <div style={quizBackground}>
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
      <div style={{ ...quizBackground, alignItems: 'unset' }}>
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
        <ResultScreen result={result} userName={userName} onEnter={handleEnter} />
      </div>
    );
  }

  return null;
}
