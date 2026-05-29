'use client';
// ─── DemoBanner ─────────────────────────────────────────────────
// Shown at the top of every tab when no broker is connected.
// Clearly communicates that displayed data is simulated and
// encourages the user to connect their brokerage account.

import React from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { getDemoLabel } from '@/lib/demo-data';
import type { InvestorStyle } from '@/types';

export function DemoBanner() {
  const { user } = useAuth();
  const style: InvestorStyle = user?.investorStyle || 'buffett';
  const label = getDemoLabel(style);

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(139,92,246,0.08) 0%, rgba(6,182,212,0.08) 100%)',
      border: '1px solid rgba(139,92,246,0.25)',
      borderRadius: 10,
      padding: '10px 14px',
      marginBottom: 12,
      display: 'flex',
      alignItems: 'flex-start',
      gap: 10,
    }}>
      <div style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>🧪</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#c4b5fd', marginBottom: 3 }}>
          Demo Data · {label}
        </div>
        <div style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.5 }}>
          This is simulated data based on your investor style. Connect your broker to see your real portfolio and trades.
        </div>
      </div>
    </div>
  );
}
