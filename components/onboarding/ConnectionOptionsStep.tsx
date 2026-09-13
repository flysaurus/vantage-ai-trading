// ─── ConnectionOptionsStep ──────────────────────────────────
// Internal step inside OnboardingFlow. Reached when user chose
// "Connect your broker" on BrokerChoiceStep. BEFORE account creation.
//
// All broker connections are COMING SOON — tapping a card shows
// a toast. Phase 5/6 will wire onSelect() for active brokers.

'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { VantageOrb } from '@/components/brand/VantageOrb';
import { Link, TrendingUp, Zap, ChevronRight } from 'lucide-react';

// ── Props ───────────────────────────────────────────────────

interface ConnectionOptionsStepProps {
  onSelect: (type: 'snaptrade' | 'alpaca' | 'tastytrade') => void;
  onBack: () => void;
  onSwitchToDemo: () => void;
}

// ── Card data ───────────────────────────────────────────────

interface BrokerCardData {
  id: 'snaptrade' | 'alpaca' | 'tastytrade';
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  tag: string;
  tagColor: string;
}

// ── Toast ───────────────────────────────────────────────────

const TOAST_DURATION = 3000;

// ── Component ──────────────────────────────────────────────

export default function ConnectionOptionsStep({
  onSelect: _onSelect,
  onBack,
  onSwitchToDemo,
}: ConnectionOptionsStepProps) {
  const [toast, setToast] = useState<{ visible: boolean; message: string }>({
    visible: false,
    message: '',
  });
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const showToast = useCallback((message: string) => {
    setToast({ visible: true, message });
  }, []);

  useEffect(() => {
    if (!toast.visible) return;
    const timer = setTimeout(() => {
      setToast({ visible: false, message: '' });
    }, TOAST_DURATION);
    return () => clearTimeout(timer);
  }, [toast.visible]);

  // Tap handler for all cards (all coming soon)
  const handleCardTap = useCallback(
    (card: BrokerCardData) => {
      showToast(
        "Coming soon — we'll notify you when " +
          card.title.toLowerCase() +
          ' is ready. 🔔',
      );
    },
    [showToast],
  );

  // ── Broker cards ──────────────────────────────────────────

  const cards: BrokerCardData[] = [
    {
      id: 'snaptrade',
      icon: <Link size={22} strokeWidth={2} color="#2dd4bf" />,
      title: 'Connect your broker',
      subtitle: 'Fidelity, Schwab, Robinhood + 20 more',
      tag: 'Read-only portfolio analysis',
      tagColor: 'var(--v-accent-label)',
    },
    {
      id: 'alpaca',
      icon: <TrendingUp size={22} strokeWidth={2} color="#22c55e" />,
      title: 'Trade with Alpaca',
      subtitle: 'Paper & live trading via secure OAuth',
      tag: 'Full trade execution',
      tagColor: 'var(--v-gain-label)',
    },
    {
      id: 'tastytrade',
      icon: <Zap size={22} strokeWidth={2} color="#a855f7" />,
      title: 'Trade with Tastytrade',
      subtitle: 'Options & futures trading',
      tag: 'Full trade execution',
      tagColor: 'var(--v-violet-label)',
    },
  ];

  return (
    <div
      className="onboarding-shell"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        background:
          'radial-gradient(ellipse 100% 60% at 50% 0%, var(--v-accent-dim) 0%, transparent 72%), radial-gradient(ellipse 60% 40% at 80% 100%, var(--v-glow) 0%, transparent 60%), var(--v-canvas)',
        color: 'var(--v-text-primary)',
        fontFamily: 'var(--font-sans)',
        position: 'relative',
      }}
    >
      {/* ═══ TOP BAR ═══ */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          minHeight: '60px',
          position: 'relative',
        }}
      >
        {/* Left: Back */}
        <button
          onClick={onBack}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--v-text-secondary)',
            fontSize: '14px',
            fontWeight: 400,
            cursor: 'pointer',
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontFamily: 'var(--font-sans)',
            minHeight: '44px',
            WebkitTapHighlightColor: 'transparent',
            zIndex: 1,
          }}
          aria-label="Back to broker choice"
        >
          ‹ Back
        </button>

        {/* Center: VantageOrb */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
          }}
        >
          <VantageOrb size={44} animate showEntrance />
        </div>

        {/* Right: spacer for balance */}
        <div style={{ width: '60px' }} />
      </div>

      {/* ═══ CONTENT ═══ */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '24px 20px',
          overflowY: 'auto',
        }}
      >
        {/* ── HEADLINE ── */}
        <h2
          style={{
            margin: '0 0 8px',
            textAlign: 'center',
            lineHeight: 1.15,
          }}
        >
          <span
            style={{
              display: 'block',
              fontFamily: 'var(--font-sans)',
              fontSize: '32px',
              fontWeight: 800,
              color: 'var(--v-text-primary)',
            }}
          >
            Connect your
          </span>
          <span
            style={{
              display: 'block',
              fontFamily: 'var(--font-serif)',
              fontSize: '32px',
              fontWeight: 400,
              fontStyle: 'italic',
              color: 'var(--v-text-primary)',
            }}
          >
            broker.
          </span>
        </h2>

        {/* ── SUBTEXT ── */}
        <p
          style={{
            fontSize: '14px',
            fontWeight: 400,
            color: 'var(--v-text-muted)',
            textAlign: 'center',
            margin: '0 0 24px',
            lineHeight: 1.5,
            maxWidth: '320px',
          }}
        >
          Choose your brokerage to sync your real portfolio with
          Rufus.
        </p>

        {/* ── CARDS ── */}
        <div
          style={{
            width: '100%',
            maxWidth: '380px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          {cards.map((card) => {
            const isHovered = hoveredId === card.id;

            return (
              <button
                key={card.id}
                onClick={() => handleCardTap(card)}
                onMouseEnter={() => setHoveredId(card.id)}
                onMouseLeave={() => setHoveredId(null)}
                style={{
                  width: '100%',
                  padding: '16px',
                  borderRadius: '14px',
                  border: isHovered
                    ? '2px solid var(--v-accent)'
                    : '2px solid var(--v-card-border)',
                  background: isHovered
                    ? 'var(--v-accent-dim)'
                    : 'var(--v-card)',
                  boxShadow: 'var(--v-shadow-card)', // locked elevation
                  cursor: 'pointer',
                  transition: 'border-color 0.2s, background 0.2s',
                  textAlign: 'left' as const,
                  fontFamily: 'var(--font-sans)',
                  color: 'var(--v-text-primary)',
                  position: 'relative' as const,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '12px',
                  }}
                >
                  {/* Icon */}
                  <div
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '10px',
                      background: 'var(--v-card)',
                      boxShadow: 'var(--v-shadow-card)', // locked elevation
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      marginTop: '2px',
                    }}
                  >
                    {card.icon}
                  </div>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginBottom: '4px',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '16px',
                          fontWeight: 700,
                        }}
                      >
                        {card.title}
                      </span>

                      {/* COMING SOON badge (only for non-snaptrade) */}
                      {card.id !== 'snaptrade' && (
                        <span
                          style={{
                            fontSize: '9px',
                            fontWeight: 600,
                            color: 'var(--v-warn)',
                            background: 'var(--v-warn-dim)',
                            padding: '2px 7px',
                            borderRadius: '4px',
                            letterSpacing: '0.04em',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          COMING SOON
                        </span>
                      )}
                    </div>

                    <p
                      style={{
                        fontSize: '13px',
                        color: 'var(--v-text-muted)',
                        margin: '0 0 4px',
                        lineHeight: 1.4,
                      }}
                    >
                      {card.subtitle}
                    </p>

                    {/* Tag */}
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 500,
                        color: card.tagColor,
                      }}
                    >
                      {card.tag}
                    </span>
                  </div>

                  {/* Chevron */}
                  <div
                    style={{
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      marginTop: '10px',
                    }}
                  >
                    <ChevronRight
                      size={18}
                      color="var(--v-text-faint)"
                    />
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* ═══ SWITCH TO DEMO ═══ */}
        <button
          onClick={onSwitchToDemo}
          style={{
            marginTop: '20px',
            background: 'none',
            border: 'none',
            fontSize: '14px',
            fontWeight: 400,
            color: 'var(--v-accent-label)',
            cursor: 'pointer',
            padding: '8px 12px',
            fontFamily: 'var(--font-sans)',
            textAlign: 'center',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          Start with demo instead &rarr;
        </button>

        {/* ═══ BOTTOM NOTE ═══ */}
        <p
          style={{
            marginTop: '16px',
            fontSize: '12px',
            fontWeight: 400,
            color: 'var(--v-text-faint)',
            textAlign: 'center',
            fontFamily: 'var(--font-sans)',
            lineHeight: 1.5,
          }}
        >
          Connect via SnapTrade to sync Fidelity, Schwab, Robinhood + 20 more.
        </p>
      </div>

      {/* ═══ TOAST ═══ */}
      {toast.visible && (
        <div
          style={{
            position: 'fixed',
            bottom: '32px',
            left: '50%',
            transform: 'translateX(-50%)',
            maxWidth: 'calc(100% - 40px)',
            padding: '14px 20px',
            borderRadius: '12px',
            background: 'var(--v-panel)',
            boxShadow: 'var(--v-shadow-card)',
            border: '1px solid var(--v-card-border)',
            color: 'var(--v-text-primary)',
            fontSize: '14px',
            fontFamily: 'var(--font-sans)',
            textAlign: 'center',
            zIndex: 100,
            animation: 'toastIn 0.25s ease-out',
          }}
        >
          {toast.message}
        </div>
      )}

      {/* ── Animations ── */}
      <style>{`
        @keyframes toastIn {
          from {
            opacity: 0;
            transform: translateX(-50%) translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
