// ─── Flow State ─────────────────────────────────────────────
// Manages the splash/onboarding flow routing decisions.
// Separates "quiz complete" from "intro seen" so the full
// splash sequence plays exactly once even if the user closes
// mid-quiz.

const INTRO_SEEN_KEY = 'vantage_intro_seen';

/** Returns true if the Feature Splash + Arrival have been seen. */
export function isIntroSeen(): boolean {
  if (typeof window === 'undefined') return true; // SSR safe
  try {
    return localStorage.getItem(INTRO_SEEN_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Marks the intro sequence as seen. Call after Feature Splash line 3 fades out. */
export function markIntroSeen(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(INTRO_SEEN_KEY, 'true');
  } catch {}
}
