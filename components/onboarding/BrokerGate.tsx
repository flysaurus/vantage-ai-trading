'use client';
// ─── BrokerGate ────────────────────────────────────────────────
// Shown every login until the user connects a broker.
// Allows selecting a broker and entering credentials, or skipping
// to use the dashboard with demo data.
// Skipping here only dismisses for this session — the gate will
// appear again on next login.

import React, { useState } from 'react';
import { X } from 'lucide-react';
import { apiPost } from '@/lib/api-client';
import { useAuth } from '@/components/providers/AuthProvider';
import { BrokerSelection } from './BrokerSelection';
import { BrokerCredentials } from './BrokerCredentials';
import type { BrokerId } from '@/types/broker';

interface Props {
  onDismiss: () => void;
}

export function BrokerGate({ onDismiss }: Props) {
  const [step, setStep] = useState<'select' | 'credentials'>('select');
  const [selectedBrokerId, setSelectedBrokerId] = useState<BrokerId | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelectBroker = (brokerId: BrokerId) => {
    setSelectedBrokerId(brokerId);
    setError(null);
    setStep('credentials');
  };

  const handleConnect = async (credentials: {
    apiKey: string;
    secretKey: string;
    environment: string;
  }) => {
    if (!selectedBrokerId) return;

    setConnecting(true);
    setError(null);

    try {
      const res = await apiPost('/api/broker/connect', {
        brokerId: selectedBrokerId,
        apiKey: credentials.apiKey,
        secretKey: credentials.secretKey,
        environment: credentials.environment,
      });

      const data = await res.json();

      if (!res.ok || !data.connected) {
        throw new Error(data.error || 'Connection failed. Please check your credentials.');
      }

      if (typeof window !== 'undefined') {
        localStorage.setItem('vantage:brokerConnected', 'true');
        localStorage.setItem('vantage:brokerId', selectedBrokerId);
        localStorage.removeItem('vantage:brokerSkipped');
      }

      // Full page reload so BrokerProvider detects the new connection
      window.location.href = '/';
    } catch (err: any) {
      setError(err?.message || 'Failed to connect. Please try again.');
      setConnecting(false);
    }
  };

  const handleSkip = () => {
    // Just dismiss — gate will appear again next login
    onDismiss();
  };

  const handleBackToBrokers = () => {
    setSelectedBrokerId(null);
    setError(null);
    setStep('select');
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9998,
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
          position: 'relative',
        }}
      >
        {/* Close / Skip button (top-right) */}
        {step === 'select' && (
          <button
            onClick={handleSkip}
            style={{
              position: 'absolute',
              top: 12,
              right: 12,
              background: 'none',
              border: 'none',
              color: '#e2e8f0',
              cursor: 'pointer',
              padding: 4,
              borderRadius: 4,
              display: 'flex',
            }}
            aria-label="Skip"
          >
            <X size={18} />
          </button>
        )}

        {step === 'select' ? (
          <BrokerSelection onSelect={handleSelectBroker} onSkip={handleSkip} />
        ) : step === 'credentials' && selectedBrokerId ? (
          <BrokerCredentials
            brokerId={selectedBrokerId}
            onConnect={handleConnect}
            onBack={handleBackToBrokers}
            connecting={connecting}
            error={error || undefined}
          />
        ) : null}
      </div>
    </div>
  );
}
