// ─── Account Select Screen — Direction A visual language ──
// Full-screen card-based account selector shown after auth.
// Same visual grammar as BrokerConnectionsPage: square logo tiles,
// consistent badge pills (PAPER/DEMO/trading-enabled), accent bars,
// matching card radius/spacing.
//
// Flow:
//   - Shows on first login (unless "don't show again" was checked)
//   - Always reachable from Settings
//   - "Add a broker" card → existing SnapTrade connection flow

'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAccounts } from '@/context/AccountContext';
import type { AccountEntry } from '@/app/api/accounts/route';
import { PlusCircle, ArrowRight } from 'lucide-react';

const SKIP_KEY = 'vantage:skipAccountSelect:v2';

// ─── Broker logo cache ───────────────────────────────────────

interface BrokerLogo {
  slug: string;
  logoUrl: string;
  displayName: string;
}

function useBrokerLogos() {
  const [logos, setLogos] = useState<Map<string, BrokerLogo>>(new Map());
  useEffect(() => {
    fetch('/api/connections/snaptrade-brokerages', { credentials: 'include' })
      .then(r => { if (!r.ok) throw new Error('Failed'); return r.json(); })
      .then(data => {
        const map = new Map<string, BrokerLogo>();
        for (const b of [...(data.trading || []), ...(data.readOnly || [])]) {
          map.set(b.slug, { slug: b.slug, logoUrl: b.logoUrl, displayName: b.displayName });
        }
        setLogos(map);
      })
      .catch(() => { /* logos will be empty — fallback to initials */ });
  }, []);
  return logos;
}

// ─── Props ────────────────────────────────────────────────────

interface AccountSelectScreenProps {
  /** Called when user selects an account. */
  onSelect: (accountId: string) => void;
  /** Called when user wants to add a broker. */
  onAddBroker: () => void;
  /** Called when user dismisses the screen (either by selecting or skipping). */
  onDismiss: () => void;
}

// ─── Design tokens (same as BrokerConnectionsPage) ──────────

// Themed via the locked --v-* light system (light is the default).
const bgPrimary = 'var(--v-canvas)';
const bgRoot = 'var(--v-canvas)';
const cardBg = 'var(--v-card)';
const cardBorder = 'var(--v-card-border)';
const cardBorderHover = 'var(--v-accent)';
const textPrimary = 'var(--v-text-primary)';
const textSecondary = 'var(--v-text-secondary)';
const textTertiary = 'var(--v-text-muted)';
const emerald = 'var(--v-gain)';
const emeraldText = 'var(--v-gain-label)';
const emeraldDim = 'var(--v-gain-dim)';
const amber = 'var(--v-view-only-text)';
const amberDim = 'var(--v-view-only-bg)';
const cyan = 'var(--v-accent)';
const cyanDim = 'var(--v-accent-dim)';
const divider = 'var(--v-card-border)';

// ─── Badge style helper ─────────────────────────────────────

function badgeStyle(bg: string, color: string): React.CSSProperties {
  return {
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif',
    fontSize: '10.5px',
    fontWeight: 700,
    letterSpacing: '0.03em',
    padding: '2.5px 7px',
    borderRadius: '6px',
    background: bg,
    color,
    lineHeight: 1,
    whiteSpace: 'nowrap',
    flexShrink: 0,
  };
}

// ─── Main component ──────────────────────────────────────────

export default function AccountSelectScreen({
  onSelect,
  onAddBroker,
  onDismiss,
}: AccountSelectScreenProps) {
  const { accounts, isLoading } = useAccounts();
  const brokerLogos = useBrokerLogos();
  const [dontShow, setDontShow] = useState(false);
  const [visible, setVisible] = useState(false);

  // Fade-in on mount
  useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);

  const handleSelect = (accountId: string) => {
    if (dontShow) localStorage.setItem(SKIP_KEY, 'true');
    onSelect(accountId);
  };

  // Sort: Demo first, then live/paper brokers (MUST be before any early return)
  const sorted: AccountEntry[] = useMemo(() => {
    const demo = accounts.filter(a => a.isDemo);
    const live = accounts.filter(a => !a.isDemo && a.environment !== 'paper');
    const paper = accounts.filter(a => !a.isDemo && a.environment === 'paper');
    return [...demo, ...live, ...paper];
  }, [accounts]);

  // ── Loading state ──
  if (isLoading) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 100,
          background: bgRoot,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '16px',
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            border: '2px solid var(--v-card-border)',
            borderTopColor: 'var(--v-accent)',
            animation: 'spin 0.8s linear infinite',
          }}
        />
        <p style={{ color: 'var(--v-text-muted)', fontSize: '13px', fontFamily: 'inherit' }}>
          Loading accounts…
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: bgPrimary,
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        transition: 'opacity 300ms',
        opacity: visible ? 1 : 0,
      }}
    >
      <div
        style={{
          minHeight: '100%',
          display: 'flex',
          flexDirection: 'column',
          maxWidth: '480px',
          margin: '0 auto',
          padding: '0 20px 32px',
        }}
      >
        {/* Page Head — matching BrokerConnectionsPage */}
        <div style={{ padding: '40px 0 16px' }}>
          <h1
            style={{
              fontFamily: 'inherit',
              fontSize: '26px',
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: textPrimary,
              marginBottom: '6px',
              marginTop: 0,
            }}
          >
            Welcome to Vantage
          </h1>
          <p
            style={{
              fontFamily: 'inherit',
              fontSize: '14.5px',
              color: textSecondary,
              lineHeight: 1.5,
              maxWidth: '320px',
              margin: 0,
            }}
          >
            Choose which account you&apos;d like to view. You can switch or add brokers
            anytime from Settings.
          </p>
        </div>

        {/* ─── CONNECTED ACCOUNTS section ─── */}
        <SectionHeader accent={cyan} title="Your Accounts" count={sorted.length} />

        {/* Account cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {sorted.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              logo={brokerLogos.get(account.brokerageSlug || '')}
              onSelect={() => handleSelect(account.id)}
            />
          ))}

          {/* Add broker card — matching Direction A dashed+emerald style */}
          <button
            onClick={onAddBroker}
            style={{
              width: '100%',
              padding: '16px',
              borderRadius: '16px',
              border: '1.5px dashed var(--v-card-border)',
              background: 'var(--v-card)',
              display: 'flex',
              alignItems: 'center',
              gap: '13px',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              fontFamily: 'inherit',
              textAlign: 'left',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--v-accent)';
              e.currentTarget.style.background = 'var(--v-disabled-bg)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--v-card-border)';
              e.currentTarget.style.background = 'var(--v-card)';
            }}
          >
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '11px',
                background: emeraldDim,
                border: '1px solid var(--v-gain-label)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <PlusCircle size={20} color={emerald} strokeWidth={1.5} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: '15.5px',
                  fontWeight: 650,
                  letterSpacing: '-0.01em',
                  color: emeraldText,
                  marginBottom: '2px',
                }}
              >
                Add a broker
              </div>
              <div
                style={{
                  fontSize: '12.5px',
                  color: textTertiary,
                  lineHeight: 1.4,
                }}
              >
                Connect Alpaca, Tastytrade, E*TRADE, or others
              </div>
            </div>
            <ArrowRight size={16} color={textTertiary} style={{ flexShrink: 0 }} />
          </button>
        </div>

        {/* Footer: "Don't show again" + dismiss */}
        <div
          style={{
            marginTop: 'auto',
            paddingTop: '24px',
            borderTop: `1px solid ${divider}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(e) => setDontShow(e.target.checked)}
              style={{
                width: '16px',
                height: '16px',
                borderRadius: '4px',
                border: `1px solid var(--v-card-border)`,
                accentColor: 'var(--v-accent)',
                cursor: 'pointer',
              }}
            />
            <span
              style={{
                fontSize: '13px',
                color: textTertiary,
                fontFamily: 'inherit',
              }}
            >
              Don&apos;t show this again
            </span>
          </label>
        </div>

        {/* Bottom spacer */}
        <div style={{ height: '20px', flexShrink: 0 }} />
      </div>
    </div>
  );
}

// ─── Section Header — reusable (same as BrokerConnectionsPage) ──

function SectionHeader({
  accent,
  title,
  count,
}: {
  accent: string;
  title: string;
  count?: number;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        margin: '26px 0 12px',
      }}
    >
      <div
        style={{
          width: '3px',
          height: '13px',
          borderRadius: '2px',
          background: accent,
        }}
      />
      <span
        style={{
          fontFamily: 'inherit',
          fontSize: '12px',
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: textSecondary,
        }}
      >
        {title}
      </span>
      {count !== undefined && (
        <span
          style={{
            fontFamily: 'inherit',
            fontSize: '11px',
            color: textTertiary,
            background: cardBg,
            padding: '2px 7px',
            borderRadius: '20px',
            fontWeight: 600,
          }}
        >
          {count}
        </span>
      )}
    </div>
  );
}

// ─── Account Card — Direction A matching card system ────────

function AccountCard({
  account,
  logo,
  onSelect,
}: {
  account: AccountEntry;
  logo: BrokerLogo | undefined;
  onSelect: () => void;
}) {
  const isDemo = account.isDemo;
  const isPaper = !isDemo && account.environment === 'paper';
  const isReadonly = !isDemo && !account.tradingEnabled;

  // Left accent bar color
  const accentColor = isDemo ? amber : (isReadonly ? amber : emerald);

  return (
    <button
      onClick={onSelect}
      style={{
        width: '100%',
        padding: '16px',
        borderRadius: '16px',
        background: cardBg,
        border: `1px solid ${cardBorder}`,
        display: 'flex',
        alignItems: 'center',
        gap: '13px',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        fontFamily: 'inherit',
        color: textPrimary,
        textAlign: 'left',
        position: 'relative',
        overflow: 'hidden',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = cardBorderHover;
        e.currentTarget.style.background = 'var(--v-disabled-bg)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = cardBorder;
        e.currentTarget.style.background = cardBg;
      }}
    >
      {/* Left accent bar */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: '3px',
          background: accentColor,
        }}
      />

      {/* Logo tile — square, matching BrokerConnectionsPage */}
      {isDemo ? (
        <div
          style={{
            width: '42px',
            height: '42px',
            borderRadius: '11px',
            background: amberDim,
            border: '1px solid var(--v-admin-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '20px',
            flexShrink: 0,
          }}
        >
          🎮
        </div>
      ) : logo?.logoUrl ? (
        <div
          style={{
            width: '42px',
            height: '42px',
            borderRadius: '11px',
            background: 'var(--v-card)',
            border: '1px solid var(--v-card-border)',
            padding: '7px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            overflow: 'hidden',
          }}
        >
          <img
            src={logo.logoUrl}
            alt={account.broker}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
          />
        </div>
      ) : (
        <div
          style={{
            width: '42px',
            height: '42px',
            borderRadius: '11px',
            background: 'var(--v-disabled-bg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '17px',
            fontWeight: 700,
            color: 'var(--v-text-faint)',
            flexShrink: 0,
          }}
        >
          {account.broker.charAt(0)}
        </div>
      )}

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '7px',
            marginBottom: '4px',
          }}
        >
          <span
            style={{
              fontSize: '15.5px',
              fontWeight: 650,
              letterSpacing: '-0.01em',
              color: textPrimary,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {account.name}
          </span>

          {/* Badges — consistent pill treatment */}
          {isDemo && (
            <span style={badgeStyle(amberDim, amber)}>DEMO</span>
          )}
          {isPaper && (
            <span style={badgeStyle(amberDim, amber)}>PAPER</span>
          )}
          {isReadonly && (
            <span style={badgeStyle(amberDim, amber)}>READ-ONLY</span>
          )}
          {!isDemo && !isReadonly && (
            <span style={badgeStyle(emeraldDim, emeraldText)}>TRADING</span>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '12.5px',
            color: textTertiary,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <span style={{ color: 'var(--v-text-secondary)' }}>
            {formatCurrency(account.totalValue)}
          </span>
          <span style={{ opacity: 0.4 }}>·</span>
          <span>{account.broker}</span>
        </div>
      </div>

      {/* Select chevron */}
      <ArrowRight size={16} color={textTertiary} style={{ flexShrink: 0, opacity: 0.5 }} />
    </button>
  );
}

// ─── Helpers ──────────────────────────────────────────────────

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
