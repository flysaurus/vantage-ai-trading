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

import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  groupLiveAccountsByConnection,
  type LiveAccountEntry,
} from '@/lib/broker/connection-cards';
import { ChevronLeft, Check, RefreshCw, ExternalLink, Unlink } from 'lucide-react';
import { VantageOrb } from '@/components/brand/VantageOrb';
import { useBroker } from '@/components/providers/BrokerProvider';
import type { BrokerInfo } from '@/lib/snaptrade/auth';

// ── Types ───────────────────────────────────────────────────

interface BrokerConnectionsPageProps {
  onBack: () => void;
  onEnterApp?: () => void;
  onDisconnect?: () => void;
}

// ── Live connection cards (A-2) ──────────────────────────────
// Grouping/enumeration lives in lib/broker/connection-cards.ts (pure + tested);
// this component only adds presentation (logo) and the per-connection status
// read. `LiveAccountEntry` is the GET /api/accounts row shape.
interface ConnectionCard {
  connectionId: string;
  brokerName: string;
  logo: string;
  environment: string | null;
  tradingEnabled: boolean;
  holdingsAvailable: boolean | null;
  subAccounts: { id: string; name: string; totalValue: number }[];
}

interface BrokerRow {
  id: string;
  name: string;
  logo: string;
  /** Optional real logo image URL (SnapTrade) — wins over emoji when present */
  logoUrl?: string;
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
  subAccounts,
  holdingsUnavailable,
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
  /**
   * Per-sub-account rows, each with its OWN standalone value. A connection is
   * never represented by the sum of its sub-accounts — the same invariant the
   * account/positions routes enforce — so a multi-sub-account login (Fidelity:
   * "Taxable SMA" + "ANIKET - YOUTH") lists both rows and no total.
   */
  subAccounts?: { id: string; name: string; totalValue: number }[];
  /** True when the broker reports holdings unavailable for this connection. */
  holdingsUnavailable?: boolean;
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
        background: 'var(--v-card)',
        boxShadow: 'var(--v-shadow-card)', // locked elevation
        border: '1px solid var(--v-card-border)',
        position: 'relative',
        overflow: 'hidden',
        // The page shell is a scrolling flex column; without this the card is
        // flex-shrunk to a sliver once the full broker list pushes the page
        // past the viewport height (same guard the other sections use).
        flexShrink: 0,
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
          background: 'var(--v-gain)',
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
              background: 'var(--v-card)',
              boxShadow: 'var(--v-shadow-card)', // locked elevation
              border: '1px solid var(--v-card-border)',
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
                color: 'var(--v-text-primary)',
              }}
            >
              {brokerName}
            </span>

            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              {/* Paper/Live badge */}
              <span
                style={badgeStyle(
                  isPaper
                    ? 'var(--v-view-only-bg)'
                    : 'var(--v-badge-gain-bg)',
                  isPaper ? 'var(--v-view-only-text)' : 'var(--v-badge-gain)',
                )}
              >
                {isPaper ? 'PAPER' : 'LIVE'}
              </span>

              {/* Trading/View only badge */}
              {tradingEnabled ? (
                <span
                  style={badgeStyle(
                    'var(--v-badge-gain-bg)',
                    'var(--v-badge-gain)',
                  )}
                >
                  TRADING
                </span>
              ) : (
                <span
                  style={badgeStyle(
                    'var(--v-view-only-bg)',
                    'var(--v-view-only-text)',
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
            background: 'var(--v-badge-gain-bg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Check size={12} color="var(--v-badge-gain)" strokeWidth={3} />
        </div>
      </div>

      {/* Sub-accounts — one row each, standalone values, never a total */}
      {subAccounts && subAccounts.length > 0 && (
        <div
          style={{
            paddingLeft: '54px',
            marginBottom: '10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '5px',
          }}
        >
          {subAccounts.map((sa) => (
            <div
              key={sa.id}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: '10px',
                fontFamily: 'var(--font-sans)',
                fontSize: '12.5px',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              <span
                style={{
                  color: 'var(--v-text-secondary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {sa.name}
              </span>
              <span style={{ color: 'var(--v-text-primary)', flexShrink: 0 }}>
                {fmtMoney(sa.totalValue)}
              </span>
            </div>
          ))}
        </div>
      )}

      {holdingsUnavailable && (
        <p
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '12.5px',
            color: 'var(--v-text-muted)',
            fontStyle: 'italic',
            paddingLeft: '54px',
            margin: '0 0 10px',
          }}
        >
          Balances not shared by this broker yet.
        </p>
      )}

      {/* Balance + timestamps */}
      <div
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: '12.5px',
          color: 'var(--v-text-muted)',
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
          borderTop: '1px solid var(--v-card-border)',
        }}
      >
        <button style={actionBtnStyle()} onClick={onRefresh}>
          <RefreshCw size={11} /> Refresh
        </button>
        <button style={actionBtnStyle()} onClick={onViewInApp}>
          View in App
        </button>
        <button style={{ ...actionBtnStyle(), color: 'var(--v-loss-label)' }} onClick={onDisconnect}>
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
    connected: 'var(--v-accent)',
    trading: 'var(--v-gain)',
    readonly: 'var(--v-warn)',
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
          color: 'var(--v-text-secondary)',
        }}
      >
        {title}
      </span>
      {count !== undefined && (
        <span
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '11px',
            color: 'var(--v-text-muted)',
            background: 'var(--v-disabled-bg)',
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
  logoUrl,
  name,
  capability,
  capabilityLabel,
  beta,
  onClick,
  loading,
}: {
  logo: string;
  logoUrl?: string;
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
        background: 'var(--v-card)',
        boxShadow: 'var(--v-shadow-card)', // locked elevation
        border: '1px solid var(--v-card-border)',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        cursor: loading ? 'default' : 'pointer',
        transition: 'all 0.15s ease',
        fontFamily: 'var(--font-sans)',
        color: 'var(--v-text-primary)',
        textAlign: 'left',
        width: 'auto',
        opacity: loading ? 0.5 : 1,
      }}
      onMouseEnter={(e) => {
        if (!loading) {
          e.currentTarget.style.borderColor = 'var(--v-accent)';
          e.currentTarget.style.background = 'var(--v-disabled-bg)';
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--v-card-border)';
        e.currentTarget.style.background = 'var(--v-card)';
      }}
    >
      {/* Logo */}
      <div
        style={{
          width: '38px',
          height: '38px',
          borderRadius: '11px',
          background: 'var(--v-card)',
          boxShadow: 'var(--v-shadow-card)', // locked elevation
          border: '1px solid var(--v-card-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '17px',
          flexShrink: 0,
          overflow: 'hidden',
        }}
      >
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={name}
            style={{ width: '70%', height: '70%', objectFit: 'contain' }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          logo
        )}
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
            color: isTrading ? 'var(--v-gain-label)' : 'var(--v-view-only-text)',
          }}
        >
          <span
            style={{
              width: '5px',
              height: '5px',
              borderRadius: '50%',
              background: isTrading ? 'var(--v-gain)' : 'var(--v-warn)',
            }}
          />
          {capabilityLabel}
        </div>
      </div>

      {/* Chevron */}
      <span style={{ color: 'var(--v-text-muted)', fontSize: '15px', flexShrink: 0 }}>›</span>
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
        background: 'var(--v-accent-dim)',
        color: 'var(--v-accent-label)',
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
        border: '1.5px dashed var(--v-card-border)',
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
          color: 'var(--v-text-muted)',
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
              color: 'var(--v-text-secondary)',
              background: 'var(--v-card)',
              boxShadow: 'var(--v-shadow-card)', // locked elevation
              border: '1px solid var(--v-card-border)',
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
          color: 'var(--v-text-muted)',
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
    border: '1px solid var(--v-card-border)',
    background: 'transparent',
    color: 'var(--v-text-secondary)',
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

function fmtMoney(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  });
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

  // ── Live connections → one card EACH (A-2) ──────────────────
  // The service-wide `useBroker()` status is a single, unscoped read: with 2+
  // connections it correctly refuses to guess (connected+ambiguous) and returns
  // no brokerId — which left this page with NO connected card and therefore NO
  // reachable Disconnect. That guard is working as intended; the bug was this
  // page asking an unscoped question. So: enumerate connections from the same
  // account list the switcher uses (per-sub-account ids), and give every
  // connection its own card whose status is read with an explicit connectionId.
  const [connectionCards, setConnectionCards] = useState<ConnectionCard[]>([]);
  const [confirmConnection, setConfirmConnection] = useState<ConnectionCard | null>(null);
  const [disconnectingConnection, setDisconnectingConnection] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/accounts', { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        const list: LiveAccountEntry[] = Array.isArray(data)
          ? data
          : Array.isArray(data?.accounts)
            ? data.accounts
            : [];
        // Pure grouping — skips demo rows and anything without a connectionId.
        const groups = groupLiveAccountsByConnection(list);
        if (groups.length === 0) return; // leave the legacy single-card path alone

        const cards = await Promise.all(
          groups.map(async (group): Promise<ConnectionCard> => {
            let environment: string | null = group.environment;
            let tradingEnabled = group.tradingEnabled;
            let holdingsAvailable: boolean | null = null;

            // Explicitly scoped status read — never the bare, ambiguous call.
            try {
              const sr = await fetch(
                `/api/broker/status?connectionId=${encodeURIComponent(group.connectionId)}`,
                { credentials: 'include' },
              );
              if (sr.ok) {
                const s = await sr.json();
                if (s?.environment) environment = s.environment;
                if (typeof s?.trading_enabled === 'boolean') tradingEnabled = s.trading_enabled;
                if (typeof s?.holdings_available === 'boolean') holdingsAvailable = s.holdings_available;
              }
            } catch {
              /* the card still renders from the account list */
            }

            const slug = String(
              group.brokerageSlug || group.brokerName || 'snaptrade',
            ).toLowerCase();

            return {
              connectionId: group.connectionId,
              brokerName: group.brokerName,
              logo: getBrokerLogo(slug),
              environment,
              tradingEnabled,
              holdingsAvailable,
              subAccounts: group.subAccounts,
            };
          }),
        );

        if (!cancelled) setConnectionCards(cards);
      } catch (e) {
        console.error('[conn-cards] enumerate failed', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Disconnect ONE connection (atomic: broker authorization + derived data) ──
  const handleConfirmDisconnect = useCallback(async () => {
    if (!confirmConnection || disconnectingConnection) return;
    setDisconnectingConnection(true);
    setToast('');
    try {
      const res = await fetch(
        `/api/connections/${encodeURIComponent(confirmConnection.connectionId)}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) throw new Error(`delete failed (${res.status})`);
      setConnectionCards((prev) =>
        prev.filter((c) => c.connectionId !== confirmConnection.connectionId),
      );
      setConfirmConnection(null);
      setToast('Broker disconnected and its data removed.');
      onDisconnect?.();
      setTimeout(() => window.location.reload(), 900);
    } catch {
      setToast('Could not disconnect the broker. Nothing was changed — please try again.');
      setConfirmConnection(null);
    } finally {
      setDisconnectingConnection(false);
    }
  }, [confirmConnection, disconnectingConnection, onDisconnect]);

  // ── Dynamic broker list (all SnapTrade brokers) ─────────
  const [brokerList, setBrokerList] = useState<{
    trading: BrokerInfo[];
    readOnly: BrokerInfo[];
  }>({ trading: [], readOnly: [] });
  const [brokerListLoading, setBrokerListLoading] = useState(true);
  const [brokerListError, setBrokerListError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/connections/snaptrade-brokerages', { credentials: 'include' })
      .then((r) => {
        if (!r.ok) throw new Error('failed');
        return r.json();
      })
      .then((d) => {
        if (cancelled) return;
        setBrokerList({
          trading: Array.isArray(d.trading) ? d.trading : [],
          readOnly: Array.isArray(d.readOnly) ? d.readOnly : [],
        });
      })
      .catch(() => {
        if (!cancelled) setBrokerListError(true);
      })
      .finally(() => {
        if (!cancelled) setBrokerListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  // ── Build broker lists grouped by capability (dynamic, filter connected) ──
  const tradingBrokers: BrokerRow[] = useMemo(
    () =>
      brokerList.trading
        .filter((b) => b.slug.toLowerCase() !== brokerId?.toLowerCase())
        .map((b) => ({
          id: b.slug,
          name: b.displayName || b.name,
          logo: getBrokerLogo(b.slug.toLowerCase()),
          logoUrl: b.logoUrl,
          capability: 'trading' as const,
          capabilityLabel: 'Trading available',
          beta: b.releaseStage === 'BETA',
          action: () => handleSnaptradeConnect(b.slug),
        })),
    [brokerList.trading, brokerId, handleSnaptradeConnect],
  );

  const readonlyBrokers: BrokerRow[] = useMemo(
    () =>
      brokerList.readOnly
        .filter((b) => b.slug.toLowerCase() !== brokerId?.toLowerCase())
        .map((b) => ({
          id: b.slug,
          name: b.displayName || b.name,
          logo: getBrokerLogo(b.slug.toLowerCase()),
          logoUrl: b.logoUrl,
          capability: 'readonly' as const,
          capabilityLabel: 'View only — no trading',
          action: () => handleSnaptradeConnect(b.slug),
        })),
    [brokerList.readOnly, brokerId, handleSnaptradeConnect],
  );

  const isLoading = loadingBroker !== null;

  return (
    <div
      className="broker-shell"
      style={{
        width: '100%',
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--v-canvas)',
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
            'linear-gradient(180deg, var(--v-canvas) 80%, transparent)',
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
            background: 'var(--v-card)',
            boxShadow: 'var(--v-shadow-card)', // locked elevation
            border: '1px solid var(--v-card-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--v-text-primary)',
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
            color: 'var(--v-text-primary)',
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
            color: 'var(--v-text-secondary)',
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
          background: 'var(--v-accent-dim)',
          border: '1px solid var(--v-accent-dim)',
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
            background: 'var(--v-accent)',
            boxShadow: 'none',
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '12.5px',
            color: 'var(--v-accent-label)',
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
            background: 'var(--v-accent-dim)',
            border: '1px solid var(--v-accent-dim)',
            color: 'var(--v-accent-label)',
            fontFamily: 'var(--font-sans)',
            fontSize: '13px',
          }}
          onClick={() => setToast('')}
        >
          {toast}
        </div>
      )}

      {/* ═══ CONNECTED SECTION — one card per connection (A-2) ═══ */}
      {connectionCards.length > 0 ? (
        <>
          <SectionHeader
            accent="connected"
            title="Connected"
            count={connectionCards.length}
          />

          {connectionCards.map((card) => (
            <ConnectedCard
              key={card.connectionId}
              brokerId={card.logo}
              brokerName={card.brokerName}
              logo={card.logo}
              environment={card.environment}
              balance=""
              tradingEnabled={card.tradingEnabled}
              subAccounts={card.subAccounts}
              holdingsUnavailable={card.holdingsAvailable === false}
              connectedAt={undefined}
              syncedAt={undefined}
              onRefresh={() => window.location.reload()}
              onViewInApp={onEnterApp}
              onDisconnect={() => setConfirmConnection(card)}
            />
          ))}
        </>
      ) : (
        isConnected &&
        brokerId && (
          <>
            <SectionHeader accent="connected" title="Connected" count={1} />

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
        )
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
          logoUrl={b.logoUrl}
          name={b.name}
          capability={b.capability}
          capabilityLabel={b.capabilityLabel}
          beta={b.beta}
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
          logoUrl={b.logoUrl}
          name={b.name}
          capability={b.capability}
          capabilityLabel={b.capabilityLabel}
          onClick={b.action}
          loading={loadingBroker === b.id}
        />
      ))}

      {/* ═══ Broker list states (loading / error / empty) ═══ */}
      {brokerListLoading && (
        <p
          style={{
            margin: '12px 20px',
            fontSize: '13px',
            color: 'var(--v-text-secondary)',
            fontFamily: 'var(--font-sans)',
          }}
        >
          Loading available brokers…
        </p>
      )}

      {!brokerListLoading && brokerListError && (
        <p
          style={{
            margin: '12px 20px',
            fontSize: '13px',
            color: 'var(--v-warn)',
            fontFamily: 'var(--font-sans)',
          }}
        >
          Couldn&apos;t load the broker list. Please refresh to retry.
        </p>
      )}

      <div style={{ height: '30px', flexShrink: 0 }} />

      {/* ═══ Disconnect confirmation (per connection) ═══ */}
      {confirmConnection && (
        <>
          <div
            onClick={() => !disconnectingConnection && setConfirmConnection(null)}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 10050,
              background: 'rgba(0,0,0,0.6)',
              backdropFilter: 'blur(4px)',
            }}
          />
          <div
            data-testid="disconnect-confirm-modal"
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              zIndex: 10051,
              width: 'calc(100% - 48px)',
              maxWidth: '360px',
              background: 'var(--v-card)',
              border: '1px solid var(--v-card-border)',
              borderRadius: '16px',
              padding: '22px',
              fontFamily: 'var(--font-sans)',
            }}
          >
            <p
              style={{
                fontSize: '16px',
                fontWeight: 700,
                color: 'var(--v-text-primary)',
                margin: '0 0 8px',
              }}
            >
              Disconnect {confirmConnection.brokerName}?
            </p>
            <p
              style={{
                fontSize: '13px',
                color: 'var(--v-text-secondary)',
                lineHeight: 1.5,
                margin: '0 0 10px',
              }}
            >
              This removes the connection at your brokerage and permanently deletes the
              data Vantage derived from it.
            </p>
            {confirmConnection.subAccounts.length > 0 && (
              <ul
                style={{
                  margin: '0 0 12px',
                  paddingLeft: '18px',
                  fontSize: '12.5px',
                  color: 'var(--v-text-secondary)',
                  lineHeight: 1.6,
                }}
              >
                {confirmConnection.subAccounts.map((sa) => (
                  <li key={sa.id}>{sa.name}</li>
                ))}
              </ul>
            )}
            <p
              style={{
                fontSize: '12px',
                color: 'var(--v-text-muted)',
                lineHeight: 1.4,
                margin: '0 0 20px',
              }}
            >
              This cannot be undone. You can reconnect later, but the derived data will not
              come back.
            </p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => setConfirmConnection(null)}
                disabled={disconnectingConnection}
                style={{
                  flex: 1,
                  padding: '11px 0',
                  borderRadius: '10px',
                  border: '1px solid var(--v-card-border)',
                  background: 'transparent',
                  color: 'var(--v-text-secondary)',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                data-testid="disconnect-confirm-button"
                onClick={handleConfirmDisconnect}
                disabled={disconnectingConnection}
                style={{
                  flex: 1,
                  padding: '11px 0',
                  borderRadius: '10px',
                  border: 'none',
                  background: 'var(--v-loss-label)',
                  color: '#ffffff',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  opacity: disconnectingConnection ? 0.6 : 1,
                }}
              >
                {disconnectingConnection ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
