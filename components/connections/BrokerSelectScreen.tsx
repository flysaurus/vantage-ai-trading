'use client';

// ─── Broker Select Screen ────────────────────────────────────
// Vantage broker selection with card-style rows — LIGHT themed.
//
// Design matches BrokerChoicePage:
//   - White cards on the --v-canvas sheet, --v-card-border hairlines
//   - Pill badges for status indicators (view-only / gain pairs)
//   - Touch-friendly interactive feedback
//   - Pull-to-connect pattern
//
// Theming: locked --v-* tokens only (app/theme.css). No frosted glass.

import { useState, useEffect, useCallback } from 'react';
import { Loader2, AlertCircle, ArrowLeftRight, Shield, Lock, ExternalLink, Sparkles } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────

interface BrokerInfo {
  id: string;
  slug: string;
  name: string;
  displayName: string;
  description: string;
  logoUrl: string;
  allowsTrading: boolean;
  allowsFractionalUnits: boolean | null;
  allowsCrypto: boolean;
  releaseStage: string;
  authTypes: Array<{ type: string; authType: string }>;
}

interface BrokerSelectScreenProps {
  onRedirect?: (broker: BrokerInfo) => void;
  onCancel?: () => void;
  tradingOnly?: boolean;
}

type ConnectPhase = 'idle' | 'confirming' | 'connecting' | 'error';

// ─── US stock broker filter ──────────────────────────────────

const US_STOCK_BROKERS = new Set([
  'ALPACA-PAPER',
  'TASTYTRADE',
  'ETRADE',
  'WEBULL',
  'PUBLIC',
  'MOOMOO',
]);

function isUSStockBroker(slug: string): boolean {
  return US_STOCK_BROKERS.has(slug.toUpperCase());
}

function formatBrokerSlug(slug: string): string {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

// ─── Component ────────────────────────────────────────────────

export default function BrokerSelectScreen({
  onRedirect,
  onCancel,
  tradingOnly = true,
}: BrokerSelectScreenProps) {
  const [tradingBrokers, setTradingBrokers] = useState<BrokerInfo[]>([]);
  const [readOnlyBrokers, setReadOnlyBrokers] = useState<BrokerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedBroker, setSelectedBroker] = useState<BrokerInfo | null>(null);
  const [phase, setPhase] = useState<ConnectPhase>('idle');
  const [connectError, setConnectError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        setLoadError(null);
        const res = await fetch('/api/connections/snaptrade-brokerages');
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        setTradingBrokers((data.trading || []).filter((b: BrokerInfo) => isUSStockBroker(b.slug)));
        setReadOnlyBrokers((data.readOnly || []).filter((b: BrokerInfo) => isUSStockBroker(b.slug)));
      } catch (err) {
        if (cancelled) return;
        console.error('[BrokerSelect] Failed to load:', err);
        setLoadError('Could not load available brokers. Please try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const startConnection = useCallback(async (broker: BrokerInfo) => {
    setPhase('connecting');
    setConnectError(null);

    try {
      const res = await fetch('/api/connections/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brokerage_slug: broker.slug,
          connection_type: 'trade-if-available',
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errData.error || `Server returned ${res.status}`);
      }

      const data = await res.json();

      if (!data.redirectUrl) {
        throw new Error('No redirect URL received');
      }

      onRedirect?.(broker);
      window.location.href = data.redirectUrl;
    } catch (err) {
      // Stay in 'connecting' phase and show error inline (avoids missing 'error' state UI)
      setConnectError(
        err instanceof Error ? err.message : 'Connection failed. Please try again.',
      );
    }
  }, [onRedirect]);

  const handleBrokerClick = useCallback((broker: BrokerInfo) => {
    setSelectedBroker(broker);
    setPhase('confirming');
    setConnectError(null);
  }, []);

  const handleConfirm = useCallback(() => {
    if (!selectedBroker) return;
    startConnection(selectedBroker);
  }, [selectedBroker, startConnection]);

  const handleCancel = useCallback(() => {
    setSelectedBroker(null);
    setPhase('idle');
    setConnectError(null);
  }, []);

  // ── Loading state ──
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <div className="relative">
          <div className="w-12 h-12 rounded-2xl bg-[var(--v-card)] border border-[var(--v-card-border)] flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--v-text-faint)]" />
          </div>
        </div>
        <p className="text-sm text-[var(--v-text-faint)]">Loading available brokers…</p>
      </div>
    );
  }

  // ── Error state ──
  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <div className="w-12 h-12 rounded-2xl bg-[var(--v-loss-dim)] border border-[var(--v-loss)] flex items-center justify-center">
          <AlertCircle className="h-6 w-6 text-[var(--v-loss-label)]" />
        </div>
        <p className="text-sm text-[var(--v-loss-label)] font-medium">{loadError}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 rounded-xl bg-[var(--v-card)] border border-[var(--v-card-border)] text-sm text-[var(--v-text-secondary)] hover:text-[var(--v-text-primary)] hover:bg-[var(--v-disabled-bg)] transition-all"
        >
          Try again
        </button>
      </div>
    );
  }

  // ── Confirmation modal ──
  if (phase === 'confirming' && selectedBroker) {
    const isPaper = selectedBroker.slug.toUpperCase().includes('PAPER') ||
                    selectedBroker.slug.toUpperCase().includes('PRACTICE');

    return (
      <div className="max-w-md mx-auto py-6 px-4">
        <div
          className="rounded-2xl border border-[var(--v-card-border)] bg-[var(--v-card)] p-6 space-y-5"
        >
          {/* Broker header */}
          <div className="flex items-center gap-3">
            {selectedBroker.logoUrl ? (
              <img
                src={selectedBroker.logoUrl}
                alt={selectedBroker.displayName}
                className="h-11 w-11 rounded-xl object-contain bg-white border border-[var(--v-card-border)] p-1 shrink-0"
              />
            ) : (
              <div className="h-11 w-11 rounded-xl bg-[var(--v-disabled-bg)] flex items-center justify-center text-lg font-bold shrink-0 text-[var(--v-text-secondary)]">
                {selectedBroker.displayName.charAt(0)}
              </div>
            )}
            <div>
              <h3 className="font-semibold text-lg text-[var(--v-text-primary)]">{selectedBroker.displayName}</h3>
              <p className="text-sm text-[var(--v-text-muted)]">
                {selectedBroker.allowsTrading ? 'Trading enabled' : 'Import only'}
                {isPaper && ' · Paper account'}
              </p>
            </div>
          </div>

          {/* Mode warning banner */}
          <div
            className={`rounded-xl p-3.5 text-sm flex items-start gap-2.5 ${
              isPaper
                ? 'bg-[var(--v-view-only-bg)] border border-[var(--v-admin-border)] text-[var(--v-view-only-text)]'
                : 'bg-[var(--v-accent-dim)] border border-[var(--v-accent)] text-[var(--v-accent-label)]'
            }`}
          >
            <Shield className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <strong className="font-semibold">
                {isPaper ? 'Paper Trading Mode' : 'Live Broker Connection'}
              </strong>
              <p className="mt-0.5 text-[var(--v-text-secondary)]">
                {isPaper
                  ? 'No real money is used. Orders are simulated. Perfect for testing strategies.'
                  : 'This connects to a real brokerage account. Orders will execute with real money.'}
              </p>
            </div>
          </div>

          {/* Non-trading warning */}
          {!selectedBroker.allowsTrading && (
            <div className="rounded-xl p-3.5 text-sm flex items-start gap-2.5 bg-[var(--v-canvas)] border border-[var(--v-card-border)]">
              <Lock className="h-4 w-4 mt-0.5 shrink-0 text-[var(--v-text-faint)]" />
              <p className="text-[var(--v-text-muted)]">
                This broker is <strong className="text-[var(--v-text-primary)]">read-only</strong>. You can view
                your portfolio and holdings, but AI-driven trading and order placement are
                not available through this connection.
              </p>
            </div>
          )}

          {/* Description */}
          {selectedBroker.description && (
            <p className="text-sm text-[var(--v-text-secondary)] leading-relaxed">
              {selectedBroker.description}
            </p>
          )}

          {/* Connection details */}
          <div className="text-xs text-[var(--v-text-muted)] space-y-2 bg-[var(--v-canvas)] rounded-xl p-3.5">
            <div className="flex justify-between">
              <span>Authentication</span>
              <span className="text-[var(--v-text-secondary)] font-mono">
                {selectedBroker.authTypes?.map((a: { authType: string }) => a.authType).join(' / ') || 'OAuth'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Connection type</span>
              <span className="text-[var(--v-gain-label)] font-mono">
                trade-if-available
              </span>
            </div>
            {selectedBroker.allowsFractionalUnits != null && (
              <div className="flex justify-between">
                <span>Fractional shares</span>
                <span className="text-[var(--v-text-secondary)]">
                  {selectedBroker.allowsFractionalUnits ? 'Supported' : 'Not supported'}
                </span>
              </div>
            )}
            {selectedBroker.allowsCrypto && (
              <div className="flex justify-between">
                <span>Crypto</span>
                <span className="text-[var(--v-warn)]">Available</span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              onClick={handleCancel}
              className="flex-1 py-2.5 px-4 rounded-xl border border-[var(--v-card-border)] text-sm font-medium text-[var(--v-text-secondary)] hover:text-[var(--v-text-primary)] hover:bg-[var(--v-disabled-bg)] transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              className="flex-1 py-2.5 px-4 rounded-xl bg-[var(--v-accent-button)] border border-[var(--v-accent)] text-sm font-medium text-[var(--v-accent-text)] hover:opacity-90 transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
            >
              <ArrowLeftRight className="h-4 w-4" />
              Connect
            </button>
          </div>

          <p className="text-xs text-center text-[var(--v-text-faint)]">
            You&apos;ll be redirected to {selectedBroker.displayName} to authorize access.
            Your credentials are never stored by Vantage.
          </p>
        </div>
      </div>
    );
  }

  // ── Connecting / Error state ──
  if (phase === 'connecting' || phase === 'error') {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-5">
        <div className="relative">
          <div className="absolute inset-0 rounded-2xl bg-[var(--v-glow)] animate-pulse" />
          <div className="relative w-14 h-14 rounded-2xl bg-[var(--v-badge-gain-bg)] border border-[var(--v-card-border)] flex items-center justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-[var(--v-gain-label)]" />
          </div>
        </div>
        <div className="text-center space-y-1">
          <p className="font-medium text-[var(--v-text-primary)]">
            Connecting to {selectedBroker?.displayName}…
          </p>
          <p className="text-sm text-[var(--v-text-muted)]">
            You&apos;ll be redirected to complete authorization.
          </p>
        </div>
        {connectError && (
          <div className="w-full max-w-sm rounded-xl p-4 bg-[var(--v-loss-dim)] border border-[var(--v-loss)]">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-[var(--v-loss-label)]" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-[var(--v-loss-label)] break-words">{connectError}</p>
                <button
                  onClick={() => {
                    setConnectError(null);
                    if (selectedBroker) startConnection(selectedBroker);
                  }}
                  className="mt-2 text-xs text-[var(--v-loss-label)] underline hover:opacity-80"
                >
                  Try again
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Main broker grid ──
  return (
    <div className="space-y-8 pb-4">
      {/* Navigation header */}
      <button
        onClick={onCancel}
        className="inline-flex items-center gap-2 text-sm text-[var(--v-text-faint)] hover:text-[var(--v-text-secondary)] transition-colors group"
      >
        <ExternalLink className="h-4 w-4 rotate-180 group-hover:-translate-x-0.5 transition-transform" strokeWidth={1.5} />
        <span>Back to connections</span>
      </button>

      {/* Trading section */}
      <section>
        {/* Section header */}
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-1 h-5 rounded-full bg-[var(--v-gain)]" />
          <h3 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--v-text-secondary)]">
            Trading Enabled
          </h3>
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[var(--v-badge-gain-bg)] border border-[var(--v-card-border)] text-[var(--v-gain-label)]">
            {tradingBrokers.length}
          </span>
        </div>

        {tradingBrokers.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--v-card-border)] bg-transparent p-8 text-center">
            <p className="text-sm text-[var(--v-text-muted)]">
              No trading-enabled brokers available on your plan.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {tradingBrokers.map((broker) => (
              <BrokerCard
                key={broker.slug}
                broker={broker}
                onClick={() => handleBrokerClick(broker)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Portfolio import — coming soon note */}
      <div className="rounded-2xl border border-dashed border-[var(--v-card-border)] bg-transparent p-5 text-center">
        <div className="inline-flex items-center gap-1.5 text-xs text-[var(--v-text-faint)] mb-1">
          <Sparkles className="h-3 w-3" />
          <span className="uppercase tracking-[0.08em] font-semibold">Coming Soon</span>
        </div>
        <p className="text-sm text-[var(--v-text-muted)]">
          Portfolio import from Fidelity, Robinhood, Schwab, Vanguard, and more.
        </p>
      </div>
    </div>
  );
}

// ─── Broker Card ──────────────────────────────────────────────

function BrokerCard({
  broker,
  onClick,
  readOnly = false,
}: {
  broker: BrokerInfo;
  onClick: () => void;
  readOnly?: boolean;
}) {
  const [pressed, setPressed] = useState(false);
  const isPaper =
    broker.slug.toUpperCase().includes('PAPER') ||
    broker.slug.toUpperCase().includes('PRACTICE');
  const isBeta = broker.releaseStage === 'BETA';

  return (
    <button
      onClick={onClick}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      onTouchStart={() => setPressed(true)}
      onTouchEnd={() => setPressed(false)}
      className="text-left w-full rounded-xl border border-[var(--v-card-border)] bg-[var(--v-card)] hover:border-[var(--v-accent)] transition-all p-4 flex items-center gap-3.5 group active:scale-[0.985]"
      style={{
        transform: pressed ? 'scale(0.985)' : 'scale(1)',
        transition: 'all 200ms cubic-bezier(0.22, 1, 0.36, 1)',
      }}
    >
      {/* Logo */}
      {broker.logoUrl ? (
        <div className="h-10 w-10 rounded-lg bg-white border border-[var(--v-card-border)] p-1 shrink-0 flex items-center justify-center">
          <img
            src={broker.logoUrl}
            alt={broker.displayName}
            className="h-full w-full object-contain"
          />
        </div>
      ) : (
        <div className="h-10 w-10 rounded-lg bg-[var(--v-disabled-bg)] flex items-center justify-center text-base font-semibold shrink-0 text-[var(--v-text-faint)] group-hover:text-[var(--v-text-secondary)] transition-all">
          {broker.displayName.charAt(0)}
        </div>
      )}

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm truncate text-[var(--v-text-primary)]">
            {broker.displayName}
          </span>
          {isPaper && (
            <span className="text-[10px] font-semibold px-1.5 py-px rounded-md bg-[var(--v-view-only-bg)] border border-[var(--v-admin-border)] text-[var(--v-view-only-text)] shrink-0 uppercase tracking-wide">
              Paper
            </span>
          )}
          {isBeta && !isPaper && (
            <span className="text-[10px] font-semibold px-1.5 py-px rounded-md bg-[var(--v-accent-dim)] border border-[var(--v-accent)] text-[var(--v-accent-label)] shrink-0 uppercase tracking-wide">
              Beta
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-1">
          {readOnly ? (
            <span className="text-[11px] text-[var(--v-text-faint)] flex items-center gap-1">
              <Lock className="h-3 w-3" />
              Import only
            </span>
          ) : (
            <span className="text-[11px] text-[var(--v-gain-label)] flex items-center gap-1 font-medium">
              Trading
            </span>
          )}
          {broker.allowsFractionalUnits && (
            <span className="text-[10px] text-[var(--v-text-faint)]">· Fractional</span>
          )}
        </div>
      </div>

      <div className="shrink-0 w-6 h-6 rounded-full bg-[var(--v-disabled-bg)] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
        <ExternalLink className="h-3 w-3 text-[var(--v-text-faint)]" />
      </div>
    </button>
  );
}
