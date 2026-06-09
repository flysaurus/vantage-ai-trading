'use client';
import { useState, useRef, useEffect } from 'react';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useBroker } from '@/components/providers/BrokerProvider';

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
  return `${prefix}${(v * 100).toFixed(1)}%`;
};

interface Message {
  role: 'user' | 'ai';
  content: string;
}

export function AITab() {
  const { account } = usePortfolio();
  const { isConnected } = useBroker();

  // ── state ──
  const [dailyBriefExpanded, setDailyBriefExpanded] = useState(false);
  const [snapshotExpanded, setSnapshotExpanded] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [earnings, setEarnings] = useState<{
    symbol: string;
    date: string;
    daysUntil: number;
  }[]>([]);
  const [marketHeadline, setMarketHeadline] = useState('');
  const [portfolioSummary, setPortfolioSummary] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── fetch market news ──
  const fetchMarketNews = async () => {
    try {
      const res = await fetch('/api/finnhub/news?category=general');
      const data = await res.json();
      if (data && data.length > 0) {
        const headline = data[0].headline || '';
        setMarketHeadline(
          headline.length > 60
            ? headline.substring(0, 57) + '...'
            : headline
        );
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

  // ── helpers ──
  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 50);
  };

  const sendMessage = (text: string) => {
    if (!text.trim() || loading) return;
    setMessages((prev) => [...prev, { role: 'user', content: text.trim() }]);
    setInput('');
    setLoading(true);
    scrollToBottom();

    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          role: 'ai',
          content:
            "I'm analyzing your portfolio. Full AI advisor coming soon — your positions look interesting! Stay tuned for deeper analysis.",
        },
      ]);
      setLoading(false);
      scrollToBottom();
    }, 1500);
  };

  // ── derived data ──
  const equity = account?.equity ?? 0;
  const dayPnl = account?.dayPnl ?? 0;
  const dayPnlPct = account?.dayPnlPercent ?? 0;
  const totalPnl = account?.totalPnl ?? 0;
  const totalPnlPct = account?.totalPnlPercent ?? 0;

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
            TODAY -$1,117 (-0.9%) · TOTAL -$10,207 (-7.9%)
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
            <span style={{ fontSize: '14px' }}>📡</span>
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
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '6px' }}>
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
        </div>

        {/* Expanded */}
        {dailyBriefExpanded && (
          <div
            style={{
              padding: '0 16px 12px 16px',
              borderTop: '1px solid #2a3448',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '6px', marginTop: '12px' }}>
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
            {earnings.length > 1 && (
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
                earnings[0]
                  ? `${earnings[0].symbol} earnings in ${earnings[0].daysUntil} days — prepare position`
                  : 'NVDA showing oversold signals — consider adding',
                'GOOGL trading below 52-week average — value entry',
              ].map((item, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: '13px',
                    color: '#94a3b8',
                    paddingLeft: '8px',
                    borderLeft: '2px solid #22d3ee',
                    marginBottom: '6px',
                    lineHeight: '1.4',
                  }}
                >
                  → {item}
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
                'Tech concentration at 68% — above 50% threshold',
                'NFLX position down 91% — review sizing',
              ].map((item, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: '13px',
                    color: '#94a3b8',
                    paddingLeft: '8px',
                    borderLeft: '2px solid #f59e0b',
                    marginBottom: '6px',
                    lineHeight: '1.4',
                  }}
                >
                  → {item}
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
                'Consider adding healthcare or financials for diversification',
                'Review NFLX position — down 91% from cost basis',
              ].map((item, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: '13px',
                    color: '#94a3b8',
                    paddingLeft: '8px',
                    borderLeft: '2px solid #10b981',
                    marginBottom: '6px',
                    lineHeight: '1.4',
                  }}
                >
                  → {item}
                </div>
              ))}
            </div>

            <p style={{
              fontSize: '10px', color: '#334155',
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
        <span style={{ fontSize: '11px', color: '#334155' }}>Ask Vantage AI</span>
        <div style={{ flex: 1, height: '1px', background: '#1e2d45' }} />
      </div>

      {/* ─── 5. Chat Messages Area ─── */}
      <div
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
            {[
              'NVDA down 4.2% today — want analysis?',
              'META earnings in 3 days — prepare?',
              'Your portfolio is down 0.9% — why?',
            ].map((suggestion) => (
              <div
                key={suggestion}
                onClick={() => sendMessage(suggestion)}
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
            {msg.content}
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
          { icon: '🧺', label: 'Build Basket', msg: 'build-basket' },
          { icon: '📡', label: 'Market Pulse', msg: 'Give me a market pulse for today' },
          { icon: '📋', label: 'Tax Check', msg: 'Check my portfolio for tax loss harvesting opportunities' },
          { icon: '⚡', label: 'Alerts', msg: 'Scan my portfolio for urgent alerts' },
        ].map((btn) => (
          <div
            key={btn.label}
            onClick={() => {
              if (btn.msg === 'build-basket') {
                window.dispatchEvent(new CustomEvent('vantage-open-basket-modal'));
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
          placeholder="Ask about your portfolio..."
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
            if (window.confirm('Clear chat history?')) {
              setMessages([]);
            }
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
        Powered by AI · Not financial advice · 25 messages remaining today
      </p>

      {/* ─── Keyframes ─── */}
      <style jsx>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
