'use client';

// ─── ProgressIndicator — Live validation checklist during AI generation ───
// Replaces decorative "Researching markets" / "Building portfolio" labels
// with real backend pipeline stages. Each stage transitions:
//   pending (grey) → in_progress (pulsing cyan) → done (green ✓) / failed (red ✗)

import { useEffect, useState } from 'react';

export interface ChecklistItem {
  stage: string;
  label: string;
  status: 'pending' | 'in_progress' | 'done' | 'failed' | 'skipped';
  detail?: string;
}

const STAGE_CONFIG: Record<string, { label: string; icon: string }> = {
  tickers_resolved:      { label: 'Resolving tickers',       icon: '🏷️' },
  recommendations_built: { label: 'Building recommendations', icon: '📊' },
  marker_format:         { label: 'Validating marker format', icon: '🔍' },
  coherence_check:       { label: 'Checking response coherence', icon: '🧩' },
  symbol_verification:   { label: 'Verifying symbols',       icon: '✅' },
  budget_reconciliation: { label: 'Reconciling budget',      icon: '💰' },
};

const STAGE_ORDER = [
  'tickers_resolved',
  'recommendations_built',
  'marker_format',
  'coherence_check',
  'symbol_verification',
  'budget_reconciliation',
];

interface ProgressIndicatorProps {
  items: ChecklistItem[];
}

function StatusIcon({ status }: { status: ChecklistItem['status'] }) {
  if (status === 'done') {
    return <span style={{ color: 'rgba(16,185,129,0.9)', fontSize: '13px', width: '18px', textAlign: 'center', flexShrink: 0 }}>✓</span>;
  }
  if (status === 'failed') {
    return <span style={{ color: 'rgba(239,68,68,0.9)', fontSize: '13px', fontWeight: 700, width: '18px', textAlign: 'center', flexShrink: 0 }}>✗</span>;
  }
  if (status === 'in_progress') {
    return (
      <span style={{
        display: 'inline-block',
        width: '8px', height: '8px',
        borderRadius: '50%',
        background: '#22d3ee',
        boxShadow: '0 0 8px rgba(34,211,238,0.5)',
        animation: 'checklistPulse 1.2s ease-in-out infinite',
        margin: '0 5px',
        flexShrink: 0,
      }} />
    );
  }
  if (status === 'skipped') {
    return <span style={{ color: 'rgba(255,255,255,0.15)', fontSize: '13px', width: '18px', textAlign: 'center', flexShrink: 0 }}>—</span>;
  }
  // pending
  return (
    <span style={{
      display: 'inline-block',
      width: '7px', height: '7px',
      borderRadius: '50%',
      background: 'rgba(255,255,255,0.12)',
      margin: '0 5.5px',
      flexShrink: 0,
    }} />
  );
}

export function ProgressIndicator({ items }: ProgressIndicatorProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 100);
    return () => clearTimeout(t);
  }, []);

  if (!visible || items.length === 0) return null;

  // Build display list from STAGE_ORDER, using item state if available
  const itemMap = new Map(items.map(i => [i.stage, i]));
  const stages = STAGE_ORDER.map(stage => {
    const item = itemMap.get(stage);
    const config = STAGE_CONFIG[stage] || { label: stage, icon: '•' };
    return {
      stage,
      label: config.label,
      icon: config.icon,
      status: item?.status || 'pending',
      detail: item?.detail,
    };
  });

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      padding: '10px 0',
    }}>
      {stages.map((s) => {
        const isActive = s.status === 'in_progress';
        const isDone = s.status === 'done';
        const isFailed = s.status === 'failed';
        const isSkipped = s.status === 'skipped';

        return (
          <div key={s.stage} style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            opacity: s.status === 'pending' ? 0.3 : 1,
            transition: 'opacity 0.3s ease',
          }}>
            <StatusIcon status={s.status} />

            <span style={{
              fontSize: '12px',
              fontFamily: 'var(--font-sans)',
              fontWeight: isActive ? 600 : 400,
              color: isFailed
                ? 'rgba(239,68,68,0.85)'
                : isDone
                  ? 'rgba(16,185,129,0.75)'
                  : isActive
                    ? 'rgba(255,255,255,0.85)'
                    : isSkipped
                      ? 'rgba(255,255,255,0.2)'
                      : 'rgba(255,255,255,0.3)',
              transition: 'color 0.3s ease',
              whiteSpace: 'nowrap',
            }}>
              {s.icon} {s.label}
            </span>

            {s.detail && (
              <span style={{
                fontSize: '10px',
                color: isFailed
                  ? 'rgba(239,68,68,0.5)'
                  : isDone
                    ? 'rgba(16,185,129,0.4)'
                    : 'rgba(255,255,255,0.25)',
                fontFamily: 'var(--font-mono, monospace)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '180px',
                marginLeft: 'auto',
                transition: 'color 0.3s ease',
              }}>
                {s.detail}
              </span>
            )}
          </div>
        );
      })}

      <style>{`
        @keyframes checklistPulse {
          0%, 100% { opacity: 0.4; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1.1); }
        }
      `}</style>
    </div>
  );
}
