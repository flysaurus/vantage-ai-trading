'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

/**
 * ExpandableRow — the single disclosure/accordion pattern used across Vantage.
 *
 * Extracted from the "Wash Sale Rule" section on Tax Harvesting
 * (app/strategies/setup/tax-harvesting/page.tsx) so new expandable rows reuse
 * the same component instead of re-inventing the pattern:
 *
 *   [ header ............................. ⌄ ChevronDown ]
 *   ┌ panel (shown when expanded) ──────────────────────┐
 *   └───────────────────────────────────────────────────┘
 *
 * Works controlled (`expanded` + `onToggle`) or uncontrolled (internal state).
 */
export function ExpandableRow({
  header,
  children,
  tone = 'card',
  expanded,
  onToggle,
  testId,
  panelTestId,
  buttonStyle,
  panelStyle,
}: {
  /** Left-hand header content (single line, or a stacked block for multi-line rows). */
  header: React.ReactNode;
  /** Panel content, rendered below the button when expanded. */
  children: React.ReactNode;
  /** `card` = neutral card surface · `warn` = amber warning surface · `plain` = borderless. */
  tone?: 'card' | 'warn' | 'plain';
  /** Controlled open state. Omit for uncontrolled. */
  expanded?: boolean;
  onToggle?: () => void;
  testId?: string;
  panelTestId?: string;
  /** Escape hatch for one-off sizing without forking the pattern. */
  buttonStyle?: React.CSSProperties;
  panelStyle?: React.CSSProperties;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = expanded !== undefined;
  const open = isControlled ? expanded : internalOpen;

  const toneStyle: React.CSSProperties =
    tone === 'warn'
      ? { background: 'var(--v-warn-dim)', border: '1px solid var(--v-warn-dim)', color: 'var(--v-warn)' }
      : tone === 'plain'
        ? { background: 'transparent', border: 'none', color: 'var(--v-text-primary)' }
        : { background: 'var(--v-card)', border: '1px solid var(--v-card-border)', color: 'var(--v-text-primary)' };

  return (
    <>
      <button
        type="button"
        data-testid={testId}
        onClick={() => (isControlled ? onToggle?.() : setInternalOpen((v) => !v))}
        aria-expanded={open}
        style={{
          width: '100%',
          padding: '10px 14px',
          borderRadius: 8,
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'inherit',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          textAlign: 'left',
          ...toneStyle,
          ...buttonStyle,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>{header}</span>
        {open ? <ChevronUp size={14} style={{ flexShrink: 0 }} /> : <ChevronDown size={14} style={{ flexShrink: 0 }} />}
      </button>
      {open && (
        <div
          data-testid={panelTestId}
          style={{
            padding: '12px 14px',
            marginTop: 8,
            background: 'var(--v-card)',
            border: '1px solid var(--v-card-border)',
            borderRadius: 8,
            fontSize: 11,
            color: 'var(--v-text-muted)',
            lineHeight: 1.6,
            ...panelStyle,
          }}
        >
          {children}
        </div>
      )}
    </>
  );
}

export default ExpandableRow;
