// ─── useLearningMoment ───────────────────────────────────────
// Hook for AI chat components. After AI response completes,
// scans for financial concepts and surfaces a LearningMomentCard.
//
// Usage in AITab:
//   const { learningCard, dismissLearning } =
//     useLearningMoment(lastAIResponse, conversationId);
//   // Render <LearningMomentCard card={learningCard} ... />

'use client';

import { useState, useEffect, useRef } from 'react';
import { detectLearningMoment } from '@/lib/learning/detector';
import type { LearningCard } from '@/lib/learning/triggers';
import { isLearningEnabled } from '@/lib/learning/preferences';
import { useAuth } from '@/components/providers/AuthProvider';

// ─── Constants ───────────────────────────────────────────────

const SHOW_DELAY = 1500; // ms after response before showing card

// ─── Hook ────────────────────────────────────────────────────

export function useLearningMoment(
  aiResponse: string | null,
  conversationId: string | null
) {
  const [learningCard, setLearningCard] = useState<LearningCard | null>(null);
  const shownThisConversation = useRef<Set<string>>(new Set());
  const lastConversationId = useRef<string | null>(null);
  const { user } = useAuth();

  // Reset shown-concepts when conversation changes
  useEffect(() => {
    if (conversationId !== lastConversationId.current) {
      lastConversationId.current = conversationId;
      shownThisConversation.current.clear();
      setLearningCard(null);
    }
  }, [conversationId]);

  // Detect learning moments after response arrives
  useEffect(() => {
    if (!aiResponse) return;
    if (learningCard) return; // already showing one

    const timer = setTimeout(() => {
      if (!isLearningEnabled()) return;
      const card = detectLearningMoment(aiResponse, shownThisConversation.current);
      if (card) {
        shownThisConversation.current.add(card.term);
        setLearningCard(card);
      }
    }, SHOW_DELAY);

    return () => clearTimeout(timer);
    // We intentionally don't include learningCard in deps to avoid
    // re-triggering when the card state changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiResponse]);

  // ── Award score points + dismiss ────────────────────────
  async function dismissLearning(gotIt: boolean) {
    if (gotIt && learningCard) {
      const anonymousId = user?.id || '';
      if (anonymousId) {
        // Every completion is deep engagement.
        //
        // Previous design considered follow-up questions and applied-insight detection
        // as additional gates for isDeep. Both were intentionally dropped: the
        // Understanding pillar is earned through completion, not forced friction.
        // No anti-farming protection is needed at current scale — revisit if abuse
        // becomes a real issue.

        try {
          const res = await fetch('/api/gamification/increment-learning', { credentials: 'include',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              anonymousId,
              xpAmount: learningCard.xp, // kept for API compat, actual scoring uses isDeep
              isDeep: true,
            }),
          });

          if (res.ok) {
            const { newScore } = await res.json();
            // Dispatch score update so PlayerStatusBar counts up
            window.dispatchEvent(
              new CustomEvent('vantage-gamification', {
                detail: {
                  type: 'score_updated',
                  payload: { totalScore: newScore, source: 'learning' },
                },
              })
            );
          } else {
            console.error('[useLearningMoment] Score award rejected:', res.status);
          }
        } catch (err) {
          console.error('[useLearningMoment] Score award failed:', err);
        }
      }
    }

    setLearningCard(null);
  }

  return { learningCard, dismissLearning };
}
