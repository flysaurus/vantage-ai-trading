// ─── /auth/complete ──────────────────────────────────────────
// Post-OAuth signup completion page. Writes the user's profile
// (users + user_profiles) after Google sign-in supplies the email.
//
// Data is split across two tables:
//   public.users         → parent (id, email, name)
//   public.user_profiles → extended profile (FK → users.id)
// user_profiles has NO user_id or email columns — uses id as PK.

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
    async function completeAuth() {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data: { session } } = await supabase.auth.getSession();

        if (!session) {
          setErrorMsg('Session not found. Please try signing in again.');
          setStatus('error');
          return;
        }

        // Check if users row exists
        const { data: existingUser } = await (supabase
          .from('users') as any)
          .select('id')
          .eq('id', session.user.id)
          .maybeSingle();

        const { data: existingProfile } = await (supabase
          .from('user_profiles') as any)
          .select('id')
          .eq('id', session.user.id)
          .maybeSingle();

        if (!existingUser && !existingProfile) {
          // ── Reconstruct profile from sessionStorage ──────────
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
          } catch {}

          // Source 2: Onboarding result
          try {
            const raw = sessionStorage.getItem('vantage_onboarding_result');
            if (raw) {
              const parsed = JSON.parse(raw);
              if (parsed?.investorStyle) {
                profile = {
                  firstName: parsed.firstName || profile?.firstName || '',
                  lastName: parsed.lastName || profile?.lastName || '',
                  investorStyle: parsed.investorStyle,
                  riskTolerance: parsed.riskTolerance || 'Moderate',
                };
              }
            }
          } catch {}

          // Source 3: Google user metadata
          if (!profile) {
            const meta = session.user.user_metadata as Record<string, string> | undefined;
            profile = {
              firstName: meta?.given_name || meta?.name?.split(' ')[0] || '',
              lastName: meta?.family_name || meta?.name?.split(' ').slice(1).join(' ') || '',
              investorStyle: null,
              riskTolerance: null,
            };
          }

          if (profile) {
            const now = new Date().toISOString();
            const demoExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

            // Create parent users row
            const { error: userError } = await (supabase
              .from('users') as any)
              .insert({
                id: session.user.id,
                email: session.user.email,
                first_name: profile.firstName,
                last_name: profile.lastName,
              });

            if (userError) throw userError;

            // Create user_profiles row (no user_id or email columns)
            const { error: profileError } = await (supabase
              .from('user_profiles') as any)
              .insert({
                id: session.user.id,
                first_name: profile.firstName,
                last_name: profile.lastName,
                investor_style: profile.investorStyle,
                risk_tolerance: profile.riskTolerance,
                tier: 'demo',
                first_open: now,
                demo_expires_at: demoExpiry,
              });

            if (profileError) throw profileError;

            // Demo portfolio seed will happen server-side on first portfolio access

            sessionStorage.removeItem('vantage_pending_profile');
            setStatus('done');

            if (!profile.investorStyle) {
              router.push('/onboarding');
            } else {
              router.push('/');
            }
          }
        } else {
          // Profile already exists — skip
          setStatus('done');
          router.push('/');
        }
      } catch (err: any) {
        console.error('[auth/complete] Error:', err);
        setErrorMsg(
          "Something went wrong setting up your account. Please try again.",
        );
        setStatus('error');
      }
    }

    completeAuth();
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
