// ─── OAuth Completion Callback ───────────────────────────────
// Landing page after Google OAuth redirect.
// Reads pending profile from 3 sources in order:
//   1. sessionStorage 'vantage_pending_profile' (same-tab OAuth)
//   2. URL search params ?fn=&ln=&style=&risk= (new-tab fallback)
//   3. Supabase user metadata (Google-provided name)
// Writes user_profiles, seeds demo portfolio, redirects to app.

'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { VantageOrb } from '@/components/brand/VantageOrb';
import { getSupabaseBrowserClient } from '@/lib/auth/supabase-client';

// ── Same gradient as login page ──────────────────────────────

const GRADIENT = `
  radial-gradient(ellipse 150% 65% at 50% -15%, rgba(34,211,238,0.40) 0%, rgba(14,116,144,0.22) 35%, transparent 65%),
  radial-gradient(ellipse 70% 45% at 90% 100%, rgba(99,102,241,0.15) 0%, transparent 70%),
  #0a0f1e
`;

// ── Component ────────────────────────────────────────────────

export default function AuthCompletePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'processing' | 'error' | 'done'>('processing');
  const [errorMsg, setErrorMsg] = useState('');
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    async function completeAuth() {
      try {
        const supabase = getSupabaseBrowserClient();

        const { data: { session } } = await supabase.auth.getSession();

        if (!session) {
          setErrorMsg('Session not found. Please try signing in again.');
          setStatus('error');
          return;
        }

        // Check if profile already exists with investor style
        const { data: existing } = await (supabase
          .from('user_profiles') as any)
          .select('id, investor_style')
          .eq('id', session.user.id)
          .single();

        if (existing?.investor_style) {
          // Profile complete — go straight to app
          router.push('/');
          return;
        }

        // ── Try to get profile data from 3 sources ──────────

        interface ProfileData {
          firstName: string;
          lastName: string;
          investorStyle: string | null;
          riskTolerance: string | null;
        }

        let profile: ProfileData | null = null;

        // Source 1: sessionStorage (works when OAuth stays in same tab)
        const stored = sessionStorage.getItem('vantage_pending_profile');
        if (stored) {
          try {
            profile = JSON.parse(stored);
          } catch {}
        }

        // Source 2: URL params (fallback — survives new-tab OAuth flows)
        if (!profile) {
          const fn = searchParams.get('fn');
          const ln = searchParams.get('ln');
          const style = searchParams.get('style');
          const risk = searchParams.get('risk');

          if (fn && ln && style && risk) {
            profile = {
              firstName: fn,
              lastName: ln,
              investorStyle: style,
              riskTolerance: risk,
            };
          }
        }

        // Source 3: Partial profile from Google user metadata
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
          // Write profile
          const { error } = await (supabase.from('user_profiles') as any).upsert(
            {
              id: session.user.id,
              first_name: profile.firstName,
              last_name: profile.lastName,
              investor_style: profile.investorStyle,
              risk_tolerance: profile.riskTolerance,
              tier: 'demo',
              first_open: new Date().toISOString(),
              demo_expires_at: new Date(
                Date.now() + 30 * 24 * 60 * 60 * 1000,
              ).toISOString(),
            },
            { onConflict: 'id' },
          );

          if (error) throw error;

          // Seed demo portfolio (via server action if available)
          try {
            await seedDemoData(session.user.id);
          } catch (e) {
            console.error('[auth/complete] Demo seed failed:', e);
            // Don't fail signup for this
          }

          // Clear sessionStorage
          sessionStorage.removeItem('vantage_pending_profile');

          setStatus('done');

          // If no investor style (Source 3 fallback) — send to onboarding quiz
          if (!profile.investorStyle) {
            router.push('/onboarding');
          } else {
            router.push('/');
          }
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
          gap: '24px',
        }}
      >
        <VantageOrb size={80} animate />
        <p
          style={{
            fontFamily: 'var(--font-serif)',
            fontWeight: 400,
            fontStyle: 'italic',
            fontSize: '20px',
            color: '#ffffff',
          }}
        >
          Setting up your account…
        </p>
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
          gap: '24px',
          padding: '24px',
        }}
      >
        <p
          style={{
            fontFamily: 'var(--font-sans)',
            fontWeight: 500,
            fontSize: '16px',
            color: 'var(--text-secondary)',
            textAlign: 'center',
            maxWidth: '280px',
          }}
        >
          {errorMsg}
        </p>
        <button
          onClick={() => router.push('/')}
          style={{
            padding: '12px 32px',
            borderRadius: '999px',
            border: 'none',
            background: '#ffffff',
            color: '#000000',
            fontSize: '16px',
            fontWeight: 600,
            fontFamily: 'var(--font-sans)',
            cursor: 'pointer',
          }}
        >
          Back to Vantage
        </button>
      </div>
    );
  }

  // Done — redirect handled above
  return null;
}

// ── Demo data seeding ─────────────────────────────────────────
// Imported dynamically to avoid bundling server-only code

async function seedDemoData(userId: string) {
  if (typeof window === 'undefined') return;
  try {
    await fetch('/api/auth/complete-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
  } catch {
    // Silently fail — seed is best-effort
  }
}
