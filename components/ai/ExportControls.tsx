'use client';

// ─── ExportControls ──────────────────────────────────────────
// Compact Download button for AI-generated structured exports (rebalance
// plans, portfolio builds, basket previews, DCA schedules). ONE reusable
// component used identically regardless of response type.
//
// The export is a plain .xlsx blob download (anchor + `download` attribute),
// so it behaves the same on every platform — Windows/macOS/Linux desktop
// browsers, mobile Safari/Chrome — with no dependency on the Web Share API.
// ─────────────────────────────────────────────────────────────

import { Download } from 'lucide-react';

interface ExportControlsProps {
  onDownload: () => void;
  /** Optional muted caption line under the button (e.g. "28 lines · Rebalance Plan"). */
  caption?: string | null;
}

const ICON_SIZE = 15;

export function ExportControls({ onDownload, caption }: ExportControlsProps) {
  const downloadStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    borderRadius: '999px',
    padding: '7px 14px',
    fontSize: '13px',
    fontWeight: 600,
    lineHeight: 1,
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
    background: 'rgba(34,211,238,0.14)',
    border: '1px solid rgba(34,211,238,0.45)',
    color: '#22d3ee',
  };

  return (
    <div style={{ marginTop: '12px' }}>
      <div style={{ display: 'flex', width: '100%' }}>
        <button type="button" onClick={onDownload} style={downloadStyle} aria-label="Download .xlsx">
          <Download size={ICON_SIZE} strokeWidth={2} aria-hidden />
          Download .xlsx
        </button>
      </div>
      {caption && (
        <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginTop: '6px' }}>{caption}</div>
      )}
    </div>
  );
}
