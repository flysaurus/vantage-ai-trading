'use client';

import React, { useState, useEffect } from 'react';
import { updateInvestorStyle } from '@/lib/supabase/user';
import { INVESTOR_STYLES } from '@/components/onboarding/styles';
import type { InvestorStyle } from '@/types';
import type { StyleDef } from '@/components/onboarding/styles';

// ─── Props ────────────────────────────────────────────────────

interface Props {
  userId: string;
  currentStyle: InvestorStyle;
  onStyleChanged: (newStyle: InvestorStyle) => void;
  /** External trigger to open the modal (from SettingsTab menu click) */
  externalShowModal?: boolean;
  /** Callback when modal is dismissed */
  onModalClosed?: () => void;
}

// ─── Component ────────────────────────────────────────────────

export function InvestorStyleSelector({ userId, currentStyle, onStyleChanged, externalShowModal, onModalClosed }: Props) {
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Respond to external trigger from SettingsTab menu
  useEffect(() => {
    if (externalShowModal) setShowModal(true);
  }, [externalShowModal]);

  const handleClose = () => {
    setShowModal(false);
    onModalClosed?.();
  };

  const active = INVESTOR_STYLES.find((s) => s.id === currentStyle);

  return (
    <div style={{ marginTop: 12 }}>
      <div className="section">
        {/* Header */}
        <div style={{ padding: '14px 16px 12px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
            🎯 INVESTOR STYLE (Global Account Setting)
          </div>
          {active && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ fontSize: 24, lineHeight: 1 }}>{active.emoji}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{active.name}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{active.title}</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4, lineHeight: 1.5 }}>
                  {active.philosophy}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* What this affects */}
        <div style={{
          margin: '0 16px', padding: 10, borderRadius: 8,
          background: 'rgba(6,182,212,0.08)', borderLeft: '3px solid #06b6d4',
        }}>
          <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
            ✓ All portfolio analysis uses this approach
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
            ✓ Stock recommendations filtered through this style
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
            ✓ Rebalancing suggestions tailored to this philosophy
          </div>
        </div>

        {/* Change button */}
        <div style={{ padding: '12px 16px' }}>
          <button
            onClick={() => { setShowModal(true); setError(null); }}
            style={{
              width: '100%', padding: '10px 0', borderRadius: 8,
              background: '#06b6d4', color: '#0f172a', border: 'none',
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Change Investor Style →
          </button>
        </div>

        {error && (
          <div style={{
            margin: '0 16px 12px', padding: '10px 12px', borderRadius: 8,
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
            color: '#fca5a5', fontSize: 12,
          }}>
            {error}
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <StyleModal
          styles={INVESTOR_STYLES}
          current={currentStyle}
          loading={loading}
          onConfirm={async (style) => {
            if (style === currentStyle) { handleClose(); return; }
            setLoading(true);
            setError(null);
            try {
              await updateInvestorStyle(userId, style);
              onStyleChanged(style);
              handleClose();
            } catch (e: any) {
              setError(e?.message || 'Failed to update style');
            } finally {
              setLoading(false);
            }
          }}
          onClose={() => handleClose()}
        />
      )}

      <style jsx>{`
        .section {
          background: #1e293b;
          border: 1px solid #334155;
          border-radius: 12px;
          overflow: hidden;
        }
      `}</style>
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────

interface ModalProps {
  styles: StyleDef[];
  current: InvestorStyle;
  loading: boolean;
  onConfirm: (style: InvestorStyle) => void;
  onClose: () => void;
}

function StyleModal({ styles, current, loading, onConfirm, onClose }: ModalProps) {
  const [tempStyle, setTempStyle] = useState<InvestorStyle>(current);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.6)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div style={{
        background: '#0f172a', border: '1px solid #334155', borderRadius: 12,
        maxWidth: 500, width: '100%', maxHeight: '90vh',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid #1e293b',
          position: 'sticky', top: 0, background: '#0f172a',
          borderTopLeftRadius: 12, borderTopRightRadius: 12, zIndex: 1,
        }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Choose Your Investor Style</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            All recommendations will be filtered through this investment philosophy
          </div>
        </div>

        {/* Scrollable body */}
        <div style={{ padding: '12px 20px', overflowY: 'auto', maxHeight: '55vh' }}>
          {styles.map((s) => (
            <label
              key={s.id}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: 12, marginBottom: 6, borderRadius: 10,
                border: tempStyle === s.id
                  ? '2px solid #06b6d4'
                  : '2px solid #1e293b',
                background: tempStyle === s.id ? 'rgba(6,182,212,0.06)' : 'transparent',
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="style"
                value={s.id}
                checked={tempStyle === s.id}
                onChange={() => setTempStyle(s.id)}
                style={{ marginTop: 2, accentColor: '#06b6d4', cursor: 'pointer' }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 18 }}>{s.emoji}</span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
                  {s.title}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 3, lineHeight: 1.4 }}>
                  {s.description}
                </div>
              </div>
            </label>
          ))}
        </div>

        {/* Warning when switching */}
        {tempStyle !== current && (
          <div style={{
            margin: '0 20px 8px', padding: 10, borderRadius: 8,
            background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.3)',
            fontSize: 11, color: 'var(--accent-teal)',
          }}>
            ℹ️ <strong>You&apos;re switching styles.</strong> Your portfolio analysis and recommendations will update to reflect this new philosophy.
          </div>
        )}

        {/* Footer */}
        <div style={{
          padding: '14px 20px', borderTop: '1px solid #1e293b',
          display: 'flex', gap: 10,
          borderBottomLeftRadius: 12, borderBottomRightRadius: 12,
        }}>
          <button
            onClick={onClose}
            disabled={loading}
            style={{
              flex: 1, padding: '10px 0', borderRadius: 8,
              background: 'transparent', border: '1px solid #475569',
              color: 'var(--text-dim)', fontSize: 13, fontWeight: 600,
              cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.5 : 1,
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(tempStyle)}
            disabled={loading || tempStyle === current}
            style={{
              flex: 1, padding: '10px 0', borderRadius: 8,
              background: '#06b6d4', color: '#0f172a', border: 'none',
              fontSize: 13, fontWeight: 600,
              cursor: loading || tempStyle === current ? 'default' : 'pointer',
              opacity: loading || tempStyle === current ? 0.5 : 1,
            }}
          >
            {loading ? 'Updating...' : 'Confirm Change'}
          </button>
        </div>
      </div>
    </div>
  );
}
