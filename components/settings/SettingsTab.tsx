'use client';

import { useState } from 'react';

export function SettingsTab() {
  const [riskLevel, setRiskLevel] = useState<'conservative' | 'moderate' | 'aggressive'>('moderate');
  const [brokerConnected, setBrokerConnected] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);

  const sectionHeader = (label: string) => (
    <div
      style={{
        padding: '20px 16px 8px 16px',
        fontSize: '11px',
        fontWeight: '600',
        color: '#64748b',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
      }}
    >
      {label}
    </div>
  );

  const riskPill = (level: 'conservative' | 'moderate' | 'aggressive', label: string) => {
    const active = riskLevel === level;
    return (
      <button
        key={level}
        onClick={() => setRiskLevel(level)}
        style={{
          borderRadius: '6px',
          padding: '4px 8px',
          fontSize: '11px',
          fontWeight: '500',
          background: active ? 'rgba(34,211,238,0.2)' : 'transparent',
          color: active ? '#22d3ee' : '#64748b',
          border: active ? '1px solid rgba(34,211,238,0.4)' : '1px solid #334155',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* ═══════════════════════════════════════════════════════
          1. PROFILE
          ═══════════════════════════════════════════════════════ */}
      {sectionHeader('Profile')}

      <div style={{ margin: '0 16px' }}>
        {/* Investor Style */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '14px 16px',
            background: '#1a2235',
            borderBottom: '1px solid #0f1829',
            borderRadius: '10px 10px 0 0',
            minHeight: '52px',
            cursor: 'pointer',
          }}
        >
          <div>
            <p style={{ fontSize: '15px', color: '#ffffff' }}>Investor Style</p>
            <p style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>Lynch · Growth Focus</p>
          </div>
          <span style={{ color: '#475569', fontSize: '18px' }}>›</span>
        </div>

        {/* Risk Tolerance */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '14px 16px',
            background: '#1a2235',
            borderRadius: '0 0 10px 10px',
            minHeight: '52px',
          }}
        >
          <p style={{ fontSize: '15px', color: '#ffffff' }}>Risk Tolerance</p>
          <div style={{ display: 'flex', gap: '6px' }}>
            {riskPill('conservative', 'Conservative')}
            {riskPill('moderate', 'Moderate')}
            {riskPill('aggressive', 'Aggressive')}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════
          DEMO BADGE
          ═══════════════════════════════════════════════════════ */}
      <div
        style={{
          margin: '12px 16px',
          background: 'linear-gradient(135deg, #1e3a5f, #1a2235)',
          border: '1px solid rgba(34,211,238,0.2)',
          borderRadius: '12px',
          padding: '14px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div>
          <p style={{ fontSize: '13px', fontWeight: '700', color: '#22d3ee' }}>Demo Mode</p>
          <p style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
            30 days free · Upgrade for real portfolio
          </p>
        </div>
        <button
          style={{
            background: '#22d3ee',
            color: '#000000',
            borderRadius: '6px',
            padding: '6px 14px',
            fontSize: '12px',
            fontWeight: '700',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          Upgrade
        </button>
      </div>

      {/* ═══════════════════════════════════════════════════════
          2. BROKER
          ═══════════════════════════════════════════════════════ */}
      {sectionHeader('Broker')}

      <div style={{ margin: '0 16px' }}>
        {!brokerConnected ? (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '14px 16px',
              background: '#1a2235',
              borderRadius: '10px',
              minHeight: '52px',
            }}
          >
            <div>
              <p style={{ fontSize: '15px', color: '#ffffff' }}>Connected Broker</p>
              <p style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>Not connected</p>
            </div>
            <button
              onClick={() => setBrokerConnected(true)}
              style={{
                background: '#22d3ee',
                color: '#000000',
                borderRadius: '6px',
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: '600',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Connect →
            </button>
          </div>
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '14px 16px',
                background: '#1a2235',
                borderBottom: '1px solid #0f1829',
                borderRadius: '10px 10px 0 0',
                minHeight: '52px',
                cursor: 'pointer',
              }}
            >
              <div>
                <p style={{ fontSize: '15px', color: '#ffffff' }}>
                  Alpaca ·{' '}
                  <span style={{ color: '#10b981' }}>Connected ✓</span>
                </p>
              </div>
              <span style={{ color: '#475569', fontSize: '18px' }}>›</span>
            </div>
            <div
              onClick={() => setBrokerConnected(false)}
              style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                padding: '14px 16px',
                background: '#1a2235',
                borderRadius: '0 0 10px 10px',
                minHeight: '52px',
                cursor: 'pointer',
              }}
            >
              <p style={{ fontSize: '15px', color: '#ef4444' }}>Disconnect</p>
            </div>
          </>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════
          3. TOOLS
          ═══════════════════════════════════════════════════════ */}
      {sectionHeader('Tools')}

      <div style={{ margin: '0 16px' }}>
        {[
          { label: 'Watchlists', sub: '2 lists · 7 symbols' },
          { label: 'Price Alerts', sub: '2 active' },
          { label: 'Earnings Calendar', sub: '10 holdings tracked' },
          { label: 'News Feed', sub: 'AI-curated' },
          { label: 'Trade History', sub: 'All time activity' },
        ].map((row, i, arr) => (
          <div
            key={row.label}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '14px 16px',
              background: '#1a2235',
              borderBottom: i < arr.length - 1 ? '1px solid #0f1829' : 'none',
              borderRadius:
                arr.length === 1
                  ? '10px'
                  : i === 0
                  ? '10px 10px 0 0'
                  : i === arr.length - 1
                  ? '0 0 10px 10px'
                  : 0,
              minHeight: '52px',
              cursor: 'pointer',
            }}
          >
            <div>
              <p style={{ fontSize: '15px', color: '#ffffff' }}>{row.label}</p>
              <p style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>{row.sub}</p>
            </div>
            <span style={{ color: '#475569', fontSize: '18px' }}>›</span>
          </div>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════
          4. ACCOUNT
          ═══════════════════════════════════════════════════════ */}
      {sectionHeader('Account')}

      <div style={{ margin: '0 16px' }}>
        {/* Preferences */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '14px 16px',
            background: '#1a2235',
            borderBottom: '1px solid #0f1829',
            borderRadius: '10px 10px 0 0',
            minHeight: '52px',
            cursor: 'pointer',
          }}
        >
          <div>
            <p style={{ fontSize: '15px', color: '#ffffff' }}>Preferences</p>
            <p style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>Appearance · Security</p>
          </div>
          <span style={{ color: '#475569', fontSize: '18px' }}>›</span>
        </div>

        {/* Help & Support */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '14px 16px',
            background: '#1a2235',
            borderBottom: '1px solid #0f1829',
            borderRadius: '0 0 10px 10px',
            minHeight: '52px',
            cursor: 'pointer',
          }}
        >
          <div>
            <p style={{ fontSize: '15px', color: '#ffffff' }}>Help & Support</p>
            <p style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>Docs · Contact</p>
          </div>
          <span style={{ color: '#475569', fontSize: '18px' }}>›</span>
        </div>
      </div>

      {/* Sign Out — standalone, no card styling */}
      <div style={{ margin: '0 16px', marginTop: '12px' }}>
        <div
          onClick={() => setShowSignOutConfirm(true)}
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '14px 16px',
            background: '#1a2235',
            borderRadius: '10px',
            minHeight: '52px',
            cursor: 'pointer',
          }}
        >
          <p style={{ fontSize: '15px', color: '#ef4444' }}>Sign Out</p>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════
          5. FOOTER
          ═══════════════════════════════════════════════════════ */}
      <div
        style={{
          textAlign: 'center',
          padding: '24px 16px 8px 16px',
        }}
      >
        <p style={{ fontSize: '16px', fontWeight: '700', color: '#ffffff', letterSpacing: '0.1em' }}>
          Vantage
        </p>
        <p style={{ fontSize: '11px', color: '#334155', marginTop: '4px' }}>v0.1.0</p>
        <p style={{ fontSize: '11px', color: '#334155', marginTop: '4px' }}>
          AI-First · Mobile-First · Built with ❤️
        </p>
      </div>

      {/* Spacer for bottom nav */}
      <div style={{ height: '120px', flexShrink: 0 }} />

      {/* ═══════════════════════════════════════════════════════
          SIGN OUT CONFIRMATION MODAL
          ═══════════════════════════════════════════════════════ */}
      {showSignOutConfirm && (
        <>
          <div
            onClick={() => setShowSignOutConfirm(false)}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.6)',
              zIndex: 9998,
            }}
          />
          <div
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              background: '#1a2235',
              border: '1px solid #2a3448',
              borderRadius: '16px',
              padding: '24px',
              width: '100%',
              maxWidth: '360px',
              zIndex: 9999,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>🚪</div>
            <p style={{ fontSize: '16px', fontWeight: '700', color: '#ffffff', marginBottom: '8px' }}>
              Sign out of Vantage?
            </p>
            <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '20px' }}>
              You&apos;ll need to sign back in to access your portfolio.
            </p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => setShowSignOutConfirm(false)}
                style={{
                  flex: 1,
                  padding: '12px 0',
                  background: 'transparent',
                  border: '1px solid #475569',
                  borderRadius: '10px',
                  color: '#94a3b8',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  // sign-out logic here
                  setShowSignOutConfirm(false);
                }}
                style={{
                  flex: 1,
                  padding: '12px 0',
                  background: '#ef4444',
                  border: 'none',
                  borderRadius: '10px',
                  color: '#ffffff',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                Sign Out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
