'use client';

import React, { useState } from 'react';
import { createClient } from '@/lib/supabase';

interface EmailGateModalProps {
  open: boolean;
  onClose: () => void;
  /** The pending action to store and resume after auth */
  pendingAction: { type: 'basket' | 'trade' | 'chat'; payload?: any };
}

export function EmailGateModal({ open, onClose, pendingAction }: EmailGateModalProps) {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const handleSubmit = async () => {
    if (!email.trim() || !email.includes('@')) {
      setError('Enter a valid email address');
      return;
    }
    setSending(true);
    setError('');

    try {
      // Store pending action for resume after magic link
      sessionStorage.setItem('vantage_pending_action', JSON.stringify(pendingAction));
      // Remember we sent a link (for resend/reminder logic)
      localStorage.setItem('vantage_magic_link_sent', JSON.stringify({
        email: email.trim(),
        timestamp: Date.now(),
      }));

      // Build callback URL with quiz state so new profile preserves onboarding status
      const callbackBase = `${window.location.origin}/auth/callback?pending_action=${encodeURIComponent(JSON.stringify(pendingAction))}`;
      let callbackUrl = callbackBase;
      try {
        const quizComplete = localStorage.getItem('vantage_quiz_complete') === 'true';
        const quizStyle = localStorage.getItem('vantage:investorStyle');
        if (quizComplete) callbackUrl += `&quiz_complete=1`;
        if (quizStyle) callbackUrl += `&investor_style=${encodeURIComponent(quizStyle)}`;
      } catch { /* localStorage unavailable */ }

      const supabase = createClient();
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: callbackUrl,
        },
      });

      if (otpError) throw otpError;
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message || 'Failed to send link');
    } finally {
      setSending(false);
    }
  };

  const handleResend = async () => {
    try {
      const stored = localStorage.getItem('vantage_magic_link_sent');
      if (!stored) return;
      const { email: storedEmail } = JSON.parse(stored);
      
      // Include quiz state in resend too
      let resendUrl = `${window.location.origin}/auth/callback`;
      try {
        const qc = localStorage.getItem('vantage_quiz_complete') === 'true';
        const qs = localStorage.getItem('vantage:investorStyle');
        if (qc) resendUrl += `?quiz_complete=1`;
        if (qs) resendUrl += `${qc ? '&' : '?'}investor_style=${encodeURIComponent(qs)}`;
      } catch {}

      const supabase = createClient();
      await supabase.auth.signInWithOtp({
        email: storedEmail,
        options: {
          emailRedirectTo: resendUrl,
        },
      });
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message || 'Failed to resend');
    }
  };

  // Check if link was already sent to this email
  const alreadySent = (() => {
    try {
      const stored = localStorage.getItem('vantage_magic_link_sent');
      if (!stored) return false;
      const { timestamp } = JSON.parse(stored);
      // Show reminder if sent within last 15 minutes
      return (Date.now() - timestamp) < 15 * 60 * 1000;
    } catch { return false; }
  })();

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      background: 'rgba(0,0,0,0.6)',
      animation: 'fadeIn 200ms ease',
    }} onClick={onClose}>
      <div style={{
        width: '100%', maxWidth: '420px',
        background: '#0f172a',
        borderTopLeftRadius: '20px', borderTopRightRadius: '20px',
        padding: '28px 24px 40px',
        animation: 'slideUp 300ms ease-out',
      }} onClick={e => e.stopPropagation()}>
        {/* Handle bar */}
        <div style={{
          width: '40px', height: '4px', background: '#334155',
          borderRadius: '2px', margin: '0 auto 20px',
        }} />

        {submitted ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '40px', marginBottom: '16px' }}>📧</div>
            <h2 style={{
              fontSize: '20px', fontWeight: 700, color: '#e2e8f0',
              marginBottom: '8px',
            }}>
              Check your inbox
            </h2>
            <p style={{
              fontSize: '14px', color: '#94a3b8', lineHeight: 1.5,
              marginBottom: '8px',
            }}>
              Tap the link to continue — we sent it to {email || 'your email'}.
            </p>
            <p style={{
              fontSize: '13px', color: 'var(--text-muted, #64748b)', textAlign: 'center',
              marginBottom: '24px',
            }}>
              Don't see it? Check your spam or junk folder.
            </p>
            <button onClick={handleResend} style={{
              background: 'none', border: 'none', color: '#22d3ee',
              fontSize: '13px', cursor: 'pointer',
            }}>
              Resend link
            </button>
          </div>
        ) : alreadySent ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '40px', marginBottom: '16px' }}>📧</div>
            <h2 style={{
              fontSize: '20px', fontWeight: 700, color: '#e2e8f0',
              marginBottom: '8px',
            }}>
              Check your inbox
            </h2>
            <p style={{
              fontSize: '14px', color: '#94a3b8', lineHeight: 1.5,
              marginBottom: '8px',
            }}>
              Check your inbox to finish setting up.
            </p>
            <p style={{
              fontSize: '13px', color: 'var(--text-muted, #64748b)', textAlign: 'center',
              marginBottom: '24px',
            }}>
              Don't see it? Check your spam or junk folder.
            </p>
            <button onClick={handleResend} style={{
              background: 'none', border: 'none', color: '#22d3ee',
              fontSize: '13px', cursor: 'pointer',
              marginRight: '16px',
            }}>
              Resend
            </button>
            <button onClick={onClose} style={{
              background: 'none', border: 'none', color: '#64748b',
              fontSize: '13px', cursor: 'pointer',
            }}>
              Maybe later
            </button>
          </div>
        ) : (
          <>
            <h2 style={{
              fontSize: '20px', fontWeight: 700, color: '#e2e8f0',
              marginBottom: '6px',
            }}>
              Save your progress
            </h2>
            <p style={{
              fontSize: '14px', color: '#94a3b8', lineHeight: 1.5,
              marginBottom: '20px',
            }}>
              Create your account so this never gets lost — even if you switch devices or clear your browser.
            </p>

            <input
              type="email"
              value={email}
              onChange={e => { setEmail(e.target.value); setError(''); }}
              placeholder="your@email.com"
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
              style={{
                width: '100%', padding: '14px 16px',
                background: '#1a2235', border: '1px solid #334155',
                borderRadius: '12px', color: '#e2e8f0', fontSize: '15px',
                outline: 'none', marginBottom: '12px',
                transition: 'border-color 150ms',
                boxSizing: 'border-box',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = '#22d3ee'; }}
              onBlur={e => { e.currentTarget.style.borderColor = '#334155'; }}
            />

            {error && (
              <p style={{
                fontSize: '12px', color: '#fca5a5', marginBottom: '8px',
              }}>
                {error}
              </p>
            )}

            <button
              onClick={handleSubmit}
              disabled={sending}
              style={{
                width: '100%', padding: '14px 0',
                background: sending ? '#0e7490' : '#22d3ee',
                border: 'none', borderRadius: '12px',
                fontSize: '15px', fontWeight: 700, color: '#0a0f1e',
                cursor: sending ? 'wait' : 'pointer',
                marginBottom: '12px',
              }}
            >
              {sending ? 'Sending...' : 'Send magic link →'}
            </button>

            <p style={{
              fontSize: '12px', color: '#64748b', textAlign: 'center',
            }}>
              We'll email you a link — no password needed.
            </p>
          </>
        )}
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
