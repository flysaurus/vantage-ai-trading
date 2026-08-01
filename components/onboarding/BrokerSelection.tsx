'use client';

import React, { useState } from 'react';
import type { BrokerId } from '@/types/broker';

interface BrokerSelectionProps {
  onSelect: (brokerId: BrokerId) => void;
  onSkip: () => void;
}

// Only brokers available through our OAuth flow (SnapTrade).
// All future broker connections use SnapTrade — no raw API keys.
const BROKER_CARDS: Array<{
  id: BrokerId | 'snaptrade';
  emoji: string;
  name: string;
  description: string;
  subtext: string;
  active: boolean;
}> = [
  {
    id: 'snaptrade',
    emoji: '🔗',
    name: 'Connect Broker',
    description: 'Alpaca, Robinhood, Schwab, Fidelity, E*TRADE, and more',
    subtext: 'Secure OAuth — credentials never touch our servers',
    active: true,
  },
];

export function BrokerSelection({ onSelect, onSkip }: BrokerSelectionProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      // Redirect to broker connections page which handles SnapTrade OAuth
      const res = await fetch('/api/connections/snaptrade/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broker_id: 'alpaca' }),
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to start connection');
      const data = await res.json();
      if (data.redirectUri) {
        window.location.href = data.redirectUri;
      }
    } catch (err) {
      console.error('[BrokerSelection] Connection failed:', err);
      setConnecting(false);
    }
  };

  return (
    <div style={{ padding: 28, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px' }}>
          Unlock your real portfolio
        </h2>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>
          Connect your broker to get institutional-quality analysis of your actual holdings — free.
          You can always add or change this later.
        </p>
      </div>

      {/* Single OAuth card */}
      <div style={{ flex: 1, overflowY: 'auto', marginBottom: 16, minHeight: 0 }}>
        <button
          onClick={handleConnect}
          onMouseEnter={() => setHoveredId('snaptrade')}
          onMouseLeave={() => setHoveredId(null)}
          disabled={connecting}
          style={{
            width: '100%',
            textAlign: 'left',
            padding: 14,
            borderRadius: 10,
            border: hoveredId === 'snaptrade'
              ? '2px solid #06b6d4'
              : '2px solid #1e293b',
            background: hoveredId === 'snaptrade'
              ? 'rgba(6,182,212,0.08)'
              : '#0f172a',
            cursor: connecting ? 'wait' : 'pointer',
            transition: 'border-color 0.15s, background 0.15s',
            fontFamily: 'inherit',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <span style={{ fontSize: 32, lineHeight: 1, flexShrink: 0 }}>🔗</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                {connecting ? 'Redirecting to SnapTrade...' : 'Connect Broker'}
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '4px 0 0', lineHeight: 1.4 }}>
                Alpaca, Robinhood, Schwab, Fidelity, E*TRADE, and more
              </p>
              <p style={{ fontSize: 10, color: '#06b6d4', margin: '6px 0 0' }}>
                🔒 Secure OAuth — credentials never touch our servers
              </p>
            </div>
          </div>
        </button>
      </div>

      {/* Security trust strip */}
      <div
        style={{
          padding: '10px 14px',
          borderRadius: 8,
          background: 'rgba(6,182,212,0.05)',
          border: '1px solid rgba(6,182,212,0.15)',
          fontSize: 11,
          color: '#94a3b8',
          lineHeight: 1.4,
          marginBottom: 16,
          textAlign: 'center',
        }}
      >
        🔒 You log in directly through your broker. Vantage never sees your password or trading credentials.
        We use read-only access by default — you control what we can see.
      </div>

      {/* Skip link */}
      <div style={{ textAlign: 'center' }}>
        <button
          onClick={onSkip}
          style={{
            background: 'none',
            border: 'none',
            color: '#06b6d4',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            padding: 0,
            textDecoration: 'underline',
          }}
        >
          Skip for now — use demo portfolio
        </button>
      </div>
    </div>
  );
}
