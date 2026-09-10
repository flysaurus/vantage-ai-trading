// ─── Theme toggle (Light / Dark / System) ──────────────────
// Part 1's theming control, wired to lib/theme/theme-provider.
// Changing it applies instantly — no reload.

'use client';

import React from 'react';
import { useTheme, type ThemeMode } from '@/lib/theme/theme-provider';

const OPTIONS: { id: ThemeMode; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'System' },
];

export function ThemeToggle() {
  const { mode, setMode } = useTheme();

  return (
    <div
      data-testid="theme-toggle"
      data-theme-mode={mode}
      style={{
        display: 'flex',
        gap: 2,
        padding: 3,
        background: '#1e293b',
        border: '1px solid #334155',
        borderRadius: 8,
        flexShrink: 0,
      }}
    >
      {OPTIONS.map((o) => {
        const active = mode === o.id;
        return (
          <button
            key={o.id}
            type="button"
            data-testid={`theme-option-${o.id}`}
            data-active={active ? 'true' : 'false'}
            onClick={() => setMode(o.id)}
            style={{
              background: active ? 'var(--v-accent, #22d3ee)' : 'transparent',
              color: active ? '#00272B' : '#94a3b8',
              border: 'none',
              borderRadius: 6,
              padding: '4px 10px',
              fontSize: 11,
              fontWeight: active ? 700 : 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export default ThemeToggle;
