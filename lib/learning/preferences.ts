// ─── Learning Preferences ───────────────────────────────────
// Controls whether Learning Moment cards appear.
// Stored in localStorage so it persists across sessions.

const STORAGE_KEY = 'vantage_learning_enabled';

/** Check if learning moments are enabled (default: true) */
export function isLearningEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const val = localStorage.getItem(STORAGE_KEY);
    if (val === null) return true; // default on
    return val !== 'false';
  } catch {
    return true;
  }
}

/** Set learning preference */
export function setLearningEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, String(enabled));
  } catch {
    // storage full — non-fatal
  }
}
