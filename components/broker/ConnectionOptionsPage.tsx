// ─── ConnectionOptionsPage ────────────────────────────────
// Shown when user chose "Connect your broker" from BrokerChoicePage.
// AppState = 'connection-options'.
//
// Three broker cards (all COMING SOON), toast feedback,
// back to broker-selection, fallback demo start.

'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Link, TrendingUp, Zap } from 'lucide-react';
import { VantageOrb } from '@/components/brand/VantageOrb';

// ── Toast ───────────────────────────────────────────────

const TOAST_DURATION = 3000;

interface ToastState {
  visible: boolean;
  message: string;
}

// ── Main ────────────────────────────────────────────────

export function ConnectionOptionsPage() {
  const router = useRouter();
  const [toast, setToast] = useState<ToastState>({
    visible: false,
    message: '',
  });
  const [demoLoading, setDemoLoading] = useState(false);

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast.visible) return;
    const timer = setTimeout(
      () => setToast({ visible: false, message: '' }),
      TOAST_DURATION,
    );
    return () => clearTimeout(timer);
  }, [toast.visible]);

  // ── Card tap → show toast ──────────────────────────────

  const handleCardTap = useCallback((brokerName: string) => {
    setToast({
      visible: true,
      message: `Coming soon — we'll notify you when ${brokerName} is ready. 🔔`,
    });
  }, []);

  // ── Back → broker-selection ────────────────────────────

  const handleBack = useCallback(() => {
    // When real API exists, clear connection_type first.
    // For now, refresh re-evaluates state from DB —
    // if connection_type is null, routes back to broker-selection.
    router.refresh();
  }, [router]);

  // ── Start demo instead ─────────────────────────────────

  const handleDemoStart = useCallback(async () => {
    setDemoLoading(true);
    try {
      const res = await fetch('/api/demo/start', {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        router.refresh();
      }
    } catch {
      // Silent fail — user can retry
    }
    setDemoLoading(false);
  }, [router]);

  // ── Render ─────────────────────────────────────────────

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
        {/* Left: Back */}
        <button
          onClick={handleBack}
          style={{
            background: 'none',
            border: 'none',
            color: 'rgba(255,255,255,0.70)',
            fontSize: '14px',
            fontWeight: 400,
            fontFamily: 'var(--font-sans)',
            cursor: 'pointer',
            padding: '8px 12px 8px 0',
            minHeight: '44px',
            display: 'flex',
            alignItems: 'center',
            gap: '2px',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <ChevronLeft size={18} />
          Back
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
      <div
        style={{
          padding: '28px 24px 0',
          flexShrink: 0,
          textAlign: 'center',
        }}
      >
        <h2 style={{ margin: 0 }}>
          <span
            style={{
              display: 'block',
              fontFamily: 'var(--font-sans)',
              fontSize: '36px',
              fontWeight: 800,
              color: 'var(--text-primary)',
              lineHeight: 1.15,
            }}
          >
            Connect your
          </span>
          <span
            style={{
              display: 'block',
              fontFamily: 'var(--font-serif)',
              fontSize: '36px',
              fontWeight: 400,
              fontStyle: 'italic',
              color: 'var(--text-primary)',
              lineHeight: 1.15,
            }}
          >
            broker.
          </span>
        </h2>

        <p
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '15px',
            fontWeight: 400,
            color: 'rgba(255,255,255,0.60)',
            textAlign: 'center',
            margin: '12px 0 0',
            lineHeight: 1.5,
          }}
        >
          Choose your brokerage to sync your
          <br />
          real portfolio with Vantage AI.
        </p>
      </div>

      {/* ═══ BROKER CARDS ═══ */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '28px 24px 0',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          scrollbarWidth: 'none',
        }}
        className="hide-scrollbar"
      >
        {/* ── Snaptrade ── */}
        <BrokerCard
          icon={<Link size={20} />}
          iconColor="#22d3ee"
          iconBg="rgba(34,211,238,0.12)"
          title="Connect your broker"
          subtitle="Fidelity, Schwab, Robinhood + 20 more"
          tag="Read-only portfolio analysis"
          tagColor="#22d3ee"
          onTap={() => handleCardTap('Snaptrade')}
        />

        {/* ── Alpaca ── */}
        <BrokerCard
          icon={<TrendingUp size={20} />}
          iconColor="var(--gain)"
          iconBg="rgba(16,185,129,0.12)"
          title="Trade with Alpaca"
          subtitle="Paper & live trading via API keys"
          tag="Full trade execution"
          tagColor="var(--gain)"
          onTap={() => handleCardTap('Alpaca')}
        />

        {/* ── Tastytrade ── */}
        <BrokerCard
          icon={<Zap size={20} />}
          iconColor="#a855f7"
          iconBg="rgba(168,85,247,0.12)"
          title="Trade with Tastytrade"
          subtitle="Options & futures trading"
          tag="Full trade execution"
          tagColor="#a855f7"
          onTap={() => handleCardTap('Tastytrade')}
        />
      </div>

      {/* ═══ BOTTOM NOTE + DEMO LINK ═══ */}
      <div
        style={{
          flexShrink: 0,
          padding: '0 24px',
          textAlign: 'center',
        }}
      >
        <span
          style={{
            display: 'block',
            fontFamily: 'var(--font-sans)',
            fontSize: '12px',
            fontWeight: 400,
            color: 'rgba(255,255,255,0.40)',
            lineHeight: 1.5,
          }}
        >
          Broker connections launching soon.
          <br />
          You&rsquo;ll be notified when ready.
        </span>

        <button
          onClick={demoLoading ? undefined : handleDemoStart}
          disabled={demoLoading}
          style={{
            background: 'none',
            border: 'none',
            color: demoLoading ? 'rgba(34,211,238,0.40)' : 'var(--accent)',
            fontSize: '14px',
            fontWeight: 400,
            fontFamily: 'var(--font-sans)',
            cursor: demoLoading ? 'default' : 'pointer',
            padding: '14px 0',
            marginTop: '4px',
            marginBottom: 'max(24px, env(safe-area-inset-bottom, 0px))',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          {demoLoading ? 'Starting demo…' : 'Start with demo instead →'}
        </button>
      </div>

      {/* ═══ TOAST ═══ */}
      {toast.visible && (
        <div
          style={{
            position: 'fixed',
            bottom: 'max(32px, env(safe-area-inset-bottom, 0px))',
            left: '24px',
            right: '24px',
            padding: '14px 20px',
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid var(--border-card)',
            borderRadius: '14px',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            zIndex: 100,
            animation: 'toastIn 300ms var(--ease-out)',
            textAlign: 'center',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '14px',
              fontWeight: 500,
              color: 'var(--text-primary)',
              lineHeight: 1.4,
            }}
          >
            {toast.message}
          </span>
        </div>
      )}

      {/* Toast keyframes injected inline */}
      <style>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

// ── Broker Card (internal component) ────────────────────

interface BrokerCardProps {
  icon: React.ReactNode;
  iconColor: string;
  iconBg: string;
  title: string;
  subtitle: string;
  tag: string;
  tagColor: string;
  onTap: () => void;
}

function BrokerCard({
  icon,
  iconColor,
  iconBg,
  title,
  subtitle,
  tag,
  tagColor,
  onTap,
}: BrokerCardProps) {
  return (
    <button
      onClick={onTap}
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: '14px',
        padding: '18px 16px',
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid var(--border-card)',
        borderRadius: '20px',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        cursor: 'pointer',
        transition: 'all 150ms var(--ease-out)',
        WebkitTapHighlightColor: 'transparent',
        fontFamily: 'var(--font-sans)',
        color: 'var(--text-primary)',
        textAlign: 'left',
      }}
      onTouchStart={(e) => {
        (e.currentTarget as HTMLElement).style.transform = 'scale(0.98)';
      }}
      onTouchEnd={(e) => {
        (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
      }}
    >
      {/* Left: icon */}
      <div
        style={{
          width: '40px',
          height: '40px',
          borderRadius: '10px',
          background: iconBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          color: iconColor,
        }}
      >
        {icon}
      </div>

      {/* Middle: text stack */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {/* Title row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '16px',
              fontWeight: 700,
              color: 'var(--text-primary)',
              lineHeight: 1.3,
              flexShrink: 0,
            }}
          >
            {title}
          </span>
          <span
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '10px',
              fontWeight: 700,
              color: 'var(--warning)',
              background: 'rgba(245,158,11,0.15)',
              padding: '2px 7px',
              borderRadius: 'var(--radius-pill)',
              letterSpacing: '0.04em',
              lineHeight: 1.4,
              flexShrink: 0,
            }}
          >
            COMING SOON
          </span>
        </div>

        {/* Subtitle */}
        <span
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '13px',
            fontWeight: 400,
            color: 'rgba(255,255,255,0.50)',
            lineHeight: 1.4,
          }}
        >
          {subtitle}
        </span>

        {/* Tag */}
        <span
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '12px',
            fontWeight: 500,
            color: tagColor,
            lineHeight: 1.4,
          }}
        >
          {tag}
        </span>
      </div>

      {/* Right: chevron */}
      <div
        style={{
          flexShrink: 0,
          color: 'rgba(255,255,255,0.20)',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <ChevronRight size={18} />
      </div>
    </button>
  );
}
