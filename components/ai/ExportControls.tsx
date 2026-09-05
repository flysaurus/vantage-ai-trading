'use client';

// ─── ExportControls ──────────────────────────────────────────
// Compact Download/Share pill buttons for AI-generated structured exports
// (rebalance plans, portfolio builds, basket previews, DCA schedules).
// ONE reusable component — identical two-pill layout regardless of response
// type, per Option B: equal-weight pills side by side, outline SVG icons,
// cyan primary (Download) + neutral secondary (Share).
// ─────────────────────────────────────────────────────────────

import { Download, Share2 } from 'lucide-react';

interface ExportControlsProps {
  onDownload: () => void;
  onShare: () => void;
  /** Hide Share when the platform has no Web Share API (desktop fallback). */
  canShare: boolean;
  /** Optional muted caption line under the buttons (e.g. "28 lines · Rebalance Plan"). */
  caption?: string | null;
}

const ICON_SIZE = 15;

export function ExportControls({ onDownload, onShare, canShare, caption }: ExportControlsProps) {
  const pill: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    borderRadius: '999px',
    padding: '7px 12px',
    fontSize: '13px',
    fontWeight: 600,
    lineHeight: 1,
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  };

  const downloadStyle: React.CSSProperties = {
    ...pill,
    background: 'rgba(34,211,238,0.14)',
    border: '1px solid rgba(34,211,238,0.45)',
    color: '#22d3ee',
  };

  const shareStyle: React.CSSProperties = {
    ...pill,
    background: 'rgba(148,163,184,0.10)',
    border: '1px solid rgba(148,163,184,0.28)',
    color: '#cbd5e1',
  };

  return (
    <div style={{ marginTop: '12px' }}>
      <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
        <button type="button" onClick={onDownload} style={downloadStyle} aria-label="Download .xlsx">
          <Download size={ICON_SIZE} strokeWidth={2} aria-hidden />
          Download .xlsx
        </button>
        {canShare && (
          <button type="button" onClick={onShare} style={shareStyle} aria-label="Share">
            <Share2 size={ICON_SIZE} strokeWidth={2} aria-hidden />
            Share
          </button>
        )}
      </div>
      {caption && (
        <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginTop: '6px' }}>{caption}</div>
      )}
    </div>
  );
}
