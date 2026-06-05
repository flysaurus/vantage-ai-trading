'use client';

import React, { useState } from 'react';
import type { BrokerId } from '@/types/broker';

interface BrokerSelectionProps {
  onSelect: (brokerId: BrokerId) => void;
  onSkip: () => void;
}

interface BrokerCard {
  id: BrokerId;
  emoji: string;
  name: string;
  description: string;
  authSummary: string;
  active: boolean;
  comingSoon?: boolean;
}

const BROKER_CARDS: BrokerCard[] = [
  {
    id: 'alpaca',
    emoji: '🦙',
    name: 'Alpaca',
    description: 'Paper & live trading. API keys.',
    authSummary: 'Connect with API keys',
    active: true,
  },
  {
    id: 'tastytrade',
    emoji: '🍝',
    name: 'Tastytrade',
    description: 'Options & futures. API keys.',
    authSummary: 'Connect with API keys',
    active: true,
  },
  {
    id: 'ibkr',
    emoji: '🏦',
    name: 'IBKR',
    description: 'Coming soon',
    authSummary: 'Connect with API keys',
    active: false,
    comingSoon: true,
  },
  {
    id: 'schwab',
    emoji: '📊',
    name: 'Schwab',
    description: 'Coming soon',
    authSummary: 'Connect with API keys',
    active: false,
    comingSoon: true,
  },
  {
    id: 'robinhood',
    emoji: '🌮',
    name: 'Robinhood',
    description: 'Coming soon',
    authSummary: 'Connect with API keys',
    active: false,
    comingSoon: true,
  },
];

export function BrokerSelection({ onSelect, onSkip }: BrokerSelectionProps) {
  const [hoveredId, setHoveredId] = useState<BrokerId | null>(null);

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

      {/* Broker Cards — scrollable */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16, minHeight: 0 }}>
        {BROKER_CARDS.map((card) => {
          const isHovered = hoveredId === card.id;

          return (
            <button
              key={card.id}
              onClick={() => card.active && onSelect(card.id)}
              onMouseEnter={() => card.active && setHoveredId(card.id)}
              onMouseLeave={() => setHoveredId(null)}
              disabled={!card.active}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: 14,
                borderRadius: 10,
                border: isHovered && card.active
                  ? '2px solid #06b6d4'
                  : '2px solid #1e293b',
                background: isHovered && card.active
                  ? 'rgba(6,182,212,0.08)'
                  : '#0f172a',
                cursor: card.active ? 'pointer' : 'default',
                transition: 'border-color 0.15s, background 0.15s',
                fontFamily: 'inherit',
                opacity: card.active ? 1 : 0.45,
                position: 'relative',
              }}
            >
              {/* Coming Soon badge */}
              {card.comingSoon && (
                <span
                  style={{
                    position: 'absolute',
                    top: 10,
                    right: 10,
                    fontSize: 9,
                    color: '#64748b',
                    background: 'rgba(100,116,139,0.15)',
                    padding: '2px 8px',
                    borderRadius: 6,
                    fontWeight: 600,
                  }}
                >
                  SOON
                </span>
              )}

              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                {/* Emoji */}
                <span style={{ fontSize: 32, lineHeight: 1, flexShrink: 0 }}>
                  {card.emoji}
                </span>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>
                    {card.name}
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '4px 0 0', lineHeight: 1.4 }}>
                    {card.description}
                  </p>
                  <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '6px 0 0' }}>
                    {card.authSummary}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
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
          Skip for now
        </button>
      </div>
    </div>
  );
}
