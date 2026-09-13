// ─── ConnectionOptionsPage ────────────────────────────────────
// Broker connection screen with live SnapTrade integration.
// Renders the BrokerSelectScreen with a demo fallback option.

'use client';

import { useState } from 'react';
import { ChevronLeft, Loader2 } from 'lucide-react';
import BrokerSelectScreen from '@/components/connections/BrokerSelectScreen';

export function ConnectionOptionsPage({
  onStateChanged,
  onDemoStart,
}: {
  onStateChanged: () => void;
  onDemoStart?: () => void;
}) {
  const [demoLoading, setDemoLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDemoStart = () => {
    setDemoLoading(true);
    setError(null);
    if (onDemoStart) {
      onDemoStart();
    } else {
      onStateChanged();
    }
  };

  return (
    <div className="broker-shell max-w-2xl mx-auto w-full min-h-[100dvh] bg-[var(--v-canvas)]">
      {/* Header */}
      <div className="px-4 pt-6 pb-2">
        <button
          onClick={onStateChanged}
          className="inline-flex items-center gap-1 text-sm text-[var(--v-text-faint)] hover:text-[var(--v-text-secondary)] transition-colors mb-5"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>
        <h2 className="text-2xl font-bold tracking-tight text-[var(--v-text-primary)]">
          Connect your broker
        </h2>
        <p className="text-sm text-[var(--v-text-secondary)] mt-1.5 leading-relaxed">
          Choose a brokerage to enable AI-driven trading, or connect for portfolio analysis. Your credentials are never stored — authentication is handled securely by your broker.
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-4 p-3 rounded-xl bg-[var(--v-loss-dim)] border border-[var(--v-loss)] text-[var(--v-loss-label)] text-sm">
          {error}
        </div>
      )}

      {/* Live broker selection grid */}
      <div className="px-4 py-4">
        <BrokerSelectScreen
          onCancel={onStateChanged}
          tradingOnly={true}
        />
      </div>

      {/* Demo fallback */}
      <div className="px-4 pb-8 pt-3 mt-2 border-t border-[var(--v-card-border)]">
        <p className="text-xs text-[var(--v-text-faint)] text-center mb-3">
          Not ready to connect a live broker?
        </p>
        <button
          onClick={handleDemoStart}
          disabled={demoLoading}
          className="w-full py-2.5 rounded-xl bg-[var(--v-card)] border border-[var(--v-card-border)] hover:bg-[var(--v-disabled-bg)] hover:border-[var(--v-accent)] text-sm font-medium text-[var(--v-text-secondary)] transition-all flex items-center justify-center gap-2 disabled:opacity-40"
        >
          {demoLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : null}
          Start with demo instead
        </button>
      </div>
    </div>
  );
}
