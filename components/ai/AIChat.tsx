'use client';
import { useState, useRef, useEffect } from 'react';
import { Send, RefreshCw, AlertCircle, Trash2 } from 'lucide-react';
import { useAIChat } from '@/hooks/useAIChat';
import { ConvictionCard } from './ConvictionCard';

const SUGGESTIONS = [
  '🔍 Research',
  '📊 Risk Check',
  '💡 Trade Ideas',
  '📰 Market News',
  '⚙️ Rebalance',
  '📈 Technical Analysis',
];

export function AIChat() {
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
  const [showCost, setShowCost] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
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
        sendMessage(detail.prompt);
      }
    };
    window.addEventListener('vantage-ai-suggestion', handler);
    return () => window.removeEventListener('vantage-ai-suggestion', handler);
  }, [sendMessage]);

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    sendMessage(input.trim());
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSuggestion = (suggestion: string) => {
    const cleaned = suggestion.replace(/^[📊💡📰⚙️📈🔍]\s*/, '');
    setInput(cleaned);
    inputRef.current?.focus();
  };

  const lastAiMessage = [...messages].reverse().find(m => m.role === 'assistant');

  return (
    <div style={{ paddingBottom: 80 }}>
      {/* Header */}
      {messages.length > 0 && (
        <div style={{
          padding: '8px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid #1e293b',
        }}>
          <span style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>Chat History</span>
          <button
            onClick={() => {
              if (confirm('Clear all chat messages?')) {
                clearChat();
              }
            }}
            style={{
              padding: '4px 8px',
              background: 'transparent',
              border: '1px solid #334155',
              borderRadius: 4,
              color: '#64748b',
              cursor: 'pointer',
              fontSize: 10,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              transition: 'all 0.15s',
            }}
            title="Clear chat history"
          >
            <Trash2 size={12} /> Clear
          </button>
        </div>
      )}

      {/* Messages */}
      <div style={{ padding: '12px 16px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon">🦊</div>
            <div className="empty-title">Ask Vantage AI</div>
            <div className="empty-subtitle">
              Real-time portfolio analysis, trade signals, and market insights — powered by DeepSeek.
            </div>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div
            key={msg.id}
            className={`message ${msg.role}`}
            style={{ display: 'flex', gap: 8, flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}
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
              {msg.role === 'assistant' ? '🦊' : 'E'}
            </div>
            <div
              className="bubble"
              style={{
                maxWidth: '85%', padding: '9px 11px', borderRadius: 12,
                fontSize: 12, lineHeight: 1.45,
                background: msg.role === 'assistant' ? '#1e293b' : '#06b6d4',
                color: msg.role === 'assistant' ? '#f1f5f9' : 'white',
                position: 'relative',
              }}
            >
              {/* AI response content with markdown-style formatting */}
              <div className="message-content" style={{ whiteSpace: 'pre-wrap' }}>
                {msg.content}
              </div>

              {/* Streaming cursor */}
              {msg.role === 'assistant' && isLoading && idx === messages.length - 1 && (
                <span className="cursor-blink" style={{
                  display: 'inline-block', width: 6, height: 14,
                  background: '#06b6d4', marginLeft: 2, verticalAlign: 'middle',
                  animation: 'blink 1s step-end infinite',
                }} />
              )}

              {/* Render embedded cards */}
              {msg.components && msg.components.length > 0 && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {msg.components.map((card, ci) => (
                    <ConvictionCard key={`${msg.id}-card-${ci}`} card={card} />
                  ))}
                </div>
              )}

              {/* Cost indicator on last AI message */}
              {msg.role === 'assistant' && idx === messages.length - 1 && lastCost > 0 && showCost && (
                <div style={{
                  fontSize: 9, color: '#64748b', marginTop: 4,
                  textAlign: 'right', fontStyle: 'italic',
                }}>
                  ~${lastCost.toFixed(4)} · {remainingCalls} calls left
                </div>
              )}
            </div>
          </div>
        ))}

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
        {remainingCalls <= 3 && remainingCalls > 0 && (
          <div style={{
            padding: '8px 12px', background: 'rgba(251,191,36,0.1)',
            border: '1px solid rgba(251,191,36,0.25)', borderRadius: 8,
            fontSize: 10, color: '#fbbf24', textAlign: 'center',
          }}>
            ⚡ Only {remainingCalls} AI call{remainingCalls === 1 ? '' : 's'} remaining this hour
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

      {/* Input Area */}
      <div style={{
        position: 'sticky', bottom: 0, left: 0, right: 0,
        padding: '10px 16px', background: '#1e293b',
        borderTop: '1px solid #334155',
      }}>
        {/* Suggestions */}
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 8 }}
          className="no-scrollbar">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => handleSuggestion(s)}
              disabled={isLoading}
              style={{
                padding: '5px 9px', background: '#334155', border: 'none',
                borderRadius: 4, color: '#cbd5e1', cursor: isLoading ? 'default' : 'pointer',
                fontSize: 10, whiteSpace: 'nowrap', flexShrink: 0,
                opacity: isLoading ? 0.5 : 1,
              }}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Input */}
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything about your portfolio..."
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
        </div>

        {/* API status */}
        <div style={{
          textAlign: 'center', fontSize: 9, color: '#475569',
          marginTop: 6,
        }}>
          Powered by DeepSeek · Responses may contain errors
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
        .message-content strong {
          color: var(--accent-cyan);
          font-weight: 600;
        }
      `}</style>
    </div>
  );
}
