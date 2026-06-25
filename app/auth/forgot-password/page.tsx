// ─── Forgot Password Screen ───────────────────────────────
// Two internal states: 'request' | 'sent'
// Sends reset email via supabase.auth.resetPasswordForEmail.
// Always transitions to 'sent' regardless of email existence.

'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { VantageOrb } from '@/components/brand/VantageOrb';
import Input from '@/components/ui/Input';
import { createClient } from '@/lib/supabase';

// ── Helpers ────────────────────────────────────────────────

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ── Gradient (same as login) ───────────────────────────────

const GRADIENT = `radial-gradient(ellipse 150% 65% at 50% -15%, rgba(34,211,238,0.40) 0%, rgba(14,116,144,0.22) 35%, transparent 65%), radial-gradient(ellipse 70% 45% at 90% 100%, rgba(99,102,241,0.15) 0%, transparent 70%), #0a0f1e`;

// ── Component ──────────────────────────────────────────────

export default function ForgotPasswordPage() {
  const router = useRouter();
  const supabase = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return createClient();
  }, []);

  const [screen, setScreen] = useState<'request' | 'sent'>('request');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState('');
  const [cooldown, setCooldown] = useState(0);

  const canSend = isValidEmail(email) && !submitting;

  // ── Cooldown ticker ─────────────────────────────────────
  useEffect(() => {
    if (cooldown <= 0) return;
    const interval = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) { clearInterval(interval); return 0; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [cooldown]);

  // ── Send reset email ────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (!canSend || !supabase) return;
    setSubmitting(true);

    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin + '/auth/reset',
    });

    setSentTo(email.trim());
    setCooldown(60);
    setSubmitting(false);
    setScreen('sent');
  }, [canSend, email, supabase]);

  // ── Resend ──────────────────────────────────────────────
  const handleResend = useCallback(async () => {
    if (cooldown > 0 || !supabase) return;
    setSubmitting(true);

    await supabase.auth.resetPasswordForEmail(sentTo, {
      redirectTo: window.location.origin + '/auth/reset',
    });

    setCooldown(60);
    setSubmitting(false);
  }, [cooldown, sentTo, supabase]);

  // ── Enter key ────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && screen === 'request') handleSend();
  };

  // ══════════════════════════════════════════════════════════
  //  STATE: 'request'
  // ══════════════════════════════════════════════════════════

  if (screen === 'request') {
    return (
      <div
        onKeyDown={handleKeyDown}
        style={{
          height: '100dvh',
          background: GRADIENT,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* ═══ TOP BAR (60px) ═══ */}
        <div
          style={{
            height: '60px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            position: 'relative',
          }}
        >
          {/* Back to sign in */}
          <button
            onClick={() => router.push('/login')}
            style={{
              position: 'absolute',
              left: '20px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '4px 0',
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-sans)',
              fontSize: '15px',
            }}
          >
            <ChevronLeft size={20} />
            Sign in
          </button>
          <VantageOrb size={44} animate showEntrance={false} />
        </div>

        {/* ═══ CONTENT ═══ */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '0 24px 48px',
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {/* ── Headline ── */}
          <h1 style={{ textAlign: 'center', margin: '0 0 12px' }}>
            <span
              style={{
                display: 'block',
                fontFamily: 'var(--font-sans)',
                fontSize: '38px',
                fontWeight: 800,
                color: '#ffffff',
                lineHeight: 1.2,
              }}
            >
              Reset your
            </span>
            <span
              style={{
                display: 'block',
                fontFamily: 'var(--font-serif)',
                fontSize: '38px',
                fontWeight: 400,
                fontStyle: 'italic',
                color: '#ffffff',
                lineHeight: 1.2,
              }}
            >
              password.
            </span>
          </h1>

          {/* ── Subtext ── */}
          <p
            style={{
              fontSize: '16px',
              color: 'var(--text-secondary)',
              textAlign: 'center',
              maxWidth: '280px',
              margin: '0 auto 32px',
              fontFamily: 'var(--font-sans)',
              lineHeight: 1.55,
            }}
          >
            Enter the email you used to create your Vantage account.
          </p>

          {/* ── Email Input ── */}
          <div style={{ marginBottom: '24px' }}>
            <Input
              label="EMAIL"
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(v) => setEmail(v)}
              disabled={submitting}
              autoFocus
            />
          </div>

          {/* ── Send Reset Link ── */}
          <button
            onClick={handleSend}
            disabled={!canSend}
            style={{
              width: '100%',
              height: '56px',
              borderRadius: '999px',
              border: 'none',
              background: canSend ? '#ffffff' : 'rgba(255,255,255,0.20)',
              color: canSend ? '#000000' : 'rgba(0,0,0,0.40)',
              fontSize: '17px',
              fontWeight: 700,
              fontFamily: 'var(--font-sans)',
              cursor: canSend ? 'pointer' : 'default',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              transition: 'background 200ms var(--ease-out)',
            }}
          >
            {submitting ? (
              <>
                <Loader2 size={20} style={{ animation: 'spin 0.7s linear infinite' }} />
                Sending…
              </>
            ) : (
              'Send reset link'
            )}
          </button>
        </div>

        <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════
  //  STATE: 'sent'
  // ══════════════════════════════════════════════════════════

  return (
    <div
      style={{
        height: '100dvh',
        background: GRADIENT,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* ═══ TOP BAR (60px) ═══ */}
      <div
        style={{
          height: '60px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          position: 'relative',
        }}
      >
        <button
          onClick={() => {
            setScreen('request');
            setEmail('');
            setSentTo('');
            setCooldown(0);
          }}
          style={{
            position: 'absolute',
            left: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '4px 0',
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-sans)',
            fontSize: '15px',
          }}
        >
          <ChevronLeft size={20} />
          Back
        </button>
        <VantageOrb size={44} animate showEntrance={false} />
      </div>

      {/* ═══ CONTENT ═══ */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '0 24px 48px',
        }}
      >
        {/* ── Mail icon (spring entrance) ── */}
        <div
          style={{
            marginBottom: '24px',
            animation: 'mail-pop 400ms cubic-bezier(0.34,1.56,0.64,1) forwards',
          }}
        >
          <svg
            width="64"
            height="64"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="M22 4L12 13L2 4" />
          </svg>
        </div>

        {/* ── Headline ── */}
        <h1 style={{ textAlign: 'center', margin: '0 0 12px' }}>
          <span
            style={{
              display: 'block',
              fontFamily: 'var(--font-sans)',
              fontSize: '38px',
              fontWeight: 800,
              color: '#ffffff',
              lineHeight: 1.2,
            }}
          >
            Check your
          </span>
          <span
            style={{
              display: 'block',
              fontFamily: 'var(--font-serif)',
              fontSize: '38px',
              fontWeight: 400,
              fontStyle: 'italic',
              color: '#ffffff',
              lineHeight: 1.2,
            }}
          >
            inbox.
          </span>
        </h1>

        {/* ── Body text ── */}
        <p
          style={{
            fontSize: '16px',
            color: 'var(--text-secondary)',
            textAlign: 'center',
            maxWidth: '280px',
            fontFamily: 'var(--font-sans)',
            lineHeight: 1.6,
            marginBottom: '12px',
          }}
        >
          We sent a reset link to{' '}
          <span style={{ color: 'var(--accent)' }}>{sentTo}</span>.
          It expires in 60 minutes.
        </p>

        <p
          style={{
            fontSize: '13px',
            color: 'var(--text-muted)',
            textAlign: 'center',
            fontFamily: 'var(--font-sans)',
            marginBottom: '32px',
          }}
        >
          Don&apos;t see it? Check your spam or junk folder.
        </p>

        {/* ── Resend ── */}
        <button
          onClick={handleResend}
          disabled={cooldown > 0}
          style={{
            background: 'none',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '999px',
            padding: '12px 24px',
            color: cooldown > 0 ? 'rgba(255,255,255,0.25)' : 'var(--text-secondary)',
            fontSize: '14px',
            fontWeight: 600,
            fontFamily: 'var(--font-sans)',
            cursor: cooldown > 0 ? 'default' : 'pointer',
            transition: 'color 200ms var(--ease-out)',
          }}
        >
          {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend email'}
        </button>

        {/* ── Back to sign in ── */}
        <button
          onClick={() => router.push('/login')}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            fontSize: '13px',
            fontFamily: 'var(--font-sans)',
            cursor: 'pointer',
            marginTop: '24px',
            textAlign: 'center',
          }}
        >
          ← Back to sign in
        </button>
      </div>

      <style>{`
        @keyframes mail-pop {
          0%   { transform: scale(0); }
          50%  { transform: scale(1.1); }
          100% { transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
