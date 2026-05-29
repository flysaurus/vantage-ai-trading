'use client';

import React, { useState } from 'react';
import type { BrokerId } from '@/types/broker';

interface BrokerCredentialsProps {
  brokerId: BrokerId;
  onConnect: (credentials: { apiKey: string; secretKey: string; environment: string }) => void;
  onBack: () => void;
  connecting: boolean;
  error?: string;
}

const BROKER_LABELS: Record<BrokerId, { name: string; emoji: string }> = {
  alpaca: { name: 'Alpaca', emoji: '🦙' },
  tastytrade: { name: 'Tastytrade', emoji: '🍝' },
  ibkr: { name: 'IBKR', emoji: '🏦' },
  schwab: { name: 'Schwab', emoji: '📊' },
  robinhood: { name: 'Robinhood', emoji: '🌮' },
};

function EyeIcon({ visible }: { visible: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {visible ? (
        <>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </>
      ) : (
        <>
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
          <path d="m14.12 14.12a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </>
      )}
    </svg>
  );
}

export function BrokerCredentials({
  brokerId,
  onConnect,
  onBack,
  connecting,
  error,
}: BrokerCredentialsProps) {
  const [apiKey, setApiKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [environment, setEnvironment] = useState<string>(
    brokerId === 'tastytrade' ? 'sandbox' : 'paper'
  );
  const [showApiKey, setShowApiKey] = useState(false);
  const [showSecretKey, setShowSecretKey] = useState(false);

  const broker = BROKER_LABELS[brokerId];
  const canSubmit = apiKey.trim().length > 0 && secretKey.trim().length > 0 && !connecting;

  const envOptions =
    brokerId === 'tastytrade'
      ? [
          { value: 'sandbox', label: 'Sandbox' },
          { value: 'live', label: 'Live' },
        ]
      : [
          { value: 'paper', label: 'Paper' },
          { value: 'live', label: 'Live' },
        ];

  return (
    <div style={{ padding: 28, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Back + Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <button
          onClick={onBack}
          disabled={connecting}
          style={{
            background: 'none',
            border: 'none',
            color: '#06b6d4',
            fontSize: 13,
            fontWeight: 600,
            cursor: connecting ? 'default' : 'pointer',
            padding: 0,
            flexShrink: 0,
          }}
        >
          ← Back
        </button>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
            {broker.emoji} Connect {broker.name}
          </h2>
        </div>
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4, marginTop: 0, marginBottom: 20 }}>
        Enter your {broker.name} API credentials. You can generate these in your{' '}
        {broker.name} dashboard under API settings.
      </p>

      {/* Form — scrollable */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, marginBottom: 16 }}>
        {/* API Key Field */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6, textTransform: 'uppercase' }}>
            {brokerId === 'alpaca' ? 'API Key ID' : 'API Key'}
          </label>
          <div style={{ position: 'relative' }}>
            <input
              type={showApiKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter your API key"
              disabled={connecting}
              autoComplete="off"
              spellCheck={false}
              style={{
                width: '100%',
                padding: '12px 40px 12px 14px',
                borderRadius: 8,
                border: '1px solid #334155',
                background: '#0f172a',
                color: '#e2e8f0',
                fontSize: 13,
                fontFamily: 'inherit',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            <button
              type="button"
              onClick={() => setShowApiKey(!showApiKey)}
              tabIndex={-1}
              style={{
                position: 'absolute',
                right: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 4,
                display: 'flex',
              }}
            >
              <EyeIcon visible={showApiKey} />
            </button>
          </div>
        </div>

        {/* Secret Key Field */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6, textTransform: 'uppercase' }}>
            Secret Key
          </label>
          <div style={{ position: 'relative' }}>
            <input
              type={showSecretKey ? 'text' : 'password'}
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              placeholder="Enter your secret key"
              disabled={connecting}
              autoComplete="off"
              spellCheck={false}
              style={{
                width: '100%',
                padding: '12px 40px 12px 14px',
                borderRadius: 8,
                border: '1px solid #334155',
                background: '#0f172a',
                color: '#e2e8f0',
                fontSize: 13,
                fontFamily: 'inherit',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            <button
              type="button"
              onClick={() => setShowSecretKey(!showSecretKey)}
              tabIndex={-1}
              style={{
                position: 'absolute',
                right: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 4,
                display: 'flex',
              }}
            >
              <EyeIcon visible={showSecretKey} />
            </button>
          </div>
        </div>

        {/* Environment Toggle */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 8, textTransform: 'uppercase' }}>
            Environment
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            {envOptions.map((opt) => (
              <label
                key={opt.value}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '10px 0',
                  borderRadius: 8,
                  border: environment === opt.value ? '2px solid #06b6d4' : '2px solid #1e293b',
                  background: environment === opt.value ? 'rgba(6,182,212,0.08)' : '#0f172a',
                  cursor: connecting ? 'default' : 'pointer',
                  transition: 'border-color 0.15s, background 0.15s',
                }}
              >
                <input
                  type="radio"
                  name="environment"
                  value={opt.value}
                  checked={environment === opt.value}
                  onChange={() => setEnvironment(opt.value)}
                  disabled={connecting}
                  style={{ display: 'none' }}
                />
                <div
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    border: environment === opt.value ? '4px solid #06b6d4' : '2px solid #475569',
                    background: environment === opt.value ? '#0f172a' : 'transparent',
                    transition: 'border 0.15s',
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 13, fontWeight: 600, color: environment === opt.value ? '#06b6d4' : '#94a3b8' }}>
                  {opt.value === 'paper' ? '🧪 ' : '📈 '}
                  {opt.label}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Security Info Box */}
        {!error && (
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 8,
              background: 'rgba(6,182,212,0.05)',
              border: '1px solid rgba(6,182,212,0.15)',
              fontSize: 11,
              color: '#94a3b8',
              lineHeight: 1.5,
              marginTop: 4,
            }}
          >
            <div style={{ fontWeight: 600, color: '#06b6d4', marginBottom: 4 }}>
              🔒 How we protect your data
            </div>
            Your keys are encrypted before they leave your device and stored so that
            they can only be unlocked during your active session. They are never sent
            back to your browser and are permanently wiped if you disconnect.{' '}
            <a
              href="/security"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#06b6d4', textDecoration: 'underline' }}
            >
              Learn more →
            </a>
          </div>
        )}

        {/* Help link */}
        <div style={{ textAlign: 'center', marginTop: 4 }}>
          <a
            href="/help/broker-keys"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: '#94a3b8',
              fontSize: 12,
              textDecoration: 'underline',
            }}
          >
            Not sure where to find your keys? Here's a step-by-step guide →
          </a>
        </div>

        {/* Error display */}
        {error && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 8,
              background: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.3)',
              color: '#fca5a5',
              fontSize: 12,
              lineHeight: 1.4,
              marginTop: 4,
            }}
          >
            {error}
          </div>
        )}
      </div>

      {/* Connect Button */}
      <button
        onClick={() =>
          canSubmit &&
          onConnect({ apiKey: apiKey.trim(), secretKey: secretKey.trim(), environment })
        }
        disabled={!canSubmit}
        style={{
          width: '100%',
          padding: '14px 0',
          borderRadius: 10,
          border: 'none',
          background: canSubmit
            ? 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)'
            : '#1e293b',
          color: canSubmit ? '#0f172a' : '#475569',
          fontSize: 15,
          fontWeight: 700,
          cursor: canSubmit ? 'pointer' : 'default',
          transition: 'opacity 0.15s',
          opacity: connecting ? 0.7 : 1,
          fontFamily: 'inherit',
        }}
      >
        {connecting ? 'Connecting...' : `Connect ${broker.name}`}
      </button>
    </div>
  );
}
