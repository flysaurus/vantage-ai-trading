'use client';

// ─── Broker Select Screen ────────────────────────────────────
// Displays available brokers grouped by trading capability.
//
// Features:
//   - Fetches broker list from /api/connections/snaptrade-brokerages
//   - Visually distinguishes trading-enabled vs read-only brokers
//   - Safety confirmation before initiating connection
//   - Loading/success/error states for the connection flow
//   - Explicit mode labeling (Paper/Real/Demo)

import { useState, useEffect, useCallback } from 'react';
import { Loader2, CheckCircle2, AlertCircle, ArrowLeftRight, Shield, Lock, ExternalLink } from 'lucide-react';

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
  /** Called when user redirects to the SnapTrade portal */
  onRedirect?: (broker: BrokerInfo) => void;
  /** Called when user cancels */
  onCancel?: () => void;
  /** Show only trading brokers (default: true — per Phase 1 scope) */
  tradingOnly?: boolean;
}

type ConnectPhase = 'idle' | 'confirming' | 'connecting' | 'error';

// ─── Known Broker Metadata ────────────────────────────────────

/** Fallback broker metadata if SnapTrade API is unreachable. */
const FALLBACK_BROKERS: Record<string, Partial<BrokerInfo>> = {
  'ALPACA-PAPER': {
    displayName: 'Alpaca Paper',
    description: 'Paper trading with real-time market data. Test strategies risk-free.',
    allowsTrading: true,
    allowsCrypto: true,
  },
  'TASTYTRADE': {
    displayName: 'tastytrade',
    description: 'Advanced options and futures trading platform.',
    allowsTrading: true,
    allowsCrypto: true,
  },
  'ETRADE': {
    displayName: 'E*TRADE',
    description: 'Full-service brokerage with stocks, ETFs, options, and mutual funds.',
    allowsTrading: true,
  },
  'WEBULL': {
    displayName: 'Webull',
    description: 'Commission-free trading with advanced charting tools.',
    allowsTrading: true,
    allowsCrypto: true,
  },
  'COINBASE': {
    displayName: 'Coinbase',
    description: 'Cryptocurrency exchange and wallet.',
    allowsTrading: true,
    allowsCrypto: true,
  },
  'FIDELITY': {
    displayName: 'Fidelity',
    description: 'Portfolio import only — view holdings and performance.',
    allowsTrading: false,
  },
  'ROBINHOOD': {
    displayName: 'Robinhood',
    description: 'Portfolio import only — view holdings and performance.',
    allowsTrading: false,
  },
};

// ─── Helper ───────────────────────────────────────────────────

function getFallbackDetails(slug: string): Partial<BrokerInfo> | undefined {
  return FALLBACK_BROKERS[slug.toUpperCase()];
}

function formatBrokerSlug(slug: string): string {
  const fallback = getFallbackDetails(slug);
  if (fallback?.displayName) return fallback.displayName;
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

  // ── Load brokers ──
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
        setTradingBrokers(data.trading || []);
        setReadOnlyBrokers(data.readOnly || []);
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

  // ── Start connection ──
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

      // Notify parent, then redirect
      onRedirect?.(broker);
      window.location.href = data.redirectUrl;
    } catch (err) {
      setPhase('error');
      setConnectError(
        err instanceof Error ? err.message : 'Connection failed. Please try again.',
      );
    }
  }, [onRedirect]);

  // ── Safety confirmation step ──
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
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-3 text-muted-foreground">Loading available brokers…</span>
      </div>
    );
  }

  // ── Error state ──
  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="text-destructive font-medium">{loadError}</p>
        <button
          onClick={() => window.location.reload()}
          className="text-sm text-muted-foreground underline hover:text-foreground"
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
    const isCrypto = selectedBroker.allowsCrypto;

    return (
      <div className="max-w-md mx-auto py-8 px-4">
        <div className="rounded-xl border border-border bg-card p-6 space-y-5">
          {/* Broker header */}
          <div className="flex items-center gap-3">
            {selectedBroker.logoUrl ? (
              <img
                src={selectedBroker.logoUrl}
                alt={selectedBroker.displayName}
                className="h-10 w-10 rounded-lg object-contain bg-white p-0.5"
              />
            ) : (
              <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center text-lg font-bold">
                {selectedBroker.displayName.charAt(0)}
              </div>
            )}
            <div>
              <h3 className="font-semibold text-lg">{selectedBroker.displayName}</h3>
              <p className="text-sm text-muted-foreground">
                {selectedBroker.allowsTrading ? 'Trading enabled' : 'Read-only import'}
                {isPaper && ' · Paper account'}
              </p>
            </div>
          </div>

          {/* Mode warning banner */}
          <div className={`rounded-lg p-3 text-sm flex items-start gap-2 ${
            isPaper
              ? 'bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200'
              : 'bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-200'
          }`}>
            <Shield className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <strong className="font-semibold">
                {isPaper ? 'Paper Trading Mode' : 'Live Broker Connection'}
              </strong>
              <p className="mt-0.5">
                {isPaper
                  ? 'No real money is used. Orders are simulated. Perfect for testing strategies.'
                  : 'This connects to a real brokerage account. Orders will execute with real money.'}
              </p>
            </div>
          </div>

          {/* Non-trading warning */}
          {!selectedBroker.allowsTrading && (
            <div className="rounded-lg p-3 text-sm flex items-start gap-2 bg-muted border">
              <Lock className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
              <p className="text-muted-foreground">
                This broker is <strong>read-only</strong>. You can view your portfolio and
                holdings, but AI-driven trading and order placement are not available
                through this connection.
              </p>
            </div>
          )}

          {/* Description */}
          {selectedBroker.description && (
            <p className="text-sm text-muted-foreground">
              {selectedBroker.description}
            </p>
          )}

          {/* Connection details */}
          <div className="text-xs text-muted-foreground space-y-1 bg-muted/50 rounded-lg p-3">
            <div className="flex justify-between">
              <span>Authentication</span>
              <span className="font-mono">
                {selectedBroker.authTypes.map((a) => a.authType).join(' / ') || 'OAuth'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Connection type</span>
              <span className="font-mono text-green-600 dark:text-green-400">
                trade-if-available
              </span>
            </div>
            {selectedBroker.allowsFractionalUnits != null && (
              <div className="flex justify-between">
                <span>Fractional shares</span>
                <span>{selectedBroker.allowsFractionalUnits ? '✅' : '❌'}</span>
              </div>
            )}
            {isCrypto && (
              <div className="flex justify-between">
                <span>Crypto</span>
                <span className="text-amber-600 dark:text-amber-400">
                  Available
                </span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleCancel}
              className="flex-1 py-2.5 px-4 rounded-lg border border-border text-sm font-medium hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              className="flex-1 py-2.5 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
            >
              <ArrowLeftRight className="h-4 w-4" />
              Connect
            </button>
          </div>

          <p className="text-xs text-center text-muted-foreground">
            You&apos;ll be redirected to {selectedBroker.displayName} to authorize access.
            Your credentials are never stored by Vantage.
          </p>
        </div>
      </div>
    );
  }

  // ── Connecting state ──
  if (phase === 'connecting') {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="font-medium">Connecting to {selectedBroker?.displayName}…</p>
        <p className="text-sm text-muted-foreground">
          You&apos;ll be redirected to complete authorization.
        </p>
        {connectError && (
          <div className="rounded-lg p-3 bg-destructive/10 border border-destructive/20 text-destructive text-sm max-w-sm">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{connectError}</span>
            </div>
            <button
              onClick={handleCancel}
              className="mt-2 text-xs underline hover:no-underline"
            >
              Go back
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Main broker grid ──
  return (
    <div className="space-y-6">
      {/* Trading-enabled section */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Trading Enabled
          </h3>
          <span className="text-xs px-1.5 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
            {tradingBrokers.length}
          </span>
        </div>

        {tradingBrokers.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No trading-enabled brokers available on your plan.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
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

      {/* Read-only section — only show if explicitly enabled */}
      {!tradingOnly && readOnlyBrokers.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Portfolio Import Only
            </h3>
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
              {readOnlyBrokers.length}
            </span>
          </div>

          <p className="text-xs text-muted-foreground mb-3">
            These connections are read-only. You can view holdings and performance,
            but AI-driven trading and order placement are not available.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 opacity-60">
            {readOnlyBrokers.map((broker) => (
              <BrokerCard
                key={broker.slug}
                broker={broker}
                onClick={() => handleBrokerClick(broker)}
                readOnly
              />
            ))}
          </div>
        </section>
      )}

      {/* Cancel */}
      {onCancel && (
        <div className="flex justify-center pt-4">
          <button
            onClick={onCancel}
            className="text-sm text-muted-foreground underline hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      )}
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
  const isPaper =
    broker.slug.toUpperCase().includes('PAPER') ||
    broker.slug.toUpperCase().includes('PRACTICE');

  return (
    <button
      onClick={onClick}
      className="text-left rounded-xl border border-border bg-card hover:bg-accent/50 hover:border-accent-foreground/20 transition-all p-4 flex items-center gap-3 group"
    >
      {/* Logo */}
      {broker.logoUrl ? (
        <img
          src={broker.logoUrl}
          alt={broker.displayName}
          className="h-10 w-10 rounded-lg object-contain bg-white p-0.5 shrink-0"
        />
      ) : (
        <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center text-lg font-bold shrink-0 group-hover:bg-background transition-colors">
          {broker.displayName.charAt(0)}
        </div>
      )}

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{broker.displayName}</span>
          {isPaper && (
            <span className="text-[10px] px-1 py-px rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-medium shrink-0">
              PAPER
            </span>
          )}
          {broker.releaseStage === 'BETA' && (
            <span className="text-[10px] px-1 py-px rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium shrink-0">
              BETA
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {readOnly ? (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Lock className="h-3 w-3" />
              Read-only import
            </span>
          ) : (
            <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" />
              Trading available
            </span>
          )}
        </div>
      </div>

      <ExternalLink className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
    </button>
  );
}
