// ─── Login Page ───────────────────────────────────────────────
// Renders immediately — no loading states, no auth checks on mount.
// Auth happens only when forms are submitted.

'use client';

import { useState, useCallback } from 'react';
import { Eye, EyeOff, LogIn, UserPlus, Mail, ArrowLeft, RefreshCw, ShieldCheck } from 'lucide-react';
import { signIn as doSignIn, signUp as doSignUp, storeSession, storeUser, resendConfirmation } from '@/lib/auth';

export default function LoginPage() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [confirmationSent, setConfirmationSent] = useState(false);
  const [confirmedEmail, setConfirmedEmail] = useState('');
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);

      if (!email.trim() || !password) {
        setError('Please enter your email and password.');
        return;
      }
      if (password.length < 6) {
        setError('Password must be at least 6 characters.');
        return;
      }

      setSubmitting(true);
      try {
        if (mode === 'signup') {
          console.log('[login] Starting sign-up for', email.trim());
          const result = await doSignUp(email.trim(), password, displayName.trim() || undefined);
          console.log('[login] Sign-up result:', { needsConfirmation: result.needsConfirmation, hasUser: !!result.user, hasSession: !!result.session });
          if (result.needsConfirmation) {
            setConfirmedEmail(email.trim());
            setConfirmationSent(true);
            setSubmitting(false);
            return;
          }
          storeSession(result.session!);
          storeUser(result.user);
          import('@/lib/supabase/user').then(({ createUser }) => {
            createUser({ email: result.user.email, displayName: result.user.displayName, token: result.session!.token });
          });
          console.log('[login] Sign-up success, navigating to /');
          window.location.href = '/';
        } else {
          console.log('[login] Starting sign-in for', email.trim());
          const result = await doSignIn(email.trim(), password);
          console.log('[login] Sign-in result:', { hasUser: !!result.user, hasSession: !!result.session, userId: result.user?.id });
          storeSession(result.session);
          storeUser(result.user);
          import('@/lib/supabase/user').then(({ createUser }) => {
            createUser({ email: result.user.email, displayName: result.user.displayName, token: result.session.token });
          });
          console.log('[login] Sign-in success, navigating to /');
          window.location.href = '/';
        }
      } catch (err: any) {
        console.error('[login] Auth error:', err);
        const msg = String(err?.message || err || 'Something went wrong.');
        const low = msg.toLowerCase();
        if (low.includes('invalid login') || low.includes('invalid credential') || low.includes('invalid email') || low.includes('user not found'))
          setError('Invalid email or password. Please check and try again.');
        else if (low.includes('not confirmed') || low.includes('not verified') || low.includes('email not confirmed'))
          setError('Email not verified yet. Check your inbox for the confirmation link.');
        else if (low.includes('rate limit') || low.includes('too many') || low.includes('429'))
          setError('Too many attempts. Please wait a moment and try again.');
        else if (low.includes('already registered') || low.includes('already exists') || low.includes('already signed up')) {
          setError('An account with this email already exists. Please sign in.');
          setMode('signin');
        } else if (low.includes('network') || low.includes('fetch') || low.includes('timeout'))
          setError('Network error. Check your connection and try again.');
        else if (low.includes('redirect') || low.includes('url not allowed'))
          setError('Auth configuration error. Please try again or contact support.');
        else
          setError('Login failed: ' + msg);
      } finally {
        setSubmitting(false);
      }
    },
    [email, password, displayName, mode]
  );

  // ─── Resend ──────────────────────────────────────────────────

  const handleResendConfirmation = useCallback(async () => {
    setResending(true);
    setResendMessage(null);
    try {
      const r = await resendConfirmation(confirmedEmail);
      setResendMessage(r.message);
    } catch {
      setResendMessage('Unable to resend. Please try again later.');
    } finally {
      setResending(false);
    }
  }, [confirmedEmail]);

  // ─── Confirmation Screen ────────────────────────────────────

  if (confirmationSent) {
    return (
      <div className="page">
        <div className="card">
          <button className="back-btn" onClick={() => { setConfirmationSent(false); setError(null); }}>
            <ArrowLeft size={16} /> Back to sign in
          </button>
          <div className="mail-icon"><Mail size={40} /></div>
          <h2 className="title">Verify your email</h2>
          <p className="sub">We&apos;ve sent a verification link to</p>
          <p className="email">{confirmedEmail}</p>
          <div className="steps">
            <div className="step"><span className="n">1</span> Open your inbox and find the email from Vantage</div>
            <div className="step"><span className="n">2</span> Click the confirmation link</div>
            <div className="step"><span className="n">3</span> Return here and sign in</div>
          </div>
          {resendMessage && <div className={`resend-msg ${resendMessage.includes('resent') ? 'ok' : 'warn'}`}>{resendMessage}</div>}
          <button className="resend-btn" onClick={handleResendConfirmation} disabled={resending}>
            {resending ? <span className="sp" /> : <RefreshCw size={14} />}
            Resend verification email
          </button>
          <p className="note">Didn&apos;t get it? Check spam or try a different email.</p>
        </div>
        <style jsx>{`
          .page { display:flex;align-items:center;justify-content:center;min-height:100dvh;padding:16px;background:#0a0e27 }
          .card { width:100%;max-width:380px;background:#0f172a;border:1px solid #334155;border-radius:16px;padding:32px 24px;text-align:center }
          .back-btn { display:inline-flex;align-items:center;gap:6px;background:none;border:none;color:#94a3b8;font-size:13px;cursor:pointer;margin-bottom:24px;font-family:inherit }
          .back-btn:hover { color:#f1f5f9 }
          .mail-icon { width:72px;height:72px;margin:0 auto 16px;background:rgba(6,182,212,.1);border:2px solid rgba(6,182,212,.2);border-radius:50%;display:flex;align-items:center;justify-content:center;color:#06b6d4 }
          .title { font-size:22px;font-weight:700;color:#f1f5f9;margin:0 0 8px }
          .sub { color:#94a3b8;font-size:14px;margin:0 0 4px }
          .email { color:#06b6d4;font-size:16px;font-weight:600;margin:0 0 24px;word-break:break-all }
          .steps { text-align:left;background:#0f172a;border:1px solid #334155;border-radius:10px;padding:16px;margin-bottom:20px }
          .step { display:flex;align-items:flex-start;gap:10px;padding:8px 0;color:#cbd5e1;font-size:13px;line-height:1.5 }
          .step+.step { border-top:1px solid #1e293b }
          .n { width:22px;height:22px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:rgba(6,182,212,.15);border-radius:50%;color:#06b6d4;font-size:12px;font-weight:700 }
          .resend-msg { padding:8px 12px;border-radius:6px;font-size:13px;margin-bottom:12px }
          .resend-msg.ok { background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.2);color:#22c55e }
          .resend-msg.warn { background:rgba(250,204,21,.1);border:1px solid rgba(250,204,21,.2);color:#facc15 }
          .resend-btn { display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:10px;background:transparent;border:1px solid #334155;border-radius:8px;color:#cbd5e1;font-size:14px;cursor:pointer;margin-bottom:12px;font-family:inherit }
          .resend-btn:hover:not(:disabled) { border-color:#06b6d4;color:#06b6d4 }
          .resend-btn:disabled { opacity:.5;cursor:not-allowed }
          .note { color:#64748b;font-size:12px;line-height:1.5 }
          .sp { width:14px;height:14px;border:2px solid rgba(6,182,212,.3);border-top-color:#06b6d4;border-radius:50%;animation:spin .6s linear infinite;display:inline-block }
          @keyframes spin { to { transform:rotate(360deg) } }
        `}</style>
      </div>
    );
  }

  // ─── Login / Sign Up Form ───────────────────────────────────

  return (
    <div className="page">
      <div className="card">
        <div className="logo">
          <span className="logo-text">Vantage</span>
        </div>
        <p className="tagline">AI-first trading, in your pocket</p>

        <div className="tabs">
          <button className={`tab ${mode === 'signin' ? 'on' : ''}`} onClick={() => { setMode('signin'); setError(null); }} disabled={submitting}>Sign In</button>
          <button className={`tab ${mode === 'signup' ? 'on' : ''}`} onClick={() => { setMode('signup'); setError(null); }} disabled={submitting}>Sign Up</button>
        </div>

        <form onSubmit={handleSubmit} className="form">
          {mode === 'signup' && (
            <div className="field">
              <label className="lbl">Display Name</label>
              <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Your name" className="inp" autoComplete="name" disabled={submitting} />
            </div>
          )}
          <div className="field">
            <label className="lbl">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" className="inp" autoComplete="email" autoFocus disabled={submitting} />
          </div>
          <div className="field">
            <label className="lbl">Password</label>
            <div className="pw">
              <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" className="inp pw-inp" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} disabled={submitting} />
              <button type="button" className="pw-toggle" onClick={() => setShowPassword(!showPassword)} tabIndex={-1}>
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && (
            <div className="err">
              <ShieldCheck size={14} />
              <span>{error}</span>
            </div>
          )}

          <button type="submit" className="submit" disabled={submitting}>
            {submitting ? <span className="sp" /> : mode === 'signup' ? <><UserPlus size={16} /> Create Account</> : <><LogIn size={16} /> Sign In</>}
          </button>
        </form>

        <div className="divider"><span>or</span></div>

        <button className="google-btn" disabled title="Coming soon">
          <svg viewBox="0 0 24 24" width="18" height="18"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          Continue with Google
        </button>

        <p className="ftr">
          {mode === 'signin' ? (
            <>Don&apos;t have an account? <button className="link" onClick={() => { setMode('signup'); setError(null); }}>Sign up</button></>
          ) : (
            <>Already have an account? <button className="link" onClick={() => { setMode('signin'); setError(null); }}>Sign in</button></>
          )}
        </p>
      </div>

      <style jsx>{`
        .page { display:flex;align-items:center;justify-content:center;min-height:100dvh;padding:16px;background:#0a0e27 }
        .card { width:100%;max-width:380px;background:#0f172a;border:1px solid #334155;border-radius:16px;padding:32px 24px;animation:fadeIn .4s ease-out }
        @keyframes fadeIn { from { opacity:0;transform:translateY(8px) } to { opacity:1;transform:translateY(0) } }
        .logo { text-align:center;margin-bottom:4px }
        .logo-text { font-size:32px;font-weight:800;background:linear-gradient(135deg,#06b6d4,#0d9488);-webkit-background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:-.5px }
        .tagline { text-align:center;color:#94a3b8;font-size:13px;margin-bottom:28px }
        .form { display:flex;flex-direction:column;gap:16px }
        .field { display:flex;flex-direction:column;gap:6px }
        .lbl { font-size:12px;font-weight:600;color:#cbd5e1;text-transform:uppercase;letter-spacing:.5px }
        .inp { width:100%;padding:10px 12px;background:#0f172a;border:1px solid #334155;border-radius:8px;color:#f1f5f9;font-size:14px;font-family:inherit;outline:none;transition:border-color .2s,box-shadow .2s }
        .inp::placeholder { color:#64748b }
        .inp:focus { border-color:#06b6d4;box-shadow:0 0 0 2px rgba(6,182,212,.15) }
        .inp:disabled { opacity:.6;cursor:not-allowed }
        .pw { position:relative }
        .pw-inp { padding-right:40px }
        .pw-toggle { position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;color:#94a3b8;cursor:pointer;padding:4px;display:flex }
        .pw-toggle:hover { color:#f1f5f9 }
        .err { display:flex;align-items:flex-start;gap:8px;background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.2);border-radius:8px;padding:10px 12px;color:#f87171;font-size:13px;line-height:1.5 }
        .submit { display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:12px;background:linear-gradient(135deg,#06b6d4,#0d9488);border:none;border-radius:8px;color:#fff;font-size:15px;font-weight:600;cursor:pointer;margin-top:4px;font-family:inherit;transition:opacity .2s,transform .1s }
        .submit:hover:not(:disabled) { opacity:.92;transform:translateY(-1px) }
        .submit:active:not(:disabled) { transform:translateY(0) }
        .submit:disabled { opacity:.6;cursor:not-allowed }
        .sp { width:16px;height:16px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .6s linear infinite;display:inline-block }
        @keyframes spin { to { transform:rotate(360deg) } }
        .divider { display:flex;align-items:center;margin:24px 0 16px;color:#64748b;font-size:12px }
        .divider::before,.divider::after { content:'';flex:1;height:1px;background:#1e293b }
        .divider span { padding:0 12px }
        .google-btn { display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:10px;background:#1e293b;border:1px solid #334155;border-radius:8px;color:#cbd5e1;font-size:14px;font-weight:500;cursor:pointer;font-family:inherit }
        .google-btn:hover:not(:disabled) { border-color:#06b6d4 }
        .google-btn:disabled { opacity:.4;cursor:not-allowed }
        .ftr { text-align:center;margin-top:20px;font-size:13px;color:#94a3b8 }
        .link { background:none;border:none;color:#06b6d4;cursor:pointer;font-size:13px;font-weight:600;font-family:inherit }
        .link:hover { text-decoration:underline }
        .tabs { display:flex;background:#0f172a;border:1px solid #334155;border-radius:10px;padding:3px;margin-bottom:20px }
        .tab { flex:1;padding:8px;background:transparent;border:none;border-radius:8px;color:#94a3b8;font-size:13px;font-weight:600;cursor:pointer;transition:all .2s;font-family:inherit }
        .tab.on { background:#1e293b;color:#f1f5f9;box-shadow:0 1px 3px rgba(0,0,0,.3) }
        .tab:disabled { opacity:.5;cursor:not-allowed }
      `}</style>
    </div>
  );
}
