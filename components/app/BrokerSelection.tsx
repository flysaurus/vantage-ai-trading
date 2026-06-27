'use client';

// ─── Broker Selection / Demo Activation Screen ──────────────
// Shown after first login/signup when demo hasn't been started.
// Bold visual language matching the onboarding flow.
// Hero + demo features + "Start 30-day demo" CTA + coming soon broker cards.

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle, ChevronRight, Loader2, TrendingUp, Zap } from 'lucide-react';
import { VantageOrb } from '@/components/brand/VantageOrb';

export function BrokerSelection() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleStartDemo = async () => {
    setLoading(true);
    setError('');

    try {
      // Clear any stale localStorage demo state
      if (typeof window !== 'undefined') {
        try { localStorage.removeItem('vantage_demo_state_v3'); } catch {}
      }

      const res = await fetch('/api/demo/start', {
        method: 'POST',
        credentials: 'include',
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || 'Failed to start demo. Try again.');
        setLoading(false);
        return;
      }

      router.push('/');
      router.refresh();
    } catch {
      setError('Network error. Check your connection.');
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100dvh',
      background: `
        radial-gradient(ellipse 200% 70% at 50% -10%, rgba(34,211,238,0.50) 0%, rgba(14,116,144,0.30) 35%, transparent 65%),
        radial-gradient(ellipse 100% 60% at 85% 100%, rgba(99,102,241,0.20) 0%, transparent 70%),
        #0a0f1e
      `,
      display: 'flex',
      flexDirection: 'column',
      overflowY: 'auto',
    }}>
      {/* ── Orb Hero ── */}
      <div style={{
        marginTop: 52,
        display: 'flex',
        justifyContent: 'center',
        flexShrink: 0,
      }}>
        <VantageOrb size={180} animate showEntrance />
      </div>

      {/* ── Headline ── */}
      <div style={{ marginTop: 28, textAlign: 'center', padding: '0 28px' }}>
        <div style={{
          fontFamily: 'var(--font-sans)',
          fontWeight: 900,
          fontSize: 52,
          letterSpacing: '-0.01em',
          color: '#fff',
          lineHeight: 1,
        }}>
          YOU&apos;RE IN.
        </div>

        <div style={{
          fontFamily: 'var(--font-serif)',
          fontStyle: 'italic',
          fontWeight: 400,
          fontSize: 22,
          color: 'rgba(255,255,255,0.70)',
          marginTop: 8,
        }}>
          Your 30-day investing sandbox is ready.
        </div>
      </div>

      {/* ── Description ── */}
      <p style={{
        marginTop: 16,
        textAlign: 'center',
        maxWidth: 320,
        marginLeft: 'auto',
        marginRight: 'auto',
        fontFamily: 'var(--font-sans)',
        fontWeight: 400,
        fontSize: 16,
        color: 'rgba(255,255,255,0.60)',
        lineHeight: 1.6,
        padding: '0 28px',
      }}>
        Real market prices. Real AI analysis. Paper trades — no real money at risk.
      </p>

      {/* ── Features ── */}
      <div style={{
        marginTop: 20,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        padding: '0 28px',
      }}>
        {[
          '$100,000 simulated portfolio',
          'Live market data + AI advisor',
          'Strategy baskets + paper trading',
        ].map((text) => (
          <div key={text} style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}>
            <CheckCircle size={18} color="var(--gain)" />
            <span style={{
              fontFamily: 'var(--font-sans)',
              fontWeight: 600,
              fontSize: 15,
              color: '#fff',
            }}>
              {text}
            </span>
          </div>
        ))}
      </div>

      {/* Error Banner */}
      {error && (
        <div style={{
          margin: '16px 28px 0',
          padding: '10px 14px',
          background: 'rgba(239,68,68,0.12)',
          border: '1px solid rgba(239,68,68,0.30)',
          borderRadius: 12,
          fontFamily: 'var(--font-sans)',
          fontSize: 13,
          color: 'var(--danger)',
        }}>
          {error}
        </div>
      )}

      {/* Primary CTA */}
      <div style={{ padding: '0 28px', marginTop: 28 }}>
        <button
          onClick={handleStartDemo}
          disabled={loading}
          style={{
            height: 58,
            width: '100%',
            background: '#fff',
            color: '#000',
            fontFamily: 'var(--font-sans)',
            fontWeight: 700,
            fontSize: 17,
            border: 'none',
            borderRadius: 999,
            cursor: loading ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            opacity: loading ? 0.8 : 1,
          }}
        >
          {loading ? (
            <>
              <Loader2 size={20} style={{ animation: 'spin 0.8s linear infinite' }} />
              Starting demo…
            </>
          ) : (
            'Start my 30-day demo →'
          )}
        </button>

        <div style={{
          fontFamily: 'var(--font-sans)',
          fontWeight: 400,
          fontSize: 13,
          color: 'rgba(255,255,255,0.35)',
          textAlign: 'center',
          marginTop: 10,
        }}>
          No credit card required.
        </div>
      </div>

      {/* Divider */}
      <div style={{
        marginTop: 36,
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div style={{
          position: 'absolute',
          width: '100%',
          height: 1,
          background: 'rgba(255,255,255,0.08)',
        }} />
        <span style={{
          position: 'relative',
          fontFamily: 'var(--font-sans)',
          fontWeight: 500,
          fontSize: 13,
          color: 'rgba(255,255,255,0.40)',
          background: '#0a0f1e',
          padding: '0 16px',
        }}>
          Connect your real portfolio later
        </span>
      </div>

      {/* Coming Soon Broker Cards */}
      <div style={{
        marginTop: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '0 0 40px',
      }}>
        {[
          {
            icon: '🔗',
            title: 'Connect your broker',
            subtitle: 'Fidelity, Schwab, Robinhood + 20 more',
            featureTag: 'Read-only portfolio analysis',
          },
          {
            icon: <TrendingUp size={22} color="rgba(255,255,255,0.50)" />,
            title: 'Trade with Alpaca',
            subtitle: 'Paper & live trading via API keys',
            featureTag: 'Full trade execution',
          },
          {
            icon: <Zap size={22} color="rgba(255,255,255,0.50)" />,
            title: 'Trade with Tastytrade',
            subtitle: 'Options & futures trading',
            featureTag: 'Full trade execution',
          },
        ].map((card, i) => (
          <div key={i} style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 20,
            padding: '16px 18px',
            opacity: 0.7,
            display: 'flex',
            alignItems: 'center',
          }}>
            {/* Left Icon */}
            <div style={{
              width: 44,
              height: 44,
              background: 'rgba(255,255,255,0.06)',
              borderRadius: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}>
              {typeof card.icon === 'string' ? (
                <span style={{ fontSize: 20 }}>{card.icon}</span>
              ) : (
                card.icon
              )}
            </div>

            {/* Center Content */}
            <div style={{ flex: 1, margin: '0 14px', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                <span style={{
                  fontFamily: 'var(--font-sans)',
                  fontWeight: 600,
                  fontSize: 16,
                  color: '#fff',
                }}>
                  {card.title}
                </span>
                <span style={{
                  fontFamily: 'var(--font-sans)',
                  fontWeight: 600,
                  fontSize: 10,
                  letterSpacing: '0.08em',
                  color: 'var(--warning)',
                  background: 'rgba(245,158,11,0.15)',
                  border: '1px solid rgba(245,158,11,0.35)',
                  padding: '3px 8px',
                  borderRadius: 999,
                }}>
                  COMING SOON
                </span>
              </div>

              <div style={{
                fontFamily: 'var(--font-sans)',
                fontWeight: 400,
                fontSize: 13,
                color: 'rgba(255,255,255,0.45)',
                marginTop: 3,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {card.subtitle}
              </div>

              <div style={{
                fontFamily: 'var(--font-sans)',
                fontWeight: 400,
                fontSize: 12,
                color: 'rgba(34,211,238,0.60)',
                marginTop: 4,
              }}>
                {card.featureTag}
              </div>
            </div>

            {/* Right Arrow */}
            <ChevronRight size={18} color="rgba(255,255,255,0.20)" />
          </div>
        ))}
      </div>

      {/* Bottom Note */}
      <div style={{
        marginTop: 0,
        marginBottom: 32,
        textAlign: 'center',
        padding: '0 28px',
      }}>
        <span style={{
          fontFamily: 'var(--font-sans)',
          fontWeight: 400,
          fontSize: 13,
          color: 'rgba(255,255,255,0.30)',
        }}>
          You can connect a real broker anytime from Settings.
        </span>
      </div>
    </div>
  );
}
