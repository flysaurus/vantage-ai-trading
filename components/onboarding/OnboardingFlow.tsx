// ─── Onboarding Flow ────────────────────────────────────────
// Single wrapper that manages which onboarding screen shows
// and holds all quiz data in React state with sessionStorage
// persistence for cross-page resilience.
//
// Screens (4B-1 restructure):
//  boot → feature → arrival → quiz (5q) → style-reveal →
//  broker-choice → [demo: create-account]
//                → [broker: connection-options → create-account]

'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { BootSplash } from '@/components/onboarding/BootSplash';
import { FeatureSplash } from '@/components/onboarding/FeatureSplash';
import { ArrivalScreen } from '@/components/onboarding/ArrivalScreen';
import { QuizQuestion } from '@/components/onboarding/QuizQuestion';
import BrokerChoiceStep from '@/components/onboarding/BrokerChoiceStep';
import ConnectionOptionsStep from '@/components/onboarding/ConnectionOptionsStep';
import { StyleReveal } from '@/components/onboarding/StyleReveal';
import { QUIZ_QUESTIONS, scoreQuiz } from '@/lib/onboarding/quiz-logic';
import type { InvestorStyleKey, RiskTolerance } from '@/lib/onboarding/onboarding-state';

// ── Types ───────────────────────────────────────────────────

type OnboardingScreen =
  | 'boot'
  | 'feature'
  | 'arrival'
  | 'quiz'
  | 'reveal'
  | 'broker-choice'
  | 'connection-options'
  | 'create-account';

type QuizDirection = 'forward' | 'back';

type PendingChoice = 'demo' | 'broker' | null;
type PendingConnectionType = 'snaptrade' | 'alpaca' | 'tastytrade' | null;

interface OnboardingState {
  screen: OnboardingScreen;
  firstName: string;
  lastName: string;
  quizAnswers: string[];
  currentQuizQuestion: number;
  investorStyle: InvestorStyleKey | null;
  riskTolerance: RiskTolerance | null;
  direction: QuizDirection;
  pendingChoice: PendingChoice;
  pendingConnectionType: PendingConnectionType;
}

// ── sessionStorage key ─────────────────────────────────────

const STORAGE_KEY = 'vantage_onboarding';

// ── Helper: serialise state for sessionStorage ──────────────

function serialiseState(state: OnboardingState) {
  try {
    const quizAnswersRecord: Record<number, string> = {};
    state.quizAnswers.forEach((ans, i) => {
      quizAnswersRecord[i] = ans;
    });
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      currentStep: state.screen,
      quizAnswers: quizAnswersRecord,
      pendingChoice: state.pendingChoice,
      pendingConnectionType: state.pendingConnectionType,
      investorStyle: state.investorStyle,
      riskTolerance: state.riskTolerance,
      firstName: state.firstName,
      lastName: state.lastName,
      currentQuizQuestion: state.currentQuizQuestion,
    }));
  } catch {}
}

// ── Helper: deserialise state from sessionStorage ──────────

function deserialiseState(): Partial<OnboardingState> | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed.currentStep || parsed.currentStep === 'boot') return null;

    // Convert quizAnswers record back to array
    const quizAnswers: string[] = [];
    if (parsed.quizAnswers) {
      Object.keys(parsed.quizAnswers).sort().forEach((k) => {
        quizAnswers[Number(k)] = parsed.quizAnswers[k];
      });
    }

    return {
      screen: parsed.currentStep as OnboardingScreen,
      quizAnswers,
      currentQuizQuestion: parsed.currentQuizQuestion ?? quizAnswers.length,
      pendingChoice: parsed.pendingChoice ?? null,
      pendingConnectionType: parsed.pendingConnectionType ?? null,
      investorStyle: parsed.investorStyle ?? null,
      riskTolerance: parsed.riskTolerance ?? null,
      firstName: parsed.firstName ?? '',
      lastName: parsed.lastName ?? '',
    };
  } catch {
    return null;
  }
}

// ── Default state ──────────────────────────────────────────

function createDefaultState(initialScreen?: OnboardingScreen): OnboardingState {
  return {
    screen: initialScreen || 'boot',
    firstName: '',
    lastName: '',
    quizAnswers: [],
    currentQuizQuestion: 0,
    investorStyle: null,
    riskTolerance: null,
    direction: 'forward',
    pendingChoice: null,
    pendingConnectionType: null,
  };
}

// ── Component ──────────────────────────────────────────────

interface OnboardingFlowProps {
  initialScreen?: OnboardingScreen;
}

export default function OnboardingFlow({ initialScreen }: OnboardingFlowProps) {
  const router = useRouter();

  // Restore from sessionStorage on mount, or start fresh
  const [state, setState] = useState<OnboardingState>(() => {
    if (initialScreen) return createDefaultState(initialScreen);
    const restored = deserialiseState();
    if (restored) return { ...createDefaultState(), ...restored };
    return createDefaultState();
  });

  // Persist to sessionStorage on every state change
  useEffect(() => {
    if (state.screen !== 'boot') {
      serialiseState(state);
    }
  }, [state]);

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
  const handleBootComplete = useCallback(() => {
    goTo('feature');
  }, []);

  // feature → arrival
  const handleFeatureComplete = useCallback(() => {
    goTo('arrival');
  }, []);

  // arrival → quiz Q1
  const handleArrivalCTA = useCallback(() => {
    goTo('quiz', 'forward', {
      currentQuizQuestion: 0,
      quizAnswers: [],
    });
  }, []);

  // arrival → sign in
  const handleSignIn = useCallback(() => {
    router.push('/login');
  }, [router]);

  // quiz answer selected
  const handleQuizAnswer = useCallback((answer: string) => {
    setState((prev) => {
      const newAnswers = [
        ...prev.quizAnswers.slice(0, prev.currentQuizQuestion),
        answer,
        ...prev.quizAnswers.slice(prev.currentQuizQuestion + 1),
      ];

      if (prev.currentQuizQuestion < 4) {
        // Advance to next question
        return {
          ...prev,
          quizAnswers: newAnswers,
          currentQuizQuestion: prev.currentQuizQuestion + 1,
          direction: 'forward' as QuizDirection,
        };
      }

      // Q5 complete — score quiz → style-reveal
      const { style, risk } = scoreQuiz(newAnswers);
      return {
        ...prev,
        quizAnswers: newAnswers,
        investorStyle: style,
        riskTolerance: risk,
        screen: 'reveal' as OnboardingScreen,
        direction: 'forward' as QuizDirection,
      };
    });
  }, []);

  // quiz back button
  const handleQuizBack = useCallback(() => {
    setState((prev) => {
      if (prev.currentQuizQuestion === 0) {
        return { ...prev, screen: 'arrival' as OnboardingScreen, direction: 'back' as QuizDirection };
      }
      return {
        ...prev,
        currentQuizQuestion: prev.currentQuizQuestion - 1,
        direction: 'back' as QuizDirection,
      };
    });
  }, []);

  // reveal → broker-choice
  const handleRevealCTA = useCallback(() => {
    goTo('broker-choice');
  }, []);

  // reveal back → quiz Q5
  const handleRevealBack = useCallback(() => {
    goTo('quiz', 'back', {
      currentQuizQuestion: 4,
    });
  }, []);

  // broker-choice: user selects demo
  const handleDemoSelected = useCallback(() => {
    goTo('create-account', 'forward', {
      pendingChoice: 'demo',
      pendingConnectionType: null,
    });
  }, []);

  // broker-choice: user selects connect broker
  const handleBrokerSelected = useCallback(() => {
    goTo('connection-options', 'forward', {
      pendingChoice: 'broker',
    });
  }, []);

  // broker-choice back → style-reveal
  const handleBrokerChoiceBack = useCallback(() => {
    goTo('reveal', 'back');
  }, []);

  // connection-options: user selects a broker
  const handleConnectionTypeSelected = useCallback((connectionType: PendingConnectionType) => {
    goTo('create-account', 'forward', {
      pendingConnectionType: connectionType,
    });
  }, []);

  // connection-options back → broker-choice
  const handleConnectionOptionsBack = useCallback(() => {
    goTo('broker-choice', 'back');
  }, []);

  // connection-options → switch to demo (goes back to broker-choice)
  const handleSwitchToDemo = useCallback(() => {
    goTo('broker-choice', 'back');
  }, []);

  // create-account back — returns to previous step depending on path
  const handleCreateAccountBack = useCallback(() => {
    if (state.pendingChoice === 'broker') {
      goTo('connection-options', 'back');
    } else {
      goTo('broker-choice', 'back');
    }
  }, [state.pendingChoice]);

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
          onBack={handleQuizBack}
          onSignIn={handleSignIn}
        />
      );

    case 'reveal':
      if (!state.investorStyle || !state.riskTolerance) return null;
      return (
        <StyleReveal
          style={state.investorStyle}
          risk={state.riskTolerance}
          firstName=""
          lastName=""
          onBack={handleRevealBack}
          onCreateAccount={handleRevealCTA}
        />
      );

    case 'broker-choice':
      return (
        <BrokerChoiceStep
          onSelectDemo={handleDemoSelected}
          onSelectBroker={handleBrokerSelected}
          onBack={handleBrokerChoiceBack}
        />
      );

    case 'connection-options':
      return (
        <ConnectionOptionsStep
          onSelect={handleConnectionTypeSelected}
          onBack={handleConnectionOptionsBack}
          onSwitchToDemo={handleSwitchToDemo}
        />
      );

    case 'create-account':
      // Navigate to the dedicated /create-account page
      // The create-account page reads pendingChoice + investorStyle
      // from sessionStorage (set by serialiseState above)
      if (typeof window !== 'undefined') {
        router.push('/create-account');
      }
      return <BootSplash onComplete={handleBootComplete} />;

    default:
      return <BootSplash onComplete={handleBootComplete} />;
  }
}

