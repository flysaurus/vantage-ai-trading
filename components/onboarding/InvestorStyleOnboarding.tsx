'use client';

import React, { useState } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { OnboardingStyleSelection } from './OnboardingStyleSelection';
import { BrokerSelection } from './BrokerSelection';
import { BrokerCredentials } from './BrokerCredentials';
import { updateInvestorStyle } from '@/lib/supabase-auth';
import type { InvestorStyle } from '@/types';
import type { BrokerId } from '@/types/broker';

type OnboardingStep = 'style' | 'broker' | 'credentials';

export function InvestorStyleOnboarding() {
  console.log('[InvestorStyleOnboarding] 🦊 RENDERING');
  const { user } = useAuth();
  const [step, setStep] = useState<OnboardingStep>('style');
  const [selectedStyle, setSelectedStyle] = useState<InvestorStyle | null>(null);
  const [selectedBrokerId, setSelectedBrokerId] = useState<BrokerId | null>(null);
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
      await updateInvestorStyle(user.id, style, true);

      if (typeof window !== 'undefined') {
        localStorage.setItem('vantage:onboarded', 'true');
        localStorage.setItem('vantage:investorStyle', style);
      }

      setSelectedStyle(style);
      setLoading(false);
      // Advance to broker selection
      setStep('broker');
    } catch (err: any) {
      setError(err?.message || 'Failed to save. Please try again.');
      setLoading(false);
    }
  };

  const handleBrokerSelect = (brokerId: BrokerId) => {
    setSelectedBrokerId(brokerId);
    setError(null);
    setStep('credentials');
  };

  const handleBrokerConnect = async (credentials: {
    apiKey: string;
    secretKey: string;
    environment: string;
  }) => {
    if (!selectedBrokerId || !user) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/broker/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brokerId: selectedBrokerId,
          apiKey: credentials.apiKey,
          secretKey: credentials.secretKey,
          environment: credentials.environment,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.connected) {
        throw new Error(data.error || 'Connection failed. Please check your credentials.');
      }

      if (typeof window !== 'undefined') {
        localStorage.setItem('vantage:brokerConnected', 'true');
        localStorage.setItem('vantage:brokerId', selectedBrokerId);
      }

      setComplete(true);

      setTimeout(() => {
        // Force full page reload so BrokerProvider re-detects connection
        window.location.href = '/';
      }, 1500);
    } catch (err: any) {
      setError(err?.message || 'Failed to connect. Please try again.');
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

  const handleBackToBrokers = () => {
    setSelectedBrokerId(null);
    setError(null);
    setStep('broker');
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
          <BrokerSelection onSelect={handleBrokerSelect} onSkip={handleBrokerSkip} />
        ) : step === 'credentials' && selectedBrokerId ? (
          <BrokerCredentials
            brokerId={selectedBrokerId}
            onConnect={handleBrokerConnect}
            onBack={handleBackToBrokers}
            connecting={loading}
            error={error || undefined}
          />
        ) : null}
      </div>
    </div>
  );
}
