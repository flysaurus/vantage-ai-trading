'use client';

// ─── /broker-setup ───────────────────────────────────────────
// Broker connection management page.
//
// Two modes:
//   Default — show connected brokers + option to add new ones
//   Post-callback — display connection result (connected=true, error, etc.)
//
// Uses the BrokerSelectScreen component for new connections
// and displays existing connections with disconnect controls.

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useEffect, useCallback, Suspense } from 'react';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Trash2,
  ExternalLink,
  Shield,
  RefreshCw,
} from 'lucide-react';
import BrokerSelectScreen from '@/components/connections/BrokerSelectScreen';

// ─── Types ────────────────────────────────────────────────────

interface ConnectionView {
  id: string;
  connection_type: string;
  brokerage_slug: string | null;
  trading_enabled: boolean | null;
  status: string;
  accounts: Array<{
    id: string;
    number: string;
    name: string;
    type: string;
    currency: string;
    cash?: number;
    buyingPower?: number;
    totalValue?: number;
  }>;
  accountCount: number;
  created_at: string;
  last_synced: string | null;
  error: string | null;
}

// ─── Status Banner ────────────────────────────────────────────

function StatusBanner({
  connected,
  broker,
  trading,
  accounts,
  error,
}: {
  connected: string | null;
  broker: string | null;
  trading: string | null;
  accounts: string | null;
  error: string | null;
}) {
  const router = useRouter();

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 mb-8">
        <div className="flex items-start gap-3">
          <XCircle className="h-6 w-6 text-destructive shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h3 className="font-semibold text-destructive">Connection Failed</h3>
            <p className="text-sm text-muted-foreground">{decodeURIComponent(error)}</p>
          </div>
        </div>
        <button
          onClick={() => router.replace('/broker-setup')}
          className="mt-4 text-sm text-primary underline hover:no-underline"
        >
          Try again
        </button>
      </div>
    );
  }

  if (connected === 'true') {
    const isPaper =
      broker?.toUpperCase().includes('PAPER') ||
      broker?.toUpperCase().includes('PRACTICE');
    const brokerName = broker
      ? broker
          .split('-')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(' ')
      : 'Broker';

    return (
      <div className="rounded-xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/20 p-6 mb-8">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
          <div className="space-y-2 flex-1">
            <h3 className="font-semibold text-green-900 dark:text-green-100">
              Connected to {brokerName}
            </h3>
            <div className="flex flex-wrap gap-2">
              {trading === 'true' ? (
                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-200 dark:bg-green-900/60 text-green-800 dark:text-green-200">
                  <Shield className="h-3 w-3" />
                  Trading enabled
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                  Read-only import
                </span>
              )}
              {isPaper && (
                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-200 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200">
                  Paper account
                </span>
              )}
              {accounts && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                  {accounts} account{accounts !== '1' ? 's' : ''} linked
                </span>
              )}
            </div>
          </div>
        </div>
        <button
          onClick={() => router.replace('/broker-setup')}
          className="mt-4 text-sm text-primary underline hover:no-underline"
        >
          View connections
        </button>
      </div>
    );
  }

  return null;
}

// ─── Connection Card ──────────────────────────────────────────

function ConnectionCard({
  conn,
  onDisconnect,
  disconnecting,
}: {
  conn: ConnectionView;
  onDisconnect: (id: string) => void;
  disconnecting: string | null;
}) {
  const brokerName = conn.brokerage_slug
    ? conn.brokerage_slug
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ')
    : 'Unknown';

  const isPaper =
    conn.brokerage_slug?.toUpperCase().includes('PAPER') ||
    conn.brokerage_slug?.toUpperCase().includes('PRACTICE');

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{brokerName}</span>
          {isPaper && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-medium">
              PAPER
            </span>
          )}
          {conn.trading_enabled ? (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          ) : (
            <span className="text-xs text-muted-foreground">Read-only</span>
          )}
        </div>

        <button
          onClick={() => onDisconnect(conn.id)}
          disabled={disconnecting === conn.id}
          className="p-1.5 rounded-lg hover:bg-destructive/10 hover:text-destructive transition-colors disabled:opacity-50"
          title="Disconnect"
        >
          {disconnecting === conn.id ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
        </button>
      </div>

      {conn.accounts && conn.accounts.length > 0 && (
        <div className="space-y-1.5">
          {conn.accounts.map((acct) => (
            <div
              key={acct.id}
              className="flex items-center justify-between text-sm bg-muted/50 rounded-lg px-3 py-2"
            >
              <div>
                <span className="font-mono text-xs text-muted-foreground">
                  {acct.number?.substring(0, 4)}****
                </span>
                <span className="ml-2">{acct.name || acct.type}</span>
              </div>
              {acct.totalValue != null && (
                <span className="font-mono text-xs">
                  ${acct.totalValue.toLocaleString()}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span>
          Connected{' '}
          {new Date(conn.created_at).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })}
        </span>
        {conn.last_synced && (
          <span>
            Synced{' '}
            {new Date(conn.last_synced).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Main Page Content ────────────────────────────────────────

function BrokerSetupContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // URL state (post-callback)
  const connected = searchParams.get('connected');
  const broker = searchParams.get('broker');
  const trading = searchParams.get('trading');
  const accounts = searchParams.get('accounts');
  const error = searchParams.get('error');

  // Page state
  const [showSelector, setShowSelector] = useState(false);
  const [connections, setConnections] = useState<ConnectionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  // ── Load connections ──
  const loadConnections = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const res = await fetch('/api/connections');
      if (!res.ok) throw new Error('Failed to load connections');
      const data = await res.json();
      setConnections(data.connections || []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  // ── Disconnect ──
  const handleDisconnect = useCallback(
    async (id: string) => {
      if (!confirm('Disconnect this broker? This cannot be undone.')) return;

      setDisconnecting(id);
      setDisconnectError(null);

      try {
        const res = await fetch(`/api/connections/${id}`, { method: 'DELETE' });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Unknown error' }));
          throw new Error(err.error || 'Failed to disconnect');
        }
        // Remove from local state
        setConnections((prev) => prev.filter((c) => c.id !== id));
      } catch (err) {
        setDisconnectError(
          err instanceof Error ? err.message : 'Disconnect failed',
        );
      } finally {
        setDisconnecting(null);
      }
    },
    [],
  );

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Broker Connections</h1>
        <p className="text-muted-foreground mt-1">
          Connect your brokerage accounts to enable AI-driven trading and portfolio tracking.
        </p>
      </div>

      {/* Status banner (post-callback) */}
      <StatusBanner
        connected={connected}
        broker={broker}
        trading={trading}
        accounts={accounts}
        error={error}
      />

      {/* Error banners */}
      {loadError && (
        <div className="rounded-lg p-3 mb-6 bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p>{loadError}</p>
            <button
              onClick={loadConnections}
              className="mt-1 underline hover:no-underline"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {disconnectError && (
        <div className="rounded-lg p-3 mb-6 bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{disconnectError}</span>
        </div>
      )}

      {/* Existing connections */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-3 text-muted-foreground">Loading connections…</span>
        </div>
      ) : connections.length > 0 ? (
        <div className="space-y-4 mb-8">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Connected Accounts
            </h2>
            <button
              onClick={loadConnections}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <RefreshCw className="h-3 w-3" />
              Refresh
            </button>
          </div>
          {connections.map((conn) => (
            <ConnectionCard
              key={conn.id}
              conn={conn}
              onDisconnect={handleDisconnect}
              disconnecting={disconnecting}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-8 text-muted-foreground mb-8">
          No broker connections yet.
        </div>
      )}

      {/* Connect new broker */}
      {!showSelector ? (
        <div className="text-center">
          <button
            onClick={() => setShowSelector(true)}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-medium hover:opacity-90 transition-opacity"
          >
            <ExternalLink className="h-4 w-4" />
            Connect a Broker
          </button>
        </div>
      ) : (
        <div className="border-t border-border pt-6 mt-6">
          <BrokerSelectScreen
            onRedirect={() => {
              // User is being redirected to SnapTrade portal
              // Keep the selector visible (page might unmount anyway)
            }}
            onCancel={() => setShowSelector(false)}
            tradingOnly={true}
          />
        </div>
      )}
    </div>
  );
}

// ─── Page Export ──────────────────────────────────────────────

export default function BrokerSetupPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <BrokerSetupContent />
    </Suspense>
  );
}
