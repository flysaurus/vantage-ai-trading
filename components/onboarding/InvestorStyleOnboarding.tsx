'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import { OnboardingWelcome } from './OnboardingWelcome';
import { OnboardingStyleSelection } from './OnboardingStyleSelection';
import { OnboardingConfirmation } from './OnboardingConfirmation';
import { updateInvestorStyle } from '@/lib/supabase-auth';
import type { InvestorStyle } from '@/types';

type OnboardingStep = 'welcome' | 'selection' | 'confirmation' | 'complete';

export function InvestorStyleOnboarding() {
  const router = useRouter();
  const { user } = useAuth();
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
    if (!user || !selectedStyle) return;

    setLoading(true);
    setError(null);

    try {
      // Save to users table with updateInvestorStyle (sets onboarded flag)
      await updateInvestorStyle(user.id, selectedStyle, true);

      // Persist to localStorage for fast reload checks
      if (typeof window !== 'undefined') {
        localStorage.setItem('vantage:onboarded', 'true');
        localStorage.setItem('vantage:investorStyle', selectedStyle);
      }

      setStep('complete');

      // Brief celebration then redirect to app
      setTimeout(() => {
        router.push('/');
      }, 1500);
    } catch (err: any) {
      setError(err?.message || 'Failed to save. Please try again.');
      setLoading(false);
    }
  };

  const handleSkip = async () => {
    if (!user) {
      router.push('/');
      return;
    }

    try {
      // Save default style + onboarded flag so it never re-triggers
      await updateInvestorStyle(user.id, 'buffett', true);

      if (typeof window !== 'undefined') {
        localStorage.setItem('vantage:onboarded', 'true');
        localStorage.setItem('vantage:investorStyle', 'buffett');
      }
    } catch {
      // Non-critical — still redirect
      if (typeof window !== 'undefined') {
        localStorage.setItem('vantage:onboarded', 'true');
      }
    }

    router.push('/');
  };

  if (!user) {
    return null;
  }

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
          maxHeight: '90dvh',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {step === 'welcome' && (
          <OnboardingWelcome
            onNext={() => setStep('selection')}
            onSkip={handleSkip}
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
