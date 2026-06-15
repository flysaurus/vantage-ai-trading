// ─── Learning: Detector ──────────────────────────────────────
// Scans AI responses for financial concepts and returns the
// first unmatched learning card.
//
// Never triggers twice for the same concept (localStorage).
// Max 1 per conversation (tracked per session via shownConcepts set).

import { LEARNING_CARDS } from './triggers';
import type { LearningCard } from './triggers';

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

// ─── Detection ───────────────────────────────────────────────

/**
 * Scan an AI response for learning triggers.
 *
 * @param aiResponse - The full AI response text (case-insensitive scan)
 * @param shownThisSession - Concepts already surfaced in this conversation
 * @returns The first matching LearningCard, or null if none found
 */
export function detectLearningMoment(
  aiResponse: string,
  shownThisSession: Set<string>
): LearningCard | null {
  if (!aiResponse) return null;

  const lower = aiResponse.toLowerCase();

  for (const [keyword, card] of Object.entries(LEARNING_CARDS)) {
    // Skip if already shown ever (localStorage) or shown this session
    if (isConceptShown(card.term)) continue;
    if (shownThisSession.has(card.term)) continue;

    // Case-insensitive keyword scan
    if (lower.includes(keyword.toLowerCase())) {
      return card;
    }
  }

  return null;
}
