// ─── LearningLibrary ─────────────────────────────────────────
// Browsable overlay of all learning cards.
// Opened via the 📚 button in the AI tab header.
//
// Two views:
//   • Path (default) — the ordered CURRICULUM: Stage → Module → Topic, with a
//     "Next up" pointer and per-stage read counts. SOFT gating only: nothing is
//     locked, you can read in any order.
//   • All topics — a searchable A–Z list of every card.
//
// Reading a card just marks it read (it dims so you can see what you've covered).
// No points, no score, no gamification — ever.

'use client';

import { useState } from 'react';
import { LEARNING_CARDS } from '@/lib/learning/triggers';
import { isConceptShown, markConceptShown } from '@/lib/learning/detector';
import { CURRICULUM, nextUpTopic } from '@/lib/learning/curriculum';
import type { LearningCard } from '@/lib/learning/triggers';

interface LearningLibraryProps {
  open: boolean;
  onClose: () => void;
}

type View = 'path' | 'all';

const LEVEL_COLORS: Record<string, string> = {
  Apprentice: '#22d3ee',
  Trader: '#a78bfa',
  Investor: '#fbbf24',
};

// Plain-language difficulty. The old Apprentice/Trader/Investor rank names were
// gamification framing; the underlying tier is just how advanced the concept is.
const LEVEL_LABELS: Record<string, string> = {
  Apprentice: 'Beginner',
  Trader: 'Intermediate',
  Investor: 'Advanced',
};

// This overlay is full-screen (z-10000) and covers the app chrome, so its own bottom
// edges only need to clear the home-indicator safe area.
const BAR_PAD = 'calc(12px + env(safe-area-inset-bottom, 0px))';
const difficulty = (level: string) => LEVEL_LABELS[level] || level;

// Shared overlay palette.
const BG = '#0a0f1e';
const BORDER = '#1e293b';
const BORDER_2 = '#2a3548';
const TILE = '#1a2235';
const TILE_READ = '#11192b';
const ACCENT = '#22d3ee';
const MUTED = '#94a3b8';

export function LearningLibrary({ open, onClose }: LearningLibraryProps) {
  const [view, setView] = useState<View>('path');
  const [selectedCard, setSelectedCard] = useState<LearningCard | null>(null);
  const [justMarked, setJustMarked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');

  if (!open) return null;

  // Read state is keyed by the card's display term, not the curriculum key.
  // A topic with no card yet simply isn't rendered / counted.
  const cardFor = (key: string): LearningCard | undefined => LEARNING_CARDS[key];
  const isRead = (key: string): boolean => {
    const card = cardFor(key);
    if (!card) return false;
    return isConceptShown(card.term) || justMarked.has(card.term);
  };

  // Reading a concept just marks it as read (it dims so you can see what you've
  // covered). No points, no score, no gamification.
  function handleGotIt() {
    if (!selectedCard) return;
    markConceptShown(selectedCard.term);
    setJustMarked(prev => new Set([...prev, selectedCard.term]));
  }

  // The single first-unread topic in path order, skipping anything not yet written.
  const nextUpKey = nextUpTopic(isRead);

  // ── Full card detail view ────────────────────────────────
  if (selectedCard) {
    return (
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 10000, background: BG,
        display: 'flex', flexDirection: 'column',
        paddingBottom: BAR_PAD,
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '12px',
          padding: '16px', borderBottom: `1px solid ${BORDER}`,
        }}>
          <button onClick={() => setSelectedCard(null)} style={{
            background: 'none', border: 'none', color: MUTED,
            fontSize: '20px', cursor: 'pointer', padding: '4px 8px',
          }}>←</button>
          <span style={{ fontSize: '24px' }}>{selectedCard.emoji || '📚'}</span>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflow: 'auto', padding: '20px 16px' }}>
          {/* Level pill */}
          <span style={{
            display: 'inline-block',
            background: `${LEVEL_COLORS[selectedCard.level] || ACCENT}20`,
            color: LEVEL_COLORS[selectedCard.level] || ACCENT,
            padding: '3px 10px', borderRadius: '4px',
            fontSize: '10px', fontWeight: '700',
            letterSpacing: '0.05em', marginBottom: '12px',
          }}>{difficulty(selectedCard.level)}</span>

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
            border: `1px solid ${BORDER_2}`,
          }}>
            <p style={{
              fontSize: '11px', fontWeight: '600', color: '#e2e8f0',
              textTransform: 'uppercase', letterSpacing: '0.08em',
              marginBottom: '8px',
            }}>💡 Example</p>
            <p style={{
              fontSize: '14px', color: MUTED, lineHeight: 1.6,
              margin: 0,
            }}>{selectedCard.example}</p>
          </div>

          {/* Investopedia link */}
          {selectedCard.investopediaSlug && (
            <a
              href={`https://www.investopedia.com/terms/${selectedCard.investopediaSlug}.asp`}
              target="_blank" rel="noopener noreferrer"
              style={{
                fontSize: '13px', color: ACCENT,
                textDecoration: 'none', display: 'block',
              }}
            >Learn more on Investopedia →</a>
          )}

          {justMarked.has(selectedCard.term) && (
            <p style={{
              fontSize: '11px', color: ACCENT, marginTop: '12px',
            }}>✓ Marked as read</p>
          )}
        </div>

        {/* Bottom buttons */}
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          padding: '12px 16px',
          paddingBottom: BAR_PAD,
          background: BG, borderTop: `1px solid ${BORDER}`,
          display: 'flex', gap: '10px',
        }}>
          <button onClick={() => setSelectedCard(null)} style={{
            flex: 1, padding: '13px', background: 'transparent',
            border: '1px solid #374151', borderRadius: '10px',
            color: MUTED, fontSize: '14px', fontWeight: '600',
            cursor: 'pointer',
          }}>Dismiss</button>
          {!justMarked.has(selectedCard.term) && (
            <button onClick={handleGotIt} style={{
              flex: 1, padding: '13px', background: ACCENT,
              border: 'none', borderRadius: '10px',
              color: BG, fontSize: '14px', fontWeight: '700',
              cursor: 'pointer',
            }}>Got it!</button>
          )}
        </div>
      </div>
    );
  }

  // ── Path view ────────────────────────────────────────────
  const pathTotal = CURRICULUM.reduce(
    (n, s) => n + s.modules.reduce((m, mod) => m + mod.topics.filter(t => cardFor(t.key)).length, 0),
    0,
  );

  // ── All-topics view ──────────────────────────────────────
  const q = query.trim().toLowerCase();
  const allCards = Object.values(LEARNING_CARDS)
    .filter(c => !q || c.term.toLowerCase().includes(q) || c.headline.toLowerCase().includes(q))
    .sort((a, b) => a.term.localeCompare(b.term));

  const subtitle = view === 'path'
    ? `${pathTotal} concepts across 4 stages · read in any order`
    : `${Object.keys(LEARNING_CARDS).length} concepts · search all topics`;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      zIndex: 10000, background: BG,
      display: 'flex', flexDirection: 'column',
      paddingBottom: BAR_PAD,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        gap: '12px', padding: '16px', borderBottom: `1px solid ${BORDER}`,
      }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: '18px', fontWeight: '700', color: '#ffffff', margin: 0 }}>
            📚 Learning Library
          </p>
          <p style={{ fontSize: '12px', color: '#e2e8f0', marginTop: '4px' }}>
            {subtitle}
          </p>
        </div>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', color: MUTED,
          fontSize: '24px', cursor: 'pointer', padding: '4px 8px', flexShrink: 0,
        }}>✕</button>
      </div>

      {/* View toggle */}
      <div style={{ display: 'flex', gap: '8px', padding: '12px 16px 0' }}>
        {(['path', 'all'] as View[]).map(v => {
          const active = view === v;
          return (
            <button key={v} onClick={() => setView(v)} style={{
              padding: '7px 14px', background: active ? `${ACCENT}1a` : 'transparent',
              border: `1px solid ${active ? ACCENT : BORDER_2}`, borderRadius: '8px',
              color: active ? ACCENT : MUTED, fontSize: '12px', fontWeight: '700',
              letterSpacing: '0.04em', cursor: 'pointer', flex: 1,
            }}>{v === 'path' ? 'Path' : 'All topics'}</button>
          );
        })}
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
        {view === 'all' && (
          <>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search concepts…"
              style={{
                width: '100%', boxSizing: 'border-box',
                background: TILE, border: `1px solid ${BORDER_2}`,
                borderRadius: '10px', padding: '11px 14px',
                color: '#ffffff', fontSize: '14px', marginBottom: '14px',
              }}
            />
            {allCards.length === 0 && (
              <p style={{ fontSize: '13px', color: MUTED, textAlign: 'center', padding: '24px 0' }}>
                No concepts match “{query.trim()}”.
              </p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {allCards.map(card => {
                const shown = isConceptShown(card.term) || justMarked.has(card.term);
                return (
                  <button
                    key={card.term}
                    onClick={() => setSelectedCard(card)}
                    style={{
                      background: shown ? TILE_READ : TILE,
                      border: `1px solid ${shown ? BORDER : BORDER_2}`,
                      borderRadius: '10px', padding: '12px 14px',
                      cursor: 'pointer', textAlign: 'left' as const,
                      display: 'flex', alignItems: 'center', gap: '12px',
                      width: '100%', opacity: shown ? 0.55 : 1,
                    }}
                  >
                    <span style={{ fontSize: '20px', flexShrink: 0 }}>{card.emoji || '📖'}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{
                        display: 'block', fontSize: '14px', fontWeight: '600',
                        color: '#ffffff', lineHeight: 1.3,
                      }}>{card.term}</span>
                      <span style={{
                        display: 'block', fontSize: '12px', color: MUTED,
                        lineHeight: 1.4, marginTop: '2px',
                      }}>{card.headline}</span>
                    </span>
                    <span style={{
                      fontSize: '11px', fontWeight: '600', flexShrink: 0,
                      color: LEVEL_COLORS[card.level] || ACCENT,
                    }}>{difficulty(card.level)}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {view === 'path' && CURRICULUM.map(stage => {
          const stageTopics = stage.modules.flatMap(m => m.topics).filter(t => cardFor(t.key));
          const stageTotal = stageTopics.length;
          const stageRead = stageTopics.filter(t => isRead(t.key)).length;
          const pct = stageTotal === 0 ? 0 : (stageRead / stageTotal) * 100;

          return (
            <div key={stage.id} style={{ marginBottom: '28px' }}>
              {/* Stage header */}
              <div style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '15px', fontWeight: '700', color: '#ffffff' }}>
                    {stage.title}
                  </span>
                  <span style={{
                    fontSize: '10px', fontWeight: '700', letterSpacing: '0.05em',
                    color: MUTED, border: `1px solid ${BORDER_2}`,
                    borderRadius: '4px', padding: '2px 8px',
                  }}>{stage.difficulty}</span>
                </div>
                <p style={{ fontSize: '12px', color: MUTED, lineHeight: 1.5, margin: '6px 0 8px' }}>
                  {stage.blurb}
                </p>
                {/* Thin progress rule */}
                <div style={{
                  height: '3px', background: TILE, borderRadius: '2px',
                  overflow: 'hidden', marginBottom: '5px',
                }}>
                  <div style={{
                    height: '100%', width: `${pct}%`,
                    background: ACCENT, borderRadius: '2px',
                  }} />
                </div>
                <span style={{ fontSize: '11px', color: MUTED }}>
                  {stageRead} of {stageTotal} read
                </span>
              </div>

              {/* Modules */}
              {stage.modules.map(mod => {
                const topics = mod.topics.filter(t => cardFor(t.key));
                if (topics.length === 0) return null;
                return (
                  <div key={mod.id} style={{ marginBottom: '18px' }}>
                    <p style={{
                      fontSize: '11px', fontWeight: '600', color: '#e2e8f0',
                      textTransform: 'uppercase', letterSpacing: '0.08em',
                      marginBottom: '4px',
                    }}>{mod.title}</p>
                    <p style={{ fontSize: '12px', color: MUTED, lineHeight: 1.5, margin: '0 0 10px' }}>
                      {mod.blurb}
                    </p>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {topics.map(topic => {
                        const card = cardFor(topic.key)!;
                        const shown = isRead(topic.key);
                        const isNext = topic.key === nextUpKey;
                        return (
                          <button
                            key={topic.key}
                            onClick={() => setSelectedCard(card)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '10px',
                              width: '100%', textAlign: 'left' as const,
                              background: shown ? TILE_READ : TILE,
                              border: `1px solid ${shown ? BORDER : BORDER_2}`,
                              borderLeft: isNext ? `3px solid ${ACCENT}` : `1px solid ${shown ? BORDER : BORDER_2}`,
                              borderRadius: '8px', padding: '10px 12px',
                              cursor: 'pointer', opacity: shown ? 0.55 : 1,
                            }}
                          >
                            <span style={{
                              fontSize: '13px', flexShrink: 0,
                              color: shown ? ACCENT : '#64748b',
                            }}>{shown ? '✓' : '○'}</span>
                            <span style={{ flex: 1, minWidth: 0 }}>
                              <span style={{
                                display: 'block', fontSize: '13px', fontWeight: '600',
                                color: '#ffffff', lineHeight: 1.35, wordBreak: 'break-word',
                              }}>{card.term}</span>
                              {isNext && (
                                <span style={{
                                  display: 'block', fontSize: '10px', fontWeight: '700',
                                  color: ACCENT, letterSpacing: '0.05em', marginTop: '2px',
                                }}>Next up</span>
                              )}
                            </span>
                            <span style={{
                              fontSize: '11px', color: MUTED, flexShrink: 0,
                            }}>{difficulty(card.level)}</span>
                          </button>
                        );
                      })}
                    </div>

                    {mod.check && (
                      <p style={{
                        fontSize: '11px', color: MUTED, fontStyle: 'italic',
                        margin: '10px 0 0', paddingLeft: '2px',
                      }}>End-of-module self-check</p>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
