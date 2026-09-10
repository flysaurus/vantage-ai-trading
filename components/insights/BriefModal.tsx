// ─── BriefModal — full Daily Brief / Weekly Snapshot in a dismissible sheet ───
// Opened from the Insights hero deck's teaser cards. It shows the SAME content
// the existing endpoints already produce (the MARKET / PORTFOLIO / WATCH /
// EARNINGS sections for the daily brief; the health/risk summary + markdown
// body for the weekly snapshot) — nothing is regenerated or re-worded here.
//
// Why a modal instead of the previous behaviour: the teaser used to navigate to
// the Holdings screen, which yanked the user out of Insights. The brief now
// opens in place, over the Insights screen, and closes back to it.
//
// Themed with the additive `--v-*` tokens so it renders correctly in Light
// (default) and Dark. The legacy brief cards are dark-only surfaces, so they
// are not reused directly — the parsing contract is (lib/insights/brief.ts).
//
// ⚠️ Read-only presentation. No trigger logic, no writes.

'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { apiGet } from '@/lib/api-client';
import { parseDailyBrief, weeklySummaryLine, type BriefLine } from '@/lib/insights/brief';

export type BriefKind = 'daily' | 'weekly';

interface BriefModalProps {
  kind: BriefKind | null;
  accountId: string;
  onClose: () => void;
  /** Fired with the FULL brief text — the caller opens Ask Rufus with it. */
  onAskRufus: (kind: BriefKind, content: string) => void;
}

interface BriefData {
  content: string;
  healthScore: number | null;
  riskLevel: string | null;
  generatedAt: string | null;
  cached: boolean;
}

const EMPTY: BriefData = { content: '', healthScore: null, riskLevel: null, generatedAt: null, cached: false };

/** Section tag accent — readable on both themes (see --v-* tokens). */
function tagColor(label: string): string {
  switch (label) {
    case 'MARKET': return 'var(--v-accent)';
    case 'PORTFOLIO': return 'var(--v-gain)';
    case 'WATCH': return 'var(--v-hero-warn)';
    case 'EARNINGS': return 'var(--v-tag-earnings)';
    default: return 'var(--v-text-muted)';
  }
}

function formatTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return `${Math.floor(diffH / 24)}d ago`;
}

export function BriefModal({ kind, accountId, onClose, onAskRufus }: BriefModalProps) {
  const [data, setData] = useState<BriefData>(EMPTY);
  const [loading, setLoading] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Fetch the full brief body whenever the modal opens (or the account switches).
  useEffect(() => {
    if (!kind) { setData(EMPTY); return; }
    let cancelled = false;
    setLoading(true);
    setData(EMPTY);
    (async () => {
      try {
        const url = kind === 'daily'
          ? `/api/ai/daily-brief?tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York')}&accountId=${encodeURIComponent(accountId)}`
          : `/api/ai/weekly-snapshot?accountId=${encodeURIComponent(accountId)}`;
        const res = await apiGet(url);
        if (res.ok && !cancelled) {
          const d = await res.json();
          setData({
            content: d.content || '',
            healthScore: d.healthScore ?? null,
            riskLevel: d.riskLevel ?? null,
            generatedAt: d.generatedAt ?? null,
            cached: !!d.cached,
          });
        }
      } catch { /* leave the empty state — the body renders an honest fallback */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [kind, accountId]);

  // Escape closes; body scroll is locked while the sheet is open.
  useEffect(() => {
    if (!kind) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [kind, onClose]);

  useEffect(() => {
    if (kind) setTimeout(() => closeRef.current?.focus(), 60);
  }, [kind]);

  const handleAsk = useCallback(() => {
    if (!kind) return;
    onAskRufus(kind, data.content);
  }, [kind, data.content, onAskRufus]);

  if (!kind) return null;

  const title = kind === 'daily' ? "Today's Daily Brief" : 'Weekly Snapshot';
  const eyebrow = kind === 'daily' ? 'DAILY BRIEF' : 'WEEKLY SNAPSHOT';
  const subtitle = kind === 'daily'
    ? (formatTime(data.generatedAt) ? `Generated ${formatTime(data.generatedAt)}` : 'Today')
    : weeklySummaryLine(data.healthScore, data.riskLevel) || (formatTime(data.generatedAt) ? `Week of ${formatTime(data.generatedAt)}` : 'This week');

  const sections: BriefLine[] = kind === 'daily' ? parseDailyBrief(data.content) : [];

  return (
    <div
      data-testid="brief-modal-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 260,
        background: 'rgba(8, 14, 26, 0.55)',
        backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        padding: 0,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="brief-modal"
        data-brief-kind={kind}
        style={{
          width: '100%', maxWidth: 560,
          maxHeight: '86vh',
          display: 'flex', flexDirection: 'column',
          background: 'var(--v-card)',
          border: '0.5px solid var(--v-card-border)',
          borderBottom: 'none',
          borderRadius: '20px 20px 0 0',
          boxShadow: '0 -12px 40px rgba(0,0,0,0.28)',
          overflow: 'hidden',
        }}
      >
        {/* header */}
        <div
          style={{
            flexShrink: 0, display: 'flex', alignItems: 'flex-start', gap: 12,
            padding: '16px 16px 12px', borderBottom: '0.5px solid var(--v-rule)',
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.12em', color: 'var(--v-accent)' }} data-testid="brief-modal-eyebrow">
              {eyebrow}
            </div>
            <div
              data-testid="brief-modal-title"
              style={{ fontSize: 20, fontWeight: 800, color: 'var(--v-text-primary)', marginTop: 5, letterSpacing: '-0.01em' }}
            >
              {title}
            </div>
            {subtitle && (
              <div style={{ fontSize: 12, color: 'var(--v-text-muted)', marginTop: 4 }}>{subtitle}</div>
            )}
          </div>
          <button
            ref={closeRef}
            type="button"
            data-testid="brief-modal-close"
            aria-label="Close brief"
            onClick={onClose}
            style={{
              flexShrink: 0, width: 32, height: 32, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: '0.5px solid var(--v-card-border)',
              color: 'var(--v-text-secondary)', fontSize: 16, lineHeight: 1,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            ✕
          </button>
        </div>

        {/* body */}
        <div
          data-testid="brief-modal-body"
          style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 16px 4px', WebkitOverflowScrolling: 'touch' }}
        >
          {loading && (
            <div data-testid="brief-modal-loading" style={{ fontSize: 13.5, color: 'var(--v-text-muted)', padding: '18px 0' }}>
              Loading your brief…
            </div>
          )}

          {!loading && !data.content && (
            <div data-testid="brief-modal-empty" style={{ fontSize: 13.5, color: 'var(--v-text-muted)', padding: '18px 0', lineHeight: 1.6 }}>
              Your {kind === 'daily' ? 'daily brief' : 'weekly snapshot'} isn&rsquo;t ready yet. It&rsquo;ll appear here as soon as there&rsquo;s something to report.
            </div>
          )}

          {/* Daily Brief — MARKET / PORTFOLIO / WATCH / EARNINGS (unchanged content) */}
          {!loading && data.content && kind === 'daily' && (
            <div data-testid="brief-daily-sections">
              {sections.map((line, i) => (
                <div
                  key={i}
                  data-testid={line.label ? `brief-section-${line.label}` : `brief-prose-${i}`}
                  style={{
                    paddingTop: i === 0 ? 0 : 14,
                    marginTop: i === 0 ? 0 : 14,
                    borderTop: i === 0 ? 'none' : '0.5px solid var(--v-rule)',
                  }}
                >
                  {line.label && (
                    <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.12em', color: tagColor(line.label), marginBottom: 5 }}>
                      {line.label}
                    </div>
                  )}
                  <p style={{ fontSize: 14, lineHeight: 1.62, color: 'var(--v-text-primary)', margin: 0 }}>
                    {line.text}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Weekly Snapshot — same markdown body already stored on the row */}
          {!loading && data.content && kind === 'weekly' && (
            <div data-testid="brief-weekly-content" style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--v-text-primary)' }}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  p: ({ children }) => <p style={{ margin: '0 0 10px 0', lineHeight: 1.65 }}>{children}</p>,
                  strong: ({ children }) => <strong style={{ color: 'var(--v-text-primary)', fontWeight: 700 }}>{children}</strong>,
                  ul: ({ children }) => <ul style={{ margin: '4px 0 10px 0', paddingLeft: 18 }}>{children}</ul>,
                  ol: ({ children }) => <ol style={{ margin: '4px 0 10px 0', paddingLeft: 18 }}>{children}</ol>,
                  li: ({ children }) => <li style={{ margin: '4px 0', lineHeight: 1.6 }}>{children}</li>,
                  h2: ({ children }) => <h2 style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--v-accent)', margin: '16px 0 6px' }}>{children}</h2>,
                  h3: ({ children }) => <h3 style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--v-text-secondary)', margin: '14px 0 5px' }}>{children}</h3>,
                  hr: () => <hr style={{ border: 'none', borderTop: '0.5px solid var(--v-rule)', margin: '14px 0' }} />,
                  code: ({ children }) => <code style={{ background: 'var(--v-rule)', borderRadius: 4, padding: '1px 5px', fontSize: 12.5 }}>{children}</code>,
                  blockquote: ({ children }) => (
                    <blockquote style={{ borderLeft: '2px solid var(--v-accent)', paddingLeft: 12, margin: '8px 0', color: 'var(--v-text-secondary)' }}>{children}</blockquote>
                  ),
                }}
              >
                {data.content}
              </ReactMarkdown>
            </div>
          )}
        </div>

        {/* footer — hand this brief to Rufus */}
        <div
          style={{
            flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 12, padding: '12px 16px',
            paddingBottom: 'calc(12px + env(safe-area-inset-bottom))',
            borderTop: '0.5px solid var(--v-rule)', background: 'var(--v-card)',
          }}
        >
          <button
            type="button"
            data-testid="brief-modal-ask-rufus"
            onClick={handleAsk}
            disabled={loading || !data.content}
            style={{
              background: 'none', border: 'none', padding: 0, fontFamily: 'inherit',
              color: data.content ? 'var(--v-accent)' : 'var(--v-text-faint)',
              fontSize: 13, fontWeight: 700,
              cursor: data.content ? 'pointer' : 'default',
              textDecoration: 'none',
            }}
          >
            Ask Rufus about this →
          </button>
          <button
            type="button"
            data-testid="brief-modal-done"
            onClick={onClose}
            style={{
              flexShrink: 0, background: 'none', border: '0.5px solid var(--v-card-border)',
              borderRadius: 999, padding: '7px 14px', fontFamily: 'inherit',
              color: 'var(--v-text-secondary)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export default BriefModal;
