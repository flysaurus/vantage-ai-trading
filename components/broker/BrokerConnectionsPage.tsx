// ─── BrokerConnectionsPage — Direction A ──────────────────
// Unified broker connections screen: connected accounts +
// available brokers grouped by capability.
//
// Sections:
//   1. Topbar w/ back button
//   2. Page head (title + subtitle)
//   3. Trust strip (security reassurance)
//   4. CONNECTED section (if any) — rich cards with actions
//   5. TRADING ENABLED section — emerald accent bar
//   6. PORTFOLIO IMPORT ONLY section — amber accent bar
//   7. Coming soon — dashed border with brand chips
//
// Design tokens match existing app: dark navy bg, cyan/emerald/amber.

'use client';

import { useState, useCallback, useEffect } from 'react';
import { ChevronLeft, Check, RefreshCw, ExternalLink, Unlink } from 'lucide-react';
import { VantageOrb } from '@/components/brand/VantageOrb';
import { useBroker } from '@/components/providers/BrokerProvider';

// ── Types ───────────────────────────────────────────────────

interface BrokerConnectionsPageProps {
  onBack: () => void;
  onEnterApp?: () => void;
  onDisconnect?: () => void;
}

interface BrokerRow {
  id: string;
  name: string;
  logo: string;
  /** 'trading' | 'readonly' — which section it belongs to */
  capability: 'trading' | 'readonly';
  /** Subtitle line shown below name */
  capabilityLabel: string;
  /** Optional BETA pill */
  beta?: boolean;
  /** Action on tap */
  action: () => void;
}

// ── Brand logo mapping ──────────────────────────────────────

function getBrokerLogo(id: string): string {
  const map: Record<string, string> = {
    alpaca: '🦙',
    tastytrade: '🍜',
    fidelity: '🏦',
    robinhood: '🟢',
    schwab: '📊',
    vanguard: '🚢',
    etrade: '📈',
    ibkr: '⚡',
    webull: '📱',
  };
  return map[id] || '🏛️';
}

function getBrokerName(id: string): string {
  const map: Record<string, string> = {
    alpaca: 'Alpaca',
    tastytrade: 'tastytrade',
    fidelity: 'Fidelity',
    robinhood: 'Robinhood',
    schwab: 'Charles Schwab',
    vanguard: 'Vanguard',
    etrade: 'E*TRADE',
    ibkr: 'Interactive Brokers',
    webull: 'Webull',
  };
  return map[id] || id;
}

// ── Connected card component ────────────────────────────────

function ConnectedCard({
  brokerId,
  brokerName,
  logo,
  environment,
  balance,
  tradingEnabled,
  connectedAt,
  syncedAt,
  onRefresh,
  onViewInApp,
  onDisconnect,
}: {
  brokerId: string;
  brokerName: string;
  logo: string;
  environment: string | null;
  balance: string;
  tradingEnabled: boolean;
  connectedAt?: string;
  syncedAt?: string;
  onRefresh?: () => void;
  onViewInApp?: () => void;
  onDisconnect?: () => void;
}) {
  const isPaper = environment === 'paper';
  const connectedLabel = connectedAt
    ? `Connected ${fmtDate(connectedAt)}`
    : '';
  const syncedLabel = syncedAt
    ? `Synced ${fmtTime(syncedAt)}`
    : '';

  return (
    <div
      style={{
        margin: '0 20px 12px',
        padding: '16px',
        borderRadius: '16px',
        background: 'rgba(255,255,255,0.035)',
        border: '1px solid rgba(61,220,151,0.18)',
        position: 'relative',
        overflow: 'hidden',
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
          background: 'var(--emerald)',
        }}
      />

      {/* Top row: logo, name, badges, status */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Logo tile */}
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '11px',
              background: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '20px',
              flexShrink: 0,
              overflow: 'hidden',
            }}
          >
            {logo}
          </div>

          {/* Name + badges */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <span
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: '15.5px',
                fontWeight: 650,
                letterSpacing: '-0.01em',
                color: 'var(--text-primary)',
              }}
            >
              {brokerName}
            </span>

            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              {/* Paper/Live badge */}
              <span
                style={badgeStyle(
                  isPaper
                    ? 'rgba(240,183,63,0.12)'
                    : 'rgba(61,220,151,0.12)',
                  isPaper ? '#f0b73f' : '#3ddc97',
                )}
              >
                {isPaper ? 'PAPER' : 'LIVE'}
              </span>

              {/* Trading/View only badge */}
              {tradingEnabled ? (
                <span
                  style={badgeStyle(
                    'rgba(61,220,151,0.12)',
                    '#3ddc97',
                  )}
                >
                  TRADING
                </span>
              ) : (
                <span
                  style={badgeStyle(
                    'rgba(240,183,63,0.12)',
                    '#f0b73f',
                  )}
                >
                  View only
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Green checkmark */}
        <div
          style={{
            width: '22px',
            height: '22px',
            borderRadius: '50%',
            background: 'rgba(61,220,151,0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Check size={12} color="#3ddc97" strokeWidth={3} />
        </div>
      </div>

      {/* Balance + timestamps */}
      <div
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: '12.5px',
          color: 'var(--text-tertiary)',
          fontVariantNumeric: 'tabular-nums',
          paddingLeft: '54px',
          lineHeight: 1.6,
        }}
      >
        {balance && (
          <>
            {balance}
            {connectedLabel && <span style={{ margin: '0 6px', opacity: 0.4 }}>·</span>}
            {connectedLabel}
            {syncedLabel && <span style={{ margin: '0 6px', opacity: 0.4 }}>·</span>}
            {syncedLabel}
          </>
        )}
        {!balance && (
          <>
            {connectedLabel}
            {syncedLabel && <span style={{ margin: '0 6px', opacity: 0.4 }}>·</span>}
            {syncedLabel}
          </>
        )}
      </div>

      {/* Action row */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          marginTop: '13px',
          paddingTop: '13px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <button style={actionBtnStyle()} onClick={onRefresh}>
          <RefreshCw size={11} /> Refresh
        </button>
        <button style={actionBtnStyle()} onClick={onViewInApp}>
          View in App
        </button>
        <button style={{ ...actionBtnStyle(), color: '#ef7b6a' }} onClick={onDisconnect}>
          Disconnect
        </button>
      </div>
    </div>
  );
}

// ── Section header ─────────────────────────────────────────

function SectionHeader({
  accent,
  title,
  count,
}: {
  accent: 'connected' | 'trading' | 'readonly';
  title: string;
  count?: number;
}) {
  const accentColors = {
    connected: '#38d6e8',
    trading: '#3ddc97',
    readonly: '#f0b73f',
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '0 20px',
        margin: '26px 0 12px',
      }}
    >
      <div
        style={{
          width: '3px',
          height: '13px',
          borderRadius: '2px',
          background: accentColors[accent],
        }}
      />
      <span
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: '12px',
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--text-secondary)',
        }}
      >
        {title}
      </span>
      {count !== undefined && (
        <span
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '11px',
            color: 'var(--text-tertiary)',
            background: 'rgba(255,255,255,0.035)',
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

// ── Broker row component ───────────────────────────────────

function BrokerListRow({
  logo,
  name,
  capability,
  capabilityLabel,
  beta,
  onClick,
  loading,
}: {
  logo: string;
  name: string;
  capability: 'trading' | 'readonly';
  capabilityLabel: string;
  beta?: boolean;
  onClick: () => void;
  loading?: boolean;
}) {
  const isTrading = capability === 'trading';

  return (
    <button
      onClick={onClick}
      disabled={loading}
      style={{
        margin: '0 20px 8px',
        padding: '13px 14px',
        borderRadius: '14px',
        background: 'rgba(255,255,255,0.035)',
        border: '1px solid rgba(255,255,255,0.08)',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        cursor: loading ? 'default' : 'pointer',
        transition: 'all 0.15s ease',
        fontFamily: 'var(--font-sans)',
        color: 'var(--text-primary)',
        textAlign: 'left',
        width: 'auto',
        opacity: loading ? 0.5 : 1,
      }}
      onMouseEnter={(e) => {
        if (!loading) {
          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.14)';
          e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
        e.currentTarget.style.background = 'rgba(255,255,255,0.035)';
      }}
    >
      {/* Logo */}
      <div
        style={{
          width: '38px',
          height: '38px',
          borderRadius: '11px',
          background: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '17px',
          flexShrink: 0,
        }}
      >
        {logo}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '2px' }}>
          <span style={{ fontSize: '14.5px', fontWeight: 600 }}>{name}</span>
          {beta && <BetaPill />}
        </div>
        <div
          style={{
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            color: isTrading ? '#3ddc97' : '#f0b73f',
          }}
        >
          <span
            style={{
              width: '5px',
              height: '5px',
              borderRadius: '50%',
              background: isTrading ? '#3ddc97' : '#f0b73f',
            }}
          />
          {capabilityLabel}
        </div>
      </div>

      {/* Chevron */}
      <span style={{ color: 'var(--text-tertiary)', fontSize: '15px', flexShrink: 0 }}>›</span>
    </button>
  );
}

// ── Beta pill ───────────────────────────────────────────────

function BetaPill() {
  return (
    <span
      style={{
        fontFamily: 'var(--font-sans)',
        fontSize: '9.5px',
        fontWeight: 700,
        background: 'rgba(56,214,232,0.12)',
        color: '#38d6e8',
        padding: '1.5px 5px',
        borderRadius: '5px',
        letterSpacing: '0.03em',
      }}
    >
      BETA
    </span>
  );
}

// ── Coming soon section ─────────────────────────────────────

function ComingSoonSection({
  brands,
}: {
  brands: string[];
}) {
  return (
    <div
      style={{
        margin: '20px 20px 24px',
        padding: '20px 18px',
        borderRadius: '16px',
        border: '1.5px dashed rgba(255,255,255,0.12)',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: '20px', marginBottom: '8px' }}>✨</div>
      <div
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: '11px',
          fontWeight: 700,
          letterSpacing: '0.08em',
          color: 'var(--text-tertiary)',
          textTransform: 'uppercase',
          marginBottom: '8px',
        }}
      >
        More coming soon
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: '8px',
          flexWrap: 'wrap',
          marginBottom: '10px',
        }}
      >
        {brands.map((b) => (
          <span
            key={b}
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '12px',
              color: 'var(--text-secondary)',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.06)',
              padding: '4px 10px',
              borderRadius: '8px',
            }}
          >
            {b}
          </span>
        ))}
      </div>
      <p
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: '12px',
          color: 'var(--text-tertiary)',
          margin: 0,
        }}
      >
        Portfolio import only, same secure flow
      </p>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────

function badgeStyle(bg: string, color: string): React.CSSProperties {
  return {
    fontFamily: 'var(--font-sans)',
    fontSize: '10.5px',
    fontWeight: 700,
    letterSpacing: '0.03em',
    padding: '2.5px 7px',
    borderRadius: '6px',
    background: bg,
    color,
    lineHeight: 1,
  };
}

function actionBtnStyle(): React.CSSProperties {
  return {
    flex: 1,
    padding: '8px 0',
    borderRadius: '9px',
    border: '1px solid rgba(255,255,255,0.08)',
    background: 'transparent',
    color: 'var(--text-secondary)',
    fontFamily: 'var(--font-sans)',
    fontSize: '12.5px',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '4px',
  };
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return iso;
  }
}

// ═══════════════════════════════════════════════════════════
// ─── Main Page ─────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════

export function BrokerConnectionsPage({
  onBack,
  onEnterApp,
  onDisconnect,
}: BrokerConnectionsPageProps) {
  const {
    isConnected,
    brokerId,
    tradingEnabled,
    accountPreview,
    environment,
  } = useBroker();

  const [loadingBroker, setLoadingBroker] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  // ── Snaptrade init handler ───────────────────────────────
  const handleSnaptradeConnect = useCallback(async (brokerId: string) => {
    setLoadingBroker(brokerId);
    setToast('');

    try {
      const res = await fetch('/api/connections/snaptrade/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ broker_id: brokerId }),
      });

      const data = await res.json();

      if (!res.ok) {
        setToast(data.error || 'Failed to initiate connection');
        setLoadingBroker(null);
        return;
      }

      if (data.success && data.redirect_url) {
        window.location.href = data.redirect_url;
      } else {
        setToast('No redirect URL received. Please try again.');
        setLoadingBroker(null);
      }
    } catch {
      setToast('Network error. Check your connection.');
      setLoadingBroker(null);
    }
  }, []);

  // ── Coming soon handler ─────────────────────────────────
  const handleComingSoon = useCallback((name: string) => {
    setToast(`${name} is coming soon — we'll notify you when ready.`);
  }, []);

  // ── Format balance ──────────────────────────────────────
  const balance = accountPreview?.equity
    ? `$${accountPreview.equity.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`
    : '';

  // ── Connected broker display name ───────────────────────
  const connectedName = brokerId
    ? getBrokerName(brokerId)
    : '';

  // ── Build broker lists grouped by capability (filter out connected broker) ──
  const allTradingBrokers: BrokerRow[] = [
    {
      id: 'alpaca',
      name: 'Alpaca',
      logo: '🦙',
      capability: 'trading',
      capabilityLabel: 'Trading available',
      action: () => handleSnaptradeConnect('alpaca'),
    },
    {
      id: 'tastytrade',
      name: 'tastytrade',
      logo: '🍜',
      capability: 'trading',
      capabilityLabel: 'Trading · Options & futures',
      action: () => handleComingSoon('tastytrade'),
    },
  ];

  const tradingBrokers = allTradingBrokers.filter(b => b.id !== brokerId);

  const allReadonlyBrokers: BrokerRow[] = [
    {
      id: 'fidelity',
      name: 'Fidelity',
      logo: '🏦',
      capability: 'readonly',
      capabilityLabel: 'View only — no trading',
      action: () => handleSnaptradeConnect('fidelity'),
    },
    {
      id: 'robinhood',
      name: 'Robinhood',
      logo: '🟢',
      capability: 'readonly',
      capabilityLabel: 'View only — no trading',
      action: () => handleSnaptradeConnect('robinhood'),
    },
    {
      id: 'schwab',
      name: 'Charles Schwab',
      logo: '📊',
      capability: 'readonly',
      capabilityLabel: 'View only — no trading',
      action: () => handleSnaptradeConnect('schwab'),
    },
    {
      id: 'vanguard',
      name: 'Vanguard',
      logo: '🚢',
      capability: 'readonly',
      capabilityLabel: 'View only — no trading',
      action: () => handleSnaptradeConnect('vanguard'),
    },
  ];

  const readonlyBrokers = allReadonlyBrokers.filter(b => b.id !== brokerId);

  const comingSoonBrands = ['IBKR', 'Chase', 'Webull', 'Coinbase'];

  const isLoading = loadingBroker !== null;

  return (
    <div
      style={{
        width: '100%',
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        background:
          'radial-gradient(ellipse 120% 60% at 50% -10%, rgba(34,211,238,0.18), transparent 55%), var(--bg-primary)',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        position: 'relative',
      }}
    >
      {/* ═══ TOPBAR ═══ */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '18px 20px 8px',
          position: 'sticky',
          top: 0,
          background:
            'linear-gradient(180deg, var(--bg-primary) 80%, transparent)',
          zIndex: 5,
          paddingTop: 'calc(18px + env(safe-area-inset-top, 0px))',
          flexShrink: 0,
        }}
      >
        <button
          onClick={onBack}
          disabled={isLoading}
          style={{
            width: '34px',
            height: '34px',
            borderRadius: '10px',
            background: 'rgba(255,255,255,0.035)',
            border: '1px solid rgba(255,255,255,0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-primary)',
            fontSize: '16px',
            cursor: isLoading ? 'default' : 'pointer',
            opacity: isLoading ? 0.4 : 1,
            transition: 'all 0.15s ease',
          }}
          aria-label="Back"
        >
          <ChevronLeft size={18} />
        </button>

        {/* Orb centered */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            paddingTop: 'env(safe-area-inset-top, 0px)',
          }}
        >
          <VantageOrb size={32} animate showEntrance={false} />
        </div>
      </div>

      {/* ═══ PAGE HEAD ═══ */}
      <div style={{ padding: '4px 20px 20px', flexShrink: 0 }}>
        <h1
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '26px',
            fontWeight: 700,
            letterSpacing: '-0.02em',
            color: 'var(--text-primary)',
            marginBottom: '6px',
            marginTop: 0,
          }}
        >
          Broker Connections
        </h1>
        <p
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '14.5px',
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
            maxWidth: '320px',
            margin: 0,
          }}
        >
          Connect brokerage accounts to enable AI-driven trading and portfolio tracking.
        </p>
      </div>

      {/* ═══ TRUST STRIP ═══ */}
      <div
        style={{
          margin: '0 20px 22px',
          padding: '11px 14px',
          borderRadius: '12px',
          background:
            'linear-gradient(90deg, rgba(56,214,232,0.08), rgba(56,214,232,0.02))',
          border: '1px solid rgba(56,214,232,0.16)',
          display: 'flex',
          alignItems: 'center',
          gap: '9px',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: '#38d6e8',
            boxShadow: '0 0 8px #38d6e8',
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '12.5px',
            color: '#a8e8f0',
          }}
        >
          Secured via SnapTrade · credentials never touch Vantage servers
        </span>
      </div>

      {/* Toast */}
      {toast && (
        <div
          style={{
            margin: '0 20px 8px',
            padding: '10px 14px',
            borderRadius: '12px',
            background: 'rgba(56,214,232,0.08)',
            border: '1px solid rgba(56,214,232,0.16)',
            color: '#a8e8f0',
            fontFamily: 'var(--font-sans)',
            fontSize: '13px',
          }}
          onClick={() => setToast('')}
        >
          {toast}
        </div>
      )}

      {/* ═══ CONNECTED SECTION ═══ */}
      {isConnected && brokerId && (
        <>
          <SectionHeader
            accent="connected"
            title="Connected"
            count={1}
          />

          <ConnectedCard
            brokerId={brokerId}
            brokerName={connectedName}
            logo={getBrokerLogo(brokerId)}
            environment={environment}
            balance={balance}
            tradingEnabled={tradingEnabled}
            connectedAt={undefined}
            syncedAt={undefined}
            onRefresh={() => window.location.reload()}
            onViewInApp={onEnterApp}
            onDisconnect={onDisconnect}
          />
        </>
      )}

      {/* ═══ TRADING ENABLED SECTION ═══ */}
      <SectionHeader
        accent="trading"
        title="Trading Enabled"
        count={tradingBrokers.length}
      />

      {tradingBrokers.map((b) => (
        <BrokerListRow
          key={b.id}
          logo={b.logo}
          name={b.name}
          capability={b.capability}
          capabilityLabel={b.capabilityLabel}
          onClick={b.action}
          loading={loadingBroker === b.id}
        />
      ))}

      {/* ═══ PORTFOLIO IMPORT ONLY SECTION ═══ */}
      <SectionHeader
        accent="readonly"
        title="Portfolio Import Only"
        count={readonlyBrokers.length}
      />

      {readonlyBrokers.map((b) => (
        <BrokerListRow
          key={b.id}
          logo={b.logo}
          name={b.name}
          capability={b.capability}
          capabilityLabel={b.capabilityLabel}
          onClick={b.action}
          loading={loadingBroker === b.id}
        />
      ))}

      {/* ═══ COMING SOON ═══ */}
      <ComingSoonSection brands={comingSoonBrands} />

      <div style={{ height: '30px', flexShrink: 0 }} />
    </div>
  );
}
