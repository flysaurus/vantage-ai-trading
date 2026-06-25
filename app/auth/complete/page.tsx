// ─── OAuth Completion Callback ───────────────────────────────
// Landing page after Google OAuth redirect.
// Reads pending profile from sessionStorage, writes user_profiles
// via server action, seeds demo portfolio, then redirects to main app.

'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';

export default function AuthCompletePage() {
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'complete' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    async function complete() {
      const supabase = createClient();

      try {
        // Wait for OAuth session to be established
        const { data: sessionData, error: sessionError } =
          await supabase.auth.getSession();

        if (sessionError || !sessionData.session?.user) {
          console.error('[auth/complete] No session found:', sessionError?.message);
          setStatus('error');
          setErrorMsg('Could not verify your account. Please try signing up again.');
          return;
        }

        const user = sessionData.session.user;

        // Read pending profile from sessionStorage
        let pendingProfile: {
          firstName: string;
          lastName: string;
          investorStyle: string;
          riskTolerance: string;
        } | null = null;

        try {
          const raw = sessionStorage.getItem('vantage_pending_profile');
          if (raw) {
            pendingProfile = JSON.parse(raw);
            sessionStorage.removeItem('vantage_pending_profile');
          }
        } catch (err) {
          console.error('[auth/complete] Failed to read pending profile:', err);
        }

        if (pendingProfile) {
          // New user — write user_profiles via server action
          const profileRes = await fetch('/api/auth/complete-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: user.id,
              firstName: pendingProfile.firstName,
              lastName: pendingProfile.lastName,
              investorStyle: pendingProfile.investorStyle,
              riskTolerance: pendingProfile.riskTolerance,
            }),
          });

          if (!profileRes.ok) {
            console.error('[auth/complete] Profile creation failed:', await profileRes.text());
            // Continue anyway — user is authenticated, profile can be created later
          }
        } else {
          // Returning user or no pending profile — check if profile exists
          const { data: profile } = await supabase
            .from('user_profiles')
            .select('id')
            .eq('id', user.id)
            .maybeSingle();

          if (!profile) {
            // No profile and no pending data — redirect to onboarding
            console.log('[auth/complete] No profile found, redirecting to onboarding');
            router.replace('/onboarding');
            return;
          }
        }

        setTimeout(() => {
          router.replace('/');
        }, 500);
      } catch (err: any) {
        console.error('[auth/complete] Error:', err);
        setStatus('error');
        setErrorMsg('Something went wrong. Please try again.');
      }
    }

    complete();
  }, [router]);

  if (status === 'error') {
    return (
      <div
        style={{
          minHeight: '100dvh',
          background: 'var(--bg-primary)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          gap: '16px',
        }}
      >
        <p style={{ color: 'var(--loss)', fontSize: '14px', textAlign: 'center' }}>
          {errorMsg}
        </p>
        <button
          onClick={() => router.push('/onboarding')}
          style={{
            padding: '10px 24px',
            borderRadius: '999px',
            border: '1px solid var(--border-subtle)',
            background: 'transparent',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-sans)',
            fontSize: '14px',
            cursor: 'pointer',
          }}
        >
          Back to Onboarding
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: '100dvh',
        background: 'var(--bg-primary)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        gap: '16px',
      }}
    >
      <div
        style={{
          width: '32px',
          height: '32px',
          border: '3px solid var(--border-subtle)',
          borderTopColor: 'var(--accent)',
          borderRadius: '50%',
          animation: 'spin 0.7s linear infinite',
        }}
      />
      <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
        Setting up your account…
      </p>
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
