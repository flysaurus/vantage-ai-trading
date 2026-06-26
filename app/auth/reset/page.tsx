// ─── Reset Password Screen ────────────────────────────────
// Arrives here from password reset email. Supabase puts
// auth tokens in the URL hash. Checks for session on mount.
//
// States: 'loading' | 'form' | 'success' | 'expired'

'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import { VantageOrb } from '@/components/brand/VantageOrb';
import Input from '@/components/ui/Input';
import PasswordStrength from '@/components/ui/PasswordStrength';
import { createClient } from '@/lib/supabase';

// ── Gradient (same as login / forgot-password) ─────────────

const GRADIENT = `radial-gradient(ellipse 150% 65% at 50% -15%, rgba(34,211,238,0.40) 0%, rgba(14,116,144,0.22) 35%, transparent 65%), radial-gradient(ellipse 70% 45% at 90% 100%, rgba(99,102,241,0.15) 0%, transparent 70%), #0a0f1e`;

// ── Auto-redirect helper ───────────────────────────────────

function AutoRedirect() {
  const router = useRouter();
  useEffect(() => {
    const timeout = setTimeout(() => router.replace('/'), 2000);
    return () => clearTimeout(timeout);
  }, [router]);
  return null;
}

// ── Shared shell ───────────────────────────────────────────

function PageShell({ children }: { children: React.ReactNode }) {
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
      {children}
    </div>
  );
}

// ── Component ──────────────────────────────────────────────

export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return createClient();
  }, []);

  const [screen, setScreen] = useState<'loading' | 'form' | 'success' | 'expired'>('loading');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [confirmTouched, setConfirmTouched] = useState(false);

  // ── Password requirements ───────────────────────────────
  const passwordsMatch = confirmPassword.length > 0 && newPassword === confirmPassword;
  const showMatch = confirmTouched && confirmPassword.length > 0;
  const allReqsMet = newPassword.length >= 8
    && /[A-Z]/.test(newPassword)
    && /[a-z]/.test(newPassword)
    && /[0-9]/.test(newPassword)
    && /[!@#$%^&*]/.test(newPassword);

  const canSubmit =
    allReqsMet && passwordsMatch && confirmPassword.length > 0 && !submitting;

  // ── Check session on mount ──────────────────────────────
  useEffect(() => {
    async function check() {
      if (!supabase) return;
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setScreen('form');
      } else {
        await new Promise((r) => setTimeout(r, 500));
        const { data: retry } = await supabase.auth.getSession();
        setScreen(retry.session ? 'form' : 'expired');
      }
    }
    check();
  }, [supabase]);

  // ── Submit handler ──────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !supabase) return;
    setSubmitting(true);
    setError('');

    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (updateError) {
      setError(
        updateError.message.includes('same as your old password')
          ? 'New password must be different from your current password.'
          : updateError.message
      );
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
  //  LOADING
  // ══════════════════════════════════════════════════════════

  if (screen === 'loading') {
    return (
      <PageShell>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Loader2 size={32} color="var(--accent)" style={{ animation: 'spin 0.7s linear infinite' }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </PageShell>
    );
  }

  // ══════════════════════════════════════════════════════════
  //  EXPIRED
  // ══════════════════════════════════════════════════════════

  if (screen === 'expired') {
    return (
      <PageShell>
        {/* Top Bar */}
        <div style={{ height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <VantageOrb size={44} animate={false} showEntrance={false} />
        </div>

        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 24px 48px',
        }}>
          {/* AlertCircle icon */}
          <div style={{ marginBottom: '24px' }}>
            <AlertCircle size={64} color="var(--warning)" />
          </div>

          {/* Headline — single line */}
          <h1 style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '32px',
            fontWeight: 800,
            color: '#ffffff',
            textAlign: 'center',
            margin: '0 0 12px',
            lineHeight: 1.2,
          }}>
            Link expired
          </h1>

          {/* Body */}
          <p style={{
            fontSize: '16px',
            color: 'var(--text-secondary)',
            textAlign: 'center',
            maxWidth: '280px',
            lineHeight: 1.5,
            fontFamily: 'var(--font-sans)',
            margin: '0 auto 32px',
          }}>
            Password reset links expire after 60 minutes and can only be used once.
          </p>

          {/* Request new link */}
          <button
            onClick={() => router.push('/auth/forgot-password')}
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
            Request new link
          </button>

          {/* Back to sign in */}
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
      </PageShell>
    );
  }

  // ══════════════════════════════════════════════════════════
  //  SUCCESS
  // ══════════════════════════════════════════════════════════

  if (screen === 'success') {
    return (
      <PageShell>
        <div style={{ height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <VantageOrb size={44} animate={false} showEntrance={false} />
        </div>

        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 24px 48px',
        }}>
          {/* CheckCircle — spring pop */}
          <div style={{
            marginBottom: '24px',
            animation: 'check-pop 400ms cubic-bezier(0.34,1.56,0.64,1) forwards',
          }}>
            <CheckCircle size={64} color="var(--gain)" />
          </div>

          {/* Headline */}
          <h1 style={{ textAlign: 'center', margin: '0 0 12px' }}>
            <span style={{
              display: 'block',
              fontFamily: 'var(--font-sans)',
              fontSize: '36px',
              fontWeight: 800,
              color: '#ffffff',
              lineHeight: 1.2,
            }}>
              Password
            </span>
            <span style={{
              display: 'block',
              fontFamily: 'var(--font-serif)',
              fontSize: '36px',
              fontWeight: 400,
              fontStyle: 'italic',
              color: '#ffffff',
              lineHeight: 1.2,
            }}>
              updated.
            </span>
          </h1>

          {/* Body */}
          <p style={{
            fontSize: '16px',
            color: 'var(--text-secondary)',
            textAlign: 'center',
            fontFamily: 'var(--font-sans)',
            lineHeight: 1.5,
          }}>
            You&apos;re all set. Signing you in now…
          </p>
        </div>

        {/* Auto-navigate after 2s — session is already live from reset token */}
        <AutoRedirect />

        <style>{`
          @keyframes check-pop {
            0%   { transform: scale(0); }
            50%  { transform: scale(1.1); }
            100% { transform: scale(1); }
          }
        `}</style>
      </PageShell>
    );
  }

  // ══════════════════════════════════════════════════════════
  //  FORM (default)
  // ══════════════════════════════════════════════════════════

  return (
    <PageShell>
      <div onKeyDown={handleKeyDown} style={{ height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Top Bar */}
        <div style={{ height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <VantageOrb size={44} animate={false} showEntrance={false} />
        </div>

        {/* Scrollable content */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '0 24px 48px',
          justifyContent: 'center',
        }}>
          {/* Headline — 36px per spec */}
          <h1 style={{ textAlign: 'center', margin: '0 0 32px' }}>
            <span style={{
              display: 'block',
              fontFamily: 'var(--font-sans)',
              fontSize: '36px',
              fontWeight: 800,
              color: '#ffffff',
              lineHeight: 1.2,
            }}>
              Choose a new
            </span>
            <span style={{
              display: 'block',
              fontFamily: 'var(--font-serif)',
              fontSize: '36px',
              fontWeight: 400,
              fontStyle: 'italic',
              color: '#ffffff',
              lineHeight: 1.2,
            }}>
              password.
            </span>
          </h1>

          {/* Error banner */}
          {error && (
            <div style={{
              background: 'var(--loss-10)',
              border: '1px solid var(--loss)',
              borderRadius: '12px',
              padding: '12px 16px',
              display: 'flex',
              gap: '10px',
              marginBottom: '16px',
              width: '100%',
              maxWidth: '400px',
            }}>
              <AlertCircle size={16} color="var(--loss)" style={{ flexShrink: 0, marginTop: '1px' }} />
              <span style={{
                fontSize: '14px',
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-sans)',
                lineHeight: 1.5,
              }}>
                {error}
              </span>
            </div>
          )}

          {/* Form */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            width: '100%',
            maxWidth: '400px',
          }}>
            {/* New password */}
            <div>
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

            {/* Confirm password */}
            <div>
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
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  marginTop: '6px',
                  color: passwordsMatch ? 'var(--gain)' : 'var(--loss)',
                  fontSize: '13px',
                  fontFamily: 'var(--font-sans)',
                  transition: 'color 150ms var(--ease-out)',
                }}>
                  {passwordsMatch ? (
                    <><CheckCircle size={14} /><span>Passwords match</span></>
                  ) : (
                    <><span style={{ fontSize: '14px' }}>✕</span><span>Passwords don&apos;t match</span></>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Submit */}
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
              <><Loader2 size={20} style={{ animation: 'spin-submit 0.7s linear infinite' }} />Updating…</>
            ) : (
              'Update password'
            )}
          </button>
        </div>

        <style>{`@keyframes spin-submit { to { transform: rotate(360deg); } }`}</style>
      </div>
    </PageShell>
  );
}
