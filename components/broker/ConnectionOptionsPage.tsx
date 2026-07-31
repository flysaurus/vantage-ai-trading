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
    <div className="max-w-3xl mx-auto w-full">
      {/* Header */}
      <div className="px-4 pt-6 pb-2">
        <button
          onClick={onStateChanged}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>
        <h2 className="text-xl font-bold tracking-tight">
          Connect your broker
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Choose a brokerage to enable AI-driven trading. Your credentials are never stored — authentication is handled securely by your broker.
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
          {error}
        </div>
      )}

      {/* Live broker selection grid */}
      <div className="p-4">
        <BrokerSelectScreen
          onCancel={onStateChanged}
          tradingOnly={true}
        />
      </div>

      {/* Demo fallback */}
      <div className="px-4 pb-8 pt-2 border-t border-border mt-4">
        <p className="text-xs text-muted-foreground text-center mb-3">
          Not ready to connect a live broker?
        </p>
        <button
          onClick={handleDemoStart}
          disabled={demoLoading}
          className="w-full py-2.5 rounded-lg bg-muted hover:bg-accent text-sm font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
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
