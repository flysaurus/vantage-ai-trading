// ═══════════════════════════════════════════════════════════════
// components/disclosure/FIFOExplainer.tsx
// ═══════════════════════════════════════════════════════════════
// One-time FIFO explainer shown the first time a user encounters
// a multi-lot position sell. Dismissible, never repeats.
// Distinct from the persistent FIFO notice on every sell ticket.
// ═══════════════════════════════════════════════════════════════

'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';

export interface FIFOExplainerProps {
  isOpen: boolean;
  onDismiss: () => void;
  /** The ticker with 2+ lots that triggered this */
  ticker: string;
  /** Dates of the two oldest lots, e.g. "Aug 21" and "Sep 3" */
  oldestLotDate: string;
  /** Second oldest lot date */
  secondLotDate: string;
}

const STORAGE_KEY = 'vantage_fifo_explainer_dismissed';

export function hasSeenFIFOExplainer(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function markFIFOExplainerSeen(): void {
  try {
    localStorage.setItem(STORAGE_KEY, 'true');
  } catch {}
}

export default function FIFOExplainer({
  isOpen,
  onDismiss,
  ticker,
  oldestLotDate,
  secondLotDate,
}: FIFOExplainerProps) {
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [isOpen]);

  const handleDismiss = () => {
    markFIFOExplainerSeen();
    onDismiss();
  };

  if (!isOpen) return null;

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '20px',
    }}>
      <div style={{
        background: '#0a0f1e',
        border: '1px solid rgba(56,214,232,0.25)',
        borderRadius: '20px',
        maxWidth: '400px', width: '100%',
        padding: '24px',
        display: 'flex', flexDirection: 'column', gap: '16px',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '16px', fontWeight: 800, color: '#eef2f7' }}>
            💡 How Selling Works
          </span>
          <button onClick={handleDismiss} style={{
            background: 'none', border: 'none', color: '#8794a8',
            fontSize: '20px', cursor: 'pointer', padding: '0 4px',
          }}>
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{
          display: 'flex', gap: '9px',
          padding: '12px 13px',
          background: 'rgba(56,214,232,0.08)',
          border: '1px solid rgba(56,214,232,0.25)',
          borderRadius: '12px',
          alignItems: 'flex-start',
        }}>
          <span style={{ fontSize: '14px', marginTop: '1px', flexShrink: 0 }}>💡</span>
          <div>
            <p style={{
              fontSize: '11.5px', color: '#eef2f7', lineHeight: '1.6',
              margin: 0,
            }}>
              You've bought <b style={{ color: '#22d3ee' }}>{ticker}</b> at least twice — on{' '}
              <b style={{ color: '#22d3ee' }}>{oldestLotDate}</b> and{' '}
              <b style={{ color: '#22d3ee' }}>{secondLotDate}</b>.
            </p>
            <p style={{
              fontSize: '11.5px', color: '#eef2f7', lineHeight: '1.6',
              margin: '10px 0 0',
            }}>
              When you sell, Vantage sells your <b style={{ color: '#f0b73f' }}>oldest shares first</b> (FIFO), same as most brokers by default. You'll always see exactly which lots are involved before confirming.
            </p>
          </div>
        </div>

        {/* Dismiss */}
        <button onClick={handleDismiss} style={{
          alignSelf: 'flex-end',
          background: 'none', border: 'none',
          color: '#22d3ee', fontSize: '12px', fontWeight: 700,
          cursor: 'pointer', padding: '4px 0',
        }}>
          Got it, don't show again →
        </button>
      </div>
    </div>,
    document.body
  );
}