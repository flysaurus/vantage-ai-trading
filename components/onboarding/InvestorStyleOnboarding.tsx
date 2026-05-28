'use client';

import React, { useState } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { OnboardingStyleSelection } from './OnboardingStyleSelection';
import { updateInvestorStyle } from '@/lib/supabase-auth';
import type { InvestorStyle } from '@/types';

export function InvestorStyleOnboarding() {
  const { user } = useAuth();
  const [selectedStyle, setSelectedStyle] = useState<InvestorStyle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);

  const handleAccept = async () => {
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

      setComplete(true);

      setTimeout(() => {
        // Force full page reload so AuthProvider re-fetches user with onboarded=true
        window.location.href = '/';
      }, 1500);
    } catch (err: any) {
      setError(err?.message || 'Failed to save. Please try again.');
      setLoading(false);
    }
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
        ) : (
          <OnboardingStyleSelection
            selectedStyle={selectedStyle}
            onSelectStyle={setSelectedStyle}
            onAccept={handleAccept}
            loading={loading}
            error={error}
          />
        )}
      </div>
    </div>
  );
}
