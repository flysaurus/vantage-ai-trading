// ─── Theme Utilities ────────────────────────────────────────
// Convenience helpers for level colors and gradients.
//
// Usage:
//   import { getLevelColor, getLevelGradient } from '@/lib/theme/utils';
//   const color = getLevelColor('Master'); // '#f59e0b'

import { theme } from './tokens';
import type { Level } from './tokens';

/**
 * Returns the CSS color for a given investor level.
 * Falls back to the neutral color for unknown levels.
 */
export function getLevelColor(level: string): string {
  const colors: Record<string, string> = theme.levels;
  return colors[level as Level] || theme.colors.neutral;
}

/**
 * Returns a CSS linear-gradient string for a level badge.
 * Each level gets a subtle gradient matching its color.
 *
 * Level-specific gradients:
 * - Apprentice: neutral gray
 * - Trader: cyan → teal
 * - Investor: purple → violet
 * - Master: amber → orange
 * - Legend: red → pink
 */
export function getLevelGradient(level: string): string {
  const gradients: Record<string, string> = {
    Apprentice: `linear-gradient(135deg, #64748b, #475569)`,
    Trader: `linear-gradient(135deg, #22d3ee, #06b6d4)`,
    Investor: `linear-gradient(135deg, #a855f7, #7c3aed)`,
    Master: `linear-gradient(135deg, #f59e0b, #ea580c)`,
    Legend: `linear-gradient(135deg, #ef4444, #dc2626)`,
  };

  return gradients[level] || gradients.Apprentice;
}
