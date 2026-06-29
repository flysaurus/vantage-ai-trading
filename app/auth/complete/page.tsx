// ─── /auth/complete ──────────────────────────────────────────
// Post-auth profile completion page. Called after sign-up (email
// or OAuth) to ensure the user's profile (public.users row) has
// all required fields: first_name, last_name, investor_style,
// and risk_tolerance.
//
// Also handles the case where the root page redirects here because
// useAppState detected an incomplete profile (needs-profile state).
//
// Uses /api/user/setup (service role) to bypass RLS for writes.

'use client';
import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { getSupabaseBrowserClient } from '@/lib/auth/supabase-client';

const GRADIENT =
  'linear-gradient(180deg, #0a0a12 0%, #111827 40%, #1a2332 75%, #0f172a 100%)';

export default function AuthCompletePage() {
  const router = useRouter();
  const [status, setStatus] = useState<'processing' | 'error' | 'done'>('processing');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function completeAuth() {
      try {
        const supabase = getSupabaseBrowserClient();

        // ── Handle code exchange if redirected here directly ──
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        if (code) {
          // Server-side exchange is more reliable — redirect to /auth/callback
          window.location.replace(`/auth/callback?code=${code}`);
          return;
        }

        const { data: { session } } = await supabase.auth.getSession();

        if (!session) {
          if (cancelled) return;
          setErrorMsg('Session not found. Please try signing in again.');
          setStatus('error');
          return;
        }

        // ── Fetch existing users row (may be incomplete) ────
        const { data: existingUser } = await (supabase
          .from('users') as any)
          .select('id, first_name, last_name, investor_style, risk_tolerance')
          .eq('id', session.user.id)
          .maybeSingle();

        // ── Determine if profile needs completion ───────────
        // Check for missing fields, not just missing row.
        // This prevents the infinite loop: root → /auth/complete → root → …
        const needsSetup =
          !existingUser ||
          !existingUser.first_name ||
          !existingUser.last_name;

        if (!needsSetup) {
          // Profile is already complete — redirect home
          if (cancelled) return;
          setStatus('done');
          if (!existingUser.investor_style) {
            router.push('/onboarding');
          } else {
            router.push('/');
          }
          return;
        }

        // ── Reconstruct profile from available sources ──────
        let profile: {
          firstName: string;
          lastName: string;
          investorStyle: string | null;
          riskTolerance: string | null;
        } | null = null;

        // Source 1: Pending profile stored by pre-signup flow
        try {
          const raw = sessionStorage.getItem('vantage_pending_profile');
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.firstName) profile = parsed;
          }
        } catch { /* ignore */ }

        // Source 2: Onboarding result
        if (!profile) {
          try {
            const raw = sessionStorage.getItem('vantage_onboarding_result');
            if (raw) {
              const parsed = JSON.parse(raw);
              if (parsed?.investorStyle) {
                profile = {
                  firstName: parsed.firstName || '',
                  lastName: parsed.lastName || '',
                  investorStyle: parsed.investorStyle,
                  riskTolerance: parsed.riskTolerance || 'Moderate',
                };
              }
            }
          } catch { /* ignore */ }
        }

        // Source 3: User metadata from session (email signup / OAuth)
        if (!profile) {
          const meta = session.user.user_metadata as Record<string, string> | undefined;
          profile = {
            firstName:
              meta?.first_name ||
              meta?.given_name ||
              meta?.name?.split(' ')[0] ||
              existingUser?.first_name ||
              '',
            lastName:
              meta?.last_name ||
              meta?.family_name ||
              meta?.name?.split(' ').slice(1).join(' ') ||
              existingUser?.last_name ||
              '',
            investorStyle:
              meta?.investor_style ||
              existingUser?.investor_style ||
              null,
            riskTolerance:
              meta?.risk_tolerance ||
              existingUser?.risk_tolerance ||
              'Moderate',
          };
        }

        if (!profile.firstName && !profile.lastName) {
          // No name available anywhere — still try to create with
          // whatever metadata we have (email prefix as fallback)
          const emailPrefix = session.user.email?.split('@')[0] || '';
          profile.firstName = emailPrefix || 'Trader';
          profile.lastName = '';
        }

        // ── Call /api/user/setup (service role, bypasses RLS) ──
        const setupRes = await fetch('/api/user/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            access_token: session.access_token,
            first_name: profile.firstName,
            last_name: profile.lastName,
            investor_style: profile.investorStyle,
            risk_tolerance: profile.riskTolerance,
          }),
          credentials: 'include',
        });

        if (cancelled) return;

        if (!setupRes.ok) {
          const errData = await setupRes.json().catch(() => null);
          throw new Error(
            (errData as any)?.error ||
            (errData as any)?.detail ||
            `Setup failed (${setupRes.status})`,
          );
        }

        // ── Clean up sessionStorage ───────────────────────────
        sessionStorage.removeItem('vantage_pending_profile');
        sessionStorage.removeItem('vantage_onboarding_result');
        // Signal to root page that setup just completed
        // (prevents immediate re-redirect back here due to DB lag)
        try {
          sessionStorage.setItem('vantage_setup_complete', '1');
        } catch { /* ignore */ }
        setStatus('done');

        // ── Redirect based on profile completeness ────────────
        if (!profile.investorStyle) {
          router.push('/onboarding');
        } else {
          router.push('/');
        }
      } catch (err: any) {
        if (cancelled) return;
        console.error('[auth/complete] Error:', err);
        // Show the actual error for debugging, not a generic message
        setErrorMsg(
          err?.message ||
          "Something went wrong setting up your account. Please try again.",
        );
        setStatus('error');
      }
    }

    completeAuth();

    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Processing state ─────────────────────────────────────────
  if (status === 'processing') {
    return (
      <div
        style={{
          height: '100dvh',
          background: GRADIENT,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: "'Playfair Display', Georgia, serif",
          color: '#e2e8f0',
          gap: 24,
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            border: '4px solid rgba(100,180,255,0.2)',
            borderTopColor: '#60a5fa',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
        <span style={{ fontSize: 18, letterSpacing: '0.5px' }}>
          Setting up your account…
        </span>
      </div>
    );
  }

  // ── Error state ──────────────────────────────────────────────
  if (status === 'error') {
    return (
      <div
        style={{
          height: '100dvh',
          background: GRADIENT,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: "'Playfair Display', Georgia, serif",
          color: '#e2e8f0',
          gap: 24,
          padding: 32,
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            border: '2px solid #ef4444',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 28,
          }}
        >
          ✕
        </div>
        <h2 style={{ fontSize: 22, margin: 0, fontWeight: 600 }}>
          Setup Failed
        </h2>
        <p
          style={{
            textAlign: 'center',
            color: '#94a3b8',
            lineHeight: 1.6,
            maxWidth: 340,
          }}
        >
          {errorMsg}
        </p>
        <button
          onClick={() => {
            setStatus('processing');
            setErrorMsg('');
            router.push('/login');
          }}
          style={{
            marginTop: 8,
            padding: '12px 32px',
            background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
            border: 'none',
            borderRadius: 12,
            color: '#fff',
            fontSize: 16,
            fontWeight: 600,
            cursor: 'pointer',
            letterSpacing: '0.3px',
          }}
        >
          Back to Vantage
        </button>
      </div>
    );
  }

  // ── Done state (renders briefly before redirect) ─────────────
  return (
    <div
      style={{
        height: '100dvh',
        background: GRADIENT,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'Playfair Display', Georgia, serif",
        color: '#e2e8f0',
        gap: 24,
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #22c55e, #16a34a)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 28,
        }}
      >
        ✓
      </div>
      <span style={{ fontSize: 18, letterSpacing: '0.5px' }}>
        Account ready
      </span>
    </div>
  );
}
