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
  onComplete: () => void;
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
    if (!selectedStyle) return;

    setLoading(true);
    setError(null);

    try {
      await updateInvestorStyle(userId, selectedStyle);
      await completeOnboarding(userId);
      setStep('complete');

      // Auto-dismiss after brief celebration
      setTimeout(() => {
        onComplete();
      }, 1500);
    } catch (err: any) {
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
          <OnboardingWelcome onNext={() => setStep('selection')} />
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
