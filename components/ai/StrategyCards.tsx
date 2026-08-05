'use client';

import React, { useState } from 'react';
import type { PortfolioBlock } from '@/lib/portfolio-types';

interface StrategyCardsProps {
  blocks: PortfolioBlock[];
  screeningMeta?: {
    criteria: Record<string, any>;
    criteriaDescription: string;
    matchCount: number;
    provider: string;
  } | null;
  onBuildThis: (block: PortfolioBlock) => void;
}

export default function StrategyCards({ blocks, screeningMeta, onBuildThis }: StrategyCardsProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const handleBuild = (block: PortfolioBlock, index: number) => {
    setSelectedIndex(index);
    onBuildThis(block);
  };

  return (
    <div style={{
      display: 'flex',
      gap: '12px',
      marginTop: screeningMeta ? '4px' : '12px',
      paddingBottom: '6px',
      flexWrap: 'wrap',
    }}>
      {/* Screening criteria banner */}
      {screeningMeta && screeningMeta.matchCount > 0 && (
        <div style={{
          width: '100%',
          fontSize: '11px',
          color: '#64748b',
          marginBottom: '4px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}>
          <span style={{
            display: 'inline-block',
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: '#22d3ee',
            opacity: 0.8,
          }} />
          <span>
            Screened for: <strong style={{ color: '#94a3b8' }}>{screeningMeta.criteriaDescription}</strong>
            {` · ${screeningMeta.matchCount} matches via ${screeningMeta.provider}`}
          </span>
        </div>
      )}
      {blocks.map((block, i) => {
        const isSelected = selectedIndex === i;
        const label = block.strategy || `Strategy ${i + 1}`;

        return (
          <div
            key={i}
            style={{
              flex: '1 1 220px',
              minWidth: '200px',
              maxWidth: '360px',
              background: isSelected
                ? 'rgba(34, 211, 238, 0.08)'
                : 'rgba(15, 23, 42, 0.7)',
              border: isSelected
                ? '1px solid rgba(34, 211, 238, 0.4)'
                : '1px solid rgba(148, 163, 184, 0.12)',
              borderRadius: '12px',
              padding: '14px 16px',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              position: 'relative',
              transition: 'border-color 0.2s, background 0.2s',
            }}
          >
            {/* Strategy name */}
            <div style={{
              fontSize: '12px',
              fontWeight: 600,
              color: '#22d3ee',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              marginBottom: '10px',
            }}>
              {label}
            </div>

            {/* Positions */}
            <div style={{ marginBottom: '14px' }}>
              {block.positions.map((pos, pi) => (
                <div
                  key={pi}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '4px 0',
                    fontSize: '13px',
                  }}
                >
                  <span style={{
                    color: '#e2e8f0',
                    fontWeight: 500,
                    fontFamily: 'monospace',
                    fontSize: '12px',
                  }}>
                    {pos.symbol}
                  </span>
                  <span style={{
                    color: '#94a3b8',
                    fontSize: '12px',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    ${pos.amount.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>

            {/* Total bar */}
            <div style={{
              borderTop: '1px solid rgba(148, 163, 184, 0.1)',
              paddingTop: '8px',
              marginBottom: '12px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '12px',
            }}>
              <span style={{ color: '#64748b' }}>Total</span>
              <span style={{
                color: '#e2e8f0',
                fontWeight: 600,
                fontVariantNumeric: 'tabular-nums',
              }}>
                ${block.total.toLocaleString()}
              </span>
            </div>

            {/* Build This button */}
            {!isSelected ? (
              <button
                onClick={() => handleBuild(block, i)}
                style={{
                  width: '100%',
                  padding: '8px 0',
                  background: 'rgba(34, 211, 238, 0.12)',
                  border: '1px solid rgba(34, 211, 238, 0.25)',
                  borderRadius: '8px',
                  color: '#22d3ee',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(34, 211, 238, 0.2)';
                  e.currentTarget.style.borderColor = 'rgba(34, 211, 238, 0.5)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(34, 211, 238, 0.12)';
                  e.currentTarget.style.borderColor = 'rgba(34, 211, 238, 0.25)';
                }}
              >
                Build This
              </button>
            ) : (
              <div style={{
                width: '100%',
                padding: '8px 0',
                textAlign: 'center',
                color: '#22d3ee',
                fontSize: '12px',
                fontWeight: 600,
                opacity: 0.8,
              }}>
                ✓ Selected
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
