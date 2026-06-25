// ─── Reset Password Screen ────────────────────────────────
// Arrives here from password reset email. Supabase puts
// auth tokens in the URL hash. Checks for session on mount.
//
// States: 'loading' | 'form' | 'success' | 'expired'

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { VantageOrb } from '@/components/brand/VantageOrb';
import Input from '@/components/ui/Input';
import PasswordStrength from '@/components/ui/PasswordStrength';
import { createClient } from '@/lib/supabase';

// ── Component ──────────────────────────────────────────────

export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = createClient();

  // ── State ───────────────────────────────────────────────
  const [screen, setScreen] = useState<'loading' | 'form' | 'success' | 'expired'>('loading');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [confirmTouched, setConfirmTouched] = useState(false);

  // ── Password requirements ───────────────────────────────
  const passwordMet = [
    newPassword.length >= 8,
    /[A-Z]/.test(newPassword),
    /[a-z]/.test(newPassword),
    /[0-9]/.test(newPassword),
    /[!@#$%^&*]/.test(newPassword),
  ];
  const allReqsMet = passwordMet.every(Boolean);
  const passwordsMatch = confirmPassword.length > 0 && newPassword === confirmPassword;
  const showMatch = confirmTouched && confirmPassword.length > 0;

  const canSubmit =
    allReqsMet && passwordsMatch && confirmPassword.length > 0 && !submitting;

  // ── Check session on mount ──────────────────────────────
  useEffect(() => {
    async function check() {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setScreen('form');
      } else {
        // Wait a brief moment in case the hash hasn't been parsed yet
        await new Promise((r) => setTimeout(r, 500));
        const { data: retry } = await supabase.auth.getSession();
        if (retry.session) {
          setScreen('form');
        } else {
          setScreen('expired');
        }
      }
    }
    check();
  }, [supabase]);

  // ── Submit handler ──────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');

    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (updateError) {
      if (updateError.message.includes('same as your old password')) {
        setError('New password must be different from your current password.');
      } else {
        setError(updateError.message);
      }
      setSubmitting(false);
      return;
    }

    setScreen('success');
  }, [canSubmit, newPassword, supabase]);

  // ── Enter key ────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && canSubmit) handleSubmit();
  };

  // ══════════════════════════════════════════════════════════
  //  LOADING STATE
  // ══════════════════════════════════════════════════════════

  if (screen === 'loading') {
    return (
      <div
        className="bg-onboarding-reveal"
        style={{
          height: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Loader2
          size={32}
          color="var(--accent)"
          style={{ animation: 'spin 0.7s linear infinite' }}
        />
        <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════
  //  EXPIRED STATE
  // ══════════════════════════════════════════════════════════

  if (screen === 'expired') {
    return (
      <div
        className="bg-onboarding-reveal"
        style={{
          height: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Top Bar */}
        <div className="style-reveal-topbar">
          <VantageOrb size={44} animate={false} showEntrance={false} />
        </div>

        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '40px 24px',
          }}
        >
          {/* Warning icon */}
          <div style={{ marginBottom: '24px' }}>
            <AlertTriangle size={64} color="var(--warning)" />
          </div>

          {/* Headline */}
          <h1 style={{ textAlign: 'center', marginBottom: '12px' }}>
            <span
              style={{
                display: 'block',
                fontFamily: 'var(--font-sans)',
                fontSize: '36px',
                fontWeight: 800,
                color: '#ffffff',
                lineHeight: 1.1,
              }}
            >
              Reset link
            </span>
            <span
              style={{
                display: 'block',
                fontFamily: 'var(--font-serif)',
                fontSize: '36px',
                fontWeight: 400,
                fontStyle: 'italic',
                color: 'var(--accent)',
                lineHeight: 1.1,
              }}
            >
              expired.
            </span>
          </h1>

          <p
            style={{
              fontSize: '16px',
              color: 'var(--text-secondary)',
              textAlign: 'center',
              maxWidth: '280px',
              lineHeight: 1.5,
              fontFamily: 'var(--font-sans)',
              marginBottom: '32px',
            }}
          >
            This reset link has expired or has already been used. Reset links are valid for 60 minutes.
          </p>

          <button
            onClick={() => router.push('/login')}
            style={{
              width: '100%',
              maxWidth: '400px',
              height: '56px',
              borderRadius: '999px',
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'transparent',
              color: '#ffffff',
              fontSize: '17px',
              fontWeight: 600,
              fontFamily: 'var(--font-sans)',
              cursor: 'pointer',
            }}
          >
            Request a new one
          </button>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════
  //  SUCCESS STATE
  // ══════════════════════════════════════════════════════════

  if (screen === 'success') {
    return (
      <div
        className="bg-onboarding-reveal"
        style={{
          height: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Top Bar */}
        <div className="style-reveal-topbar">
          <VantageOrb size={44} animate={false} showEntrance={false} />
        </div>

        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '40px 24px',
          }}
        >
          {/* Checkmark */}
          <div
            style={{
              marginBottom: '24px',
              animation: 'check-entrance 400ms cubic-bezier(0.34,1.56,0.64,1) forwards',
            }}
          >
            <CheckCircle size={64} color="var(--gain)" />
          </div>

          {/* Headline */}
          <h1 style={{ textAlign: 'center', marginBottom: '12px' }}>
            <span
              style={{
                display: 'block',
                fontFamily: 'var(--font-sans)',
                fontSize: '36px',
                fontWeight: 800,
                color: '#ffffff',
                lineHeight: 1.1,
              }}
            >
              Password
            </span>
            <span
              style={{
                display: 'block',
                fontFamily: 'var(--font-serif)',
                fontSize: '36px',
                fontWeight: 400,
                fontStyle: 'italic',
                color: 'var(--accent)',
                lineHeight: 1.1,
              }}
            >
              updated.
            </span>
          </h1>

          <p
            style={{
              fontSize: '16px',
              color: 'var(--text-secondary)',
              textAlign: 'center',
              lineHeight: 1.5,
              fontFamily: 'var(--font-sans)',
              marginBottom: '32px',
            }}
          >
            You can now sign in with your new password.
          </p>

          <button
            onClick={() => router.push('/login')}
            style={{
              width: '100%',
              maxWidth: '400px',
              height: '56px',
              borderRadius: '999px',
              border: 'none',
              background: '#ffffff',
              color: '#000000',
              fontSize: '17px',
              fontWeight: 700,
              fontFamily: 'var(--font-sans)',
              cursor: 'pointer',
            }}
          >
            Sign in
          </button>
        </div>

        <style>{`
          @keyframes check-entrance {
            0%   { transform: scale(0); }
            50%  { transform: scale(1.2); }
            100% { transform: scale(1); }
          }
        `}</style>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════
  //  RESET FORM STATE (default)
  // ══════════════════════════════════════════════════════════

  return (
    <div
      className="bg-onboarding-reveal"
      onKeyDown={handleKeyDown}
      style={{
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* ═══ TOP BAR ═══ */}
      <div className="style-reveal-topbar">
        <VantageOrb size={44} animate={false} showEntrance={false} />
      </div>

      {/* ═══ SCROLLABLE CONTENT ═══ */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '32px 24px 40px',
        }}
      >
        {/* ── Headline ── */}
        <h1 style={{ textAlign: 'center', marginBottom: '32px' }}>
          <span
            style={{
              display: 'block',
              fontFamily: 'var(--font-sans)',
              fontSize: '36px',
              fontWeight: 800,
              color: '#ffffff',
              lineHeight: 1.1,
            }}
          >
            Choose a new
          </span>
          <span
            style={{
              display: 'block',
              fontFamily: 'var(--font-serif)',
              fontSize: '36px',
              fontWeight: 400,
              fontStyle: 'italic',
              color: 'var(--accent)',
              lineHeight: 1.1,
            }}
          >
            password.
          </span>
        </h1>

        {/* ── Error banner ── */}
        {error && (
          <div
            style={{
              background: 'var(--loss-10)',
              border: '1px solid var(--loss)',
              borderRadius: '12px',
              padding: '12px 16px',
              display: 'flex',
              gap: '10px',
              marginBottom: '16px',
              width: '100%',
              maxWidth: '400px',
            }}
          >
            <AlertCircle
              size={16}
              color="var(--loss)"
              style={{ flexShrink: 0, marginTop: '1px' }}
            />
            <p
              style={{
                fontSize: '14px',
                color: 'var(--text-primary)',
                margin: 0,
                lineHeight: 1.5,
                fontFamily: 'var(--font-sans)',
              }}
            >
              {error}
            </p>
          </div>
        )}

        {/* ── Form ── */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            width: '100%',
            maxWidth: '400px',
          }}
        >
          {/* New Password */}
          <div style={{ width: '100%' }}>
            <Input
              label="NEW PASSWORD"
              type="password"
              placeholder="Create a new password"
              value={newPassword}
              onChange={(v) => setNewPassword(v)}
              showToggle
              disabled={submitting}
            />
            <div style={{ marginTop: '4px' }}>
              <PasswordStrength password={newPassword} />
            </div>
          </div>

          {/* Confirm Password */}
          <div style={{ width: '100%' }}>
            <Input
              label="CONFIRM PASSWORD"
              type="password"
              placeholder="Confirm your new password"
              value={confirmPassword}
              onChange={(v) => {
                setConfirmPassword(v);
                if (!confirmTouched) setConfirmTouched(true);
              }}
              showToggle
              disabled={submitting}
            />
            {showMatch && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  marginTop: '6px',
                  color: passwordsMatch ? 'var(--gain)' : 'var(--loss)',
                  fontSize: '13px',
                  fontFamily: 'var(--font-sans)',
                  transition: 'color 150ms var(--ease-out)',
                }}
              >
                {passwordsMatch ? (
                  <>
                    <CheckCircle size={14} />
                    <span>Passwords match</span>
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: '14px' }}>✕</span>
                    <span>Passwords don&apos;t match</span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Submit button ── */}
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            width: '100%',
            maxWidth: '400px',
            height: '56px',
            borderRadius: '999px',
            border: 'none',
            background: canSubmit ? '#ffffff' : 'rgba(255,255,255,0.20)',
            color: canSubmit ? '#000000' : 'rgba(0,0,0,0.40)',
            fontSize: '17px',
            fontWeight: 700,
            fontFamily: 'var(--font-sans)',
            cursor: canSubmit ? 'pointer' : 'default',
            marginTop: '24px',
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
              Updating…
            </>
          ) : (
            'Update password'
          )}
        </button>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
