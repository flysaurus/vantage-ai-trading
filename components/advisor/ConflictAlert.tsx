'use client';

import React from 'react';
import type { ConflictAnalysis } from '@/lib/advisor/conflict-detection';

// ─── Props ────────────────────────────────────────────────────

interface Props {
  analysis: ConflictAnalysis;
  onClose?: () => void;
  onDismiss: () => void;
}

// ─── Severity config ──────────────────────────────────────────

const CONFIG: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  low:    { bg: 'rgba(234,179,8,0.08)',  border: '#a16207', text: '#fde047', icon: '⚠️' },
  medium: { bg: 'rgba(249,115,22,0.08)', border: '#c2410c', text: '#fdba74', icon: '⚠️' },
  high:   { bg: 'rgba(239,68,68,0.08)',  border: '#dc2626', text: '#fca5a5', icon: '🚨' },
};

// ─── Component ────────────────────────────────────────────────

export default function ConflictAlert({ analysis, onClose, onDismiss }: Props) {
  if (!analysis.hasConflict) return null;

  const c = CONFIG[analysis.severity];
  const severityLabel = analysis.severity === 'high' ? 'High' : analysis.severity === 'medium' ? 'Medium' : 'Low';
  const hasMetrics = Object.keys(analysis.metrics).length > 0;
  const hasSuggestions = analysis.suggestions.length > 0;

  return (
    <div
      style={{
        background: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: 16,
        padding: 20,
        color: c.text,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 14 }}>
        <span style={{ fontSize: 22 }}>{c.icon}</span>
        <div style={{ flex: 1 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 4px' }}>
            {severityLabel} Style Conflict
          </h3>
          <p style={{ fontSize: 12, margin: 0, opacity: 0.85 }}>{analysis.conflictMessage}</p>
        </div>
      </div>

      {/* Metrics table */}
      {hasMetrics && (
        <div
          style={{
            background: 'rgba(0,0,0,0.18)',
            borderRadius: 8,
            padding: 12,
            marginBottom: 14,
          }}
        >
          <p
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: 'uppercase',
              opacity: 0.7,
              margin: '0 0 8px',
              letterSpacing: 0.5,
            }}
          >
            Your Portfolio vs Ideal
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {Object.entries(analysis.metrics).map(([key, m]) => (
              <div
                key={key}
                style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, opacity: 0.8 }}
              >
                <span style={{ opacity: 0.7 }}>{key}</span>
                <span>
                  {m.current}{m.unit}{' '}
                  <span style={{ opacity: 0.45 }}>→ {m.ideal}{m.unit}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Suggestions */}
      {hasSuggestions && (
        <div style={{ marginBottom: 14 }}>
          <p
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: 'uppercase',
              opacity: 0.7,
              margin: '0 0 6px',
              letterSpacing: 0.5,
            }}
          >
            Suggestions
          </p>
          <ul style={{ margin: 0, padding: '0 0 0 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {analysis.suggestions.map((s, i) => (
              <li key={i} style={{ fontSize: 12, opacity: 0.8, display: 'flex', gap: 6 }}>
                <span style={{ opacity: 0.4 }}>→</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8 }}>
        {onClose && (
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: '8px 12px',
              fontSize: 12,
              fontWeight: 500,
              borderRadius: 8,
              background: 'rgba(255,255,255,0.06)',
              border: `1px solid ${c.border}`,
              color: c.text,
              cursor: 'pointer',
            }}
          >
            View Details
          </button>
        )}
        <button
          onClick={onDismiss}
          style={{
            flex: 1,
            padding: '8px 12px',
            fontSize: 12,
            fontWeight: 500,
            borderRadius: 8,
            background: 'rgba(255,255,255,0.06)',
            border: 'none',
            color: c.text,
            cursor: 'pointer',
            opacity: 0.85,
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
