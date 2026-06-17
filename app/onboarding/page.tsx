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

import React, { useState, useCallback, useEffect } from 'react';
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
  checkQuizComplete,
  markQuizComplete,
} from '@/lib/onboarding/quiz-logic';
import { getOrCreateAnonymousId } from '@/lib/session/anonymous';
import type { InvestorStyle } from '@/types';

type Screen = 'boot' | 'feature' | 'arrival' | 'quiz' | 'name' | 'result';

export default function OnboardingPage() {
  const router = useRouter();

  // ── DIAGNOSTIC: routing decisions ─────────────────────────
  console.log(`[ONBOARDING_FLOW] 🟢 OnboardingPage MOUNT at ${new Date().toISOString()}`);

  // If already complete, redirect to main app immediately (async cross-device check)
  useEffect(() => {
    console.log(`[ONBOARDING_FLOW] 🔍 checkQuizComplete() running at ${new Date().toISOString()}`);
    const start = Date.now();
    checkQuizComplete().then(({ complete, style, risk, name }) => {
      const dur = Date.now() - start;
      console.log(`[ONBOARDING_FLOW] 🔍 checkQuizComplete() DONE in ${dur}ms → complete=${complete} style="${style || 'none'}" risk="${risk || 'none'}" name="${name || 'none'}"`);
      if (complete) {
        console.log(`[ONBOARDING_FLOW] 🚦 DECISION: redirect to / (quiz already complete)`);
        router.replace('/');
      } else {
        console.log(`[ONBOARDING_FLOW] 🚦 DECISION: stay on onboarding (quiz not complete)`);
      }
    }).catch((err) => {
      console.error(`[ONBOARDING_FLOW] ❌ checkQuizComplete() FAILED:`, err);
    });
  }, [router]);

  // Determine initial screen: always BootSplash first
  const [screen, setScreenRaw] = useState<Screen>('boot');
  
  // ── DIAGNOSTIC: intercept screen transitions ──────────────
  const setScreen = (v: Screen | ((prev: Screen) => Screen)) => {
    const val = typeof v === 'function' ? v(screen) : v;
    console.log(`[ONBOARDING_FLOW] 🖥️  SCREEN TRANSITION: "${screen}" → "${val}" at ${new Date().toISOString()}`);
    setScreenRaw(v);
  };
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [navDirection, setNavDirection] = useState<'forward' | 'backward'>('forward');
  const [userName, setUserName] = useState('');
  const [result, setResult] = useState<ReturnType<typeof scoreQuiz> | null>(null);

  // ── Boot Splash complete ──────────────────────────────────

  const handleBootComplete = useCallback((route: 'main' | 'feature-splash' | 'quiz') => {
    console.log(`[ONBOARDING_FLOW] 🚦 BootSplash DECISION → "${route}" at ${new Date().toISOString()}`);
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
    console.log(`[ONBOARDING_FLOW] 🚦 FeatureSplash DECISION → "${route}" at ${new Date().toISOString()}`);
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
    setNavDirection('forward');

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

  // ── Back navigation ────────────────────────────────────────

  const handleBack = useCallback(() => {
    setNavDirection('backward');
    setAnswers((prev) => prev.slice(0, -1));
    setQuestionIndex((prev) => prev - 1);
  }, []);

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
    console.log(`[ONBOARDING_FLOW] 🚀 handleEnter CALLED at ${new Date().toISOString()} — style="${style}" risk="${riskTolerance}" userName="${userName}"`);
    
    try {
      localStorage.setItem('vantage:investorStyle', style);
      localStorage.setItem('vantage:riskTolerance', riskTolerance);
      localStorage.setItem('vantage:onboarded', 'true');
      if (userName) {
        localStorage.setItem('vantage_user_name', userName);
      }
      console.log(`[ONBOARDING_FLOW] 💾 localStorage WRITTEN`);
    } catch (err) {
      console.error(`[ONBOARDING_FLOW] ❌ localStorage write FAILED:`, err);
    }

    try {
      const anonymousId = getOrCreateAnonymousId();
      console.log(`[ONBOARDING_FLOW] 🔄 Syncing to Supabase with anonymousId="${anonymousId}"`);
      const syncStart = Date.now();
      const res = await fetch('/api/onboarding/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anonymousId, investorStyle: style, riskTolerance, firstName: userName || undefined }),
      });
      const dur = Date.now() - syncStart;
      console.log(`[ONBOARDING_FLOW] 🔄 Sync response: ${res.status} ${res.statusText} (${dur}ms)`);
      if (!res.ok) {
        const text = await res.text();
        console.error(`[ONBOARDING_FLOW] ❌ Sync FAILED: ${res.status} — ${text}`);
      }
    } catch (err) {
      console.error(`[ONBOARDING_FLOW] ❌ Sync EXCEPTION:`, err);
    }

    markQuizComplete();
    console.log(`[ONBOARDING_FLOW] ✅ markQuizComplete() done, localStorage key="vantage_quiz_complete"=${localStorage.getItem('vantage_quiz_complete')}`);
    
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('vantage-navigate', { detail: { tab: 'portfolio' } }));
    }
    console.log(`[ONBOARDING_FLOW] 🚦 Pushing router to /`);
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
    console.log(`[ONBOARDING_FLOW] 🎬 RENDERING BootSplash`);
    return <BootSplash onComplete={handleBootComplete} />;
  }

  // ── Feature Splash ─────────────────────────────────────────

  if (screen === 'feature') {
    console.log(`[ONBOARDING_FLOW] 🎬 RENDERING FeatureSplash`);
    return <FeatureSplash onComplete={handleFeatureComplete} />;
  }

  // ── Arrival screen ─────────────────────────────────────────

  if (screen === 'arrival') {
    console.log(`[ONBOARDING_FLOW] 🎬 RENDERING ArrivalScreen`);
    return <ArrivalScreen onFindStyle={handleFindStyle} />;
  }

  // ── Quiz screens ───────────────────────────────────────────

  if (screen === 'quiz' && questionIndex < QUIZ_QUESTIONS.length) {
    console.log(`[ONBOARDING_FLOW] 🎬 RENDERING QuizQuestion Q${questionIndex + 1}/${QUIZ_QUESTIONS.length}`);
    return (
      <QuizQuestion
        key={QUIZ_QUESTIONS[questionIndex].id}
        question={QUIZ_QUESTIONS[questionIndex]}
        questionNumber={questionIndex + 1}
        totalQuestions={QUIZ_QUESTIONS.length}
        onAnswer={handleAnswer}
        onBack={questionIndex > 0 ? handleBack : undefined}
        direction={navDirection}
      />
    );
  }

  // ── Name capture screen ────────────────────────────────────

  if (screen === 'name') {
    console.log(`[ONBOARDING_FLOW] 🎬 RENDERING NameCapture`);
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
    console.log(`[ONBOARDING_FLOW] 🎬 RENDERING ResultScreen — style="${result.style}" risk="${result.riskTolerance}" userName="${userName}"`);
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

  {const r = screen === 'result' ? (result ? 'has result' : 'NO RESULT') : 'not result'; console.warn(`[ONBOARDING_FLOW] ⚠️  FALLTHROUGH to null — screen="${screen}" result=${r}`);}
  return null;
}
