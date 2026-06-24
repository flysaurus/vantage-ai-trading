'use client';

import React from 'react';

interface DividerProps {
  label?: string;
}

export default function Divider({ label = 'or' }: DividerProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        gap: 'var(--space-3)',
      }}
    >
      <div
        style={{
          flex: 1,
          height: '1px',
          background: 'var(--border-subtle)',
        }}
      />
      <span
        style={{
          flexShrink: 0,
          fontSize: '13px',
          color: 'var(--text-muted)',
          background: 'var(--bg-primary)',
          padding: '0 12px',
        }}
      >
        {label}
      </span>
      <div
        style={{
          flex: 1,
          height: '1px',
          background: 'var(--border-subtle)',
        }}
      />
    </div>
  );
}
