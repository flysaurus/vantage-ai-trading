'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useBroker } from '@/components/providers/BrokerProvider';
import { onAISessionStarted } from '@/lib/gamification/events';
import { apiPost } from '@/lib/api-client';
import { debugLog } from '@/lib/debug-log';
import { useAuth } from '@/components/providers/AuthProvider';
import { useLivePortfolio, buildLivePortfolioContext } from '@/context/PortfolioContext';
import { saveCurrentSession, getRecentSessions, loadSessionMessages, generateSessionId } from '@/lib/chat-history';
import { useChatStorage } from '@/hooks/useChatStorage';
import { saveChatMessage } from '@/lib/chat-service';
import CompassIcon from '@/components/CompassIcon';
import { useLearningMoment } from '@/hooks/useLearningMoment';
import { LearningMomentCard } from '@/components/learning/LearningMomentCard';
import DailyBriefCard from '@/components/ai/DailyBriefCard';
import WeeklySnapshotCard from '@/components/ai/WeeklySnapshotCard';

// ── Message counter (localStorage, per-day) — fast-initial fallback, server is authoritative ──
const getCountKey = () => {
  const today = new Date().toDateString();
  return `vantage_msg_count_${today}`;
};

function getMessageCount(): number {
  if (typeof window === 'undefined') return 0;
  return parseInt(localStorage.getItem(getCountKey()) || '0', 10);
}

function incrementMessageCount(): number {
  if (typeof window === 'undefined') return 0;
  const current = getMessageCount();
  const next = current + 1;
  localStorage.setItem(getCountKey(), String(next));
  return next;
}

function getLocalRemaining(): number {
  return Math.max(0, 75 - getMessageCount());
}

const DOLLAR_FMT: Intl.NumberFormatOptions = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
};

const fmt = (v: number) => {
  const prefix = v > 0 ? '+' : v < 0 ? '-' : '';
  return `${prefix}$${Math.abs(v).toLocaleString('en-US', DOLLAR_FMT)}`;
};

const pctStr = (v: number) => {
  const prefix = v > 0 ? '+' : v < 0 ? '-' : '';
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
  const { user } = useAuth();
  const userId = user?.id || null;
  const investorStyle = user?.investorStyle || 'Lynch';
  const chatGateCheckedRef = useRef(false);
  
  // ── Supabase chat storage (previous sessions + message count) ──
  const {
    previousSession,
    loadPreviousSession,
    dismissPreviousSession,
    refreshSessions,
  } = useChatStorage();

  // ── state ──
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastMessageTime, setLastMessageTime] = useState(0);
  const [greetingOpener, setGreetingOpener] = useState<string | null>(null);
  const [greetingHook, setGreetingHook] = useState<string | null>(null);
  const [greetingLoaded, setGreetingLoaded] = useState(false);
  const localName = typeof window !== 'undefined' ? user?.name || '' : null;
  const userInitial = ((user?.name || user?.email || localName || 'M')[0]?.toUpperCase() || 'M') + '.';
  const RATE_LIMIT_MS = 5000;
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [lastAIResponse, setLastAIResponse] = useState<string | null>(null);

  // ── Learning moment detection ────────────────────────
  const { learningCard, dismissLearning } =
    useLearningMoment(lastAIResponse, currentSessionId);

  // ── Claude-like scroll behavior refs ──
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const bottomAnchorRef = useRef<HTMLDivElement>(null);
  const isUserScrollingRef = useRef(false);
  const wasAtBottomRef = useRef(true);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const lastAiResponseRef = useRef<string>('');

  // ── Smooth streaming: character queue with drainer ──
  const charQueueRef = useRef<string[]>([]);
  const isDrainingRef = useRef(false);
  const displayedContentRef = useRef('');
  const streamDoneRef = useRef(false);

  const startDrainer = useCallback(() => {
    if (isDrainingRef.current) return;
    isDrainingRef.current = true;

    const drain = () => {
      if (charQueueRef.current.length === 0) {
        isDrainingRef.current = false;
        // If stream is done, mark message complete
        if (streamDoneRef.current) {
          streamDoneRef.current = false;
        }
        return;
      }

      // Take up to 3 chars at once for speed but still feel smooth
      const batch = charQueueRef.current.splice(0, 3).join('');
      displayedContentRef.current += batch;

      setMessages(prev => {
        const updated = [...prev];
        if (updated.length > 0 && updated[updated.length - 1].role === 'ai') {
          updated[updated.length - 1] = {
            role: 'ai' as const,
            content: displayedContentRef.current,
          };
        }
        return updated;
      });

      // 12ms per character effectively (36ms for 3 chars)
      setTimeout(drain, 12);
    };

    drain();
  }, [setMessages]);

  // ── portfolio context for AI (shared live-priced data from PortfolioProvider) ──
  const portfolioContext = buildLivePortfolioContext(liveAccount);

  // ── Remaining messages — server-authoritative with localStorage fallback ──
  const [localRemaining, setLocalRemaining] = useState(() => getLocalRemaining());
  const [serverLimit, setServerLimit] = useState(75);

  // Fetch server usage on mount — server is the source of truth
  const refreshRemaining = useCallback(async () => {
    try {
      const res = await fetch('/api/usage/remaining');
      if (res.ok) {
        const data = await res.json();
        setLocalRemaining(data.remaining);
        setServerLimit(data.limit || 75);
        return;
      }
    } catch { /* fall through to localStorage fallback */ }
    setLocalRemaining(getLocalRemaining());
  }, []);

  useEffect(() => {
    refreshRemaining();
  }, [refreshRemaining]);

  // (market news, portfolio summary, and earnings are now handled by DailyBriefCard)

  // ── persist chat to device-keyed localStorage whenever messages change ──
  useEffect(() => {
    if (messages.length > 0) {
      const formatted = messages.map(m => ({
        role: (m.role as string === 'assistant' ? 'ai' : 'user') as 'user' | 'ai',
        content: m.content,
      }));
      saveCurrentSession(currentSessionId || '', formatted);
    }
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Greeting cache key (per-day) ──
  const GREETING_CACHE_KEY = useCallback(() => {
    const today = new Date().toDateString();
    return `vantage_greeting_${today}`;
  }, []);

  // ── Static fallback greetings — shown instantly ──
  const STATIC_FALLBACKS: Record<string, { opener: string; hook: string }> = {
    premarket: { opener: 'Pre-market, M.', hook: 'Markets open soon — your portfolio is ready.' },
    open_morning: { opener: 'Morning, M.', hook: 'Your portfolio is live and ready to review.' },
    open_afternoon: { opener: 'Afternoon, M.', hook: 'Markets are moving — ask me anything.' },
    afterhours: { opener: 'After hours, M.', hook: 'Markets closed — good time to plan ahead.' },
    evening: { opener: 'Evening, M.', hook: 'A quiet moment to think through your positions.' },
  };

  function getMarketPeriod(): keyof typeof STATIC_FALLBACKS {
    const now = new Date();
    const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hour = et.getHours();
    const min = et.getMinutes();
    const day = et.getDay();
    const timeInMin = hour * 60 + min;
    const isWeekend = day === 0 || day === 6;

    if (isWeekend || timeInMin < 240 || timeInMin >= 1200) return 'evening';
    if (timeInMin < 570) return 'premarket';
    if (timeInMin < 720) return 'open_morning';
    if (timeInMin < 960) return 'open_afternoon';
    if (timeInMin < 1200) return 'afterhours';
    return 'evening';
  }

  function cleanOldGreetingCache() {
    const today = new Date().toDateString();
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith('vantage_greeting_') && key !== `vantage_greeting_${today}`) {
        localStorage.removeItem(key);
      }
    });
  }

  // ── Greeting fetch ref — prevent re-fetch on tab switch ──
  const greetingFetchedRef = useRef(false);

  // ── Track portfolio for greeting cache invalidation on trades ──
  const prevPositionsHashRef = useRef('');

  useEffect(() => {
    const hash = JSON.stringify({
      cash: liveAccount?.cash,
      count: liveAccount?.positions?.length,
      symbols: liveAccount?.positions?.map(p => p.symbol).sort().join(','),
    });
    if (prevPositionsHashRef.current && hash !== prevPositionsHashRef.current && prevPositionsHashRef.current !== '') {
      // Portfolio changed (trade executed) — invalidate greeting cache
      const cacheKey = GREETING_CACHE_KEY();
      localStorage.removeItem(cacheKey);
      greetingFetchedRef.current = false;
      setGreetingLoaded(false);
    }
    prevPositionsHashRef.current = hash;
  }, [liveAccount?.cash, liveAccount?.positions]);

  // Clean old cache keys on mount
  useEffect(() => {
    cleanOldGreetingCache();
  }, []);

  // ── AI greeting on fresh session (cache-first) ──
  useEffect(() => {
    if (messages.length > 0) return;
    if (greetingFetchedRef.current) return;
    greetingFetchedRef.current = true;

    loadGreeting();

    async function loadGreeting() {
      // Step 1: Show static fallback immediately
      const period = getMarketPeriod();
      const fallback = STATIC_FALLBACKS[period];
      setGreetingOpener(fallback.opener);
      setGreetingHook(fallback.hook);
      setGreetingLoaded(true);

      const cacheKey = GREETING_CACHE_KEY();

      // Step 2: Check today's cache
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const { opener, hook } = JSON.parse(cached);
          // Smooth swap from fallback to cached
          setTimeout(() => {
            setGreetingOpener(opener);
            setGreetingHook(hook);
          }, 200);
          return; // No API call needed
        }
      } catch {
        localStorage.removeItem(cacheKey);
      }

      // Step 3: Generate fresh (no cache found)
      try {
        const invStyle = (user?.investorStyle || investorStyle || 'Lynch') as string;
        const risk = (user?.riskTolerance || 'Moderate') as string;
        const positions = liveAccount?.positions || [];
        const equity = liveAccount?.equity ?? 0;
        const cash = liveAccount?.cash ?? 0;
        const totalInvested = positions.reduce((sum: number, p: any) => sum + (p.costBasis || 0) * (p.qty || 0), 0);
        const totalPnlPct = liveAccount?.totalPnlPercent ?? 0;
        const cashPct = equity + cash > 0 ? (cash / (equity + cash)) * 100 : 0;
        const symbols = positions.map((p: any) => p.symbol);

        let upcomingEarnings: any[] = [];
        try {
          if (symbols.length > 0) {
            const earnRes = await fetch(`/api/finnhub/earnings-calendar?symbols=${symbols.join(',')}`);
            if (earnRes.ok) upcomingEarnings = await earnRes.json();
          }
        } catch (_) { /* earnings fetch is optional */ }

        const res = await apiPost('/api/ai/greeting', {
          userInitial,
          investorStyle: invStyle,
          riskTolerance: risk,
          totalPnLPct: totalPnlPct,
          cashBalance: cash,
          cashPct,
          positions: positions.map((p: any) => ({
            symbol: p.symbol,
            totalPnLPct: p.totalPnlPercent || 0,
            totalPnL: p.totalPnl || 0,
            marketValue: p.marketValue || 0,
          })),
          upcomingEarnings: upcomingEarnings || [],
        });

        if (!res.ok) throw new Error('API failed');

        const data = await res.json();

        if (data.opener && data.hook) {
          // Cache for today
          localStorage.setItem(cacheKey, JSON.stringify({
            opener: data.opener,
            hook: data.hook,
            generatedAt: Date.now(),
          }));

          // Smooth swap from fallback to personalized
          setTimeout(() => {
            setGreetingOpener(data.opener);
            setGreetingHook(data.hook);
          }, 200);
        }
      } catch (e) {
        // Static fallback stays — no crash
        console.log('[Greeting] Using fallback:', e);
      }
    }
  }, [greetingLoaded]); // re-run when cache invalidated (e.g. after trade)

  // ── Invalidate greeting cache when portfolio changes (e.g., after buy/sell) ──
  const prevPositionsHashRef = useRef('');
  useEffect(() => {
    const hash = JSON.stringify({
      cash: liveAccount?.cash,
      count: liveAccount?.positions?.length,
      symbols: liveAccount?.positions?.map(p => p.symbol).sort().join(','),
    });
    if (prevPositionsHashRef.current && hash !== prevPositionsHashRef.current && prevPositionsHashRef.current !== '') {
      // Portfolio changed — invalidate greeting cache for today
      const cacheKey = GREETING_CACHE_KEY();
      localStorage.removeItem(cacheKey);
      greetingFetchedRef.current = false;
      setGreetingLoaded(false);
    }
    prevPositionsHashRef.current = hash;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveAccount?.cash, liveAccount?.positions]);

  // ── helpers ──
  function isAtBottom(): boolean {
    const container = messagesContainerRef.current;
    if (!container) return true;
    const threshold = 80;
    return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
  }

  function scrollToBottom(smooth = true) {
    const container = messagesContainerRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: smooth ? 'smooth' : 'instant' as ScrollBehavior });
  }

  // ── Track user scroll intent ──
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    let scrollTimeout: NodeJS.Timeout;
    const handleScroll = () => {
      isUserScrollingRef.current = true;
      wasAtBottomRef.current = isAtBottom();
      setShowScrollButton(!isAtBottom());
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => { isUserScrollingRef.current = false; }, 150);
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => { container.removeEventListener('scroll', handleScroll); clearTimeout(scrollTimeout); };
  }, []);

  // ── Auto-scroll when messages change ──
  const prevMessageCountRef = useRef(0);
  useEffect(() => {
    if (messages.length === 0) return;
    if (messages.length === 1) { scrollToBottom(false); prevMessageCountRef.current = 1; return; }
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role === 'user') {
      scrollToBottom(true);
      wasAtBottomRef.current = true;
    } else if (lastMsg.role === 'ai') {
      if (wasAtBottomRef.current) scrollToBottom(true);
    }
    prevMessageCountRef.current = messages.length;
  }, [messages.length]);

  // ── Scroll during streaming — only if at bottom ──
  useEffect(() => {
    if (!loading) return;
    if (wasAtBottomRef.current && !isUserScrollingRef.current) {
      scrollToBottom(false);
    }
  }, [messages, loading]);

  const sendMessage = async (content: string, mode: 'chat' | 'alerts' = 'chat') => {
    if (!content.trim() || loading) return;

    // (email gate removed — auth-only app)

    // Message limit check — server-authoritative
    if (localRemaining <= 0) {
      setMessages(prev => [...prev, {
        role: 'ai',
        content: `📊 You've used all ${serverLimit} messages today. Your daily limit resets at midnight UTC.\n\nWant unlimited messages? Check the **Upgrade** tab in Settings — paid plans get 500+ messages/day with priority AI access.`
      }]);
      return;
    }

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

    // Fire gamification on first AI message
    if (messages.length === 0) {
      const anonId = user?.id || 'unknown';
      onAISessionStarted(anonId).catch(() => {});
    }

    const userMessage = { role: 'user' as const, content };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const res = await apiPost('/api/chat', {
        messages: newMessages,
        portfolioContext,
        mode,
        investorStyle: investorStyle,
        riskTolerance: user?.riskTolerance || 'Moderate',
        name: user?.name || (typeof window !== 'undefined' ? user?.name || '' : null) || 'M',
      });

      if (!res.ok) throw new Error('API error');

      // ── Queue-based smooth streaming (like Claude) ──
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      // Reset queue state
      charQueueRef.current = [];
      displayedContentRef.current = '';
      streamDoneRef.current = false;

      // Add empty AI message to update in place
      setMessages(prev => [...prev, { role: 'ai', content: '' }]);

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        // Dismiss toast when first chunk arrives
        setToast(null);

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.text) {
                // Push each character to queue
                charQueueRef.current.push(...data.text.split(''));
                lastAiResponseRef.current = displayedContentRef.current + charQueueRef.current.join('');
                startDrainer();
                scrollToBottom();
              }
            } catch (e) {
              // skip malformed chunks
            }
          }
        }
      }

      // Stream complete — let drainer finish naturally (no flush dump)
      streamDoneRef.current = true;

      // Wait for drainer to finish
      while (isDrainingRef.current || charQueueRef.current.length > 0) {
        await new Promise(r => setTimeout(r, 50));
      }

      // One final render with complete content (safety backstop)
      const finalContent = displayedContentRef.current;
      setMessages(prev => {
        const updated = [...prev];
        if (updated.length > 0 && updated[updated.length - 1].role === 'ai') {
          updated[updated.length - 1] = {
            role: 'ai' as const,
            content: finalContent,
          };
        }
        return updated;
      });
      scrollToBottom();
    } catch (error) {
      console.error('Chat error:', error);
      setMessages(prev => [...prev, {
        role: 'ai',
        content: 'Sorry — I encountered an error. Please try again.'
      }]);
    } finally {
      setLoading(false);
      // Increment message counter (localStorage)
      incrementMessageCount();
      refreshRemaining();
      // Persist user message + AI response to Supabase (non-blocking)
      if (userId) {
        saveChatMessage(userId, 'user', content).catch(() => {});
        if (lastAiResponseRef.current) {
          saveChatMessage(userId, 'assistant', lastAiResponseRef.current).catch(() => {});
          // Trigger learning moment detection
          setLastAIResponse(lastAiResponseRef.current);
          lastAiResponseRef.current = '';
        }
      } else if (lastAiResponseRef.current) {
        setLastAIResponse(lastAiResponseRef.current);
        lastAiResponseRef.current = '';
      }
      scrollToBottom();
    }
  };

  // ── send to chat from tappable items (flash + toast + scroll to input) ──
  // ── Market Pulse: fetch live quotes before sending ──
  const handleMarketPulse = async (e: React.MouseEvent) => {
    // Flash effect
    const el = e.currentTarget as HTMLElement;
    el.style.transition = 'box-shadow 0s';
    el.style.boxShadow = '0 0 0 2px #22d3ee';
    setTimeout(() => {
      el.style.transition = 'box-shadow 400ms ease-out';
      el.style.boxShadow = '';
    }, 100);

    setToast('💬 Vantage AI is responding...');

    const symbols = ['SPY', 'QQQ', 'DIA', 'IWM', 'VIX'];
    const quotes: Record<string, { c: number; d: number; dp: number }> = {};

    try {
      await Promise.all(
        symbols.map(async (sym) => {
          try {
            const res = await fetch(`/api/finnhub/quote?symbol=${sym}`);
            const data = await res.json();
            quotes[sym] = { c: data.c || 0, d: data.d || 0, dp: data.dp || 0 };
          } catch {
            quotes[sym] = { c: 0, d: 0, dp: 0 };
          }
        })
      );
    } catch {
      // proceed with whatever we have
    }

    const fmtChg = (d: number) => (d > 0 ? `+${d.toFixed(2)}` : d.toFixed(2));
    const fmtPct = (dp: number) => (dp > 0 ? `+${dp.toFixed(2)}` : dp.toFixed(2));

    const marketData = `LIVE MARKET DATA (real-time from Finnhub):
S&P 500 ETF (SPY): $${quotes.SPY?.c?.toFixed(2) || 'N/A'} ${fmtChg(quotes.SPY?.d || 0)} (${fmtPct(quotes.SPY?.dp || 0)}%)
Nasdaq ETF (QQQ): $${quotes.QQQ?.c?.toFixed(2) || 'N/A'} ${fmtChg(quotes.QQQ?.d || 0)} (${fmtPct(quotes.QQQ?.dp || 0)}%)
Dow ETF (DIA): $${quotes.DIA?.c?.toFixed(2) || 'N/A'} ${fmtChg(quotes.DIA?.d || 0)} (${fmtPct(quotes.DIA?.dp || 0)}%)
Russell 2000 (IWM): $${quotes.IWM?.c?.toFixed(2) || 'N/A'} ${fmtChg(quotes.IWM?.d || 0)} (${fmtPct(quotes.IWM?.dp || 0)}%)
VIX: $${quotes.VIX?.c?.toFixed(2) || 'N/A'} ${fmtChg(quotes.VIX?.d || 0)} (${fmtPct(quotes.VIX?.dp || 0)}%)

Note: For sector performance, use the ETF moves above as proxies and your knowledge of sector correlations. QQQ weakness = tech pressure. IWM weakness = small cap risk-off. DIA vs QQQ spread = value vs growth rotation.

Use this data to answer the following — do NOT search the web for prices, these are the real current numbers:

Give me a market pulse check — how are the major indexes performing today, what sectors are leading and lagging, and what should I know as an investor right now?`;

    sendMessage(marketData);
    wasAtBottomRef.current = true;
    scrollToBottom(true);
  };

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
    setToast('💬 Vantage AI is responding...');
    wasAtBottomRef.current = true;
    scrollToBottom(true);
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

    const isDown = dayPnl < 0;
    const direction = isDown ? 'down' : 'up';
    const absAmount = Math.abs(dayPnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const absPct = Math.abs(dayPnlPct).toFixed(1);
    chips.push(`Your portfolio is ${direction} $${absAmount} (${absPct}%) today — why?`);
    return chips;
  })();

  // ── styles ──
  const cardBox: React.CSSProperties = {
    background: '#1a2235',
    border: '1px solid #2a3448',
    borderRadius: '10px',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, background: 'transparent' }}>
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
          <span style={{ fontSize: '12px', color: '#cbd5e1' }}>
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
                  wasAtBottomRef.current = true;
                  scrollToBottom(false);
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

      {/* ─── 2. Daily Brief Card (AI-powered) ─── */}
      <DailyBriefCard />

      {/* ─── 3. Weekly Snapshot (AI-powered) ─── */}
      <WeeklySnapshotCard />

      {/* ─── 4. Ask Vantage AI Header ─── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          margin: '16px 16px 0 16px',
          gap: '8px',
        }}
      >
        <span style={{ fontSize: '12px', color: '#cbd5e1', fontWeight: '600' }}>Ask Vantage AI</span>
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
        ref={messagesContainerRef}
        id="chat-area"
        data-testid="chat-area"
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '16px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          background: '#0d1526',
          borderTop: '2px solid rgba(34,211,238,0.4)',
          borderRadius: '16px',
          marginTop: '12px',
          minHeight: '180px',
          WebkitOverflowScrolling: 'touch',
          position: 'relative',
        }}
      >
        {/* AI Greeting on fresh session — loading dots */}
        {messages.length === 0 && !loading && !greetingLoaded && (
          <div
            style={{
              alignSelf: 'flex-start',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 14px',
              background: '#1a2235',
              border: '1px solid #2a3448',
              borderRadius: '16px 16px 16px 4px',
            }}
          >
            <CompassIcon size={18} color="#22d3ee" />
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              <span style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: '#22d3ee',
                animation: 'vantagePulse 1.2s ease-in-out infinite',
                animationDelay: '0s',
              }} />
              <span style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: '#22d3ee',
                animation: 'vantagePulse 1.2s ease-in-out infinite',
                animationDelay: '0.2s',
              }} />
              <span style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: '#22d3ee',
                animation: 'vantagePulse 1.2s ease-in-out infinite',
                animationDelay: '0.4s',
              }} />
            </div>
          </div>
        )}

        {/* AI Greeting — two-line layout with styled initial */}
        {greetingLoaded && (
          <div style={{
            background: 'linear-gradient(135deg, ' +
              'rgba(34,211,238,0.06) 0%, ' +
              'rgba(26,34,53,0.98) 100%)',
            border: '1px solid rgba(34,211,238,0.18)',
            borderRadius: '16px',
            padding: '16px 18px',
            marginBottom: '16px',
            transition: 'opacity 0.3s ease',
          }}>

            {/* Tiny header row */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              marginBottom: '10px',
            }}>
              <span style={{ fontSize: '13px' }}>🧭</span>
              <span style={{
                color: 'rgba(34,211,238,0.6)',
                fontSize: '10px',
                fontWeight: '600',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
              }}>
                Vantage AI
              </span>
            </div>

            {/* Line 1 — opener with styled initial */}
            <div style={{
              fontSize: '20px',
              fontWeight: '700',
              letterSpacing: '-0.01em',
              lineHeight: 1.2,
              marginBottom: '8px',
            }}>
              {greetingOpener && greetingOpener.split(new RegExp(`\\b(${userInitial.replace('.', '\\.')})\\b`)).map((part, i) =>
                part === userInitial ? (
                  <span key={i} style={{ color: '#22d3ee' }}>{userInitial}</span>
                ) : (
                  <span key={i} style={{ color: '#ffffff' }}>{part}</span>
                )
              )}
            </div>

            {/* Line 2 — hook */}
            {greetingHook && (
              <div style={{
                fontSize: '14px',
                fontWeight: '400',
                color: '#cbd5e1',
                lineHeight: '1.6',
              }}>
                {greetingHook}
              </div>
            )}
          </div>
        )}

        {/* Empty state — suggestion chips */}
        {messages.length === 0 && greetingLoaded && !loading && (
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
                  wasAtBottomRef.current = true;
                  scrollToBottom(true);
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
                  remarkPlugins={[remarkGfm]}
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
                    h2: ({ children }) => (
                      <h2 style={{
                        fontSize: '14px',
                        fontWeight: '700',
                        color: '#ffffff',
                        margin: '12px 0 8px 0',
                      }}>
                        {children}
                      </h2>
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
                    table: ({ children }) => (
                      <div style={{
                        overflowX: 'auto',
                        marginTop: '8px',
                        marginBottom: '8px',
                        borderRadius: '8px',
                        border: '1px solid rgba(255,255,255,0.1)',
                      }}>
                        <table style={{
                          width: '100%',
                          borderCollapse: 'collapse',
                          fontSize: '12px',
                        }}>
                          {children}
                        </table>
                      </div>
                    ),
                    thead: ({ children }) => (
                      <thead style={{
                        background: 'rgba(34,211,238,0.1)',
                      }}>
                        {children}
                      </thead>
                    ),
                    tbody: ({ children }) => (
                      <tbody>{children}</tbody>
                    ),
                    th: ({ children }) => (
                      <th style={{
                        padding: '8px 12px',
                        textAlign: 'left',
                        color: '#22d3ee',
                        fontWeight: '600',
                        fontSize: '11px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        borderBottom: '1px solid rgba(255,255,255,0.1)',
                        whiteSpace: 'nowrap',
                      }}>
                        {children}
                      </th>
                    ),
                    td: ({ children }) => (
                      <td style={{
                        padding: '8px 12px',
                        borderBottom: '1px solid rgba(255,255,255,0.06)',
                        color: '#e2e8f0',
                        verticalAlign: 'top',
                      }}>
                        {children}
                      </td>
                    ),
                    tr: ({ children }) => (
                      <tr style={{
                        transition: 'background 0.1s',
                      }}>
                        {children}
                      </tr>
                    ),
                    hr: () => (
                      <hr style={{
                        border: 'none',
                        borderTop: '1px solid rgba(255,255,255,0.1)',
                        margin: '12px 0',
                      }} />
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
            <span style={{ fontSize: '13px', color: '#cbd5e1' }}>
              Analyzing your portfolio —
            </span>
          </div>
        )}

        <div ref={bottomAnchorRef} style={{ height: '1px' }} />

        {/* Scroll-to-bottom button */}
        {showScrollButton && (
          <button
            onClick={() => {
              scrollToBottom(true);
              wasAtBottomRef.current = true;
              setShowScrollButton(false);
            }}
            style={{
              position: 'absolute',
              bottom: '16px',
              right: '16px',
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              background: 'rgba(26,34,53,0.95)',
              border: '1px solid rgba(34,211,238,0.3)',
              color: '#22d3ee',
              fontSize: '16px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10,
              boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
            }}
          >
            ↓
          </button>
        )}
      </div>

      {/* ─── 6. Pinned Bottom Section ─── */}
      <div style={{ flexShrink: 0, borderTop: '1px solid #1e2d45', paddingBottom: 'calc(80px + env(safe-area-inset-bottom))' }}>
        {/* Upsell banner — shown at 2 remaining */}
        {localRemaining === 2 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              margin: '0 16px 4px 16px',
              padding: '8px 12px',
              background: 'linear-gradient(135deg, rgba(245,158,11,0.15), rgba(245,158,11,0.05))',
              border: '1px solid rgba(245,158,11,0.25)',
              borderRadius: '10px',
              fontSize: '12px',
              color: '#f59e0b',
            }}
          >
            <span>⚡ 2 AI analyses remaining — <span style={{ color: '#ffffff', fontWeight: '600' }}>upgrade for 50+</span></span>
            <span
              onClick={() => refreshRemaining()}
              style={{
                cursor: 'pointer',
                color: '#94a3b8',
                fontSize: '16px',
                lineHeight: '1',
                padding: '2px 4px',
              }}
              title="Dismiss"
            >
              ×
            </span>
          </div>
        )}

        {/* Quick Actions 2×2 Grid */}
        <div
          data-testid="quick-actions"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '8px',
            padding: '0 12px',
            marginBottom: '8px',
          }}
        >
          {[
            {
              icon: '💡',
              label: 'Strategy Ideas',
              onClick: () => {
                const msg = 'Based on my current portfolio and market conditions, what investment strategies should I consider right now? Give me 2-3 specific actionable ideas tailored to my holdings and risk profile.';
                sendMessage(msg);
                setToast('💬 Vantage AI is responding...');
                wasAtBottomRef.current = true;
                scrollToBottom(true);
              },
            },
            {
              icon: '📡',
              label: 'Market Pulse',
              onClick: (e: React.MouseEvent) => handleMarketPulse(e),
            },
            {
              icon: '📋',
              label: 'Tax Check',
              onClick: (e: React.MouseEvent) => sendToChat(
                'Run a tax check on my portfolio — identify any positions with unrealized losses I could harvest, flag wash sale risks, and give me any year-end tax optimization moves to consider.',
                e
              ),
            },
            {
              icon: '⚡',
              label: 'Alerts',
              onClick: () => {
                setToast('💬 Vantage AI is responding...');
                sendMessage('Scan my portfolio for urgent alerts', 'alerts');
                wasAtBottomRef.current = true;
                scrollToBottom(true);
              },
            },
          ].map((action) => (
            <button
              key={action.label}
              onClick={action.onClick}
              style={{
                background: '#1a2235',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '12px',
                padding: '14px 12px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                textAlign: 'left',
              }}
            >
              <span style={{ fontSize: '18px' }}>{action.icon}</span>
              <span style={{ color: '#ffffff', fontSize: '13px', fontWeight: '500' }}>{action.label}</span>
            </button>
          ))}
        </div>

        {/* Message count + remaining */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '0 16px',
          margin: '0 0 2px 0',
        }}>
          <span style={{
            fontSize: '10px',
            color: localRemaining <= 5 ? '#f59e0b' : '#64748b',
          }}>
            {localRemaining} message{localRemaining !== 1 ? 's' : ''} remaining today
          </span>
          {localRemaining <= 5 && (
            <span style={{ fontSize: '10px', color: '#cbd5e1' }}>
              Free tier · Resets midnight UTC
            </span>
          )}
        </div>

        {/* Character count warning */}
        {input.length > 400 && (
          <p style={{
            fontSize: '10px',
            color: input.length >= 500 ? '#ef4444' : '#64748b',
            textAlign: 'right',
            padding: '0 16px',
            margin: '0 0 2px 0',
          }}>
            {500 - input.length} characters remaining
          </p>
        )}

        {/* Input Bar — elevated pill */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 16px 12px 16px',
            opacity: localRemaining <= 0 && !loading ? 0.5 : 1,
            pointerEvents: localRemaining <= 0 && !loading ? 'none' : 'auto',
          }}
        >
          <input
            ref={inputRef}
            type="text"
            id="chat-input"
            data-testid="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (localRemaining > 0) sendMessage(input);
              }
            }}
            placeholder={localRemaining <= 0 ? 'Daily limit reached — resets tomorrow at midnight' : 'Ask anything — markets, portfolio, strategy...'}
            maxLength={500}
            disabled={localRemaining <= 0}
            style={{
              flex: 1,
              height: '52px',
              background: '#1a2235',
              border: localRemaining <= 0 ? '1.5px solid #2a3448' : '1.5px solid rgba(34,211,238,0.25)',
              borderRadius: '26px',
              padding: '0 18px',
              color: localRemaining <= 0 ? '#4b5563' : '#ffffff',
              fontSize: '14px',
              outline: 'none',
              transition: 'all 0.2s ease',
              boxSizing: 'border-box',
              cursor: localRemaining <= 0 ? 'not-allowed' : 'text',
            }}
            onFocus={(e) => {
              if (localRemaining <= 0) return;
              e.target.style.borderColor = 'rgba(34,211,238,0.6)';
              e.target.style.boxShadow = '0 0 0 3px rgba(34,211,238,0.15)';
            }}
            onBlur={(e) => {
              e.target.style.borderColor = localRemaining <= 0 ? '#2a3448' : 'rgba(34,211,238,0.25)';
              e.target.style.boxShadow = 'none';
            }}
          />

          {/* Send button — Vantage compass */}
          <div
            onClick={() => { if (localRemaining > 0) sendMessage(input); }}
            style={{
              width: '40px',
              height: '40px',
              minWidth: '40px',
              background: input.trim() ? '#22d3ee' : '#1e2d45',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: input.trim() ? 'pointer' : 'default',
              flexShrink: 0,
              padding: '6px',
              boxSizing: 'border-box',
              transition: 'background 0.2s ease',
            }}
          >
            <CompassIcon size={20} color={input.trim() ? '#0a0f1e' : '#64748b'} />
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
            <Trash2 size={16} />
          </div>
        </div>

        {/* Footer */}
        <p
          style={{
            textAlign: 'center',
            fontSize: '10px',
            color: '#cbd5e1',
            padding: '0 16px calc(12px + env(safe-area-inset-bottom)) 16px',
            margin: 0,
          }}
        >
          Powered by AI · Not financial advice ·{' '}
          <span style={{ color: localRemaining <= 5 ? '#f59e0b' : '#64748b' }}>
            {localRemaining} AI analyses available today
          </span>
        </p>
      </div>

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

      {/* ─── Chat History Full-Screen Modal (simplified — last 3 sessions) ─── */}
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
              maxHeight: 'calc(100dvh - env(safe-area-inset-top))',
              paddingBottom: 'calc(80px + env(safe-area-inset-bottom))',
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
            }}
          >
            {/* Header */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '20px 20px 8px 20px',
                flexShrink: 0,
              }}
            >
              <p style={{ fontSize: '18px', fontWeight: '600', color: '#ffffff' }}>
                Recent Conversations
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
              color: '#cbd5e1',
              padding: '0 20px 16px 20px',
              flexShrink: 0,
            }}>
              Last 7 days
            </p>

            {/* Session cards — max 3 */}
            <div style={{
              flex: 1,
              overflowY: 'auto',
              padding: '0 20px 16px 20px',
            }}>
              {(() => {
                const sessions = getRecentSessions(3);
                // Already sorted by updatedAt desc, limited to 3

                if (sessions.length === 0) {
                  return (
                    <p style={{ fontSize: '13px', color: '#cbd5e1', textAlign: 'center', padding: '32px 0' }}>
                      No recent conversations
                    </p>
                  );
                }

                return sessions.map((session, i) => {
                  // Find first AI response for preview
                  const aiMsg = session.messages.find(m => m.role === 'ai');
                  const preview = aiMsg
                    ? (aiMsg.content.length > 100 ? aiMsg.content.slice(0, 97) + '...' : aiMsg.content)
                    : (session.messages[0]?.content?.slice(0, 80) + '...' || 'Empty chat');
                  const firstUser = session.messages.find(m => m.role === 'user');
                  const displayPreview = firstUser
                    ? `"${firstUser.content.slice(0, 60)}${firstUser.content.length > 60 ? '...' : ''}"`
                    : preview;
                  const date = new Date(session.updatedAt);
                  const now = new Date();
                  const isToday = date.toDateString() === now.toDateString();
                  const yesterday = new Date(now);
                  yesterday.setDate(yesterday.getDate() - 1);
                  const isYesterday = date.toDateString() === yesterday.toDateString();
                  const dateLabel = isToday
                    ? `Today, ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
                    : isYesterday
                    ? `Yesterday, ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
                    : date.toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      });

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
                          wasAtBottomRef.current = true;
                          scrollToBottom(false);
                        }}
                        style={{
                          background: '#1a2235',
                          border: '1px solid rgba(255,255,255,0.08)',
                          borderRadius: '12px',
                          padding: '14px 16px',
                          marginBottom: i < sessions.length - 1 ? '10px' : '0',
                          cursor: 'pointer',
                          transition: 'border-color 0.15s',
                        }}
                        onMouseEnter={e => {
                          (e.currentTarget as HTMLElement).style.borderColor = 'rgba(34,211,238,0.3)';
                        }}
                        onMouseLeave={e => {
                          (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.08)';
                        }}
                      >
                        {/* Date label */}
                        <p style={{
                          fontSize: '11px',
                          color: '#cbd5e1',
                          fontWeight: '500',
                          margin: '0 0 6px 0',
                        }}>
                          {dateLabel}
                        </p>

                        {/* Preview (first user message) */}
                        <p style={{
                          fontSize: '13px',
                          color: '#cbd5e1',
                          lineHeight: '1.5',
                          margin: '0 0 8px 0',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                        }}>
                          {displayPreview}
                        </p>

                        {/* Message count */}
                        <p style={{
                          fontSize: '11px',
                          color: '#94a3b8',
                          margin: 0,
                        }}>
                          {session.messages.length} message{session.messages.length !== 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>

            {/* Start New Conversation button */}
            <div style={{
              padding: '12px 20px 20px 20px',
              borderTop: '1px solid #1e2d45',
              flexShrink: 0,
            }}>
              <button
                onClick={() => {
                  setShowHistory(false);
                  setMessages([]);
                  setCurrentSessionId(null);
                  wasAtBottomRef.current = true;
                  scrollToBottom(false);
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
                color: '#cbd5e1',
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

      {/* ── Learning Moment Card ─────────────────────── */}
      {learningCard && (
        <LearningMomentCard
          card={learningCard}
          onGotIt={() => dismissLearning(true)}
          onDismiss={() => dismissLearning(false)}
        />
      )}

    </div>
  );
}
