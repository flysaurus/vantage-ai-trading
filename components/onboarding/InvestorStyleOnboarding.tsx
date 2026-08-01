'use client';

import React, { useState } from 'react';
import { apiPost } from '@/lib/api-client';
import { useAuth } from '@/components/providers/AuthProvider';
import { OnboardingStyleSelection } from './OnboardingStyleSelection';
import { BrokerSelection } from './BrokerSelection';
import type { InvestorStyle } from '@/types';

type OnboardingStep = 'style' | 'broker';

export function InvestorStyleOnboarding() {
  const { user } = useAuth();
  const [step, setStep] = useState<OnboardingStep>('style');
  const [selectedStyle, setSelectedStyle] = useState<InvestorStyle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);

  const handleStyleAccepted = async () => {
    if (!user) return;

    // If no style selected, default to Buffett
    const style = selectedStyle || 'buffett';

    setLoading(true);
    setError(null);

    try {
      const res = await apiPost('/api/db/users/update', {
        userId: user.id,
        investorStyle: style,
        investorStyleOnboarded: true,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({} as any));
        throw new Error(data?.error || 'Failed to save. Please try again.');
      }

      setSelectedStyle(style);
      setLoading(false);
      // Advance to broker connection step
      setStep('broker');
    } catch (err: any) {
      setError(err?.message || 'Failed to save. Please try again.');
      setLoading(false);
    }
  };

  const handleBrokerSkip = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('vantage:brokerSkipped', 'true');
    }
    // Reload to dashboard
    window.location.href = '/';
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
        overflowY: 'auto',
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
          margin: 'auto',
        }}
      >
        {complete ? (
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
        ) : step === 'style' ? (
          <OnboardingStyleSelection
            selectedStyle={selectedStyle}
            onSelectStyle={setSelectedStyle}
            onAccept={handleStyleAccepted}
            loading={loading}
            error={error}
          />
        ) : step === 'broker' ? (
          <BrokerSelection
            onSelect={() => {}} // handled internally by BrokerSelection (SnapTrade OAuth redirect)
            onSkip={handleBrokerSkip}
          />
        ) : null}
      </div>
    </div>
  );
}
