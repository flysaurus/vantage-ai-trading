// ─── Learning: read-state ────────────────────────────────────
// Tracks which concepts you've already read, so the library can dim them.
//
// The old AI-response concept detector (which surfaced learning cards inside chat)
// was removed on Em's call — no unsolicited cards in the Rufus chat.

// ─── Constants ───────────────────────────────────────────────

const STORAGE_KEY = 'vantage_shown_concepts';

// ─── Storage helpers ────────────────────────────────────────

/** Get all concepts ever shown (from localStorage) */
export function getShownConcepts(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** Mark a concept as shown (persists to localStorage) */
export function markConceptShown(concept: string): void {
  if (typeof window === 'undefined') return;
  try {
    const existing = getShownConcepts();
    if (!existing.includes(concept)) {
      existing.push(concept);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
    }
  } catch {
    // localStorage full or private browsing — non-fatal
  }
}

/** Check if a concept has already been shown */
export function isConceptShown(concept: string): boolean {
  return getShownConcepts().includes(concept);
}
