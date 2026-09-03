'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAuth } from '@/components/providers/AuthProvider';
import { useAccounts } from '@/context/AccountContext';
import { fetchRecentSessions, type DBSession, type DBChatMessage } from '@/lib/chat-history-db';
import { stripRecommendationMarkers } from '@/components/ai/InlineTradeButton';

// ── Same design tokens as AITab.tsx ──
const ACCENT = '#22d3ee';
const TEXT_BODY = 'rgba(255,255,255,0.85)';
const TEXT_SUBTLE = 'rgba(255,255,255,0.4)';
const TEXT_DIM = 'rgba(255,255,255,0.25)';
const BACKDROP_BLUR = 'blur(20px)';

interface ChatHistoryProps {
  open: boolean;
  onClose: () => void;
}

/** One session day card — messages render inline when expanded */
function SessionDay({
  session,
  isExpanded,
  onToggle,
  isFirst,
}: {
  session: DBSession;
  isExpanded: boolean;
  onToggle: () => void;
  isFirst: boolean;
}) {
  return (
    <div style={{ marginBottom: '6px' }}>
      {/* Date header — tappable */}
      <button
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          width: '100%',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: '10px',
          padding: '10px 12px',
          cursor: 'pointer',
          fontFamily: 'inherit',
          color: TEXT_BODY,
          fontSize: '13px',
          fontWeight: 600,
          textAlign: 'left' as const,
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.07)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
      >
        {isExpanded ? (
          <ChevronDown size={14} style={{ color: ACCENT, flexShrink: 0 }} />
        ) : (
          <ChevronRight size={14} style={{ color: TEXT_SUBTLE, flexShrink: 0 }} />
        )}
        <span style={{ flex: 1 }}>{session.label}</span>
        <span style={{ fontSize: '11px', color: TEXT_SUBTLE, fontWeight: 400 }}>
          {session.messageCount} msg{session.messageCount !== 1 ? 's' : ''}
        </span>
      </button>

      {/* Messages — rendered only when expanded */}
      {isExpanded && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            padding: '8px 4px 4px 4px',
          }}
        >
          {session.messages.map((msg: DBChatMessage) => {
            if (msg.role === 'user') {
              return (
                <div
                  key={msg.id || msg.createdAt}
                  style={{
                    alignSelf: 'flex-end',
                    maxWidth: '85%',
                    background: 'rgba(34,211,238,0.12)',
                    border: '1px solid rgba(34,211,238,0.2)',
                    borderRadius: '16px 16px 4px 16px',
                    padding: '10px 13px',
                    fontSize: '14px',
                  }}
                >
                  <span style={{ lineHeight: '1.5', wordBreak: 'break-word', color: '#fff' }}>
                    {msg.content}
                  </span>
                </div>
              );
            }
            // AI message
            return (
              <div
                key={msg.id || msg.createdAt}
                style={{
                  maxWidth: '92%',
                  background: 'rgba(255,255,255,0.04)',
                  borderLeft: '3px solid #22d3ee',
                  borderRadius: '4px 16px 16px 16px',
                  padding: '12px 14px',
                  fontSize: '14px',
                  color: 'rgba(255,255,255,0.85)',
                }}
              >
                <div
                  style={{
                    fontSize: '10.5px',
                    fontWeight: 700,
                    color: '#22d3ee',
                    marginBottom: '6px',
                    letterSpacing: '0.03em',
                  }}
                >
                  VANTAGE AI
                </div>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    p: ({ children }) => (
                      <p style={{ margin: '0 0 8px 0', lineHeight: '1.6' }}>{children}</p>
                    ),
                    strong: ({ children }) => (
                      <strong style={{ color: '#ffffff', fontWeight: '700' }}>{children}</strong>
                    ),
                    ul: ({ children }) => (
                      <ul
                        style={{
                          margin: '4px 0 8px 0',
                          paddingLeft: '16px',
                          listStyleType: 'disc',
                        }}
                      >
                        {children}
                      </ul>
                    ),
                    li: ({ children }) => (
                      <li style={{ margin: '4px 0', lineHeight: '1.5' }}>{children}</li>
                    ),
                    h2: ({ children }) => (
                      <h2
                        style={{
                          fontSize: '14px',
                          fontWeight: '700',
                          color: '#ffffff',
                          margin: '12px 0 8px 0',
                        }}
                      >
                        {children}
                      </h2>
                    ),
                    h3: ({ children }) => (
                      <h3
                        style={{
                          fontSize: '13px',
                          fontWeight: '700',
                          color: '#22d3ee',
                          margin: '12px 0 6px 0',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}
                      >
                        {children}
                      </h3>
                    ),
                    code: ({ children }) => (
                      <code
                        style={{
                          background: '#0f1829',
                          borderRadius: '4px',
                          padding: '1px 6px',
                          fontSize: '12px',
                          color: '#22d3ee',
                        }}
                      >
                        {children}
                      </code>
                    ),
                    table: ({ children }) => (
                      <div
                        style={{
                          overflowX: 'auto',
                          margin: '8px 0',
                          borderRadius: '8px',
                          border: '1px solid rgba(255,255,255,0.1)',
                        }}
                      >
                        <table
                          style={{
                            width: '100%',
                            borderCollapse: 'collapse',
                            fontSize: '12px',
                          }}
                        >
                          {children}
                        </table>
                      </div>
                    ),
                    thead: ({ children }) => (
                      <thead style={{ background: 'rgba(34,211,238,0.1)' }}>{children}</thead>
                    ),
                    th: ({ children }) => (
                      <th
                        style={{
                          padding: '8px 12px',
                          textAlign: 'left',
                          color: '#22d3ee',
                          fontWeight: '600',
                          fontSize: '11px',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          borderBottom: '1px solid rgba(255,255,255,0.1)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {children}
                      </th>
                    ),
                    td: ({ children }) => (
                      <td
                        style={{
                          padding: '8px 12px',
                          borderBottom: '1px solid rgba(255,255,255,0.06)',
                          color: '#e2e8f0',
                          verticalAlign: 'top',
                        }}
                      >
                        {children}
                      </td>
                    ),
                    hr: () => (
                      <hr
                        style={{
                          border: 'none',
                          borderTop: '1px solid rgba(255,255,255,0.1)',
                          margin: '12px 0',
                        }}
                      />
                    ),
                  }}
                >
                  {stripRecommendationMarkers(msg.content)}
                </ReactMarkdown>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ChatHistory({ open, onClose }: ChatHistoryProps) {
  const { user } = useAuth();
  const userId = user?.id ? String(user.id) : null;
  const { activeAccountId } = useAccounts();
  const accountId = activeAccountId || 'demo';

  const [sessions, setSessions] = useState<DBSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());

  const loadSessions = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchRecentSessions(userId, accountId, 10);
      setSessions(data);
      // Expand most recent day by default (browser local timezone)
      if (data.length > 0) {
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const todaySession = data.find(s => s.date === today);
        if (todaySession) {
          setExpandedDates(new Set([today]));
        } else {
          setExpandedDates(new Set([data[0].date]));
        }
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load chat history');
    } finally {
      setLoading(false);
    }
  }, [userId, accountId]);

  useEffect(() => {
    if (open && userId) {
      loadSessions();
    }
  }, [open, userId, accountId, loadSessions]);

  const toggleDate = (date: string) => {
    setExpandedDates(prev => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop overlay */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1000,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: BACKDROP_BLUR,
        }}
      />

      {/* Sheet panel */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: '100%',
          maxWidth: '420px',
          zIndex: 1001,
          background: 'rgba(10,16,32,0.98)',
          borderLeft: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            flexShrink: 0,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: '18px',
              fontWeight: 700,
              color: '#ffffff',
            }}
          >
            Chat History
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: 'none',
              borderRadius: '10px',
              padding: '8px',
              cursor: 'pointer',
              color: TEXT_SUBTLE,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Subtitle — retention notice */}
        <div
          style={{
            padding: '8px 20px 4px',
            fontSize: '11px',
            color: TEXT_DIM,
            flexShrink: 0,
          }}
        >
          Last 7 days · {sessions.length} day{sessions.length !== 1 ? 's' : ''}
        </div>

        {/* Content */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '12px 20px 32px',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}
        >
          {/* Loading state */}
          {loading && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                padding: '40px 0',
                color: TEXT_SUBTLE,
                fontSize: '14px',
              }}
            >
              <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
              Loading history…
            </div>
          )}

          {/* Error state */}
          {error && !loading && (
            <div
              style={{
                padding: '20px',
                textAlign: 'center',
                color: '#f59e0b',
                fontSize: '13px',
              }}
            >
              {error}
              <button
                onClick={loadSessions}
                style={{
                  display: 'block',
                  margin: '12px auto 0',
                  background: 'rgba(245,158,11,0.15)',
                  border: '1px solid rgba(245,158,11,0.3)',
                  borderRadius: '8px',
                  color: '#f59e0b',
                  padding: '8px 16px',
                  fontSize: '13px',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Retry
              </button>
            </div>
          )}

          {/* Empty state */}
          {!loading && !error && sessions.length === 0 && (
            <div
              style={{
                padding: '40px 0',
                textAlign: 'center',
                color: TEXT_SUBTLE,
                fontSize: '14px',
              }}
            >
              <div style={{ fontSize: '32px', marginBottom: '12px' }}>💬</div>
              <div style={{ marginBottom: '4px', fontWeight: 600, color: TEXT_BODY }}>
                No recent conversations
              </div>
              <div style={{ fontSize: '12px' }}>
                Start chatting with Vantage AI — your history will appear here
              </div>
            </div>
          )}

          {/* Session day groups */}
          {!loading &&
            !error &&
            sessions.map((session, i) => (
              <SessionDay
                key={session.id}
                session={session}
                isExpanded={expandedDates.has(session.date)}
                onToggle={() => toggleDate(session.date)}
                isFirst={i === 0}
              />
            ))}
        </div>
      </div>

      {/* Spinner animation */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
}
