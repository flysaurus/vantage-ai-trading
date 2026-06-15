// ─── ScoreDetailSheet ────────────────────────────────────────
// Bottom sheet opened by tapping the Player Status Bar.
// Slides up with spring animation, 85% screen height.
// Drag-to-dismiss via downward swipe.
//
// Sections:
//   1. Score Hero (number, level badge, progress bar, XP needed)
//   2. Stats Row (baskets, trades, AI chats, days — 4 columns)
//   3. Score History Chart (recharts line, W1-Wn labels)
//   4. Milestone Feed (earned + locked teaser)
//
// All colors via CSS design tokens.

'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { getLevelColor } from '@/lib/theme/utils';
import { useScoreDetail } from '@/hooks/useScoreDetail';
import type { UseScoreDetailReturn } from '@/hooks/useScoreDetail';
import { ScoreHistoryChart } from './ScoreHistoryChart';

// ─── Props ────────────────────────────────────────────────────

interface ScoreDetailSheetProps {
  open: boolean;
  onClose: () => void;
}

// ─── Constants ───────────────────────────────────────────────

const SHEET_HEIGHT_VH = 85;
const DISMISS_THRESHOLD = 80; // px of downward drag to dismiss
const SPRING_DURATION = '350ms'; // spring settle

// ─── Skeleton ─────────────────────────────────────────────────

function SheetSkeleton() {
  return (
    <>
      {/* Hero skeleton */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 'var(--space-3)',
        marginBottom: 'var(--space-5)',
      }}>
        <div style={{
          width: '80px',
          height: '24px',
          borderRadius: 'var(--radius-full)',
          background: 'var(--border-card)',
        }} />
        <div style={{
          width: '120px',
          height: '48px',
          borderRadius: 'var(--radius-md)',
          background: 'var(--border-card)',
        }} />
        <div style={{
          width: '200px',
          height: '6px',
          borderRadius: 'var(--radius-full)',
          background: 'var(--border-subtle)',
        }} />
      </div>

      {/* Stats skeleton */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 'var(--space-2)',
        marginBottom: 'var(--space-5)',
      }}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 'var(--space-1)',
            padding: 'var(--space-3)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--border-subtle)',
          }}>
            <div style={{
              width: '32px',
              height: '20px',
              borderRadius: '4px',
              background: 'var(--border-card)',
            }} />
            <div style={{
              width: '40px',
              height: '10px',
              borderRadius: '3px',
              background: 'var(--border-card)',
            }} />
          </div>
        ))}
      </div>

      {/* Chart skeleton */}
      <ScoreHistoryChart history={[]} loading />

      {/* Milestones skeleton */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <div style={{
          width: '90px',
          height: '14px',
          borderRadius: '4px',
          background: 'var(--border-card)',
          marginBottom: 'var(--space-1)',
        }} />
        {[1, 2, 3].map((i) => (
          <div key={i} style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            padding: 'var(--space-3)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--border-subtle)',
          }}>
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--border-card)',
            }} />
            <div style={{ flex: 1 }}>
              <div style={{
                width: '80px',
                height: '12px',
                borderRadius: '3px',
                background: 'var(--border-card)',
                marginBottom: '4px',
              }} />
              <div style={{
                width: '120px',
                height: '10px',
                borderRadius: '3px',
                background: 'var(--border-card)',
              }} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ─── Component ───────────────────────────────────────────────

export function ScoreDetailSheet({ open, onClose }: ScoreDetailSheetProps) {
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef(0);
  const sheetRef = useRef<HTMLDivElement>(null);

  const { data, loading } = useScoreDetail(open);

  // ── Drag handlers ─────────────────────────────────────
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const target = e.target as HTMLElement;
    // Only drag on the handle or top 60px of the sheet
    const sheetTop = sheetRef.current?.getBoundingClientRect().top ?? 0;
    if (e.touches[0].clientY - sheetTop > 60) return;
    dragStartY.current = e.touches[0].clientY;
    setIsDragging(true);
  }, []);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isDragging) return;
      const dy = e.touches[0].clientY - dragStartY.current;
      if (dy > 0) {
        setDragOffset(dy);
      }
    },
    [isDragging]
  );

  const handleTouchEnd = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);
    if (dragOffset > DISMISS_THRESHOLD) {
      onClose();
    }
    setDragOffset(0);
  }, [isDragging, dragOffset, onClose]);

  // Reset offset when closed
  useEffect(() => {
    if (!open) setDragOffset(0);
  }, [open]);

  if (!open) return null;

  const score = data?.score ?? 0;
  const level = data?.level ?? 'Apprentice';
  const progress = data?.progress ?? 0;
  const nextThreshold = data?.nextThreshold;
  const xpNeeded = nextThreshold ? nextThreshold - score : 0;
  const stats = data?.stats ?? { baskets: 0, trades: 0, aiChats: 0, days: 0 };
  const levelColor = getLevelColor(level);
  const isLegend = level === 'Legend';

  const translateY = isDragging
    ? dragOffset
    : 0;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        animation: 'vantageSheetFadeIn 0.2s ease-out',
      }}
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          backdropFilter: 'blur(4px)',
          opacity: isDragging ? Math.max(0, 1 - dragOffset / 300) : undefined,
          transition: isDragging ? 'none' : 'opacity 0.2s ease',
        }}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: '480px',
          height: `${SHEET_HEIGHT_VH}vh`,
          maxHeight: '800px',
          background: 'var(--bg-sheet)',
          borderTopLeftRadius: 'var(--radius-lg)',
          borderTopRightRadius: 'var(--radius-lg)',
          display: 'flex',
          flexDirection: 'column',
          transform: `translateY(${translateY}px)`,
          transition: isDragging ? 'none' : `transform ${SPRING_DURATION} cubic-bezier(0.22, 0.61, 0.36, 1)`,
          animation: `vantageSheetSlideUp ${SPRING_DURATION} cubic-bezier(0.22, 0.61, 0.36, 1)`,
          touchAction: 'none',
        }}
      >
        {/* Drag handle */}
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          padding: 'var(--space-3) 0 var(--space-2)',
          flexShrink: 0,
        }}>
          <div style={{
            width: '36px',
            height: '4px',
            borderRadius: '2px',
            background: 'var(--border-card)',
          }} />
        </div>

        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 'var(--space-3)',
            right: 'var(--space-4)',
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            fontSize: '18px',
            cursor: 'pointer',
            padding: '4px 8px',
            lineHeight: 1,
            zIndex: 1,
          }}
          aria-label="Close"
        >
          ×
        </button>

        {/* Scrollable content */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '0 var(--space-5) var(--space-6)',
          WebkitOverflowScrolling: 'touch',
        }}>
          {loading ? (
            <SheetSkeleton />
          ) : (
            <>
              {/* ═══════════════════════════════════════════
                  SECTION 1: SCORE HERO
                  ═══════════════════════════════════════════ */}
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                paddingTop: 'var(--space-2)',
                paddingBottom: 'var(--space-5)',
                borderBottom: '1px solid var(--border-subtle)',
                marginBottom: 'var(--space-5)',
              }}>
                {/* Level badge */}
                <div style={{
                  padding: '6px 18px',
                  borderRadius: 'var(--radius-full)',
                  background: `${levelColor}26`,
                  border: `1px solid ${levelColor}66`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  marginBottom: 'var(--space-3)',
                }}>
                  <span style={{
                    fontSize: '16px',
                    fontWeight: 700,
                    color: levelColor,
                    letterSpacing: '-0.01em',
                  }}>
                    {level}
                  </span>
                  {!isLegend && (
                    <span style={{
                      fontSize: '12px',
                      color: 'var(--status-gain)',
                    }}>
                      ↗
                    </span>
                  )}
                </div>

                {/* Score number */}
                <span style={{
                  fontSize: '48px',
                  fontWeight: 800,
                  color: 'var(--accent-primary)',
                  fontVariantNumeric: 'tabular-nums',
                  letterSpacing: '-0.03em',
                  lineHeight: 1.1,
                  marginBottom: 'var(--space-4)',
                }}>
                  {score}
                </span>

                {/* Progress bar */}
                {!isLegend && (
                  <div style={{ width: '100%', maxWidth: '300px' }}>
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: 'var(--space-2)',
                    }}>
                      <span style={{
                        fontSize: '12px',
                        color: 'var(--text-secondary)',
                        fontWeight: 500,
                      }}>
                        {score} / {nextThreshold} to next level
                      </span>
                      <span style={{
                        fontSize: '12px',
                        color: 'var(--accent-primary)',
                        fontWeight: 600,
                      }}>
                        {progress}%
                      </span>
                    </div>
                    <div style={{
                      width: '100%',
                      height: '6px',
                      borderRadius: 'var(--radius-full)',
                      background: 'var(--border-subtle)',
                      overflow: 'hidden',
                    }}>
                      <div style={{
                        width: `${progress}%`,
                        height: '100%',
                        borderRadius: 'var(--radius-full)',
                        background: levelColor,
                        transition: 'width var(--transition-base)',
                      }} />
                    </div>
                    <p style={{
                      marginTop: 'var(--space-2)',
                      fontSize: '12px',
                      color: 'var(--text-muted)',
                      textAlign: 'center',
                    }}>
                      +{xpNeeded} to next level
                    </p>
                  </div>
                )}

                {/* Legend message */}
                {isLegend && (
                  <p style={{
                    fontSize: '13px',
                    color: 'var(--text-secondary)',
                    textAlign: 'center',
                    lineHeight: 1.5,
                    maxWidth: '280px',
                  }}>
                    You&apos;ve reached the highest level.<br />
                    Incredible work.
                  </p>
                )}
              </div>

              {/* ═══════════════════════════════════════════
                  SECTION 2: STATS ROW
                  ═══════════════════════════════════════════ */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 'var(--space-2)',
                marginBottom: 'var(--space-5)',
              }}>
                {/* Baskets */}
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 'var(--space-1)',
                  padding: 'var(--space-3) var(--space-2)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-subtle)',
                }}>
                  <span style={{
                    fontSize: '20px',
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {stats.baskets}
                  </span>
                  <span style={{
                    fontSize: '10px',
                    color: 'var(--text-secondary)',
                    fontWeight: 500,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}>
                    Baskets
                  </span>
                </div>

                {/* Trades */}
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 'var(--space-1)',
                  padding: 'var(--space-3) var(--space-2)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-subtle)',
                }}>
                  <span style={{
                    fontSize: '20px',
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {stats.trades}
                  </span>
                  <span style={{
                    fontSize: '10px',
                    color: 'var(--text-secondary)',
                    fontWeight: 500,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}>
                    Trades
                  </span>
                </div>

                {/* AI Chats */}
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 'var(--space-1)',
                  padding: 'var(--space-3) var(--space-2)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-subtle)',
                }}>
                  <span style={{
                    fontSize: '20px',
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {stats.aiChats}
                  </span>
                  <span style={{
                    fontSize: '10px',
                    color: 'var(--text-secondary)',
                    fontWeight: 500,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}>
                    AI Chats
                  </span>
                </div>

                {/* Days (streak) */}
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 'var(--space-1)',
                  padding: 'var(--space-3) var(--space-2)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-subtle)',
                }}>
                  <span style={{
                    fontSize: '20px',
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {stats.days}
                  </span>
                  <span style={{
                    fontSize: '10px',
                    color: 'var(--text-secondary)',
                    fontWeight: 500,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}>
                    Days
                  </span>
                </div>
              </div>

              {/* ═══════════════════════════════════════════
                  SECTION 3: SCORE HISTORY CHART
                  ═══════════════════════════════════════════ */}
              <div style={{
                marginBottom: 'var(--space-5)',
                paddingBottom: 'var(--space-5)',
                borderBottom: '1px solid var(--border-subtle)',
              }}>
                <ScoreHistoryChart
                  history={data?.history ?? []}
                  loading={false}
                />
              </div>

              {/* ═══════════════════════════════════════════
                  SECTION 4: MILESTONE FEED
                  ═══════════════════════════════════════════ */}
              <div style={{ paddingBottom: 'var(--space-6)' }}>
                <span style={{
                  fontSize: '14px',
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  display: 'block',
                  marginBottom: 'var(--space-3)',
                }}>
                  Achievements
                </span>

                {/* Earned milestones */}
                {data?.milestones && data.milestones.length > 0 ? (
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-2)',
                    marginBottom: data.lockedMilestones.length > 0 ? 'var(--space-4)' : 0,
                  }}>
                    {data.milestones.map((m) => (
                      <div
                        key={m.key}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 'var(--space-3)',
                          padding: '10px var(--space-3)',
                          borderRadius: 'var(--radius-md)',
                          background: 'var(--bg-card)',
                          border: '1px solid var(--border-subtle)',
                        }}
                      >
                        {/* Icon */}
                        <span style={{
                          fontSize: '24px',
                          width: '32px',
                          textAlign: 'center',
                          flexShrink: 0,
                        }}>
                          {m.icon}
                        </span>

                        {/* Name + date */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontSize: '13px',
                            fontWeight: 600,
                            color: 'var(--text-primary)',
                            marginBottom: '2px',
                          }}>
                            {m.label}
                          </div>
                          {m.awardedAt && (
                            <div style={{
                              fontSize: '10px',
                              color: 'var(--text-muted)',
                            }}>
                              Earned {new Date(m.awardedAt).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                              })}
                            </div>
                          )}
                        </div>

                        {/* Earned badge */}
                        <span style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          padding: '3px 10px',
                          borderRadius: 'var(--radius-full)',
                          background: `${levelColor}26`,
                          color: levelColor,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          flexShrink: 0,
                        }}>
                          Earned
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{
                    padding: 'var(--space-5)',
                    textAlign: 'center',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--border-subtle)',
                    marginBottom: data?.lockedMilestones && data.lockedMilestones.length > 0 ? 'var(--space-4)' : 0,
                  }}>
                    <span style={{
                      fontSize: '28px',
                      display: 'block',
                      marginBottom: 'var(--space-2)',
                    }}>
                      🏁
                    </span>
                    <p style={{
                      fontSize: '12px',
                      color: 'var(--text-muted)',
                      lineHeight: 1.5,
                      margin: 0,
                    }}>
                      No achievements yet.<br />
                      Start trading to earn your first badge.
                    </p>
                  </div>
                )}

                {/* Locked milestones (teaser — max 3) */}
                {data?.lockedMilestones && data.lockedMilestones.length > 0 && (
                  <>
                    <span style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      display: 'block',
                      marginBottom: 'var(--space-2)',
                    }}>
                      Locked
                    </span>
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 'var(--space-2)',
                    }}>
                      {data.lockedMilestones.map((m) => (
                        <div
                          key={m.key}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--space-3)',
                            padding: '10px var(--space-3)',
                            borderRadius: 'var(--radius-md)',
                            background: 'var(--border-subtle)',
                            opacity: 0.5,
                          }}
                        >
                          {/* Lock icon overlay on emoji */}
                          <div style={{
                            position: 'relative',
                            width: '32px',
                            height: '32px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}>
                            <span style={{ fontSize: '20px', filter: 'grayscale(1)' }}>
                              {m.icon}
                            </span>
                          </div>

                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontSize: '13px',
                              fontWeight: 500,
                              color: 'var(--text-muted)',
                            }}>
                              {m.label}
                            </div>
                            <div style={{
                              fontSize: '10px',
                              color: 'var(--text-muted)',
                            }}>
                              Keep investing to unlock
                            </div>
                          </div>

                          {/* Lock icon */}
                          <span style={{
                            fontSize: '14px',
                            color: 'var(--text-muted)',
                            flexShrink: 0,
                          }}>
                            🔒
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Keyframes */}
      <style>{`
        @keyframes vantageSheetFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes vantageSheetSlideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
