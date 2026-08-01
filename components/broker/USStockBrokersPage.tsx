// ─── USStockBrokersPage ────────────────────────────────────
// Shown after user taps "Connect your broker" (Snaptrade)
// on ConnectionOptionsPage. Lists individual US stock brokers
// available through SnapTrade (Fidelity, Robinhood, Schwab, Vanguard).
//
// Has a "Back to connections" link that navigates back to
// the Broker Connections / ConnectionOptionsPage screen.
//
// Tapping a broker: POSTs to /api/connections/snaptrade/init
// to get a SnapTrade OAuth redirect URL.

'use client';

import { useState, useCallback } from 'react';
import { ChevronLeft, Link, Loader2, ExternalLink } from 'lucide-react';
import { VantageOrb } from '@/components/brand/VantageOrb';

// ── Types ───────────────────────────────────────────────────

interface USStockBrokersPageProps {
  onBack: () => void;
  onConnectionInitiated: (brokerId: string) => void;
}

interface BrokerItem {
  id: string;
  name: string;
  logo: string;
  subtitle: string;
  tradingEnabled: boolean; // from SnapTrade — most are read-only
  popular?: boolean;
}

// ── US Stock Broker list ────────────────────────────────────

const US_BROKERS: BrokerItem[] = [
  {
    id: 'fidelity',
    name: 'Fidelity',
    logo: '🏦',
    subtitle: 'Investments, retirement, wealth management',
    tradingEnabled: false,
    popular: true,
  },
  {
    id: 'robinhood',
    name: 'Robinhood',
    logo: '🌿',
    subtitle: 'Commission-free stocks, ETFs, crypto',
    tradingEnabled: false,
    popular: true,
  },
  {
    id: 'schwab',
    name: 'Charles Schwab',
    logo: '📊',
    subtitle: 'Full-service brokerage and banking',
    tradingEnabled: false,
    popular: true,
  },
  {
    id: 'vanguard',
    name: 'Vanguard',
    logo: '🚢',
    subtitle: 'Low-cost index funds and ETFs',
    tradingEnabled: false,
    popular: true,
  },
  {
    id: 'etrade',
    name: 'E*TRADE',
    logo: '📈',
    subtitle: 'Stocks, options, futures trading',
    tradingEnabled: false,
  },
  {
    id: 'tdameritrade',
    name: 'TD Ameritrade',
    logo: '📋',
    subtitle: 'Thinkorswim platform, education tools',
    tradingEnabled: false,
  },
  {
    id: 'webull',
    name: 'Webull',
    logo: '📱',
    subtitle: 'Mobile-first trading with advanced charts',
    tradingEnabled: false,
  },
  {
    id: 'coinbase',
    name: 'Coinbase',
    logo: '₿',
    subtitle: 'Crypto exchange and wallet',
    tradingEnabled: false,
  },
];

// ── Component ──────────────────────────────────────────────

export function USStockBrokersPage({
  onBack,
  onConnectionInitiated,
}: USStockBrokersPageProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState('');

  const handleConnect = useCallback(
    async (broker: BrokerItem) => {
      setLoading(broker.id);
      setError('');

      try {
        const res = await fetch('/api/connections/snaptrade/init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ broker_id: broker.id }),
        });

        const data = await res.json();

        if (!res.ok) {
          setError(data.error || 'Failed to initiate connection');
          setLoading(null);
          return;
        }

        if (data.success && data.redirect_url) {
          // Notify parent that connection was initiated
          onConnectionInitiated(broker.id);

          // Redirect user to SnapTrade OAuth
          window.location.href = data.redirect_url;
        } else {
          setError('No redirect URL received. Please try again.');
          setLoading(null);
        }
      } catch {
        setError('Network error. Check your connection.');
        setLoading(null);
      }
    },
    [onConnectionInitiated],
  );

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
      {/* ═══ TOP BAR ═══ */}
      <div
        style={{
          height: '56px',
          display: 'flex',
          alignItems: 'center',
          padding: '0 20px',
          position: 'relative',
          flexShrink: 0,
          paddingTop: 'env(safe-area-inset-top, 0px)',
        }}
      >
        {/* Left: Back to connections */}
        <button
          onClick={onBack}
          disabled={loading !== null}
          style={{
            background: 'none',
            border: 'none',
            color: 'rgba(255,255,255,0.70)',
            fontSize: '14px',
            fontWeight: 400,
            fontFamily: 'var(--font-sans)',
            cursor: loading ? 'default' : 'pointer',
            padding: '8px 12px 8px 0',
            minHeight: '44px',
            display: 'flex',
            alignItems: 'center',
            gap: '2px',
            WebkitTapHighlightColor: 'transparent',
            opacity: loading ? 0.4 : 1,
          }}
          aria-label="Back to connections"
        >
          <ChevronLeft size={18} />
          Back to connections
        </button>

        {/* Center: VantageOrb */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            paddingTop: 'env(safe-area-inset-top, 0px)',
          }}
        >
          <VantageOrb size={44} animate showEntrance={false} />
        </div>
      </div>

      {/* ═══ HEADLINE ═══ */}
      <div style={{ padding: '28px 24px 0', flexShrink: 0, textAlign: 'center' }}>
        <h2 style={{ margin: 0 }}>
          <span
            style={{
              display: 'block',
              fontFamily: 'var(--font-sans)',
              fontSize: '32px',
              fontWeight: 800,
              color: 'var(--text-primary)',
              lineHeight: 1.15,
            }}
          >
            US Stock
          </span>
          <span
            style={{
              display: 'block',
              fontFamily: 'var(--font-serif)',
              fontSize: '32px',
              fontWeight: 400,
              fontStyle: 'italic',
              color: 'var(--text-primary)',
              lineHeight: 1.15,
            }}
          >
            Brokers
          </span>
        </h2>

        <p
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '14px',
            fontWeight: 400,
            color: 'rgba(255,255,255,0.55)',
            textAlign: 'center',
            margin: '12px 0 0',
            lineHeight: 1.5,
            maxWidth: '320px',
            marginLeft: 'auto',
            marginRight: 'auto',
          }}
        >
          Connect via SnapTrade to sync your portfolio.
          Your credentials are never stored.
        </p>
      </div>

      {/* ═══ BROKER LIST ═══ */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '20px 20px 0',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          scrollbarWidth: 'none',
        }}
        className="hide-scrollbar"
      >
        {/* Error banner */}
        {error && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: '12px',
              background: 'rgba(239,68,68,0.10)',
              border: '1px solid rgba(239,68,68,0.25)',
              color: 'var(--loss)',
              fontSize: '13px',
              fontFamily: 'var(--font-sans)',
              marginBottom: '4px',
            }}
          >
            {error}
          </div>
        )}

        {US_BROKERS.map((broker) => {
          const isLoading = loading === broker.id;
          const isOtherLoading = loading !== null && loading !== broker.id;

          return (
            <button
              key={broker.id}
              onClick={() => !isLoading && !isOtherLoading && handleConnect(broker)}
              disabled={isLoading || isOtherLoading}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
                padding: '16px',
                background: isLoading
                  ? 'rgba(255,255,255,0.06)'
                  : 'rgba(255,255,255,0.04)',
                border: '1px solid var(--border-card)',
                borderRadius: '16px',
                cursor: isLoading || isOtherLoading ? 'default' : 'pointer',
                transition: 'all 150ms var(--ease-out)',
                WebkitTapHighlightColor: 'transparent',
                fontFamily: 'var(--font-sans)',
                color: 'var(--text-primary)',
                textAlign: 'left',
                opacity: isOtherLoading ? 0.4 : 1,
                position: 'relative',
              }}
              onTouchStart={(e) => {
                if (!isLoading && !isOtherLoading) {
                  (e.currentTarget as HTMLElement).style.transform = 'scale(0.98)';
                }
              }}
              onTouchEnd={(e) => {
                (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
              }}
            >
              {/* Logo */}
              <span
                style={{
                  fontSize: '28px',
                  lineHeight: 1,
                  flexShrink: 0,
                  width: '44px',
                  textAlign: 'center',
                }}
              >
                {broker.logo}
              </span>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontSize: '16px',
                      fontWeight: 700,
                      color: 'var(--text-primary)',
                    }}
                  >
                    {broker.name}
                  </span>

                  {/* Popular badge */}
                  {broker.popular && (
                    <span
                      style={{
                        fontFamily: 'var(--font-sans)',
                        fontSize: '10px',
                        fontWeight: 600,
                        color: 'var(--accent)',
                        background: 'rgba(34,211,238,0.12)',
                        padding: '2px 7px',
                        borderRadius: '999px',
                        letterSpacing: '0.04em',
                      }}
                    >
                      Popular
                    </span>
                  )}

                  {/* Read-only badge */}
                  {!broker.tradingEnabled && (
                    <span
                      style={{
                        fontFamily: 'var(--font-sans)',
                        fontSize: '10px',
                        fontWeight: 600,
                        color: '#d4d4d8',
                        background: 'rgba(161,161,170,0.15)',
                        padding: '2px 7px',
                        borderRadius: '999px',
                        letterSpacing: '0.04em',
                      }}
                    >
                      View only
                    </span>
                  )}
                </div>

                <div
                  style={{
                    fontFamily: 'var(--font-sans)',
                    fontSize: '12px',
                    fontWeight: 400,
                    color: 'rgba(255,255,255,0.45)',
                    marginTop: '3px',
                    lineHeight: 1.4,
                  }}
                >
                  {broker.subtitle}
                </div>
              </div>

              {/* Right: loading spinner or external link icon */}
              {isLoading ? (
                <Loader2
                  size={18}
                  color="var(--accent)"
                  style={{
                    flexShrink: 0,
                    animation: 'spin 0.8s linear infinite',
                  }}
                />
              ) : (
                <ExternalLink
                  size={16}
                  color="rgba(255,255,255,0.25)"
                  style={{ flexShrink: 0 }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* ═══ BOTTOM NOTE ═══ */}
      <div
        style={{
          flexShrink: 0,
          padding: '16px 24px',
          paddingBottom: 'max(24px, env(safe-area-inset-bottom, 0px))',
          textAlign: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
          <Link size={14} color="rgba(255,255,255,0.35)" />
          <span
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '12px',
              fontWeight: 400,
              color: 'rgba(255,255,255,0.35)',
            }}
          >
            Secured by SnapTrade · We never see your broker credentials
          </span>
        </div>
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
