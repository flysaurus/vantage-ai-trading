'use client';

import { useState, useCallback } from 'react';
import { apiPost } from '@/lib/api-client';
import { useAuth } from '@/components/providers/AuthProvider';
import { ALL_STYLES, getStyleContent } from '@/lib/content/investor-styles';

/**
 * Subtle investor style badge — educational/personalization content.
 * Shows emoji + short label + tag, tappable to open style picker.
 * NOT gamification — this is identity/preference content that stays.
 */
export function InvestorStyleBadge() {
  const { user, refreshUser } = useAuth();
  const [showPicker, setShowPicker] = useState(false);

  const styleId = (user?.investorStyle as string) || 'buffett';
  const styleData = getStyleContent(styleId);

  const selectStyle = useCallback(async (newStyle: string) => {
    // Clear greeting cache (localStorage + sessionStorage) so the next greeting
    // reflects the newly selected style instead of a stale cached one.
    const storages = [localStorage, sessionStorage];
    for (const store of storages) {
      try {
        Object.keys(store).forEach((key) => {
          if (key.startsWith('vantage_greeting')) store.removeItem(key);
        });
      } catch { /* cross-origin may throw */ }
    }

    if (user?.id) {
      try {
        const res = await apiPost('/api/db/users/update', { userId: user.id, investorStyle: newStyle });
        if (res.ok) {
          localStorage.setItem('vantage_investor_style', newStyle);
        }
      } catch {}
    }

    setShowPicker(false);

    // Update AuthContext user in place — refreshes the badge, the AI chat system
    // prompt (reads user.investorStyle), and every other style surface WITHOUT a
    // full page reload (which was remounting MainApp and re-running account-select).
    if (user?.id) {
      try { await refreshUser(); } catch {}
    }
  }, [user?.id, refreshUser]);

  return (
    <>
      {/* Inline badge */}
      <button
        onClick={() => setShowPicker(true)}
        className="investor-style-badge"
        aria-label="Change investor style"
        title={`${styleData.shortLabel} · ${styleData.tag}`}
      >
        <span style={{ fontSize: 14 }}>{styleData.emoji}</span>
        <span className="investor-style-name">{styleData.shortLabel}</span>
        <span className="investor-style-tag">{styleData.tag}</span>
      </button>

      {/* Style picker modal */}
      {showPicker && (
        <div
          onClick={() => setShowPicker(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 10001,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
          }}
        >
          <div style={{
            position: 'absolute', inset: 0,
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(8px)',
          }} />

          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'relative', width: '100%', maxWidth: 360,
              background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
              borderRadius: 16, padding: 24,
              display: 'flex', flexDirection: 'column', gap: 16,
              animation: 'vantageSlideUp 0.25s ease-out',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                Investor Style
              </span>
              <button
                onClick={() => setShowPicker(false)}
                style={{
                  background: 'none', border: 'none',
                  color: 'var(--text-primary)', fontSize: 18,
                  cursor: 'pointer', padding: 4, lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>

            <p style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.5 }}>
              Choose your investing style. Your AI advisor tailors its responses to match.
            </p>

            {ALL_STYLES.map((s) => {
              const isSelected = s.id === styleId;
              return (
                <button
                  key={s.id}
                  onClick={() => selectStyle(s.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 14px', borderRadius: 12,
                    border: isSelected
                      ? '1px solid var(--accent)'
                      : '1px solid var(--border-subtle)',
                    background: isSelected ? 'rgba(34,211,238,0.10)' : 'var(--bg-card-hover)',
                    cursor: 'pointer', transition: 'all 0.15s ease', width: '100%',
                  }}
                >
                  <span style={{ fontSize: 20 }}>{s.emoji}</span>
                  <div style={{ textAlign: 'left', flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                      {s.shortLabel}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-primary)' }}>
                      {s.tag}
                    </div>
                  </div>
                  {isSelected && (
                    <span style={{ color: 'var(--accent)', fontSize: 14 }}>✓</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
