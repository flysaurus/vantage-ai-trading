'use client';
import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { useBroker } from '@/components/providers/BrokerProvider';
import { useLivePortfolio, buildLivePortfolioContext } from '@/context/PortfolioContext';
import { persistChat, loadSessions, loadSessionMessages, groupSessionsByDay } from '@/lib/chat-history';
import type { ChatSession } from '@/lib/chat-history';
import { useChatStorage } from '@/hooks/useChatStorage';
import { saveChatMessage } from '@/lib/chat-service';

const DOLLAR_FMT: Intl.NumberFormatOptions = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
};

const fmt = (v: number) => {
  const prefix = v >= 0 ? '+' : '';
  return `${prefix}$${Math.abs(v).toLocaleString('en-US', DOLLAR_FMT)}`;
};

const pctStr = (v: number) => {
  const prefix = v >= 0 ? '+' : '';
  return `${prefix}${Math.abs(v).toFixed(1)}%`;
};

interface Message {
  role: 'user' | 'ai';
  content: string;
}

interface AITabProps {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
}

export function AITab({ messages, setMessages }: AITabProps) {
  const { account: liveAccount } = useLivePortfolio();
  const { isConnected } = useBroker();
  
  // ── Supabase chat storage (previous sessions + message count) ──
  const {
    previousSession,
    remainingMessages: supabaseRemaining,
    loadPreviousSession,
    dismissPreviousSession,
    clearMessages: clearSupabaseMessages,
  } = useChatStorage();

  // ── state ──
  const [dailyBriefExpanded, setDailyBriefExpanded] = useState(false);
  const [snapshotExpanded, setSnapshotExpanded] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastMessageTime, setLastMessageTime] = useState(0);
  const RATE_LIMIT_MS = 5000;
  const [earnings, setEarnings] = useState<{
    symbol: string;
    date: string;
    daysUntil: number;
  }[]>([]);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [marketHeadline, setMarketHeadline] = useState('');
  const [marketNewsUrl, setMarketNewsUrl] = useState('');
  const [portfolioSummary, setPortfolioSummary] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastAiResponseRef = useRef<string>('');

  // ── portfolio context for AI (shared live-priced data from PortfolioProvider) ──
  const portfolioContext = buildLivePortfolioContext(liveAccount);

  // ── fetch market news ──
  const fetchMarketNews = async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      let res = await fetch(
        `/api/finnhub/company-news?symbol=SPY&from=${today}&to=${today}`
      );
      let data = await res.json();

      // weekend/holiday fallback
      if (!data || data.length === 0) {
        const yesterday = new Date(Date.now() - 86400000)
          .toISOString()
          .split('T')[0];
        res = await fetch(
          `/api/finnhub/company-news?symbol=SPY&from=${yesterday}&to=${yesterday}`
        );
        data = await res.json();
      }

      if (data && data.length > 0) {
        const headline = data[0]?.headline || '';
        setMarketHeadline(
          headline.length > 60
            ? headline.substring(0, 57) + '...'
            : headline || 'Markets open'
        );
        setMarketNewsUrl(data[0]?.url || '');
      }
    } catch (e) {
      console.error(e);
    }
  };

  // ── fetch portfolio summary (top holdings today change) ──
  const fetchPortfolioSummary = async () => {
    try {
      const topHoldings = ['META', 'MSFT', 'GOOGL'];

      const quotes = await Promise.all(
        topHoldings.map(async (symbol) => {
          const res = await fetch(
            `/api/finnhub/quote?symbol=${encodeURIComponent(symbol)}`
          );
          const data = await res.json();
          return { symbol, changePct: data.dp ?? 0 };
        })
      );

      const biggest = quotes.reduce((a, b) =>
        Math.abs(a.changePct) > Math.abs(b.changePct) ? a : b
      );

      const direction = biggest.changePct >= 0 ? 'up' : 'down';
      const pct = Math.abs(biggest.changePct).toFixed(1);

      setPortfolioSummary(
        `${biggest.symbol} ${direction} ${pct}% · portfolio -0.9% today`
      );
    } catch (e) {
      console.error(e);
    }
  };

  // ── fetch earnings calendar ──
  const fetchEarnings = async () => {
    try {
      const today = new Date();
      const fromDate = today.toISOString().split('T')[0];
      const toDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];

      const res = await fetch(
        `/api/finnhub/earnings?from=${fromDate}&to=${toDate}`
      );
      const data = await res.json();

      const demoSymbols = [
        'META', 'MSFT', 'GOOGL', 'AMZN', 'NVDA',
        'CRM', 'NFLX', 'ADBE', 'UBER', 'SQ',
      ];

      const relevant = (data.earningsCalendar || [])
        .filter((e: { symbol: string; date: string }) =>
          demoSymbols.includes(e.symbol)
        )
        .map((e: { symbol: string; date: string }) => {
          const earningsDate = new Date(e.date);
          const daysUntil = Math.ceil(
            (earningsDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
          );
          return { symbol: e.symbol, date: e.date, daysUntil };
        })
        .filter((e: { daysUntil: number }) => e.daysUntil >= 0)
        .sort(
          (a: { daysUntil: number }, b: { daysUntil: number }) =>
            a.daysUntil - b.daysUntil
        )
        .slice(0, 3);

      setEarnings(relevant);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchEarnings();
    fetchMarketNews();
    fetchPortfolioSummary();
  }, []);

  // ── persist chat to localStorage whenever messages change ──
  useEffect(() => {
    const id = persistChat(messages, currentSessionId);
    if (id !== currentSessionId) setCurrentSessionId(id);
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── helpers ──
  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 50);
  };

  const sendMessage = async (content: string, mode: 'chat' | 'alerts' = 'chat') => {
    if (!content.trim() || loading) return;

    // Rate limiting
    const now = Date.now();
    if (now - lastMessageTime < RATE_LIMIT_MS) {
      const secondsLeft = Math.ceil((RATE_LIMIT_MS - (now - lastMessageTime)) / 1000);
      setMessages(prev => [...prev, {
        role: 'ai',
        content: `Please wait ${secondsLeft} second${secondsLeft === 1 ? '' : 's'} before sending another message.`
      }]);
      return;
    }
    setLastMessageTime(now);

    const userMessage = { role: 'user' as const, content };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages,
          portfolioContext,
          mode
        })
      });

      if (!res.ok) throw new Error('API error');

      // Handle streaming with typing delay
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let aiContent = '';
      let displayedLength = 0;
      let typingTimer: ReturnType<typeof setInterval> | null = null;

      // Add empty AI message to update in place
      setMessages(prev => [...prev, { role: 'ai', content: '' }]);

      const updateDisplay = (text: string) => {
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'ai', content: text };
          return updated;
        });
      };

      // Start typing animation — outputs 3 chars per ~15ms tick
      const startTyping = () => {
        if (typingTimer) return;
        typingTimer = setInterval(() => {
          if (displayedLength < aiContent.length) {
            displayedLength = Math.min(displayedLength + 3, aiContent.length);
            updateDisplay(aiContent.slice(0, displayedLength));
            scrollToBottom();
          }
        }, 15);
      };

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        // Dismiss toast when first chunk arrives
        if (!typingTimer) setToast(null);

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.text) {
                aiContent += data.text;
                startTyping();
              }
            } catch (e) {
              // skip malformed chunks
            }
          }
        }
        lastAiResponseRef.current = aiContent;
      }

      // Flush remaining text immediately when streaming completes
      if (typingTimer) {
        clearInterval(typingTimer);
        typingTimer = null;
      }
      updateDisplay(aiContent);
      scrollToBottom();
    } catch (error) {
      console.error('Chat error:', error);
      setMessages(prev => [...prev, {
        role: 'ai',
        content: 'Sorry — I encountered an error. Please try again.'
      }]);
    } finally {
      setLoading(false);
      // Persist AI response to Supabase (non-blocking)
      if (lastAiResponseRef.current) {
        saveChatMessage('pending', 'assistant', lastAiResponseRef.current).catch(() => {});
        lastAiResponseRef.current = '';
      }
      scrollToBottom();
    }
  };

  // ── send to chat from tappable items (flash + toast + scroll to input) ──
  const sendToChat = (message: string, e?: React.MouseEvent) => {
    // Flash effect: add cyan border for 100ms on the tapped element
    if (e) {
      const el = e.currentTarget as HTMLElement;
      el.style.transition = 'box-shadow 0s';
      el.style.boxShadow = '0 0 0 2px #22d3ee';
      setTimeout(() => {
        el.style.transition = 'box-shadow 400ms ease-out';
        el.style.boxShadow = '';
      }, 100);
    }
    sendMessage(message);
    // Show toast — dismissed when AI streaming starts
    setToast('💬 Vantage AI is responding...');
    // Scroll to chat input bar after render
    setTimeout(() => {
      document.getElementById('chat-input')?.scrollIntoView({
        behavior: 'smooth',
        block: 'end',
      });
    }, 150);
  };

  // ── derived data from shared portfolio context ──
  const equity = liveAccount?.equity ?? 0;
  const dayPnl = liveAccount?.dayPnl ?? 0;
  const dayPnlPct = liveAccount?.dayPnlPercent ?? 0;
  const totalPnl = liveAccount?.totalPnl ?? 0;
  const totalPnlPct = liveAccount?.totalPnlPercent ?? 0;

  // ── suggestion chips (computed from live portfolio data) ──
  const suggestionChips: string[] = (() => {
    const chips: string[] = [];
    const positions = liveAccount?.positions || [];

    const largest = positions.reduce((a, b) =>
      (a.marketValue || 0) > (b.marketValue || 0) ? a : b
    , positions[0]);
    if (largest) {
      chips.push(`${largest.symbol} — analyze my largest position at $${largest.currentPrice?.toFixed(2) || '?'}`);
    } else {
      chips.push('Analyze my largest position');
    }

    const topMover = [...positions].sort((a, b) =>
      Math.abs(b.dayChange || 0) - Math.abs(a.dayChange || 0)
    )[0];
    if (topMover && topMover.dayChange !== 0) {
      const dir = topMover.dayChange >= 0 ? 'up' : 'down';
      const pct = Math.abs(topMover.dayChangePercent || 0);
      chips.push(`${topMover.symbol} is ${dir} ${pct.toFixed(1)}% today — why?`);
    } else {
      chips.push('How is my portfolio performing today?');
    }

    const dayDir = dayPnl >= 0 ? 'up' : 'down';
    chips.push(`Your portfolio is ${dayDir} ${fmt(Math.abs(dayPnl))} (${pctStr(dayPnlPct)}) today — why?`);
    return chips;
  })();

  // ── styles ──
  const cardBox: React.CSSProperties = {
    background: '#1a2235',
    border: '1px solid #2a3448',
    borderRadius: '10px',
  };

  const COLLAPSIBLE_HEADER: React.CSSProperties = {
    padding: '12px 16px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    cursor: 'pointer',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* ─── 1. Compact Account Card ─── */}
      <div
        style={{
          ...cardBox,
          margin: '12px 16px 0 16px',
          padding: '12px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div>
          <p style={{ fontSize: '22px', fontWeight: '700', color: '#ffffff' }}>
            ${equity.toLocaleString('en-US', DOLLAR_FMT)}
          </p>
          <p style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
            TODAY {fmt(dayPnl)} ({pctStr(dayPnlPct)}){' '}
            · TOTAL {fmt(totalPnl)} ({pctStr(totalPnlPct)})
          </p>
        </div>
        <div>
          <span
            style={{
              whiteSpace: 'nowrap',
              display: 'inline-block',
              fontSize: '10px',
              color: '#22d3ee',
              background: 'rgba(34,211,238,0.1)',
              border: '1px solid rgba(34,211,238,0.2)',
              borderRadius: '4px',
              padding: '2px 8px',
            }}
          >
            {isConnected ? 'Live' : 'Demo Mode'}
          </span>
        </div>
      </div>

      {/* Previous session banner */}
      {previousSession && messages.length === 0 && (
        <div
          style={{
            ...cardBox,
            margin: '8px 16px 0 16px',
            padding: '12px 16px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span style={{ fontSize: '12px', color: '#94a3b8' }}>
            💬 Previous conversation from {previousSession.date}
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={dismissPreviousSession}
              style={{
                background: 'transparent',
                border: '1px solid #374151',
                borderRadius: '6px',
                color: '#94a3b8',
                fontSize: '12px',
                padding: '4px 12px',
                cursor: 'pointer',
              }}
            >
              Start Fresh
            </button>
            <button
              onClick={() => {
                const msgs = loadPreviousSession();
                if (msgs) {
                  setMessages(msgs);
                  setTimeout(() => {
                    document.getElementById('chat-input')?.scrollIntoView({ behavior: 'smooth', block: 'end' });
                  }, 200);
                }
              }}
              style={{
                background: 'rgba(34,211,238,0.15)',
                border: '1px solid #22d3ee',
                borderRadius: '6px',
                color: '#22d3ee',
                fontSize: '12px',
                padding: '4px 12px',
                cursor: 'pointer',
              }}
            >
              Load
            </button>
          </div>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: '80px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9999,
            background: 'rgba(34,211,238,0.15)',
            border: '1px solid #22d3ee',
            borderRadius: '8px',
            padding: '8px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            whiteSpace: 'nowrap',
          }}
        >
          <span
            className="vantage-pulse-dot"
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: '#22d3ee',
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: '13px', color: '#22d3ee' }}>{toast}</span>
          <style>{`
            @keyframes vantageSlideUp {
              from { opacity: 0; transform: translateX(-50%) translateY(16px); }
              to   { opacity: 1; transform: translateX(-50%) translateY(0); }
            }
            @keyframes vantageToastOut {
              from { opacity: 1; transform: translateX(-50%) translateY(0); }
              to   { opacity: 0; transform: translateX(-50%) translateY(-8px); }
            }
            @keyframes vantagePulse {
              0%, 100% { transform: scale(1); opacity: 1; }
              50%      { transform: scale(1.5); opacity: 0.4; }
            }
            .vantage-pulse-dot {
              animation: vantagePulse 1.2s ease-in-out infinite;
            }
            .vantage-toast-in {
              animation: vantageSlideUp 0.3s ease-out forwards;
            }
            .vantage-toast-out {
              animation: vantageToastOut 0.3s ease-in forwards;
            }
          `}</style>
        </div>
      )}

      {/* ─── 2. Daily Brief Card ─── */}
      <div
        style={{
          ...cardBox,
          margin: '12px 16px 0 16px',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={COLLAPSIBLE_HEADER}
          onClick={() => setDailyBriefExpanded(!dailyBriefExpanded)}
        >
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span>🗞️</span>
            <span
              style={{
                fontSize: '13px',
                fontWeight: '600',
                color: '#ffffff',
                marginLeft: '8px',
              }}
            >
              Daily Brief
            </span>
            <span style={{ fontSize: '11px', color: '#64748b', marginLeft: '4px' }}>
              · Today
            </span>
          </div>
          <span style={{ fontSize: '10px', color: '#64748b' }}>
            {dailyBriefExpanded ? '▲' : '▼'}
          </span>
        </div>

        {/* Preview (always visible) */}
        <div style={{ padding: '0 16px 12px 16px' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              cursor: 'pointer',
              background: 'rgba(34,211,238,0.06)',
              border: '1px solid rgba(34,211,238,0.12)',
              borderRadius: '6px',
              padding: '8px 10px',
              marginBottom: '6px',
            }}
            onClick={() => {
              if (marketNewsUrl) window.open(marketNewsUrl, '_blank');
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center' }}>
            <span
              style={{
                fontSize: '9px',
                fontWeight: '700',
                color: '#22d3ee',
                background: 'rgba(34,211,238,0.15)',
                borderRadius: '3px',
                padding: '1px 5px',
                marginRight: '6px',
              }}
            >
              MARKET
            </span>
            <span style={{ fontSize: '12px', color: '#94a3b8' }}>
              {marketHeadline || 'Markets mixed, monitoring macro events'}
            </span>
            </div>
            <span style={{ fontSize: '14px', color: '#22d3ee', marginLeft: '8px', flexShrink: 0 }}>›</span>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              cursor: 'pointer',
              background: 'rgba(34,211,238,0.06)',
              border: '1px solid rgba(34,211,238,0.12)',
              borderRadius: '6px',
              padding: '8px 10px',
            }}
            onClick={() => {
              window.dispatchEvent(
                new CustomEvent('vantage-navigate', { detail: { tab: 'portfolio' } })
              );
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center' }}>
            <span
              style={{
                fontSize: '9px',
                fontWeight: '700',
                color: '#10b981',
                background: 'rgba(16,185,129,0.15)',
                borderRadius: '3px',
                padding: '1px 5px',
                marginRight: '6px',
              }}
            >
              PORTFOLIO
            </span>
            <span style={{ fontSize: '12px', color: '#94a3b8' }}>
              {portfolioSummary || 'Your portfolio down 0.9% today'}
            </span>
            </div>
            <span style={{ fontSize: '14px', color: '#22d3ee', marginLeft: '8px', flexShrink: 0 }}>›</span>
          </div>
        </div>

        {/* Expanded */}
        {dailyBriefExpanded && (
          <div
            style={{
              padding: '0 16px 12px 16px',
              borderTop: '1px solid #2a3448',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                cursor: 'pointer',
                background: 'rgba(34,211,238,0.06)',
                border: '1px solid rgba(34,211,238,0.12)',
                borderRadius: '6px',
                padding: '8px 10px',
                marginBottom: '6px',
                marginTop: '12px',
              }}
              onClick={(e) => {
                if (earnings[0]) {
                  sendToChat(`Tell me about ${earnings[0].symbol} upcoming earnings`, e);
                }
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center' }}>
              <span
                style={{
                  fontSize: '9px',
                  fontWeight: '700',
                  color: '#f59e0b',
                  background: 'rgba(245,158,11,0.15)',
                  borderRadius: '3px',
                  padding: '1px 5px',
                  marginRight: '6px',
                }}
              >
                WATCH
              </span>
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                {earnings.length > 0
                  ? `${earnings[0].symbol} earnings in ${earnings[0].daysUntil} day${earnings[0].daysUntil === 1 ? '' : 's'}`
                  : 'No earnings in next 30 days for your holdings'}
              </span>
              </div>
              <span style={{ fontSize: '14px', color: '#22d3ee', marginLeft: '8px', flexShrink: 0 }}>›</span>
            </div>
            {earnings.length > 1 && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                cursor: 'pointer',
                background: 'rgba(34,211,238,0.06)',
                border: '1px solid rgba(34,211,238,0.12)',
                borderRadius: '6px',
                padding: '8px 10px',
              }}
              onClick={(e) => {
                sendToChat(`Tell me about ${earnings[1].symbol} upcoming earnings`, e);
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center' }}>
              <span
                style={{
                  fontSize: '9px',
                  fontWeight: '700',
                  color: '#a855f7',
                  background: 'rgba(168,85,247,0.15)',
                  borderRadius: '3px',
                  padding: '1px 5px',
                  marginRight: '6px',
                }}
              >
                EARNINGS
              </span>
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                {earnings[1].symbol} reports in {earnings[1].daysUntil} days
              </span>
              </div>
              <span style={{ fontSize: '14px', color: '#22d3ee', marginLeft: '8px', flexShrink: 0 }}>›</span>
            </div>
            )}
            <p style={{ fontSize: '10px', color: '#334155', marginTop: '8px' }}>
              Generated now · Updates tomorrow
            </p>
          </div>
        )}
      </div>

      {/* ─── 3. Weekly Snapshot Card ─── */}
      <div
        style={{
          margin: '8px 16px 0 16px',
          background: 'rgba(26,34,53,0.6)',
          border: '1px solid rgba(42,52,72,0.6)',
          borderRadius: '10px',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={COLLAPSIBLE_HEADER}
          onClick={() => setSnapshotExpanded(!snapshotExpanded)}
        >
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{ fontSize: '14px' }}>📊</span>
            <span
              style={{
                fontSize: '13px',
                fontWeight: '600',
                color: '#ffffff',
                marginLeft: '8px',
              }}
            >
              Weekly Snapshot
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                fontSize: '14px',
                color: '#64748b',
                cursor: 'pointer',
              }}
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              ↻
            </span>
            <span style={{ fontSize: '10px', color: '#64748b' }}>
              {snapshotExpanded ? '▲' : '▼'}
            </span>
          </div>
        </div>

        {/* Summary (always visible) */}
        <div style={{ padding: '0 16px 12px 16px' }}>
          <div style={{ display: 'flex', gap: '16px' }}>
            {/* Health Score */}
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline' }}>
                <span
                  style={{
                    fontSize: '18px',
                    fontWeight: '700',
                    color: '#10b981',
                  }}
                >
                  7.2
                </span>
                <span style={{ fontSize: '12px', color: '#64748b' }}>/10</span>
              </div>
              <p style={{ fontSize: '10px', color: '#64748b' }}>
                Portfolio Health
              </p>
            </div>

            {/* Risk */}
            <div>
              <span
                style={{
                  fontSize: '14px',
                  fontWeight: '700',
                  color: '#10b981',
                }}
              >
                LOW
              </span>
              <p style={{ fontSize: '10px', color: '#64748b' }}>
                Risk Level
              </p>
            </div>

            {/* Opportunities */}
            <div>
              <span
                style={{
                  fontSize: '18px',
                  fontWeight: '700',
                  color: '#22d3ee',
                }}
              >
                2
              </span>
              <p style={{ fontSize: '10px', color: '#64748b' }}>
                Opportunities
              </p>
            </div>
          </div>
        </div>

        {/* Expanded */}
        {snapshotExpanded && (
          <div
            style={{
              padding: '0 16px 12px 16px',
              borderTop: '1px solid rgba(42,52,72,0.6)',
            }}
          >
            {/* Opportunities */}
            <div style={{ marginTop: '12px' }}>
              <p style={{
                fontSize: '11px', color: '#22d3ee',
                fontWeight: '700', letterSpacing: '0.05em',
                marginBottom: '8px',
              }}>
                📈 OPPORTUNITIES
              </p>
              {[
                {
                  text: earnings[0]
                    ? `${earnings[0].symbol} earnings in ${earnings[0].daysUntil} days — prepare position`
                    : 'NVDA showing oversold signals — consider adding',
                  msg: earnings[0]
                    ? `Help me prepare for ${earnings[0].symbol} earnings`
                    : 'Analyze NVDA — is it showing oversold signals?',
                },
                {
                  text: 'GOOGL trading below 52-week average — value entry',
                  msg: 'Analyze GOOGL — is it a value entry at current price?',
                },
              ].map((item, i) => (
                <div
                  key={i}
                  onClick={(e) => sendToChat(item.msg, e)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: 'pointer',
                    background: 'rgba(34,211,238,0.06)',
                    border: '1px solid rgba(34,211,238,0.12)',
                    borderRadius: '6px',
                    padding: '8px 10px',
                    marginBottom: '6px',
                  }}
                >
                  <span style={{ fontSize: '13px', color: '#94a3b8', lineHeight: '1.4' }}>→ {item.text}</span>
                  <span style={{ fontSize: '14px', color: '#22d3ee', marginLeft: '8px', flexShrink: 0 }}>›</span>
                </div>
              ))}
            </div>

            {/* Risks */}
            <div style={{ marginTop: '12px' }}>
              <p style={{
                fontSize: '11px', color: '#f59e0b',
                fontWeight: '700', letterSpacing: '0.05em',
                marginBottom: '8px',
              }}>
                ⚠️ RISKS
              </p>
              {[
                {
                  text: 'Tech concentration at 68% — above 50% threshold',
                  msg: 'How should I reduce my tech concentration?',
                },
                {
                  text: 'NFLX position down 91% — review sizing',
                  msg: "Should I cut my NFLX position? It's down 91%",
                },
              ].map((item, i) => (
                <div
                  key={i}
                  onClick={(e) => sendToChat(item.msg, e)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: 'pointer',
                    background: 'rgba(34,211,238,0.06)',
                    border: '1px solid rgba(34,211,238,0.12)',
                    borderRadius: '6px',
                    padding: '8px 10px',
                    marginBottom: '6px',
                  }}
                >
                  <span style={{ fontSize: '13px', color: '#94a3b8', lineHeight: '1.4' }}>→ {item.text}</span>
                  <span style={{ fontSize: '14px', color: '#22d3ee', marginLeft: '8px', flexShrink: 0 }}>›</span>
                </div>
              ))}
            </div>

            {/* Recommendations */}
            <div style={{ marginTop: '12px' }}>
              <p style={{
                fontSize: '11px', color: '#10b981',
                fontWeight: '700', letterSpacing: '0.05em',
                marginBottom: '8px',
              }}>
                💡 RECOMMENDATIONS
              </p>
              {[
                {
                  text: 'Consider adding healthcare or financials for diversification',
                  msg: 'What healthcare or financial stocks should I add?',
                },
                {
                  text: 'Review NFLX position — down 91% from cost basis',
                  msg: 'Give me a full analysis of my NFLX position',
                },
              ].map((item, i) => (
                <div
                  key={i}
                  onClick={(e) => sendToChat(item.msg, e)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: 'pointer',
                    background: 'rgba(34,211,238,0.06)',
                    border: '1px solid rgba(34,211,238,0.12)',
                    borderRadius: '6px',
                    padding: '8px 10px',
                    marginBottom: '6px',
                  }}
                >
                  <span style={{ fontSize: '13px', color: '#94a3b8', lineHeight: '1.4' }}>→ {item.text}</span>
                  <span style={{ fontSize: '14px', color: '#22d3ee', marginLeft: '8px', flexShrink: 0 }}>›</span>
                </div>
              ))}
            </div>

            <p style={{
              fontSize: '10px', color: '#94a3b8',
              marginTop: '12px',
            }}>
              Generated Jun 9 · Refresh uses 1 deep analysis
            </p>
          </div>
        )}
      </div>

      {/* ─── 4. Divider ─── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          margin: '16px 16px 0 16px',
          gap: '8px',
        }}
      >
        <div style={{ flex: 1, height: '1px', background: '#1e2d45' }} />
        <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: '600' }}>Ask Vantage AI</span>
        <button
          onClick={() => setShowHistory(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            background: 'none',
            border: 'none',
            color: '#22d3ee',
            fontSize: '11px',
            opacity: 0.7,
            cursor: 'pointer',
            padding: '2px 4px',
          }}
        >
          <span style={{ fontSize: '14px' }}>🕐</span>
          History
        </button>
      </div>

      {/* ─── 5. Chat Messages Area ─── */}
      <div
        ref={chatAreaRef}
        id="chat-area"
        style={{
          minHeight: '200px',
          maxHeight: '300px',
          overflowY: 'auto',
          padding: '12px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        {/* Empty state — suggestion chips */}
        {messages.length === 0 && !loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {suggestionChips.map((suggestion) => (
              <div
                key={suggestion}
                onClick={(e) => {
                  // Flash effect
                  const el = e.currentTarget as HTMLElement;
                  el.style.transition = 'box-shadow 0s';
                  el.style.boxShadow = '0 0 0 2px #22d3ee';
                  setTimeout(() => {
                    el.style.transition = 'box-shadow 400ms ease-out';
                    el.style.boxShadow = '';
                  }, 100);
                  setToast('💬 Vantage AI is responding...');
                  sendMessage(suggestion);
                  setTimeout(() => {
                    document.getElementById('chat-input')?.scrollIntoView({
                      behavior: 'smooth',
                      block: 'end',
                    });
                  }, 150);
                }}
                style={{
                  background: '#1a2235',
                  border: '1px solid #2a3448',
                  borderRadius: '20px',
                  padding: '8px 14px',
                  fontSize: '12px',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  alignSelf: 'flex-start',
                }}
              >
                {suggestion}
              </div>
            ))}
          </div>
        )}

        {/* Messages */}
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              background:
                msg.role === 'user'
                  ? 'rgba(34,211,238,0.15)'
                  : '#1a2235',
              border:
                msg.role === 'user'
                  ? '1px solid rgba(34,211,238,0.2)'
                  : '1px solid #2a3448',
              borderRadius:
                msg.role === 'user'
                  ? '16px 16px 4px 16px'
                  : '16px 16px 16px 4px',
              padding: '10px 14px',
              maxWidth: msg.role === 'user' ? '80%' : '85%',
              fontSize: '14px',
              color: '#ffffff',
              lineHeight: '1.5',
            }}
          >
            {msg.role === 'ai' ? (
              <div>
                <ReactMarkdown
                  components={{
                    p: ({ children }) => (
                      <p style={{ margin: '0 0 8px 0', lineHeight: '1.6' }}>
                        {children}
                      </p>
                    ),
                    strong: ({ children }) => (
                      <strong style={{ color: '#ffffff', fontWeight: '700' }}>
                        {children}
                      </strong>
                    ),
                    ul: ({ children }) => (
                      <ul style={{
                        margin: '4px 0 8px 0',
                        paddingLeft: '16px',
                        listStyleType: 'disc'
                      }}>
                        {children}
                      </ul>
                    ),
                    li: ({ children }) => (
                      <li style={{ margin: '4px 0', lineHeight: '1.5' }}>
                        {children}
                      </li>
                    ),
                    h3: ({ children }) => (
                      <h3 style={{
                        fontSize: '13px',
                        fontWeight: '700',
                        color: '#22d3ee',
                        margin: '12px 0 6px 0',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em'
                      }}>
                        {children}
                      </h3>
                    ),
                    code: ({ children }) => (
                      <code style={{
                        background: '#0f1829',
                        borderRadius: '4px',
                        padding: '1px 6px',
                        fontSize: '12px',
                        color: '#22d3ee'
                      }}>
                        {children}
                      </code>
                    ),
                  }}
                >
                  {msg.content}
                </ReactMarkdown>
                {loading && i === messages.length - 1 && (
                  <span style={{
                    display: 'inline-block',
                    width: '2px',
                    height: '14px',
                    background: '#22d3ee',
                    marginLeft: '2px',
                    verticalAlign: 'middle',
                    animation: 'blink 1s step-end infinite'
                  }} />
                )}
              </div>
            ) : (
              <span style={{ lineHeight: '1.5', wordBreak: 'break-word' }}>
                {msg.content}
              </span>
            )}
          </div>
        ))}

        {/* Thinking indicator */}
        {loading && (
          <div
            style={{
              alignSelf: 'flex-start',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 0',
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              style={{ animation: 'spin 2s linear infinite' }}
            >
              <circle
                cx="9"
                cy="9"
                r="7"
                fill="none"
                stroke="#22d3ee"
                strokeWidth="2"
                strokeDasharray="33"
                strokeDashoffset="22"
                strokeLinecap="round"
              />
            </svg>
            <span style={{ fontSize: '13px', color: '#64748b' }}>
              Analyzing your portfolio —
            </span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ─── 6. Quick Actions 2×2 Grid ─── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '8px',
          padding: '0 16px',
          marginTop: '8px',
        }}
      >
        {[
          { icon: '⚡', label: 'Alerts', msg: 'Scan my portfolio for urgent alerts' },
          { icon: '📊', label: 'Snapshot', msg: 'snapshot-refresh' },
          { icon: '🔍', label: 'Screener', msg: 'screener' },
          { icon: '📋', label: 'Brief', msg: 'brief-refresh' },
        ].map((btn) => (
          <div
            key={btn.label}
            onClick={() => {
              if (btn.msg === 'screener') {
                sendMessage('Open the stock screener');
              } else if (btn.msg === 'snapshot-refresh') {
                sendMessage('Generate a new weekly portfolio snapshot');
              } else if (btn.msg === 'brief-refresh') {
                sendMessage('Refresh the daily brief for today');
              } else if (btn.label === 'Alerts') {
                sendMessage(btn.msg, 'alerts');
              } else {
                sendMessage(btn.msg);
              }
            }}
            style={{
              background: '#1a2235',
              border: '1px solid #2a3448',
              borderRadius: '10px',
              padding: '12px',
              textAlign: 'center',
              cursor: 'pointer',
              fontSize: '13px',
              color: '#ffffff',
              fontWeight: '500',
            }}
          >
            {btn.icon} {btn.label}
          </div>
        ))}
      </div>

      {/* ─── 7. Input Bar ─── */}
      <div
        id="chat-input"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '12px 16px',
          borderTop: '1px solid #1e2d45',
          marginTop: '8px',
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendMessage(input);
            }
          }}
          placeholder="Ask anything — markets, portfolio, strategy..."
          maxLength={500}
          style={{
            flex: 1,
            background: '#1a2235',
            border: '1px solid #2a3448',
            borderRadius: '20px',
            padding: '10px 16px',
            color: '#ffffff',
            fontSize: '14px',
            outline: 'none',
          }}
        />

        {input.length > 400 && (
          <p style={{
            fontSize: '10px',
            color: input.length >= 500 ? '#ef4444' : '#64748b',
            textAlign: 'right',
            marginTop: '4px',
          }}>
            {500 - input.length} characters remaining
          </p>
        )}

        {/* Send button */}
        <div
          onClick={() => sendMessage(input)}
          style={{
            width: '36px',
            height: '36px',
            background: input.trim() ? '#22d3ee' : '#1e2d45',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: input.trim() ? 'pointer' : 'default',
            flexShrink: 0,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M2 8h10M9 4l4 4-4 4"
              stroke="white"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        {/* Trash button */}
        <div
          onClick={() => {
            if (messages.length === 0) return;
            setShowClearConfirm(true);
          }}
          style={{
            width: '36px',
            height: '36px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: '#334155',
            flexShrink: 0,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M2 4h12M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1M6 7v5M10 7v5M3 4l1 9a1 1 0 001 1h6a1 1 0 001-1l1-9"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>

      {/* ─── 8. Footer ─── */}
      <p
        style={{
          textAlign: 'center',
          fontSize: '10px',
          color: '#94a3b8',
          padding: '4px 16px 16px 16px',
        }}
      >
        Powered by AI · Not financial advice · {supabaseRemaining} messages remaining today
      </p>

      {/* ─── Keyframes ─── */}
      <style jsx>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>

      {/* ─── Chat History Full-Screen Modal ─── */}
      {showHistory && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            zIndex: 99999,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
          }}
          onClick={() => setShowHistory(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#0a0f1e',
              borderTop: '1px solid #1e2d45',
              borderRadius: '20px 20px 0 0',
              height: 'calc(100vh - 40px)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Header */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '20px 20px 12px 20px',
                flexShrink: 0,
              }}
            >
              <p style={{ fontSize: '18px', fontWeight: '600', color: '#ffffff' }}>
                Chat History
              </p>
              <button
                onClick={() => setShowHistory(false)}
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: 'none',
                  borderRadius: '50%',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#94a3b8',
                  fontSize: '16px',
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>

            {/* Subtitle */}
            <p style={{
              fontSize: '11px',
              color: '#64748b',
              padding: '0 20px 8px 20px',
              flexShrink: 0,
            }}>
              Last 7 days · Tap to resume
            </p>

            {/* Session list */}
            <div style={{
              flex: 1,
              overflowY: 'auto',
              padding: '0 20px 16px 20px',
            }}>
              {(() => {
                const sessions = loadSessions();
                const groups = groupSessionsByDay(sessions);
                if (groups.length === 0) {
                  return (
                    <p style={{ fontSize: '13px', color: '#64748b', textAlign: 'center', padding: '32px 0' }}>
                      No previous conversations
                    </p>
                  );
                }
                return groups.map((group, gi) => (
                  <div key={gi} style={{ marginBottom: '16px' }}>
                    <p style={{
                      fontSize: '10px',
                      color: '#475569',
                      fontWeight: '600',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      marginBottom: '8px',
                    }}>
                      {group.label} · {group.sessions.length} conversation{group.sessions.length === 1 ? '' : 's'}
                    </p>
                    {group.sessions.map((session, si) => {
                      const firstMsg = session.messages[0]?.content || 'Empty chat';
                      const preview = firstMsg.length > 55 ? firstMsg.slice(0, 52) + '...' : firstMsg;
                      const time = new Date(session.timestamp).toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                      });
                      const isLast = si === group.sessions.length - 1 && gi === groups.length - 1;
                      return (
                        <div key={session.id}>
                          <div
                            onClick={() => {
                              const msgs = loadSessionMessages(session.id);
                              if (msgs) {
                                setMessages(msgs);
                                setCurrentSessionId(session.id);
                              }
                              setShowHistory(false);
                              setTimeout(() => {
                                document.getElementById('chat-input')?.scrollIntoView({ behavior: 'smooth', block: 'end' });
                              }, 200);
                            }}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              padding: '10px 0',
                              cursor: 'pointer',
                            }}
                          >
                            <span style={{
                              fontSize: '13px',
                              color: '#cbd5e1',
                              flex: 1,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              marginRight: '12px',
                            }}>
                              {preview}
                            </span>
                            <span style={{
                              fontSize: '11px',
                              color: '#64748b',
                              flexShrink: 0,
                            }}>
                              {time}
                            </span>
                          </div>
                          {!isLast && (
                            <div style={{ height: '1px', background: '#1e2d45', opacity: 0.5 }} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                ));
              })()}
            </div>

            {/* Start New Conversation button */}
            <div style={{
              padding: '12px 20px calc(20px + env(safe-area-inset-bottom)) 20px',
              borderTop: '1px solid #1e2d45',
              flexShrink: 0,
            }}>
              <button
                onClick={() => {
                  setShowHistory(false);
                  setMessages([]);
                  setCurrentSessionId(null);
                  setTimeout(() => {
                    document.getElementById('chat-input')?.scrollIntoView({ behavior: 'smooth', block: 'end' });
                  }, 200);
                }}
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: '1px solid rgba(34,211,238,0.4)',
                  borderRadius: '10px',
                  color: '#22d3ee',
                  fontSize: '14px',
                  fontWeight: '500',
                  padding: '12px 0',
                  cursor: 'pointer',
                }}
              >
                ＋ Start New Conversation
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Clear Confirm Modal ─── */}
      {showClearConfirm && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
        >
          <div
            style={{
              background: '#1a2235',
              border: '1px solid #2a3448',
              borderRadius: '16px',
              padding: '24px',
              width: '100%',
              maxWidth: '320px',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>🗑️</div>
            <p
              style={{
                fontSize: '16px',
                fontWeight: '700',
                color: '#ffffff',
                marginBottom: '8px',
              }}
            >
              Clear Conversation
            </p>
            <p
              style={{
                fontSize: '13px',
                color: '#64748b',
                marginBottom: '24px',
                lineHeight: '1.5',
              }}
            >
              This will remove all messages from your current session. This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={() => setShowClearConfirm(false)}
                style={{
                  flex: 1,
                  padding: '12px',
                  background: 'transparent',
                  border: '1px solid #374151',
                  borderRadius: '10px',
                  color: '#94a3b8',
                  fontSize: '14px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setMessages([]);
                  clearSupabaseMessages();
                  setShowClearConfirm(false);
                }}
                style={{
                  flex: 1,
                  padding: '12px',
                  background: '#ef4444',
                  border: 'none',
                  borderRadius: '10px',
                  color: '#ffffff',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
