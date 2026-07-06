// ─── LearningLibrary ─────────────────────────────────────────
// Browsable overlay of all learning cards, grouped by category.
// Opened via the 📚 button in the AI tab header.
// Supports both free browsing AND the existing auto-trigger flow.
//
// When a card is selected, it renders inline (same format as
// the auto-triggered LearningMomentCard) with Got it / Dismiss.

'use client';

import { useState } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { LEARNING_CARDS, LEARNING_CATEGORIES } from '@/lib/learning/triggers';
import { isConceptShown, markConceptShown } from '@/lib/learning/detector';
import type { LearningCard } from '@/lib/learning/triggers';

interface LearningLibraryProps {
  open: boolean;
  onClose: () => void;
}

const LEVEL_COLORS: Record<string, string> = {
  Apprentice: '#22d3ee',
  Trader: '#a78bfa',
  Investor: '#fbbf24',
};

export function LearningLibrary({ open, onClose }: LearningLibraryProps) {
  const [selectedCard, setSelectedCard] = useState<LearningCard | null>(null);
  const [justMarked, setJustMarked] = useState<Set<string>>(new Set());
  const { user } = useAuth() as any;

  if (!open) return null;

  function handleGotIt() {
    if (!selectedCard) return;
    markConceptShown(selectedCard.term);
    setJustMarked(prev => new Set([...prev, selectedCard.term]));

    // Award XP
    const userId = user?.id || '';
    if (userId) {
      fetch('/api/gamification/increment-learning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, xpAmount: selectedCard.xp }),
      }).then(res => {
        if (res.ok) {
          res.json().then(({ newScore }) => {
            window.dispatchEvent(new CustomEvent('vantage-gamification', {
              detail: { type: 'score_updated', payload: { totalScore: newScore, source: 'learning' } },
            }));
          });
        }
      }).catch(() => {});
    }
  }

  function handleBack() {
    setSelectedCard(null);
  }

  // ── Full card detail view ────────────────────────────────
  if (selectedCard) {
    return (
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 10000, background: '#0a0f1e',
        display: 'flex', flexDirection: 'column',
        paddingBottom: 'max(calc(env(safe-area-inset-bottom) + 80px), 100px)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '12px',
          padding: '16px', borderBottom: '1px solid #1e293b',
        }}>
          <button onClick={handleBack} style={{
            background: 'none', border: 'none', color: '#94a3b8',
            fontSize: '20px', cursor: 'pointer', padding: '4px 8px',
          }}>←</button>
          <span style={{ fontSize: '24px' }}>{selectedCard.emoji || '📚'}</span>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflow: 'auto', padding: '20px 16px' }}>
          {/* Level pill */}
          <span style={{
            display: 'inline-block',
            background: `${LEVEL_COLORS[selectedCard.level] || '#22d3ee'}20`,
            color: LEVEL_COLORS[selectedCard.level] || '#22d3ee',
            padding: '3px 10px', borderRadius: '4px',
            fontSize: '10px', fontWeight: '700',
            letterSpacing: '0.05em', marginBottom: '12px',
          }}>{selectedCard.level}</span>

          <h2 style={{
            fontSize: '22px', fontWeight: '700', color: '#ffffff',
            margin: '0 0 16px 0', lineHeight: 1.3,
          }}>{selectedCard.headline}</h2>

          <p style={{
            fontSize: '15px', color: '#cbd5e1', lineHeight: 1.7,
            marginBottom: '20px',
          }}>{selectedCard.body}</p>

          {/* Example box */}
          <div style={{
            background: '#1a2235', borderRadius: '10px',
            padding: '14px 16px', marginBottom: '20px',
            border: '1px solid #2a3548',
          }}>
            <p style={{
              fontSize: '11px', fontWeight: '600', color: '#e2e8f0',
              textTransform: 'uppercase', letterSpacing: '0.08em',
              marginBottom: '8px',
            }}>💡 Example</p>
            <p style={{
              fontSize: '14px', color: '#94a3b8', lineHeight: 1.6,
              margin: 0,
            }}>{selectedCard.example}</p>
          </div>

          {/* XP info */}
          <p style={{
            fontSize: '13px', color: '#e2e8f0', marginBottom: '8px',
          }}>
            +{selectedCard.xp} XP when learned
          </p>

          {/* Investopedia link */}
          {selectedCard.investopediaSlug && (
            <a
              href={`https://www.investopedia.com/terms/${selectedCard.investopediaSlug.replace(/^[a-z]\//, '')}`}
              target="_blank" rel="noopener noreferrer"
              style={{
                fontSize: '13px', color: '#22d3ee',
                textDecoration: 'none', display: 'block',
              }}
            >Learn more on Investopedia →</a>
          )}

          {justMarked.has(selectedCard.term) && (
            <p style={{
              fontSize: '11px', color: '#22d3ee', marginTop: '12px',
            }}>✓ Learned! Won't trigger automatically anymore</p>
          )}
        </div>

        {/* Bottom buttons */}
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          padding: '12px 16px',
          paddingBottom: 'max(calc(env(safe-area-inset-bottom) + 20px), 30px)',
          background: '#0a0f1e', borderTop: '1px solid #1e293b',
          display: 'flex', gap: '10px',
        }}>
          <button onClick={() => setSelectedCard(null)} style={{
            flex: 1, padding: '13px', background: 'transparent',
            border: '1px solid #374151', borderRadius: '10px',
            color: '#94a3b8', fontSize: '14px', fontWeight: '600',
            cursor: 'pointer',
          }}>Dismiss</button>
          {!justMarked.has(selectedCard.term) && (
            <button onClick={handleGotIt} style={{
              flex: 1, padding: '13px', background: '#22d3ee',
              border: 'none', borderRadius: '10px',
              color: '#0a0f1e', fontSize: '14px', fontWeight: '700',
              cursor: 'pointer',
            }}>Got it! (+{selectedCard.xp})</button>
          )}
        </div>
      </div>
    );
  }

  // ── Grid / list view ─────────────────────────────────────
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      zIndex: 10000, background: '#0a0f1e',
      display: 'flex', flexDirection: 'column',
      paddingBottom: 'max(calc(env(safe-area-inset-bottom) + 20px), 30px)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '16px', borderBottom: '1px solid #1e293b',
      }}>
        <div>
          <p style={{ fontSize: '18px', fontWeight: '700', color: '#ffffff', margin: 0 }}>
            📚 Learning Library
          </p>
          <p style={{ fontSize: '12px', color: '#e2e8f0', marginTop: '4px' }}>
            {Object.keys(LEARNING_CARDS).length} financial concepts · tap to learn
          </p>
        </div>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', color: '#94a3b8',
          fontSize: '24px', cursor: 'pointer', padding: '4px 8px',
        }}>✕</button>
      </div>

      {/* Scrollable category list */}
      <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
        {LEARNING_CATEGORIES.map(cat => {
          const cards = Object.values(cat.cards);
          return (
            <div key={cat.id} style={{ marginBottom: '24px' }}>
              <p style={{
                fontSize: '11px', fontWeight: '600',
                color: '#e2e8f0', textTransform: 'uppercase',
                letterSpacing: '0.08em', marginBottom: '10px',
              }}>{cat.label}</p>

              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px',
              }}>
                {cards.map(card => {
                  const shown = isConceptShown(card.term) || justMarked.has(card.term);
                  return (
                    <button
                      key={card.term}
                      onClick={() => setSelectedCard(card)}
                      style={{
                        background: shown ? '#11192b' : '#1a2235',
                        border: shown ? '1px solid #1e293b' : '1px solid #2a3548',
                        borderRadius: '10px', padding: '14px 12px',
                        cursor: 'pointer', textAlign: 'left' as const,
                        display: 'flex', flexDirection: 'column',
                        gap: '6px', opacity: shown ? 0.55 : 1,
                      }}
                    >
                      <span style={{ fontSize: '22px' }}>{card.emoji || '📖'}</span>
                      <span style={{
                        fontSize: '13px', fontWeight: '600', color: '#ffffff',
                        lineHeight: 1.3,
                      }}>{card.headline}</span>
                      <span style={{
                        fontSize: '10px', fontWeight: '600',
                        color: LEVEL_COLORS[card.level] || '#22d3ee',
                      }}>{card.level} · +{card.xp} XP</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
