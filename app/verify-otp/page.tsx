// ─── Redirect: /verify-otp → /verify-email ──────────────────
// Some OTP emails link to /verify-otp?email=X&otp=YYYYYY (likely from
// a Supabase email template). This page maps those params and redirects
// to the actual /verify-email page so users land on the correct OTP entry form.

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function VerifyOtpRedirect() {
  const router = useRouter();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const email = params.get('email');
    const otp = params.get('otp'); // maps to 'code' param on /verify-email

    if (email && otp) {
      router.replace(
        `/verify-email?email=${encodeURIComponent(email)}&code=${otp}`
      );
    } else if (email) {
      router.replace(`/verify-email?email=${encodeURIComponent(email)}`);
    } else {
      router.replace('/verify-email');
    }
  }, [router]);

  return null;
}
