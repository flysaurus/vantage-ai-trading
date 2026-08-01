'use client';

// ─── Demo Expired Screen ────────────────────────────────────
// Shown when the 30-day demo period has elapsed.
// Placeholder for Phase 5 Stripe integration. For now shows
// broker connection options and an "Extend my demo" ghost CTA.

import React, { useState } from 'react';
import { ChevronRight, TrendingUp, Zap, X } from 'lucide-react';
import { VantageOrb } from '@/components/brand/VantageOrb';

export function DemoExpired() {
  const [showComingSoon, setShowComingSoon] = useState(false);

  return (
    <div style={{
      minHeight: '100dvh',
      background: `
        radial-gradient(ellipse 150% 60% at 50% -10%, rgba(239,68,68,0.18) 0%, rgba(153,27,27,0.10) 40%, transparent 65%),
        radial-gradient(ellipse 80% 50% at 90% 100%, rgba(99,102,241,0.15) 0%, transparent 70%),
        #0a0f1e
      `,
      display: 'flex',
      flexDirection: 'column',
      overflowY: 'auto',
    }}>
      {/* Top Bar */}
      <div style={{
        height: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}>
        <VantageOrb size={36} animate showEntrance={false} />
      </div>

      {/* Hero */}
      <div style={{ padding: '24px 28px 0' }}>
        <div style={{
          fontFamily: 'var(--font-sans)',
          fontWeight: 600,
          fontSize: 11,
          letterSpacing: '0.14em',
          color: 'var(--danger)',
          marginBottom: 10,
        }}>
          DEMO EXPIRED
        </div>

        <h1 style={{ margin: 0 }}>
          <div style={{
            fontFamily: 'var(--font-sans)',
            fontWeight: 800,
            fontSize: 42,
            color: '#fff',
            lineHeight: 1.05,
          }}>
            Your demo has
          </div>
          <div style={{
            fontFamily: 'var(--font-serif)',
            fontStyle: 'italic',
            fontWeight: 400,
            fontSize: 42,
            color: '#fff',
            lineHeight: 1.05,
          }}>
            expired.
          </div>
        </h1>

        <p style={{
          marginTop: 16,
          fontFamily: 'var(--font-sans)',
          fontWeight: 400,
          fontSize: 17,
          color: 'rgba(255,255,255,0.72)',
          lineHeight: 1.6,
          maxWidth: 340,
        }}>
          Your 30-day sandbox is up. Connect a real broker to keep your AI advisor, strategies, and portfolio analysis.
        </p>
      </div>

      {/* Broker Options (tappable, same card style) */}
      <div style={{
        marginTop: 28,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '0 28px 0',
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
            subtitle: 'Paper & live trading via secure OAuth',
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
            display: 'flex',
            alignItems: 'center',
            cursor: 'pointer',
          }}
            onClick={() => setShowComingSoon(true)}
          >
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
              ) : card.icon}
            </div>

            <div style={{ flex: 1, margin: '0 14px', minWidth: 0 }}>
              <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 16, color: '#fff' }}>
                {card.title}
              </span>
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

            <ChevronRight size={18} color="rgba(255,255,255,0.20)" />
          </div>
        ))}
      </div>

      {/* Extend Demo (ghost CTA) */}
      <div style={{ padding: '0 28px', marginTop: 20, marginBottom: 40 }}>
        <button
          onClick={() => setShowComingSoon(true)}
          style={{
            height: 52,
            width: '100%',
            background: 'transparent',
            color: 'rgba(255,255,255,0.50)',
            fontFamily: 'var(--font-sans)',
            fontWeight: 600,
            fontSize: 15,
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 999,
            cursor: 'pointer',
          }}
        >
          Extend my demo
        </button>

        <div style={{
          marginTop: 20,
          textAlign: 'center',
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

      {/* Coming Soon Modal */}
      {showComingSoon && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.60)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100,
          padding: 28,
        }}
          onClick={() => setShowComingSoon(false)}
        >
          <div style={{
            background: '#1a1f2e',
            border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: 20,
            padding: 28,
            maxWidth: 320,
            width: '100%',
            textAlign: 'center',
          }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              background: 'rgba(34,211,238,0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
            }}>
              <TrendingUp size={24} color="var(--accent)" />
            </div>
            <h3 style={{
              fontFamily: 'var(--font-sans)',
              fontWeight: 700,
              fontSize: 20,
              color: '#fff',
              margin: '0 0 8px',
            }}>
              Coming soon
            </h3>
            <p style={{
              fontFamily: 'var(--font-sans)',
              fontWeight: 400,
              fontSize: 14,
              color: 'rgba(255,255,255,0.55)',
              lineHeight: 1.5,
              margin: '0 0 20px',
            }}>
              Broker connections and subscription tiers are coming in a future update. Stay tuned!
            </p>
            <button
              onClick={() => setShowComingSoon(false)}
              style={{
                height: 44,
                width: '100%',
                background: 'rgba(255,255,255,0.10)',
                color: '#fff',
                fontFamily: 'var(--font-sans)',
                fontWeight: 600,
                fontSize: 14,
                border: 'none',
                borderRadius: 12,
                cursor: 'pointer',
              }}
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
