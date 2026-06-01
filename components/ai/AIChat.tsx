'use client';
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Send, RefreshCw, AlertCircle, Trash2, AlignLeft } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAIChat } from '@/hooks/useAIChat';

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

/** Check if a string contains a markdown table with positions */
function hasMarkdownTable(content: string): boolean {
  const clean = sanitizeContent(content);
  return clean.includes('|') && /\bSymbol\b/i.test(clean);
}

/** Parse dollar amount string like "$10,300", "-$6,100", "$5.1K" */
function parseDollarAmount(str: string): number {
  if (!str) return 0;
  const num = str.replace(/[$,\s]/g, '');
  const value = parseFloat(num);
  if (isNaN(value)) return 0;
  return /[Kk]/.test(str) ? value * 1000 : value;
}

/** Parse trades from AI markdown tables */
function parseTradesFromMarkdown(content: string): Array<{
  symbol: string;
  action: string;
  type: string;
  currentPct: number;
  targetPct: number;
  dollarAmount: number;
  reason: string;
}> {
  const trades: Array<{
    symbol: string;
    action: string;
    type: string;
    currentPct: number;
    targetPct: number;
    dollarAmount: number;
    reason: string;
  }> = [];
  const lines = content.split('\n');
  let currentTable: 'sell' | 'buy' | null = null;

  for (const line of lines) {
    // Detect table type from headings
    if (line.toLowerCase().includes('sell')) currentTable = 'sell';
    if (line.toLowerCase().includes('buy') && !line.toLowerCase().includes('sell')) currentTable = 'buy';

    // Skip non-data rows
    if (!line.startsWith('|')) continue;
    if (line.includes('---')) continue;
    if (/\bSymbol\b/i.test(line)) continue;

    const cols = line.split('|')
      .map(c => c.trim())
      .filter(Boolean);

    if (cols.length >= 4 && currentTable) {
      const symbol = cols[0];
      if (!symbol || symbol.length > 6 || symbol.length < 1) continue;

      // Column offsets differ between SELL/BUY tables
      // SELL: Symbol | Current % | Target % | Reduce By | Est. Proceeds | Why
      // BUY:  Symbol | Type | Current % | Target % | Add | Est. Cost | Why
      const isBuy = currentTable === 'buy';
      const currentPctCol = isBuy ? 2 : 1;
      const targetPctCol = isBuy ? 3 : 2;
      const amountCol = isBuy ? 5 : 4;

      trades.push({
        symbol: symbol.toUpperCase(),
        action: currentTable === 'sell' ? 'sell' : 'buy',
        type: isBuy && cols[1]?.toLowerCase().includes('etf') ? 'etf' : 'stock',
        currentPct: parseFloat(cols[currentPctCol]) || 0,
        targetPct: parseFloat(cols[targetPctCol]) || 0,
        dollarAmount: parseDollarAmount(cols[amountCol] || ''),
        reason: cols[cols.length - 1] || '',
      });
    }
  }

  return trades;
}

import { useAuth } from '@/components/providers/AuthProvider';
import { ConvictionCard } from './ConvictionCard';

const SUGGESTIONS = [
  {
    id: 'health',
    label: '🌱 Portfolio Health',
    mode: 'health' as const,
    message: 'Run a complete health check on my portfolio. Score each area and give me priority actions.',
  },
  {
    id: 'risk',
    label: '🛡 Risk Check',
    mode: 'risk' as const,
    message: 'Check my portfolio for concentration risk, sector risk, and any other risks I should know about.',
  },
  {
    id: 'opportunities',
    label: '💡 Opportunities',
    mode: 'opportunities' as const,
    message: 'Based on my current portfolio and market conditions, what buying or rebalancing opportunities do you see?',
  },
  {
    id: 'trends',
    label: '📈 Market Trends',
    mode: 'trends' as const,
    message: 'What are the key market trends right now and how do they affect my portfolio specifically?',
  },
  {
    id: 'research',
    label: '🔍 Research',
    mode: 'research' as const,
    message: 'Research [SYMBOL] — fundamentals, technicals, recent news, and whether it fits my portfolio.',
  },
  {
    id: 'tax',
    label: '🧾 Tax Check',
    mode: 'tax' as const,
    message: 'Check my tax situation. What losses can I harvest and what are my estimated savings?',
  },
];

/** Custom markdown renderers — dark theme, compact, trading-appropriate */
const MARKDOWN_COMPONENTS = {
  h1: ({ children }: { children: React.ReactNode }) => (
    <h1 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', margin: '10px 0 4px', lineHeight: 1.3 }}>{children}</h1>
  ),
  h2: ({ children }: { children: React.ReactNode }) => (
    <h2 style={{ fontSize: 13, fontWeight: 700, color: '#06b6d4', margin: '8px 0 4px', lineHeight: 1.3 }}>{children}</h2>
  ),
  h3: ({ children }: { children: React.ReactNode }) => (
    <h3 style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', margin: '6px 0 2px', lineHeight: 1.3 }}>{children}</h3>
  ),
  p: ({ children }: { children: React.ReactNode }) => (
    <p style={{ margin: '2px 0 6px', lineHeight: 1.7, color: '#cbd5e1' }}>{children}</p>
  ),
  strong: ({ children }: { children: React.ReactNode }) => (
    <strong style={{ color: '#facc15', fontWeight: 700 }}>{children}</strong>
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
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, color: 'rgba(255,255,255,0.85)' }}>
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
      fontSize: 11,
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
    <li style={{ marginBottom: 1, lineHeight: 1.6, fontSize: 12 }}>{children}</li>
  ),
  hr: () => <hr style={{ border: 'none', borderTop: '1px solid #1e293b', margin: '6px 0' }} />,
  blockquote: ({ children }: { children: React.ReactNode }) => (
    <blockquote style={{ borderLeft: '2px solid #06b6d4', paddingLeft: 8, margin: '4px 0', color: '#94a3b8', fontSize: 11, fontStyle: 'italic' }}>{children}</blockquote>
  ),
};  // eslint-disable-next-line @typescript-eslint/no-explicit-any

export function AIChat() {
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
        sendMessage(detail.prompt, responseMode, detail.mode);
      }
    };
    window.addEventListener('vantage-ai-suggestion', handler);
    return () => window.removeEventListener('vantage-ai-suggestion', handler);
  }, [sendMessage, responseMode]);

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    sendMessage(input.trim(), responseMode, 'general');
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleQuickPrompt = (suggestion: typeof SUGGESTIONS[number]) => {
    if (suggestion.id === 'research') {
      // Show inline symbol input for research prompt
      setShowResearchInput(true);
      setResearchSymbol('');
      return;
    }
    sendMessage(suggestion.message, responseMode, suggestion.mode);
  };

  const handleResearchSend = () => {
    const symbol = researchSymbol.trim().toUpperCase();
    if (!symbol) return;
    const researchSuggestion = SUGGESTIONS.find(s => s.id === 'research')!;
    const message = researchSuggestion.message.replace('[SYMBOL]', symbol);
    sendMessage(message, responseMode, 'research', symbol);
    setShowResearchInput(false);
    setResearchSymbol('');
  };

  const handlePushToRebalance = async (content: string) => {
    try {
      const trades = parseTradesFromMarkdown(content);

      const res = await fetch('/api/strategies/rebalancing/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trades,
          source: 'ai_chat',
          expiresIn: 3600,
        }),
      });

      const { sessionId } = await res.json();
      router.push(`/strategies/setup/rebalancing?session=${sessionId}&fresh=true`);
    } catch (err) {
      console.error('Push to rebalance error:', err);
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      maxHeight: 'calc(100vh - 180px)',
    }}>
      {/* ── Scrollable Messages ── */}
      <div
        ref={messagesContainerRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px 16px 0',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          minHeight: 0,
        }}
        className="chat-messages"
      >
        {messages.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon">🦊</div>
            <div className="empty-title">Ready to make some money, {userInitial}?</div>
            <div className="empty-subtitle">
              AI-powered portfolio analysis and market intelligence.
            </div>
            <div className="empty-disclaimer">
              ⚠️ Advisory only. Vantage AI does not execute trades.
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
                <div className="markdown-body" style={{ fontSize: 14, lineHeight: 1.7 }}>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={MARKDOWN_COMPONENTS as any}
                  >
                    {sanitizeContent(msg.content || '...')}
                  </ReactMarkdown>

                  {/* Streaming cursor */}
                  {isLoading && idx === messages.length - 1 && (
                    <span className="cursor-blink" style={{
                      display: 'inline-block', width: 6, height: 13,
                      background: '#06b6d4', marginLeft: 2, verticalAlign: 'middle',
                      animation: 'blink 1s step-end infinite',
                    }} />
                  )}
                </div>
              ) : (
                /* User messages stay plain */
                <div style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
                  {msg.content}
                </div>
              )}

              {/* Push to Rebalance — shown when AI output contains a markdown table */}
              {msg.role === 'assistant' && !isLoading && !msg.rebalanceSession && hasMarkdownTable(msg.content || '') && (() => {
                return (
                  <div style={{
                    marginTop: 12,
                    border: '1px solid rgba(6,182,212,0.3)',
                    borderRadius: 12,
                    padding: 16,
                    background: 'rgba(30,41,59,0.5)',
                  }}>
                    <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>
                      AI-suggested rebalancing plan ready
                    </p>
                    <button
                      onClick={() => handlePushToRebalance(msg.content)}
                      style={{
                        width: '100%',
                        background: '#06b6d4',
                        border: 'none',
                        borderRadius: 8,
                        color: 'white',
                        fontWeight: 600,
                        fontSize: 13,
                        padding: '10px 16px',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        transition: 'background 0.2s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#0891b2')}
                      onMouseLeave={e => (e.currentTarget.style.background = '#06b6d4')}
                    >
                      📊 Open in Rebalancing →
                    </button>
                  </div>
                );
              })()}

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

                return (
                  <div style={{
                    marginTop: 10, padding: tradeCount > 0 ? '12px 14px' : 0,
                    background: tradeCount > 0 ? '#1e293b' : 'transparent',
                    border: tradeCount > 0 ? '1px solid #06b6d4' : 'none',
                    borderRadius: 10,
                  }}>
                    {tradeCount > 0 && (
                      <>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#06b6d4', marginBottom: 4 }}>
                          📊 Rebalance Detected
                        </div>
                        <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 10 }}>
                          {tradeCount} targets parsed
                          {buys.length > 0 && ` · ${buys.length} buys`}
                          {sells.length > 0 && ` · ${sells.length} sells`}
                        </div>
                      </>
                    )}
                    <button
                      onClick={() => {
                        const url = tradeCount > 0 && parsedTrades
                          ? `/strategies/setup/rebalancing?source=ai&trades=${encodeURIComponent(JSON.stringify(parsedTrades.map(t => ({
                              symbol: t.symbol,
                              action: t.action,
                              shares: 0,
                              estimatedValue: 0,
                            }))))}`
                          : '/strategies/setup/rebalancing?source=ai';
                        router.push(url);
                      }}
                      style={{
                        width: '100%',
                        padding: '10px 16px',
                        background: tradeCount > 0 ? '#06b6d4' : '#1e293b',
                        border: tradeCount > 0 ? 'none' : '1px solid #06b6d4',
                        borderRadius: 8,
                        color: tradeCount > 0 ? 'white' : '#06b6d4',
                        fontSize: 12, fontWeight: 600,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        textAlign: 'center',
                      }}
                    >
                      {tradeCount > 0 ? 'Send to Rebalancing →' : '📊 Open Rebalancing →'}
                    </button>
                  </div>
                );
              })()}

              {/* Cost indicator on last AI message */}
              {msg.role === 'assistant' && idx === messages.length - 1 && lastCost > 0 && showCost && (
                <div style={{
                  fontSize: 9, color: '#64748b', marginTop: 4,
                  textAlign: 'right', fontStyle: 'italic',
                }}>
                  ~${lastCost.toFixed(4)} · {remainingCalls}/25 calls left
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
            ⚡ {remainingCalls}/25 AI calls available this hour
          </div>
        )}

        {remainingCalls === 0 && (
          <div style={{
            padding: '8px 12px', background: 'rgba(248,113,113,0.1)',
            border: '1px solid rgba(248,113,113,0.25)', borderRadius: 8,
            fontSize: 10, color: '#f87171', textAlign: 'center',
          }}>
            🛑 AI cooldown — wait for the hourly reset
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
        {/* NO EXECUTION disclaimer banner */}
        <div style={{
          padding: '6px 10px',
          marginBottom: 8,
          background: 'rgba(248,113,113,0.08)',
          border: '1px solid rgba(248,113,113,0.2)',
          borderRadius: 6,
          fontSize: 10,
          color: '#fca5a5',
          textAlign: 'center',
          fontWeight: 500,
        }}>
          ⚠️ NO EXECUTION — Vantage AI advises only. All trades must be placed manually in the Trade tab or Strategies.
        </div>
        {/* Suggestions */}
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 8 }}
          className="no-scrollbar">
          {SUGGESTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => handleQuickPrompt(s)}
              disabled={isLoading || remainingCalls === 0}
              style={{
                padding: '5px 9px', background: '#334155', border: 'none',
                borderRadius: 4, color: '#cbd5e1', cursor: (isLoading || remainingCalls === 0) ? 'default' : 'pointer',
                fontSize: 10, whiteSpace: 'nowrap', flexShrink: 0,
                opacity: (isLoading || remainingCalls === 0) ? 0.5 : 1,
              }}
            >
              {s.label}
            </button>
          ))}
        </div>

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
            placeholder="Ask anything about stocks, markets, or your portfolio..."
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
          Powered by AI · Responses may contain errors. History of last 5 responses kept.
        </div>
      </div>

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
