'use client';

// ─── BugPin bug-report widget — testers only ─────────────────────
//
// BugPin is a self-hosted bug reporter. Its embed is a third-party script, so it
// is deliberately a CLIENT component with no server-side rendering:
//
//   • a non-tester's HTML never contains the script tag (nothing to strip later)
//   • the gate is the session profile that AuthProvider already loads
//     (/api/auth/me → public.users.is_tester, migration 079)
//   • it FAILS CLOSED — logged-out user, failed profile fetch, or a missing
//     column (migration not applied yet) all mean "do not inject"
//
// The widget reads data-api-key from its own script tag and derives its API
// origin from the script src, so BUGPIN_WIDGET_SRC must point at the BugPin
// server that serves /widget.js (see lib/tester/bugpin.ts for overrides).

import Script from 'next/script';
import { useAuth } from '@/components/providers/AuthProvider';
import {
  BUGPIN_WIDGET_SRC,
  BUGPIN_WIDGET_API_KEY,
  bugpinConfigured,
  isTesterProfile,
} from '@/lib/tester/bugpin';

export function BugPinTesterEmbed() {
  const { user, isLoading } = useAuth();

  // Wait for the profile, then gate on the flag. Never fall through to
  // "render the widget" on an unresolved user.
  if (isLoading) return null;
  if (!isTesterProfile(user)) return null;
  if (!bugpinConfigured()) return null;

  return (
    <Script
      id="bugpin-widget-script"
      src={BUGPIN_WIDGET_SRC}
      data-api-key={BUGPIN_WIDGET_API_KEY}
      strategy="afterInteractive"
    />
  );
}
