'use client';
import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useBroker } from '@/components/providers/BrokerProvider';
import { buildPortfolioContext } from '@/lib/ai-context';
import { demoPositions } from '@/lib/demo-data';

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
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [marketHeadline, setMarketHeadline] = useState('');
  const [marketNewsUrl, setMarketNewsUrl] = useState('');
  const [portfolioSummary, setPortfolioSummary] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── portfolio context for AI ──
  const portfolioContext = buildPortfolioContext({
    totalValue: 118066,
    todayPnl: -1117,
    todayPnlPct: -0.9,
    totalPnl: -10207,
    totalPnlPct: -7.9,
    buyingPower: 145217,
    cash: 11617,
    investorStyle: 'Lynch Growth',
    riskTolerance: 'Moderate',
    positions: demoPositions.map(p => ({
      symbol: p.symbol,
      name: p.name,
      qty: p.qty,
      currentPrice: p.currentPrice,
      avgCost: p.avgCost,
      marketValue: p.marketValue,
      totalPnl: p.totalPnl,
      totalPnlPct: p.totalPnlPct,
      todayChange: p.todayChange,
      todayChangePct: p.todayChangePct,
      pctOfAccount: p.pctOfAccount,
      sector: p.sector,
    }))
  });

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

  // ── helpers ──
  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 50);
  };

  const sendMessage = async (content: string) => {
    if (!content.trim() || loading) return;

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
          mode: 'chat'
        })
      });

      if (!res.ok) throw new Error('API error');

      // Handle streaming
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let aiContent = '';

      // Add empty AI message to update in place
      setMessages(prev => [...prev, { role: 'ai', content: '' }]);

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.text) {
                aiContent += data.text;
                // Update last message in place
                setMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1] = {
                    role: 'ai',
                    content: aiContent
                  };
                  return updated;
                });
              }
            } catch (e) {
              // skip malformed chunks
            }
          }
        }
      }
    } catch (error) {
      console.error('Chat error:', error);
      setMessages(prev => [...prev, {
        role: 'ai',
        content: 'Sorry — I encountered an error. Please try again.'
      }]);
    } finally {
      setLoading(false);
      scrollToBottom();
    }
  };

  // ── send to chat from tappable rows ──
  const sendToChat = (message: string) => {
    sendMessage(message);
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
            <span>📡</span>
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
              onClick={() => {
                if (earnings[0]) {
                  sendToChat(`Tell me about ${earnings[0].symbol} upcoming earnings`);
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
              onClick={() => {
                sendToChat(`Tell me about ${earnings[1].symbol} upcoming earnings`);
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
                  onClick={() => sendToChat(item.msg)}
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
                  onClick={() => sendToChat(item.msg)}
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
                  onClick={() => sendToChat(item.msg)}
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
        <div style={{ flex: 1, height: '1px', background: '#1e2d45' }} />
      </div>

      {/* ─── 5. Chat Messages Area ─── */}
      <div
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
            {[
              earnings[0]
                ? `${earnings[0].symbol} earnings in ${earnings[0].daysUntil} day${earnings[0].daysUntil === 1 ? '' : 's'} — want analysis?`
                : 'NVDA — analyze my largest position?',
              portfolioSummary
                ? `${portfolioSummary.split(' ')[0]} is moving today — why?`
                : 'META — analyze my largest position?',
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
        Powered by AI · Not financial advice · 25 messages remaining today
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
