'use client';
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Send, RefreshCw, AlertCircle, Trash2, AlignLeft } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAIChat } from '@/hooks/useAIChat';
import BuildBasketModal from '@/components/BuildBasketModal';
import { useChatStore } from '@/store';

/** Extract <rebalance-trades> JSON block from AI response text */
function extractRebalanceTrades(content: string): Array<{ symbol: string; action: string; targetPercent: number }> | null {
  try {
    const match = content.match(/<rebalance-trades>\s*([\s\S]*?)\s*<\/rebalance-trades>/);
    if (!match) return null;
    const parsed = JSON.parse(match[1]);
    if (!Array.isArray(parsed?.trades)) return null;
    return parsed.trades;
  } catch {
    return null;
  }
}

/** Get display-safe content by stripping JSON integration block */
function sanitizeContent(content: string): string {
  return content.replace(/<rebalance-trades>[\s\S]*?<\/rebalance-trades>/g, '').trim();
}

/** Parse dollar amount string like "$10,300", "-$6,100", "$5.1K" */
import { useAuth } from '@/components/providers/AuthProvider';
import { ConvictionCard } from './ConvictionCard';
import AIThinkingIndicator from './AIThinkingIndicator';

const SUGGESTIONS_PRIMARY = [
  {
    id: 'health',
    label: '🌱 Health Check',
    mode: 'health' as const,
    message: 'Run a complete health check on my portfolio. Score each area and give me priority actions.',
  },
  {
    id: 'risk',
    label: '🛡 Risk',
    mode: 'risk' as const,
    message: 'Check my portfolio for concentration risk, sector risk, and any other risks I should know about.',
  },
  {
    id: 'opportunities',
    label: '💡 Opportunities',
    mode: 'opportunities' as const,
    message: 'Based on my current portfolio and market conditions, what buying or rebalancing opportunities do you see?',
  },
];

const SUGGESTIONS_SECONDARY = [
  {
    id: 'trends',
    label: '📊 Market Trends',
    mode: 'trends' as const,
    message: 'What are the key market trends right now and how do they affect my portfolio specifically?',
  },
  {
    id: 'tax',
    label: '📋 Tax Check',
    mode: 'tax' as const,
    message: 'Check my tax situation. What losses can I harvest and what are my estimated savings?',
  },
  {
    id: 'research',
    label: '🔍 Research',
    mode: 'research' as const,
    message: 'Research [SYMBOL] — fundamentals, technicals, recent news, and whether it fits my portfolio.',
  },
];

/** Custom markdown renderers — dark theme, compact, trading-appropriate */
const MARKDOWN_COMPONENTS = {
  h1: ({ children }: { children: React.ReactNode }) => (
    <h1 style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9', margin: '10px 0 4px', lineHeight: 1.3 }}>{children}</h1>
  ),
  h2: ({ children }: { children: React.ReactNode }) => (
    <h2 style={{ fontSize: 16, fontWeight: 600, color: '#06b6d4', margin: '8px 0 4px', lineHeight: 1.3 }}>{children}</h2>
  ),
  h3: ({ children }: { children: React.ReactNode }) => (
    <h3 style={{ fontSize: 14, fontWeight: 500, color: '#06b6d4', margin: '6px 0 2px', lineHeight: 1.3, textTransform: 'uppercase', letterSpacing: '0.025em' }}>{children}</h3>
  ),
  p: ({ children }: { children: React.ReactNode }) => (
    <p style={{ margin: '2px 0 6px', lineHeight: 1.625, color: '#cbd5e1' }}>{children}</p>
  ),
  strong: ({ children }: { children: React.ReactNode }) => (
    <strong style={{ fontWeight: 600, color: '#f1f5f9' }}>{children}</strong>
  ),
  code: ({ children, className }: { children: React.ReactNode; className?: string }) => {
    // Inline code (tickers, prices)
    if (!className) {
      return <code style={{ background: 'rgba(6,182,212,0.15)', color: '#22d3ee', padding: '0 3px', borderRadius: 3, fontSize: 11, fontFamily: 'monospace' }}>{children}</code>;
    }
    return <code style={{ color: '#cbd5e1', fontSize: 10 }}>{children}</code>;
  },
  table: ({ children }: { children: React.ReactNode }) => (
    <div style={{ overflowX: 'auto', display: 'block', margin: '12px 0 4px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, color: 'rgba(255,255,255,0.85)' }}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children }: { children: React.ReactNode }) => (
    <thead>{children}</thead>
  ),
  tbody: ({ children }: { children: React.ReactNode }) => (
    <tbody>{children}</tbody>
  ),
  tr: ({ children }: { children: React.ReactNode }) => (
    <tr style={{ transition: 'background 0.15s' }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(51,65,85,0.2)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      {children}
    </tr>
  ),
  th: ({ children }: { children: React.ReactNode }) => (
    <th style={{
      padding: '8px 12px',
      textAlign: 'left',
      color: '#22d3ee',
      fontWeight: 500,
      fontSize: 14,
      whiteSpace: 'nowrap',
      borderBottom: '1px solid #475569',
    }}>
      {children}
    </th>
  ),
  td: ({ children }: { children: React.ReactNode }) => (
    <td style={{
      padding: '6px 12px',
      borderBottom: '1px solid rgba(51,65,85,0.3)',
      color: 'rgba(255,255,255,0.85)',
      fontSize: 14,
      whiteSpace: 'nowrap',
      lineHeight: 1.5,
    }}>
      {children}
    </td>
  ),
  ul: ({ children }: { children: React.ReactNode }) => (
    <ul style={{ margin: '2px 0', paddingLeft: 16, color: '#cbd5e1' }}>{children}</ul>
  ),
  ol: ({ children }: { children: React.ReactNode }) => (
    <ol style={{ margin: '2px 0', paddingLeft: 16, color: '#cbd5e1' }}>{children}</ol>
  ),
  li: ({ children }: { children: React.ReactNode }) => (
    <li style={{ marginBottom: 1, lineHeight: 1.6, fontSize: 14 }}>{children}</li>
  ),
  hr: () => <hr style={{ border: 'none', borderTop: '1px solid #1e293b', margin: '6px 0' }} />,
  blockquote: ({ children }: { children: React.ReactNode }) => (
    <blockquote style={{ borderLeft: '2px solid #06b6d4', paddingLeft: 8, margin: '4px 0', color: '#94a3b8', fontSize: 11, fontStyle: 'italic' }}>{children}</blockquote>
  ),
};  // eslint-disable-next-line @typescript-eslint/no-explicit-any

export function AIChat({ children }: { children?: React.ReactNode }) {
  const router = useRouter();
  const { user } = useAuth();
  const userInitial = (user?.displayName || user?.email || 'U').charAt(0).toUpperCase();
  const {
    messages,
    isLoading,
    sendMessage,
    retry,
    lastCost,
    remainingCalls,
    error,
    setError,
    clearChat,
  } = useAIChat();

  const [input, setInput] = useState('');
  const [responseMode, setResponseMode] = useState<'summary' | 'detailed'>('summary');
  const [showCost, setShowCost] = useState(false);
  const [researchSymbol, setResearchSymbol] = useState('');
  const [showResearchInput, setShowResearchInput] = useState(false);
  const [thinkingMode, setThinkingMode] = useState<string>('general');
  const [showBasketModal, setShowBasketModal] = useState(false);
  const [showMorePrompts, setShowMorePrompts] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Scroll to latest message on mount (always open at the bottom)
  useEffect(() => {
    if (messages.length > 0) {
      // Small delay for DOM render
      setTimeout(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'instant' });
      }, 100);
    }
  }, []); // Only on mount

  // Auto-scroll to bottom when new messages arrive (only if already near bottom)
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
    if (isNearBottom) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Show cost info briefly after each response
  useEffect(() => {
    if (lastCost > 0) {
      setShowCost(true);
      const timer = setTimeout(() => setShowCost(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [lastCost]);

  // Listen for QuickAction button clicks from the AI tab
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.prompt) {
        setThinkingMode(detail.mode || 'general');
        sendMessage(detail.prompt, responseMode, detail.mode);
      }
    };
    const basketHandler = () => {
      setShowBasketModal(true);
    };
    window.addEventListener('vantage-ai-suggestion', handler);
    window.addEventListener('vantage-open-basket-modal', basketHandler);
    return () => {
      window.removeEventListener('vantage-ai-suggestion', handler);
      window.removeEventListener('vantage-open-basket-modal', basketHandler);
    };
  }, [sendMessage, responseMode]);

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    setThinkingMode('general');
    sendMessage(input.trim(), responseMode, 'general');
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleQuickPrompt = (suggestion: { id: string; message: string; mode: string; label: string }) => {
    if (suggestion.id === 'research') {
      // Show inline symbol input for research prompt
      setShowResearchInput(true);
      setResearchSymbol('');
      return;
    }
    setThinkingMode(suggestion.mode);
    sendMessage(suggestion.message, responseMode, suggestion.mode);
  };

  const handleResearchSend = () => {
    const symbol = researchSymbol.trim().toUpperCase();
    if (!symbol) return;
    const researchSuggestion = SUGGESTIONS_SECONDARY.find(s => s.id === 'research')!;
    const message = researchSuggestion.message.replace('[SYMBOL]', symbol);
    setThinkingMode('research');
    sendMessage(message, responseMode, 'research', symbol);
    setShowResearchInput(false);
    setResearchSymbol('');
  };

  const handleSaveStyleTargets = async (targets: Array<{ symbol: string; targetPercent: number }>) => {
    try {
      const targetAllocations = targets.map(t => ({
        symbol: t.symbol,
        targetPercent: t.targetPercent / 100, // API expects decimal
      }));

      const res = await fetch('/api/strategies/rebalancing/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetAllocations,
          driftThreshold: 5,
          alertEnabled: false,
        }),
      });

      if (res.ok) {
        // Reload to pick up the now-saved targets
        window.location.reload();
      } else {
        console.error('Save targets failed:', await res.json());
      }
    } catch (err) {
      console.error('Save style targets error:', err);
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      flex: 1,
      minHeight: 0,
    }}>
      {/* ── Scrollable Messages ── */}
      <div
        ref={messagesContainerRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '0 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          minHeight: 0,
        }}
        className="chat-messages"
      >
        {/* Top content slot (DemoBanner, AccountSummaryCard, Insight, etc.) */}
        {children}

        {messages.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon">🦊</div>
            <div className="empty-title">Welcome back, {userInitial}.</div>
            <div className="empty-subtitle">
              AI-powered portfolio analysis and market intelligence.
            </div>
          </div>
        )}

        {messages.map((msg, idx) => {
          // Session divider special rendering
          if (msg.role === 'system') {
            return (
              <div key={msg.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '8px 0', margin: '4px 0',
              }}>
                <div style={{ flex: 1, height: 1, background: '#1e293b' }} />
                <span style={{
                  fontSize: 10, fontWeight: 600,
                  color: '#475569', textTransform: 'uppercase',
                  letterSpacing: 1, whiteSpace: 'nowrap',
                }}>
                  {msg.content}
                </span>
                <div style={{ flex: 1, height: 1, background: '#1e293b' }} />
              </div>
            );
          }

          return (
          <div
            key={msg.id}
            className={`message ${msg.role}`}
            style={{
              display: 'flex',
              gap: 8,
              flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
            }}
          >
            <div
              className={`avatar ${msg.role}`}
              style={{
                width: 26, height: 26, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, flexShrink: 0,
                background: msg.role === 'assistant'
                  ? 'linear-gradient(135deg, #06b6d4, #0d9488)'
                  : '#334155',
                color: 'white',
              }}
            >
              {msg.role === 'assistant' ? '🦊' : userInitial}
            </div>
            <div
              className="bubble"
              style={{
                maxWidth: '85%',
                padding: '9px 11px',
                borderRadius: 12,
                background: msg.role === 'assistant' ? '#1e293b' : '#06b6d4',
                color: msg.role === 'assistant' ? '#f1f5f9' : 'white',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              {/* Rich markdown rendering for AI messages */}
              {msg.role === 'assistant' ? (
                <div className="markdown-body" style={{ fontSize: 16, lineHeight: 1.625 }}>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={MARKDOWN_COMPONENTS as any}
                  >
                    {sanitizeContent(msg.content || '...')}
                  </ReactMarkdown>

                  {/* Thinking indicator during loading */}
                  {isLoading && idx === messages.length - 1 && (
                    <AIThinkingIndicator mode={thinkingMode} />
                  )}
                </div>
              ) : (
                /* User messages stay plain */
                <div style={{ fontSize: 16, fontWeight: 400, whiteSpace: 'pre-wrap', lineHeight: 1.625 }}>
                  {msg.content}
                </div>
              )}

              {/* Theme Basket action card — shown when AI returns a themed stock basket */}
              {msg.type === 'theme_basket' && (
                <div style={{
                  marginTop: 12,
                  background: '#0f172a',
                  border: '1px solid rgba(6,182,212,0.3)',
                  borderRadius: 16,
                  padding: 16,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <span style={{ fontSize: 16 }}>🧺</span>
                    <span style={{ color: '#f1f5f9', fontSize: 13, fontWeight: 600 }}>
                      {msg.basketName || 'AI Basket'}
                    </span>
                    <span style={{ color: '#64748b', fontSize: 11 }}>
                      {(msg.stocks || []).length} stocks scored
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                    {(msg.stocks || []).map((s: any, i: number) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        background: '#1e293b', borderRadius: 8, padding: '6px 10px',
                      }}>
                        <span style={{ color: '#f1f5f9', fontSize: 11, fontWeight: 600 }}>{s.symbol}</span>
                        <span style={{
                          fontSize: 10,
                          color: s.conviction === 'high' ? '#4ade80' :
                                 s.conviction === 'medium' ? '#facc15' : '#94a3b8',
                        }}>{s.compositeScore}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {msg.basketId ? (
                      <button
                        onClick={() => router.push(`/trade/basket/${msg.basketId}`)}
                        style={{
                          flex: 1, padding: '10px 16px',
                          background: '#06b6d4', border: 'none', borderRadius: 12,
                          color: 'white', fontSize: 12, fontWeight: 600,
                          cursor: 'pointer', fontFamily: 'inherit',
                        }}
                      >
                        Review & Order →
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          const { useTabStore } = require('@/store');
                          useTabStore.getState().setTab('trade');
                        }}
                        style={{
                          flex: 1, padding: '10px 16px',
                          background: '#06b6d4', border: 'none', borderRadius: 12,
                          color: 'white', fontSize: 12, fontWeight: 600,
                          cursor: 'pointer', fontFamily: 'inherit',
                        }}
                      >
                        View in Trade →
                      </button>
                    )}
                    <button
                      style={{
                        padding: '10px 16px',
                        background: 'transparent',
                        border: '1px solid #475569',
                        borderRadius: 12,
                        color: '#94a3b8', fontSize: 12,
                        cursor: 'pointer', fontFamily: 'inherit',
                      }}
                    >
                      Watch
                    </button>
                  </div>
                </div>
              )}

              {/* Render embedded cards (suppress when rebalance session card is shown) */}
              {msg.components && msg.components.length > 0 && !msg.rebalanceSession && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {msg.components.map((card, ci) => (
                    <ConvictionCard key={`${msg.id}-card-${ci}`} card={card} />
                  ))}
                </div>
              )}

              {/* Rebalance session card — structured plan from AI */}
              {msg.role === 'assistant' && !isLoading && msg.rebalanceSession && (() => {
                const session = msg.rebalanceSession;
                const tradeCount = session.trades?.length || 0;
                const totalValue = session.trades?.reduce((sum: number, t: any) => sum + (t.estimatedValue || 0), 0) || 0;
                const buys = session.trades?.filter((t: any) => t.action === 'buy' || t.action === 'add') || [];
                const sells = session.trades?.filter((t: any) => t.action === 'sell' || t.action === 'trim') || [];
                const isStyleDefault = session.targetSource === 'style_default';
                const styleName = session.styleName || '';
                return (
                  <div style={{
                    marginTop: 10,
                    padding: '12px 14px',
                    background: '#1e293b',
                    border: '1px solid #06b6d4',
                    borderRadius: 10,
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#06b6d4', marginBottom: 4 }}>
                      📊 Rebalance Plan Ready
                      {isStyleDefault && <span style={{ fontSize: 10, color: '#f59e0b', marginLeft: 6 }}>({styleName} defaults)</span>}
                    </div>
                    <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 10 }}>
                      {tradeCount} trades · Est. ${totalValue.toLocaleString()}
                      {buys.length > 0 && ` · ${buys.length} buys`}
                      {sells.length > 0 && ` · ${sells.length} sells`}
                    </div>
                    <button
                      onClick={() => {
                        const isLocal = session.sessionId?.startsWith('local-');
                        const url = isLocal
                          ? `/strategies/setup/rebalancing?source=ai&trades=${encodeURIComponent(JSON.stringify(session.trades))}`
                          : `/strategies/setup/rebalancing?session=${session.sessionId}&source=ai`;
                        router.push(url);
                      }}
                      style={{
                        width: '100%',
                        padding: '10px 16px',
                        background: '#06b6d4',
                        border: 'none',
                        borderRadius: 8,
                        color: 'white',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >
                      Push to Rebalance →
                    </button>
                    {isStyleDefault && session.targets && session.targets.length > 0 && (
                      <button
                        onClick={() => handleSaveStyleTargets(session.targets!)}
                        style={{
                          width: '100%',
                          marginTop: 8,
                          padding: '8px 16px',
                          background: '#1e293b',
                          border: '1px solid #f59e0b',
                          borderRadius: 8,
                          color: '#f59e0b',
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                        }}
                      >
                        💾 Save These as My Targets
                      </button>
                    )}
                  </div>
                );
              })()}

              {/* Fallback: keyword-based or JSON-parsed rebalance link */}
              {msg.role === 'assistant' && !isLoading && !msg.rebalanceSession && (() => {
                const rawText = msg.content || '';
                const text = rawText.toLowerCase();
                const hasRebalance = /\brebalance\b|\brebalancing\b|\bdrift\b|\ballocation target\b/i.test(text);
                // Check for structured trades from <rebalance-trades> JSON block
                const parsedTrades = extractRebalanceTrades(rawText);
                if (!hasRebalance && !parsedTrades) return null;

                const tradeCount = parsedTrades?.length || 0;
                const buys = parsedTrades?.filter(t => t.action === 'buy') || [];
                const sells = parsedTrades?.filter(t => t.action === 'sell') || [];

                if (tradeCount === 0) return null;

                return (
                  <div style={{
                    marginTop: 10, padding: '12px 14px',
                    background: '#1e293b',
                    border: '1px solid #06b6d4',
                    borderRadius: 10,
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#06b6d4', marginBottom: 4 }}>
                      📊 Rebalance Detected
                    </div>
                    <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 4 }}>
                      {tradeCount} targets parsed
                      {buys.length > 0 && ` · ${buys.length} buys`}
                      {sells.length > 0 && ` · ${sells.length} sells`}
                    </div>
                  </div>
                );
              })()}

              {/* Cost indicator on last AI message */}
              {msg.role === 'assistant' && idx === messages.length - 1 && lastCost > 0 && showCost && (
                <div style={{
                  fontSize: 9, color: '#64748b', marginTop: 4,
                  textAlign: 'right', fontStyle: 'italic',
                }}>
                  ~${lastCost.toFixed(4)} · {remainingCalls}/75 messages left
                </div>
              )}
            </div>
          </div>
          );
        })}

        {/* Error banner */}
        {error && (
          <div style={{
            padding: '10px 12px', background: 'rgba(248,113,113,0.15)',
            border: '1px solid rgba(248,113,113,0.3)', borderRadius: 8,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <AlertCircle size={14} style={{ color: '#f87171', flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 11, color: '#fca5a5' }}>{error}</span>
            <button
              onClick={() => { setError(null); retry(); }}
              style={{
                padding: '4px 8px', background: 'rgba(248,113,113,0.2)',
                border: 'none', borderRadius: 4, color: '#f87171',
                cursor: 'pointer', fontSize: 10, display: 'flex', alignItems: 'center', gap: 3,
              }}
            >
              <RefreshCw size={10} /> Retry
            </button>
          </div>
        )}

        {/* Rate limit warning */}
        {remainingCalls > 0 && (
          <div style={{
            padding: '8px 12px', background: 'rgba(251,191,36,0.1)',
            border: '1px solid rgba(251,191,36,0.25)', borderRadius: 8,
            fontSize: 10, color: '#fbbf24', textAlign: 'center',
          }}>
            ⚡ {remainingCalls}/75 messages remaining today
          </div>
        )}

        {remainingCalls === 0 && (
          <div style={{
            padding: '8px 12px', background: 'rgba(248,113,113,0.1)',
            border: '1px solid rgba(248,113,113,0.25)', borderRadius: 8,
            fontSize: 10, color: '#f87171', textAlign: 'center',
          }}>
            🛑 Daily limit reached — resets at midnight EST
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Sticky Input Area ── */}
      <div style={{
        flexShrink: 0,
        padding: '10px 16px 8px',
        background: '#1e293b',
        borderTop: '1px solid #334155',
      }}>
        {/* Primary suggestions row */}
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: showMorePrompts ? 4 : 8 }}
          className="no-scrollbar">
          {SUGGESTIONS_PRIMARY.map((s) => (
            <button
              key={s.id}
              onClick={() => handleQuickPrompt(s)}
              disabled={isLoading || remainingCalls === 0}
              style={{
                padding: '5px 9px', background: '#334155', border: 'none',
                borderRadius: 4, color: '#cbd5e1', cursor: (isLoading || remainingCalls === 0) ? 'default' : 'pointer',
                fontSize: 15, whiteSpace: 'nowrap', flexShrink: 0,
                opacity: (isLoading || remainingCalls === 0) ? 0.5 : 1,
              }}
            >
              {s.label}
            </button>
          ))}
          <button
            onClick={() => setShowBasketModal(true)}
            disabled={isLoading || remainingCalls === 0}
            style={{
              padding: '5px 9px',
              background: 'linear-gradient(135deg, rgba(6,182,212,0.2), rgba(13,148,136,0.2))',
              border: '1px solid rgba(6,182,212,0.3)',
              borderRadius: 4,
              color: '#22d3ee',
              cursor: (isLoading || remainingCalls === 0) ? 'default' : 'pointer',
              fontSize: 15,
              whiteSpace: 'nowrap',
              flexShrink: 0,
              fontWeight: 600,
              opacity: (isLoading || remainingCalls === 0) ? 0.5 : 1,
              transition: 'all 0.2s',
            }}
          >
            🧺 Build
          </button>
          <button
            onClick={() => setShowMorePrompts(prev => !prev)}
            disabled={isLoading || remainingCalls === 0}
            style={{
              padding: '5px 9px', background: showMorePrompts ? '#1e3a5f' : '#334155',
              border: showMorePrompts ? '1px solid rgba(6,182,212,0.3)' : '1px solid transparent',
              borderRadius: 4, color: showMorePrompts ? '#67e8f9' : '#94a3b8',
              cursor: (isLoading || remainingCalls === 0) ? 'default' : 'pointer',
              fontSize: 15, whiteSpace: 'nowrap', flexShrink: 0,
              fontWeight: showMorePrompts ? 600 : 400,
              opacity: (isLoading || remainingCalls === 0) ? 0.5 : 1,
            }}
          >
            {showMorePrompts ? 'Less ↑' : 'More ↓'}
          </button>
        </div>
        {/* Secondary suggestions row — collapsible */}
        {showMorePrompts && (
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 8 }}
            className="no-scrollbar">
            {SUGGESTIONS_SECONDARY.map((s) => (
              <button
                key={s.id}
                onClick={() => handleQuickPrompt(s)}
                disabled={isLoading || remainingCalls === 0}
                style={{
                  padding: '5px 9px', background: '#1e293b', border: '1px solid #334155',
                  borderRadius: 4, color: '#cbd5e1', cursor: (isLoading || remainingCalls === 0) ? 'default' : 'pointer',
                  fontSize: 15, whiteSpace: 'nowrap', flexShrink: 0,
                  opacity: (isLoading || remainingCalls === 0) ? 0.5 : 1,
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        {/* Research symbol input — appears inline when Research is tapped */}
        {showResearchInput && (
          <div style={{
            display: 'flex', gap: 6, marginBottom: 8,
            padding: '8px 10px', background: '#0f172a',
            border: '1px solid #06b6d4', borderRadius: 8,
            alignItems: 'center',
          }}>
            <span style={{ fontSize: 10, color: '#06b6d4', whiteSpace: 'nowrap' }}>🔍 Symbol:</span>
            <input
              type="text"
              value={researchSymbol}
              onChange={(e) => setResearchSymbol(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleResearchSend();
                if (e.key === 'Escape') { setShowResearchInput(false); setResearchSymbol(''); }
              }}
              placeholder="AAPL, NVDA..."
              autoFocus
              style={{
                flex: 1, padding: '6px 8px',
                background: '#1e293b', border: '1px solid #334155',
                borderRadius: 6, color: '#f1f5f9', fontSize: 12,
                outline: 'none',
              }}
            />
            <button
              onClick={handleResearchSend}
              disabled={!researchSymbol.trim()}
              style={{
                padding: '6px 10px', background: researchSymbol.trim() ? '#06b6d4' : '#334155',
                border: 'none', borderRadius: 6, color: 'white',
                cursor: researchSymbol.trim() ? 'pointer' : 'default',
                fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
              }}
            >
              Go
            </button>
            <button
              onClick={() => { setShowResearchInput(false); setResearchSymbol(''); }}
              style={{
                padding: '6px 8px', background: 'transparent',
                border: 'none', color: '#94a3b8',
                cursor: 'pointer', fontSize: 14,
              }}
            >
              ✕
            </button>
          </div>
        )}

        {/* Input row */}
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your portfolio, markets, or stocks..."
            disabled={isLoading || remainingCalls === 0}
            style={{
              flex: 1, padding: '9px 11px',
              background: '#0f172a', border: '1px solid #334155',
              borderRadius: 8, color: '#f1f5f9', fontSize: 12,
              outline: 'none',
              opacity: isLoading ? 0.6 : 1,
            }}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim() || remainingCalls === 0}
            style={{
              width: 34, height: 34,
              background: input.trim() && !isLoading ? '#06b6d4' : '#334155',
              border: 'none', borderRadius: 8,
              color: 'white', cursor: input.trim() && !isLoading ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 0.2s',
            }}
          >
            <Send size={16} />
          </button>

          {/* Response mode toggle — Summary / Detailed */}
          <button
            onClick={() => setResponseMode(m => m === 'summary' ? 'detailed' : 'summary')}
            disabled={isLoading}
            title={responseMode === 'summary' ? 'Switch to Detailed mode' : 'Switch to Summary mode'}
            style={{
              width: 34, height: 34,
              background: responseMode === 'detailed' ? 'rgba(6,182,212,0.15)' : 'transparent',
              border: responseMode === 'detailed' ? '1px solid #06b6d4' : '1px solid #475569',
              borderRadius: 8,
              color: responseMode === 'detailed' ? '#06b6d4' : '#94a3b8',
              cursor: isLoading ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              opacity: isLoading ? 0.5 : 1,
              flexShrink: 0,
              fontSize: 10,
              fontWeight: 600,
            }}
          >
            <AlignLeft size={14} />
          </button>

          {/* 🗑️ Always visible */}
          <button
            onClick={() => {
              if (confirm('Clear all chat messages?')) {
                clearChat();
              }
            }}
            disabled={isLoading}
            title="Clear chat history"
            style={{
              width: 34, height: 34,
              background: 'transparent',
              border: '1px solid #475569',
              borderRadius: 8,
              color: '#94a3b8',
              cursor: isLoading ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              opacity: isLoading ? 0.5 : 1,
              flexShrink: 0,
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>

        {/* API status */}
        <div style={{
          textAlign: 'center', fontSize: 9, color: '#475569',
          marginTop: 6,
        }}>
          Powered by AI · Responses may contain errors. Conversation history saved.
        </div>
      </div>

      {/* ── Build Basket Modal ── */}
      <BuildBasketModal
        isOpen={showBasketModal}
        onClose={() => setShowBasketModal(false)}
        onBasketGenerated={(userMsg, data) => {
          useChatStore.getState().addMessage({
            id: Date.now().toString(),
            role: 'user',
            content: userMsg,
            type: 'text',
            timestamp: Date.now(),
          })
          useChatStore.getState().addMessage({
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: data.content,
            type: data.type || 'text',
            basketId: data.basketId,
            basketName: data.basketName,
            stocks: data.stocks,
            timestamp: Date.now(),
          })
          setTimeout(() => {
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
          }, 100)
        }}
      />

      <style jsx>{`
        @keyframes blink {
          50% { opacity: 0; }
        }
        .empty-state {
          text-align: center;
          padding: 32px 8px;
        }
        .empty-icon {
          font-size: 32px;
          margin-bottom: 8px;
        }
        .empty-title {
          font-size: 14px;
          font-weight: 700;
          color: var(--text-primary);
          margin-bottom: 4px;
        }
        .empty-subtitle {
          font-size: 11px;
          color: var(--text-muted);
          max-width: 260px;
          margin: 0 auto;
          line-height: 1.5;
        }
        .empty-disclaimer {
          font-size: 9px;
          color: #fca5a5;
          margin-top: 8px;
          font-weight: 500;
        }
        .chat-messages::-webkit-scrollbar {
          width: 4px;
        }
        .chat-messages::-webkit-scrollbar-track {
          background: transparent;
        }
        .chat-messages::-webkit-scrollbar-thumb {
          background: #334155;
          border-radius: 2px;
        }
      `}</style>
    </div>
  );
}
