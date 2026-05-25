'use client';

import React, { useState } from 'react';
import { OnboardingWelcome } from './OnboardingWelcome';
import { OnboardingStyleSelection } from './OnboardingStyleSelection';
import { OnboardingConfirmation } from './OnboardingConfirmation';
import { completeOnboarding } from '@/lib/supabase/user';
import { updateInvestorStyle } from '@/lib/supabase/user';
import type { InvestorStyle } from '@/types';

type OnboardingStep = 'welcome' | 'selection' | 'confirmation' | 'complete';

interface Props {
  userId: string;
  onComplete: (style: InvestorStyle) => void;
}

export function InvestorStyleOnboarding({ userId, onComplete }: Props) {
  const [step, setStep] = useState<OnboardingStep>('welcome');
  const [selectedStyle, setSelectedStyle] = useState<InvestorStyle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelectStyle = (style: InvestorStyle) => {
    setSelectedStyle(style);
    setStep('confirmation');
  };

  const handleBack = () => {
    setStep('selection');
  };

  const handleConfirm = async () => {
    if (!selectedStyle) {
      console.log('❌ [DEBUG onboarding] handleConfirm called but no style selected');
      return;
    }

    console.log('👉 [DEBUG onboarding] handleConfirm — style:', selectedStyle);
    console.log('👉 [DEBUG onboarding] handleConfirm — userId:', userId);

    setLoading(true);
    setError(null);

    try {
      console.log('👉 [DEBUG onboarding] calling updateInvestorStyle...');
      await updateInvestorStyle(userId, selectedStyle);
      console.log('✅ [DEBUG onboarding] updateInvestorStyle done');

      console.log('👉 [DEBUG onboarding] calling completeOnboarding...');
      await completeOnboarding(userId);
      console.log('✅ [DEBUG onboarding] completeOnboarding done');

      setStep('complete');

      // Auto-dismiss after brief celebration
      setTimeout(() => {
        console.log('👉 [DEBUG onboarding] auto-dismissing onboarding');
        onComplete(selectedStyle!);
      }, 1500);
    } catch (err: any) {
      console.log('❌ [DEBUG onboarding] error:', err?.message || err);
      setError(err?.message || 'Failed to save your style preference. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        style={{
          background: '#0f172a',
          border: '1px solid #334155',
          borderRadius: 14,
          maxWidth: 480,
          width: '100%',
          maxHeight: '90vh',
          overflow: 'hidden',
        }}
      >
        {step === 'welcome' && (
          <OnboardingWelcome
            onNext={() => setStep('selection')}
            onSkip={() => {
              // Skip saves default style + onboarded flag so it never re-triggers
              onComplete('buffett');
            }}
          />
        )}

        {step === 'selection' && (
          <OnboardingStyleSelection
            onSelectStyle={handleSelectStyle}
            error={error}
          />
        )}

        {step === 'confirmation' && selectedStyle && (
          <OnboardingConfirmation
            selectedStyle={selectedStyle}
            onConfirm={handleConfirm}
            onBack={handleBack}
            loading={loading}
            error={error}
          />
        )}

        {step === 'complete' && (
          <div style={{ padding: '48px 32px', textAlign: 'center' }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>✨</div>
            <h2 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 8px' }}>
              All Set!
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Your investor profile is ready.
              <br />
              Personalizing your dashboard...
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
