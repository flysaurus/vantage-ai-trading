// ─── Returning to the app shell from a stand-alone sub-page ─────────────────
//
// Strategy-setup pages (and any other route that lives OUTSIDE the app shell)
// have to re-mount MainApp at '/' when the user backs out. Two things have to
// be true for that to feel right:
//
//   1. Land where the user came from — the tab they launched the flow from
//      (Portfolio, Invest, Insights) — not on the default tab.
//   2. Don't re-present the "Welcome to Vantage" account picker. MainApp shows
//      it on mount whenever the persistent opt-out key is absent, so every
//      Cancel looked like a jump back to the beginning of onboarding.
//
// Browser history is NOT a reliable signal here (Next tracks its entries in
// history.state without an index, and a sub-page can be the first entry of a
// fresh tab), so the destination is derived from `rememberTab()` — the tab the
// shell last had active in this browser tab — with an explicit fallback for
// cold entries (deep links, email CTAs).

type NavRouter = { push: (href: string) => void };

export const SKIP_ACCOUNT_SELECT_ONCE = 'vantage:skipAccountSelectOnce';
export const LAST_TAB_KEY = 'vantage:lastTab';

/** Suppress the account picker on the next MainApp mount (consumed exactly once). */
export function suppressAccountPickerOnce() {
  if (typeof window === 'undefined') return;
  try { sessionStorage.setItem(SKIP_ACCOUNT_SELECT_ONCE, '1'); } catch { /* private mode */ }
}

/** Record the shell's active tab so sub-pages can hand the user back to it. */
export function rememberTab(tab: string) {
  if (typeof window === 'undefined') return;
  try { sessionStorage.setItem(LAST_TAB_KEY, tab); } catch { /* private mode */ }
}

function readLastTab(): string | null {
  if (typeof window === 'undefined') return null;
  try { return sessionStorage.getItem(LAST_TAB_KEY); } catch { return null; }
}

/**
 * Go back to the app shell the way the user arrived.
 * @param fallback destination when the shell hasn't been seen in this browser
 *                 tab (deep link / email CTA / fresh tab). Defaults to the tab
 *                 that owns allocation work.
 */
export function returnToApp(router: NavRouter, fallback = '/?tab=portfolio') {
  suppressAccountPickerOnce();
  const last = readLastTab();
  router.push(last ? `/?tab=${last}` : fallback);
}
