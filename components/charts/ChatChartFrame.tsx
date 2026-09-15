'use client';

// ─── ChatChartFrame — shared card around a chat chart ────────────
// title / optional subtitle / renderer / optional footnote. Uses only existing
// --v-* tokens (both themes read). No backdrop-blur anywhere.

import type { ReactNode } from 'react';

export default function ChatChartFrame({
  type,
  chartKey,
  title,
  subtitle,
  footnote,
  children,
}: {
  type: string;
  chartKey: string;
  title: string;
  subtitle?: string;
  footnote?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-testid="chat-chart"
      data-chart-type={type}
      data-chart-key={chartKey}
      style={{
        marginTop: 10,
        border: '1px solid var(--v-card-border)',
        background: 'var(--v-card)',
        borderRadius: 12,
        padding: '12px 14px',
        boxShadow: 'var(--v-shadow-card)',
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--v-text-primary)', letterSpacing: 0.2 }}>
        {title}
      </div>
      {subtitle && (
        <div style={{ fontSize: 11, color: 'var(--v-text-secondary)', marginTop: 2 }}>{subtitle}</div>
      )}
      <div style={{ marginTop: 8 }}>{children}</div>
      {footnote && (
        <div
          style={{
            fontSize: 10.5,
            lineHeight: 1.35,
            color: 'var(--v-text-faint)',
            marginTop: 8,
            borderTop: '1px solid var(--v-rule)',
            paddingTop: 6,
          }}
        >
          {footnote}
        </div>
      )}
    </div>
  );
}
