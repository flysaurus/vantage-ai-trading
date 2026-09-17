// ─── BugPin tester flag + embed config ───────────────────────────
// Pure config/predicate for the BugPin bug-report widget, kept out of the React
// component so it is unit-testable without a DOM.
//
// Gating rule (Em, 2026-09-17): the widget is injected ONLY for users whose
// public.users.is_tester is true (migration 079). Everything else — logged-out,
// profile fetch failed, column missing — means "do not inject". Fail closed.

export const BUGPIN_WIDGET_SRC =
  process.env.NEXT_PUBLIC_BUGPIN_WIDGET_URL ||
  'https://vantage-ai-trading.duckdns.org/widget.js';

// BugPin project key for the "Vantage" project. Public by design: it ships in
// the embed snippet and in the client bundle.
export const BUGPIN_WIDGET_API_KEY =
  process.env.NEXT_PUBLIC_BUGPIN_API_KEY || 'proj_5607fda83911476fa0d894210826428d';

/** True only when the loaded profile explicitly says so. */
export function isTesterProfile(
  user: Record<string, unknown> | null | undefined,
): boolean {
  return user?.is_tester === true;
}

/** Is the embed fully configured (src + key present)? */
export function bugpinConfigured(): boolean {
  return Boolean(BUGPIN_WIDGET_SRC) && Boolean(BUGPIN_WIDGET_API_KEY);
}
