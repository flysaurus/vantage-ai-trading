// ─── Vantage Theme: TypeScript Mirror ───────────────────────
// Type-safe mirror of CSS custom properties from tokens.css.
// Use for JS-driven animations, canvas rendering, and
// any calculation that needs color/spacing values.
//
// Usage: import { theme } from '@/lib/theme/tokens';

export const theme = {
  colors: {
    bgPrimary: '#0a0f1e',
    bgCard: '#1a2235',
    bgCardHover: '#1f2940',
    bgOverlay: 'rgba(10, 15, 30, 0.95)',
    bgSheet: '#131929',
    textPrimary: '#ffffff',
    textSecondary: '#94a3b8',
    textMuted: '#475569',
    accent: '#22d3ee',
    accent10: 'rgba(34, 211, 238, 0.1)',
    accent20: 'rgba(34, 211, 238, 0.2)',
    gain: '#10b981',
    loss: '#ef4444',
    warning: '#f59e0b',
    warning10: 'rgba(245, 158, 11, 0.1)',
    neutral: '#64748b',
    streak: '#f97316',
    score: '#22d3ee',
    milestone: '#a855f7',
    borderSubtle: 'rgba(255, 255, 255, 0.06)',
    borderCard: 'rgba(255, 255, 255, 0.08)',
    borderAccent: 'rgba(34, 211, 238, 0.3)',
  },

  levels: {
    Apprentice: '#64748b',
    Trader: '#22d3ee',
    Investor: '#a855f7',
    Master: '#f59e0b',
    Legend: '#ef4444',
  },

  spacing: {
    1: '4px',
    2: '8px',
    3: '12px',
    4: '16px',
    5: '20px',
    6: '24px',
  },

  radius: {
    sm: '8px',
    md: '12px',
    lg: '16px',
    full: '9999px',
  },

  transition: {
    fast: '150ms ease',
    base: '250ms ease',
    slow: '400ms ease',
  },
} as const;

export type Level = keyof typeof theme.levels;
