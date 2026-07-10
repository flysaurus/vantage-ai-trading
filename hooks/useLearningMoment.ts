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
  const cardShownAt = useRef<number>(0);
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
        cardShownAt.current = Date.now();
        setLearningCard(card);
      }
    }, SHOW_DELAY);

    return () => clearTimeout(timer);
    // We intentionally don't include learningCard in deps to avoid
    // re-triggering when the card state changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiResponse]);

  // ── Award XP + dismiss ─────────────────────────────────
  async function dismissLearning(gotIt: boolean) {
    if (gotIt && learningCard) {
      const anonymousId = user?.id || '';
      if (anonymousId) {
        // isDeep = true when user spent >30s reading before clicking Got It.
        // 📋 Only 1 of 3 planned deep-engagement triggers is live:
        // (1) time-on-page >30s ✅  (2) follow-up question ❌  (3) applied insight ❌
        const timeOnCard = cardShownAt.current ? Date.now() - cardShownAt.current : 0;
        const isDeep = timeOnCard > 30_000;

        try {
          const res = await fetch('/api/gamification/increment-learning', { credentials: 'include',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              anonymousId,
              xpAmount: learningCard.xp,
              isDeep,
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
            console.error('[useLearningMoment] XP award rejected:', res.status);
          }
        } catch (err) {
          console.error('[useLearningMoment] XP award failed:', err);
        }
      }
    }

    cardShownAt.current = 0;
    setLearningCard(null);
  }

  return { learningCard, dismissLearning };
}
