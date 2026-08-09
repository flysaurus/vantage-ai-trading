'use client';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useBroker } from '@/components/providers/BrokerProvider';
import { apiPost } from '@/lib/api-client';
import { debugLog } from '@/lib/debug-log';
import { useAuth } from '@/components/providers/AuthProvider';
import { useLivePortfolio, buildLivePortfolioContext } from '@/context/PortfolioContext';
import { saveCurrentSession, getRecentSessions } from '@/lib/chat-history';
import { fetchRecentSessions, clearUserMessages, type DBSession } from '@/lib/chat-history-db';
import { useChatStorage } from '@/hooks/useChatStorage';
import { saveChatMessage } from '@/lib/chat-service';
import { InlineTradeButtons, parseSuggestions, parseChoiceSuggestions, parseSummaryTLDR, stripRecommendationMarkers, markMarkerExecuted, isMarkerExecutedInStorage, type Suggestion, type ChoiceSuggestion } from '@/components/ai/InlineTradeButton';
import StrategyCards from '@/components/ai/StrategyCards';
import { parsePortfolioBlocks } from '@/lib/portfolio-blocks';
import type { PortfolioBlock } from '@/lib/portfolio-types';
import { parseClarifyMarkers, questionsToOptions, ClarifyingOptions, ClarifyStepper, type ClarifyingOption, type ClarifyingQuestion } from '@/components/ai/ClarifyingOptions';
import { SummaryCard } from '@/components/ai/SummaryCard';
import { ProgressIndicator, type ChecklistItem } from '@/components/ai/ProgressIndicator';
import TradeTicket from '@/components/portfolio/TradeTicket';
import CompassIcon from '@/components/CompassIcon';
import { useLearningMoment } from '@/hooks/useLearningMoment';
import { LearningMomentCard } from '@/components/learning/LearningMomentCard';
import { LearningLibrary } from '@/components/learning/LearningLibrary';
import { ChatHistory } from '@/components/ai/ChatHistory';


// ── Design tokens (vantage-ai-tab-redesign.html) ──
const GLASS_BG = 'rgba(255,255,255,0.05)';
const GLASS_BG_LIGHTER = 'rgba(255,255,255,0.035)';
const GLASS_BG_SUBTLE = 'rgba(255,255,255,0.03)';
const BORDER_ACCENT = 'rgba(34,211,238,0.25)';
const BORDER_SUBTLE = 'rgba(255,255,255,0.06)';
const BORDER_MUTED = 'rgba(255,255,255,0.07)';
const TEXT_BODY = 'rgba(255,255,255,0.85)';
const TEXT_SUBTLE = 'rgba(255,255,255,0.4)';
const TEXT_MUTED = 'rgba(255,255,255,0.35)';
const TEXT_DIM = 'rgba(255,255,255,0.25)';
const ACCENT = '#22d3ee';
const GAIN = '#10b981';
const WARNING = '#f59e0b';
const BACKDROP_BLUR = 'blur(20px)';

// ── TL;DR extraction: client-side heuristic, zero API cost ──
// Matches natural closing statements the AI already produces.
const TLDR_PATTERN = /(?:^|\n)(?:Bottom[ -]?[Ll]ine|TL;DR|In [Ss]ummary|Key [Tt]akeaway|The [Gg]ist)[:—\-]?\s*/m;

/** Check if a response is long enough to warrant a TL;DR toggle */
function qualifiesForTLDR(content: string): boolean {
  const paragraphs = content.split(/\n\n+/).filter(p => p.trim().length > 0);
  return content.length > 500 || paragraphs.length >= 3;
}

/** Extract the summary line from a response, or return null */
function extractTLDR(content: string): string | null {
  const match = content.match(TLDR_PATTERN);
  if (!match) return null;
  const startIdx = match.index! + match[0].length;
  // Take from match start to end of paragraph (next double newline or end of string)
  const rest = content.slice(startIdx);
  const endMatch = rest.match(/\n\n|$/);
  const endIdx = endMatch ? endMatch.index! : rest.length;
  return (match[0] + rest.slice(0, endIdx)).trim();
}

// ── Message counter (localStorage, per-day, UTC date = server-aligned) ──
const getCountKey = () => {
  const today = new Date().toISOString().split('T')[0];
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
  // Return a large safe value to effectively disable the local fallback.
  // The SERVER enforces real limits via ai-guard.ts checkUsageLimit().
  // Client-side pre-checks are a UX optimization, not a security boundary.
  // If the API is unreachable, let the request go through — the server will
  // return 429 if the limit is actually reached.
  return 999;
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
  id?: string;
}

interface AITabProps {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
}

// ── AI Noticed — fetched from Supabase via API ──
interface NoticedItem {
  id: string;
  triggerKey: string;
  triggerType: string;
  title: string;
  body: string;
  followUp: string;
  variant: 'accent' | 'warn' | 'gain';
  icon: string;
  meta: Record<string, any>;
  createdAt: string;
  dismissedUntil: string | null;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

// ── Rotating chat placeholder pool ──────────────────────────
const PLACEHOLDERS = [
  'Ask about your portfolio…',
  'What should my next move be?',
  'Curious about a stock? Ask away…',
  'Ask about any stock or the market…',
  'Looking for new opportunities? Ask Vantage…',
  "What's Vantage AI noticing today?",
  'Research any stock, sector, or strategy…',
  'Markets, stocks, or your portfolio — ask anything',
];

export function AITab({ messages, setMessages }: AITabProps) {
  const { account: liveAccount, executeTrade, brokerMeta } = useLivePortfolio();
  const { isConnected } = useBroker();
  const { user } = useAuth();
  const userId = user?.id ? String(user.id) : null;
  const investorStyle = user?.investorStyle || 'Lynch';
  
  // ── Supabase chat storage ──
  const {
    previousSession,
    loadPreviousSession,
    dismissPreviousSession,
    refreshSessions,
  } = useChatStorage();

  // ── state ──
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
  // Screening meta for strategy-card transparency (criteria, match count, provider)
  const [screeningMeta, setScreeningMeta] = useState<{
    criteria: Record<string, any>;
    criteriaDescription: string;
    matchCount: number;
    provider: string;
  } | null>(null);
  const [lastMessageTime, setLastMessageTime] = useState(0);
  // ── Greeting state — initialized from sessionStorage to prevent skeleton flash on remount ──
  const getCachedGreeting = (): { opener: string; hook: string } | null => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = sessionStorage.getItem('vantage_greet_cache');
      if (raw) {
        const data = JSON.parse(raw);
        if (Date.now() - data.at < 15 * 60 * 1000) return data;
      }
    } catch {}
    return null;
  };
  const cachedGreeting = getCachedGreeting();
  const [greetingOpener, setGreetingOpener] = useState<string | null>(cachedGreeting?.opener || null);
  const [greetingHook, setGreetingHook] = useState<string | null>(cachedGreeting?.hook || null);
  const [greetingLoaded, setGreetingLoaded] = useState(cachedGreeting !== null);
  const userName: string = String((user as any)?.name || (user as any)?.email || 
    (typeof window !== 'undefined' ? (user as any)?.name || '' : '') || 'M');
  const userInitial = (userName[0]?.toUpperCase() || 'M') + '.';
  const RATE_LIMIT_MS = 5000;
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [exploreCompact, setExploreCompact] = useState(false);
  const [exploreSeenCount, setExploreSeenCount] = useState(0);
  const [showMenu, setShowMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [budgetWarnings, setBudgetWarnings] = useState<any>(null); // budget gate violations
  const [showBudgetWarning, setShowBudgetWarning] = useState(false);

  // ── TL;DR toggle state (set of collapsed message indices) ──
  const [collapsedTLDRs, setCollapsedTLDRs] = useState<Set<number>>(new Set());

  // ── Sequential clarifying-question stepper ──
  // When an AI response contains multiple [CLARIFY:{...}] markers,
  // they are queued and revealed one at a time instead of all at once.
  const [clarifyQueue, setClarifyQueue] = useState<ClarifyingQuestion[]>([]);
  const [clarifyStep, setClarifyStep] = useState(0);
  const [clarifyAnswers, setClarifyAnswers] = useState<string[]>([]);
  const stepperMsgIdRef = useRef<string | null>(null); // tracks which message initialized the stepper
  const bypassStepperRef = useRef(false); // bypasses stepper intercept when submitting combined answers
  // Persist resolved CLARIFY message IDs so re-login doesn't re-activate them.
  // Key: message ID → value: '1'. Cleared on new session or after 24h.
  const resolvedClarifyRef = useRef<Set<string>>(new Set());
  // Lazily load resolved CLARIFY IDs from localStorage on first use
  const getResolvedClarify = useCallback(() => {
    if (resolvedClarifyRef.current.size > 0) return resolvedClarifyRef.current;
    try {
      const raw = localStorage.getItem('vantage:resolved-clarify');
      if (raw) {
        const { ids, ts } = JSON.parse(raw);
        if (Date.now() - ts < 24 * 60 * 60 * 1000) {
          resolvedClarifyRef.current = new Set<string>(ids);
        }
      }
    } catch {}
    return resolvedClarifyRef.current;
  }, []);
  const markClarifyResolved = useCallback((msgId: string) => {
    const next = new Set(resolvedClarifyRef.current);
    next.add(msgId);
    resolvedClarifyRef.current = next;
    try {
      localStorage.setItem('vantage:resolved-clarify', JSON.stringify({
        ids: [...next],
        ts: Date.now()
      }));
    } catch {}
  }, []);

  // ── Multi-strategy selection: messageId → selected block index ──
  const [selectedStrategies, setSelectedStrategies] = useState<Record<string, number>>({});

  // ── Inline trade buttons — TradeTicket state ──
  const [tradeTicket, setTradeTicket] = useState<{
    symbol: string; side: 'BUY' | 'SELL'; currentPrice: number;
    sharesHeld: number; availableCash: number;
    initialShares?: number; initialAmount?: number;
    /** ID of the AI message the marker came from — for persisting execution state */
    messageId?: string;
  } | null>(null);
  // Track tickers the user asked about in their last message (for deviation scenarios)

  // ── Executed markers: permanent state across sessions ──
  // Key = "messageId:symbol" → { shares, amount, side }
  const [executedMarkers, setExecutedMarkers] = useState<Record<string, { shares: number; amount: number; side: string }>>({});
  const executedLoadedRef = useRef(false);


  // ── Real ticker validation: load US stock symbol list once on mount ──
  // Passed to parseSuggestions to filter false positives ("I", "A", common words)
  // Finnhub source → server-side 24h cache → client fetches once per session
  const [validSymbols, setValidSymbols] = useState<Set<string> | null>(null);
  const [symbolNames, setSymbolNames] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/symbols/all');
        if (!res.ok) return;
        const data = await res.json();
        if (data.symbols && Array.isArray(data.symbols) && !cancelled) {
          setValidSymbols(new Set(data.symbols));
          if (data.symbolNames) {
            setSymbolNames(new Map(Object.entries(data.symbolNames)));
          }
        }
      } catch {
        // Silent — symbol validation degrades gracefully (allows all if unavailable)
      }
    }
    load();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleTLDR = useCallback((index: number) => {
    setCollapsedTLDRs(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  }, []);

  // ── Advance clarifying-question stepper to next question ──
  // Called on chip-tap or free-text submit. Submits combined answers when done.
  const advanceStepper = useCallback((answers: string[]) => {
    const queue = clarifyQueue; // capture current value
    if (queue.length === 0) return;

    const nextStep = answers.length; // after recording, answers.length === new step index
    if (nextStep >= queue.length) {
      // All questions answered — build combined message and submit
      const combined = answers.map((a, i) =>
        `${queue[i].question}\n→ ${a}`
      ).join('\n\n');

      // Reset stepper before sending
      setClarifyQueue([]);
      setClarifyStep(0);
      setClarifyAnswers([]);
      // Persist that this CLARIFY message was resolved — prevents
      // re-activation on page reload / re-login.
      if (stepperMsgIdRef.current) markClarifyResolved(stepperMsgIdRef.current);
      stepperMsgIdRef.current = null;

      // Submit as a normal chat message (bypass ref prevents stepper intercept)
      bypassStepperRef.current = true;
      sendMessage(combined, 'chat');
    } else {
      setClarifyStep(nextStep);
    }
  }, [clarifyQueue]);

  // ── Initialize clarifying-question stepper when new AI message arrives ──
  useEffect(() => {
    if (loading) return;
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== 'ai' || lastMsg.id === stepperMsgIdRef.current) return;
    // Skip messages whose CLARIFY has already been resolved — prevents
    // stale CLARIFY questions from re-activating on re-login / page reload.
    if (lastMsg.id && getResolvedClarify().has(lastMsg.id)) {
      console.log('[ClarifyStepper] Skipping resolved message:', lastMsg.id);
      return;
    }

    const questions = parseClarifyMarkers(lastMsg.content);
    if (questions.length > 0) {
      stepperMsgIdRef.current = lastMsg.id ?? null;
      setClarifyQueue(questions);
      setClarifyStep(0);
      setClarifyAnswers([]);
      console.log('[ClarifyStepper] Initialized with', questions.length, 'questions');
    }
  }, [messages, loading]);

  // ── Load executed markers from DB when messages change ──
  const loadedMessageIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!userId || userId === 'anonymous' || messages.length === 0) return;

    const newIds = messages
      .map(m => m.id)
      .filter((id): id is string => !!id && !loadedMessageIdsRef.current.has(id));

    if (newIds.length === 0) return;
    newIds.forEach(id => loadedMessageIdsRef.current.add(id));

    // Batch in chunks to avoid URL length issues
    const chunkSize = 50;
    for (let i = 0; i < newIds.length; i += chunkSize) {
      const chunk = newIds.slice(i, i + chunkSize);
      fetch(`/api/marker-executions?message_ids=${chunk.join(',')}`)
        .then(res => res.json())
        .then(data => {
          if (data.executions) {
            setExecutedMarkers(prev => ({ ...prev, ...data.executions }));
          }
        })
        .catch((e) => {
          // Fail gracefully — buttons stay active on read failure
          // But log with detail so the gap is discoverable
          console.warn('[marker-exec] GET failed — buy buttons may not show persisted state', e?.message || e);
        });
    }
  }, [userId, messages]);

  // ── Trade button handler: fetch live price → open TradeTicket ──
  const handleTradeAction = useCallback(async (
    symbol: string, side: 'BUY' | 'SELL',
    suggestedShares?: number, suggestedAmount?: number,
    messageId?: string,
  ) => {
    // Fetch live price
    let currentPrice = 0;
    try {
      const res = await fetch(`/api/finnhub/quote?symbol=${symbol}`);
      if (res.ok) {
        const data = await res.json();
        currentPrice = data.c || 0;
      }
    } catch { /* use 0 on error — TradeTicket handles validation */ }

    // Get position data for this symbol
    const positions = liveAccount?.positions || [];
    const pos = positions.find((p: any) => p.symbol?.toUpperCase() === symbol.toUpperCase());
    const rawShares = pos?.qty || 0;
    const reservedSell = pos?.reservedShares || 0;
    const sharesHeld = Math.max(0, rawShares - reservedSell);
    const availableCash = liveAccount?.cash || 0;

    // Pass both amount and shares — TradeTicket defaults to dollar mode when initialAmount is set
    const initialAmount = suggestedAmount && suggestedAmount > 0 ? suggestedAmount : undefined;
    let initialShares = suggestedShares && suggestedShares > 0 ? suggestedShares : undefined;
    // Only compute shares from amount if no explicit shares were given AND we have a price
    if (!initialShares && initialAmount && currentPrice > 0) {
      initialShares = Math.floor(initialAmount / currentPrice);
    }

    setTradeTicket({ symbol, side, currentPrice, sharesHeld, availableCash, initialShares, initialAmount, messageId });
  }, [liveAccount]);
  const [showLibrary, setShowLibrary] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [lastAIResponse, setLastAIResponse] = useState<string | null>(null);
  // ── AI Noticed state — fetched from API ──
  const [noticedItems, setNoticedItems] = useState<NoticedItem[]>([]);
  const [noticedLoaded, setNoticedLoaded] = useState(false);
  const [snoozeTarget, setSnoozeTarget] = useState<string | null>(null); // item id for popover
  // ── Rotating placeholder: picked once on mount ──
  const [chatPlaceholder] = useState(() => PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)]);

  const fetchNoticed = useCallback(async () => {
    if (!liveAccount) return;
    try {
      const res = await apiPost('/api/ai/noticed', {
        portfolio: {
          cash: liveAccount.cash ?? 0,
          equity: liveAccount.equity ?? 0,
          totalPnl: liveAccount.totalPnl ?? 0,
          totalPnlPercent: liveAccount.totalPnlPercent ?? 0,
          dayPnl: liveAccount.dayPnl ?? 0,
          dayPnlPercent: liveAccount.dayPnlPercent ?? 0,
        },
        positions: (liveAccount.positions || []).map((p: any) => ({
          symbol: p.symbol,
          qty: p.qty || 0,
          marketValue: p.marketValue || 0,
          avgCost: p.avgCost || 0,
          totalPnl: p.totalPnl || 0,
          totalPnlPercent: p.totalPnlPercent || 0,
        })),
        watchlistSymbols: [], // TODO: pass from watchlist context when available
      });
      if (res.ok) {
        const data = await res.json();
        setNoticedItems(data.items || []);
      }
    } catch {
      // silent — feed hides when empty
    } finally {
      setNoticedLoaded(true);
    }
  }, [liveAccount]);

  useEffect(() => {
    if (liveAccount && !noticedLoaded) {
      fetchNoticed();
    }
  }, [liveAccount, noticedLoaded, fetchNoticed]);

  const handleDismiss = async (itemId: string, dismissType: string) => {
    setSnoozeTarget(null);
    // Optimistic remove
    setNoticedItems(prev => prev.filter(i => i.id !== itemId));
    try {
      await apiPost('/api/ai/noticed/dismiss', { itemId, dismissType });
    } catch {
      // Re-fetch on failure
      fetchNoticed();
    }
  };

  // ── Learning moment detection ──
  const { learningCard, dismissLearning } =
    useLearningMoment(lastAIResponse, currentSessionId);

  // ── Scroll behavior refs ──
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const bottomAnchorRef = useRef<HTMLDivElement>(null);
  const isUserScrollingRef = useRef(false);
  const wasAtBottomRef = useRef(true);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const lastAiResponseRef = useRef('');

  // ── Smooth streaming queue ──
  const charQueueRef = useRef<string[]>([]);
  const isDrainingRef = useRef(false);
  const displayedContentRef = useRef('');
  const streamDoneRef = useRef(false);
  const correctedTextRef = useRef<string | null>(null);
  const validationRejectRef = useRef<any>(null); // stores regenerate/fatalValidationFailure event
  // Symbols corrected by server-side validator — force-allow in client validation
  const correctedSymbolsRef = useRef<Set<string>>(new Set());
  // Frame stagger counter for checklist SSE updates — prevents React 18 batching
  // all checklist stage transitions into one render frame (which appears frozen)
  const checklistFrameRef = useRef(0);

  const startDrainer = useCallback(() => {
    if (isDrainingRef.current) return;
    isDrainingRef.current = true;

    const drain = () => {
      // If server sent corrected text (gapFill/validation), stop rendering
      // the streamed version — prevents buttons from flashing/disappearing
      // when the corrected text and streamed text swap mid-render.
      if (correctedTextRef.current) {
        isDrainingRef.current = false;
        charQueueRef.current = [];
        return;
      }

      if (charQueueRef.current.length === 0) {
        isDrainingRef.current = false;
        if (streamDoneRef.current) streamDoneRef.current = false;
        return;
      }

      const batch = charQueueRef.current.splice(0, 3).join('');
      displayedContentRef.current += batch;

      // Do NOT write to setMessages during streaming — content stays hidden
      // behind the progress indicator (checklist) until validation passes.
      // This prevents the unvalidated first attempt from flashing on screen
      // before the validator rejects it and triggers a retry.

      setTimeout(drain, 12);
    };

    drain();
  }, [setMessages]);

  // ── portfolio context for AI ──
  const portfolioContext = buildLivePortfolioContext(liveAccount);

  // ── Usage tracking (chat + deep) ──
  const [chatRemaining, setChatRemaining] = useState<number | null>(null);
  const [deepRemaining, setDeepRemaining] = useState<number | null>(null);
  const [tier, setTier] = useState('demo');
  const [usageStats, setUsageStats] = useState<any>(null); // full stats for settings panel

  // Compute the user's local date in browser timezone (not UTC)
  const getLocalDate = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const refreshRemaining = useCallback(async () => {
    try {
      const localDate = getLocalDate();
      const res = await fetch(`/api/usage/remaining?localDate=${encodeURIComponent(localDate)}`);
      if (res.ok) {
        const data = await res.json();
        setChatRemaining(data.chatRemaining ?? getLocalRemaining());
        setDeepRemaining(data.deepRemaining ?? 5);
        return;
      }
    } catch { /* fall through */ }
    setChatRemaining(getLocalRemaining());
  }, []);

  const refreshUsageStats = useCallback(async () => {
    try {
      const localDate = getLocalDate();
      const res = await fetch(`/api/usage/stats?localDate=${encodeURIComponent(localDate)}`);
      if (res.ok) {
        const data = await res.json();
        setUsageStats(data);
        setTier(data.tier || 'demo');
      }
    } catch { /* fail silently */ }
  }, []);

  useEffect(() => {
    refreshRemaining();
    refreshUsageStats();
  }, [refreshRemaining, refreshUsageStats]);

  // ── DB hydration: load recent sessions from Supabase on mount ──
  useEffect(() => {
    if (!userId) return;
    fetchRecentSessions(userId, 10).then(sessions => {
      let allSessions: DBSession[] = sessions;

      if (sessions.length === 0) {
        // Fallback: no DB sessions yet — check device localStorage
        const local = getRecentSessions(10).map(s => ({
          id: s.id,
          label: s.date,
          date: new Date(s.updatedAt).toISOString().slice(0, 10),
          timestamp: s.updatedAt,
          preview: s.preview,
          messageCount: s.messageCount,
          messages: s.messages.map((m: any) => ({
            id: '',
            role: m.role as 'user' | 'ai',
            content: m.content,
            createdAt: new Date(s.updatedAt).toISOString(),
          })),
        }));
        if (local.length > 0) {
          allSessions = local as DBSession[];
        }
      }

      // If chat is empty, hydrate from available sessions
      if (messages.length === 0 && allSessions.length > 0) {
        const today = new Date().toISOString().slice(0, 10);
        const todaySession = allSessions.find(s => s.date === today);
        const targetSession = todaySession || allSessions[0];
        if (targetSession.messages.length > 0) {
          // Load only last 10 messages (5 user/AI exchange pairs) on session start
          let lastMessages = targetSession.messages.slice(-10);
          // 🔴 CRITICAL: Ensure conversation ends with an AI response, not a user
          // message. If the last message is a user message, the AI will re-answer it
          // on the next request — generating duplicate responses and wasting tokens.
          // This happens when an AI response failed to save, or when the slice(-10)
          // cuts off the AI answer to the last user question. Strip trailing user
          // messages to prevent re-submission of already-answered questions.
          while (lastMessages.length > 0 && lastMessages[lastMessages.length - 1].role === 'user') {
            console.warn('[chat] Stripping trailing user message from session load to prevent re-submission:', lastMessages[lastMessages.length - 1].content?.slice(0, 80));
            lastMessages = lastMessages.slice(0, -1);
          }
          if (lastMessages.length > 0) {
            setMessages(lastMessages.map(m => ({
              role: m.role as 'user' | 'ai',
              content: m.content,
            })));
            setCurrentSessionId(targetSession.id);
          }
        }
      }
    }).catch(() => {});
  }, [userId]); // re-fetch when user changes

  // ── Persist current session to DB cache (lightweight, offline fallback) ──
  // Only save metadata, not full message content — DB is authority.
  useEffect(() => {
    if (messages.length > 0 && currentSessionId) {
      const formatted = messages.map(m => ({
        role: (m.role as string === 'assistant' ? 'ai' : 'user') as 'user' | 'ai',
        content: m.content,
      }));
      saveCurrentSession(currentSessionId, formatted);
    }
  }, [messages.length]); // only on count change, NOT on every token

  // ── Category rotation tracking (no greeting caching) ──
  const CATEGORY_HISTORY_KEY = 'vantage_category_history';

  // ── Static fallback greetings ──
  const STATIC_FALLBACKS: Record<string, { opener: string; hook: string }> = {
    premarket: { opener: 'Pre-market, M.', hook: 'Markets open soon — your portfolio is ready.' },
    open_morning: { opener: 'Morning, M.', hook: 'Your portfolio is live and ready to review.' },
    open_afternoon: { opener: 'Afternoon, M.', hook: 'Markets are moving — ask me anything.' },
    afterhours: { opener: 'After hours, M.', hook: 'Markets closed — good time to plan ahead.' },
    evening: { opener: 'Evening, M.', hook: 'A quiet moment to think through your positions.' },
    weekend_morning: { opener: 'Good morning, M.', hook: 'Markets are closed — perfect time for research.' },
    weekend_afternoon: { opener: 'Afternoon, M.', hook: 'A good day to review your strategy for the week ahead.' },
  };

  function getMarketPeriod(): string {
    const now = new Date();
    // Deterministic ET time extraction — avoids fragile new Date(toLocaleString()) round-trip
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
      weekday: 'short',
    }).formatToParts(now);
    const getPart = (type: string) => parts.find(p => p.type === type)?.value || '';
    const hour = parseInt(getPart('hour'), 10);
    const min = parseInt(getPart('minute'), 10);
    const weekday = getPart('weekday');
    const timeInMin = hour * 60 + min;
    const isWeekend = weekday === 'Sun' || weekday === 'Sat';

    // Weekends: use natural time-of-day periods (not all 'evening')
    if (isWeekend) {
      if (timeInMin < 300) return 'evening';      // 12am–5am: night/evening
      if (timeInMin < 720) return 'weekend_morning'; // 5am–12pm
      if (timeInMin < 1020) return 'weekend_afternoon'; // 12pm–5pm
      return 'evening';                             // 5pm–12am
    }

    // Weekdays
    if (timeInMin < 240 || timeInMin >= 1200) return 'evening';
    if (timeInMin < 570) return 'premarket';
    if (timeInMin < 720) return 'open_morning';
    if (timeInMin < 960) return 'open_afternoon';
    if (timeInMin < 1200) return 'afterhours';
    return 'evening';
  }

  function cleanOldGreetingCache() {
    // Clean up leftover greeting cache keys from localStorage (pre-migration) and sessionStorage
    const storages = [localStorage, sessionStorage];
    for (const store of storages) {
      try {
        const keys = Object.keys(store);
        keys.forEach(key => {
          if (key.startsWith('vantage_greeting_')) {
            store.removeItem(key);
          }
        });
      } catch { /* cross-origin may throw */ }
    }
  }

  const greetingFetchedRef = useRef(false);
  const prevPositionsHashRef = useRef('');
  const positionsInitializedRef = useRef(false);

  useEffect(() => {
    const hash = JSON.stringify({
      cash: liveAccount?.cash,
      count: liveAccount?.positions?.length,
      symbols: liveAccount?.positions?.map(p => p.symbol).sort().join(','),
    });

    // Skip if no actual data yet
    if (!hash || hash === '{}' || hash === '{"cash":0,"count":0,"symbols":""}') return;

    // First time positions arrive with real data — just record the hash, don't reset greeting
    if (!positionsInitializedRef.current) {
      positionsInitializedRef.current = true;
      prevPositionsHashRef.current = hash;
      return;
    }

    // Subsequent change (user added/removed positions mid-session) — refresh greeting
    if (hash !== prevPositionsHashRef.current) {
      greetingFetchedRef.current = false;
      setGreetingLoaded(false);
      prevPositionsHashRef.current = hash;
    }
  }, [liveAccount?.cash, liveAccount?.positions]);

  useEffect(() => {
    cleanOldGreetingCache();
  }, []);

  // ── AI greeting on fresh session ──
  useEffect(() => {
    if (messages.length > 0) return;
    if (greetingLoaded) return; // Already shown from cache or previous fetch
    if (greetingFetchedRef.current) return;
    greetingFetchedRef.current = true;

    loadGreeting();

    async function loadGreeting() {
      const period = getMarketPeriod();
      const fallback = STATIC_FALLBACKS[period as keyof typeof STATIC_FALLBACKS] || STATIC_FALLBACKS.evening;

      // ↓ greetingLoaded stays false while fetching → skeleton renders (only on FIRST visit, no cache)

      // ── Step 2: Read category history + last hooks for rotation ──
      let recentCategories: string[] = [];
      let lastHooks: string[] = [];
      try {
        const raw = sessionStorage.getItem(CATEGORY_HISTORY_KEY);
        if (raw) {
          const history = JSON.parse(raw);
          recentCategories = history.categories || [];
          lastHooks = history.hooks || [];
        }
      } catch { /* ignore */ }

      // ── Step 3: Always call API fresh (no greeting cache) ──
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
        } catch (_) {}

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
          lastCategories: recentCategories,
          lastHooks,
        });

        if (!res.ok) throw new Error('API failed');

        const data = await res.json();

        if (data.opener && data.hook) {
          setGreetingOpener(data.opener);
          setGreetingHook(data.hook);
          setGreetingLoaded(true);

          // ── Save greeting to sessionStorage (persists across tab switches) ──
          try {
            sessionStorage.setItem('vantage_greet_cache', JSON.stringify({
              opener: data.opener,
              hook: data.hook,
              at: Date.now(),
            }));
          } catch { /* ignore */ }

          // ── Save category history + last hooks for next load ──
          try {
            sessionStorage.setItem(CATEGORY_HISTORY_KEY, JSON.stringify({
              categories: data.categoriesUsed || [data.category],
              hooks: [data.hook, ...lastHooks].slice(0, 2),
            }));
          } catch { /* ignore */ }
        }
      } catch (e) {
        console.log('[Greeting] API failed, using fallback:', e);
        setGreetingOpener(fallback.opener);
        setGreetingHook(fallback.hook);
        setGreetingLoaded(true);
      }
    }
  // Only re-run when messages are cleared (new session) or greeting is explicitly reset
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [greetingLoaded, messages.length]);

  // ── helpers ──
  function isAtBottom(): boolean {
    const container = chatContainerRef.current;
    if (!container) return true;
    const threshold = 80;
    return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
  }

  function scrollToBottom(smooth = true) {
    const container = chatContainerRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: smooth ? 'smooth' : 'instant' as ScrollBehavior });
  }

  // ── Track user scroll intent ──
  useEffect(() => {
    const container = chatContainerRef.current;
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

  // ── Scroll on user sends + initial load ──
  const prevMessageCountRef = useRef(0);
  const initialScrollDoneRef = useRef(false);
  useEffect(() => {
    if (messages.length === 0) return;
    // Initial load: scroll to bottom once on first non-empty render
    if (!initialScrollDoneRef.current) {
      initialScrollDoneRef.current = true;
      scrollToBottom(false);
      prevMessageCountRef.current = messages.length;
      return;
    }
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role === 'user') {
      scrollToBottom(true);
      wasAtBottomRef.current = true;
    }
    prevMessageCountRef.current = messages.length;
  }, [messages.length]);

  // ── Auto-scroll during streaming: pin to bottom unless user scrolled away ──
  useEffect(() => {
    if (!loading) return;
    if (wasAtBottomRef.current && !isUserScrollingRef.current) {
      scrollToBottom(false);
    }
  }, [messages, loading]);

  // ── Responsive Explore button: switch to icon-only below ~340px ──
  useEffect(() => {
    const el = document.querySelector('.vantage-input-bar');
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setExploreCompact(entry.contentRect.width < 340);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Close menu on outside click ──
  useEffect(() => {
    if (!showMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);

  const sendMessage = async (
    content: string,
    mode: 'chat' | 'alerts' = 'chat',
    additionalContext?: string,
    retryOpts?: { retryAttempt: number; retryFailures: any[] },
  ) => {
    if (!content.trim() || loading) return;

    // ── Stepper intercept: if a multi-question stepper is active ──
    // Free-text answers (for open-ended questions without options) are
    // captured here instead of being sent to the API as normal messages.
    // bypassStepperRef skips this when advanceStepper submits combined answers.
    const isBypass = bypassStepperRef.current;
    bypassStepperRef.current = false;

    if (!isBypass && clarifyQueue.length > 0 && clarifyStep < clarifyQueue.length) {
      // Only intercept when the stepper is rendering for the CURRENT message.
      // If the stepper is NOT active (single-question mode), the clarify state
      // should have been cleared — this guard prevents stale state from eating
      // chip taps in single-question mode.
      const isStepperMsg = stepperMsgIdRef.current !== null && messages.some(m => m.id === stepperMsgIdRef.current);
      if (!isStepperMsg) {
        // Stale queue — clear it so chip taps reach the server
        setClarifyQueue([]);
        setClarifyStep(0);
        setClarifyAnswers([]);
        // Fall through to normal sendMessage flow
      } else {
      const currentQ = clarifyQueue[clarifyStep];
      // Only intercept if current question has NO chips (open-ended)
      // Questions with chips should be answered by tapping, not typing
      const hasChips = currentQ.options && currentQ.options.length >= 2;
      if (!hasChips) {
        const newAnswers = [...clarifyAnswers, content.trim()];
        setClarifyAnswers(newAnswers);
        setInput('');
        advanceStepper(newAnswers);
        return;
      }
      // If current question has chips, ignore free-form text input
      return;
      }
    }

    // Only block when chatRemaining is explicitly 0 (confirmed loaded + depleted).
    // null = not yet loaded → allow through (server enforces the real limit).
    if (chatRemaining === 0) {
      const resetMsg = usageStats?.chat?.monthly
        ? `Monthly chat limit reached — resets on the 1st. Upgrade to Gold for more messages.`
        : `Daily chat limit reached — resets tomorrow.`;
      setMessages(prev => [...prev, {
        role: 'ai',
        content: `📊 ${resetMsg}`
      }]);
      return;
    }

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

    if (messages.length === 0) {
      // session tracking stub removed — gamification UI retired
    }

    const userMessage = { role: 'user' as const, content, id: crypto.randomUUID() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    // Send last 10 messages to cap context window, but ALWAYS include
    // the first user message which carries the original portfolio budget.
    // Without it, extractBudgetFromHistory() returns null and the
    // budget gate has no context to validate against.
    const recentMessages = newMessages.slice(-10);
    const firstUserMsg = newMessages.find(m => m.role === 'user');
    const contextMessages = (firstUserMsg && !recentMessages.includes(firstUserMsg))
      ? [firstUserMsg, ...recentMessages]
      : recentMessages;

    try {
      const res = await apiPost('/api/chat', {
        messages: contextMessages,
        portfolioContext,
        additionalContext: additionalContext || '',
        mode,
        investorStyle: investorStyle,
        riskTolerance: user?.riskTolerance || 'Moderate',
        name: user?.name || (typeof window !== 'undefined' ? user?.name || '' : null) || 'M',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
        retryAttempt: retryOpts?.retryAttempt ?? 0,
        validationFailures: retryOpts?.retryFailures ?? null,
      });

      if (!res.ok) {
        if (res.status === 429) {
          const errData = await res.json().catch(() => ({}));
          throw { status: 429, ...errData };
        }
        throw new Error('API error');
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      charQueueRef.current = [];
      displayedContentRef.current = '';
      streamDoneRef.current = false;
      correctedTextRef.current = null;
      validationRejectRef.current = null;
      correctedSymbolsRef.current = new Set();
      checklistFrameRef.current = 0; // reset checklist animation stagger

      setMessages(prev => [...prev, { role: 'ai', content: '', id: crypto.randomUUID() }]);

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        setToast(null);

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.checklist) {
                // 🔴 React 18 batches all setState calls within one synchronous
                // event-loop tick. SSE events arrive in rapid bursts — without
                // frame staggering, the checklist jumps from all-pending to
                // all-done in a single render, appearing frozen to users.
                // Schedule each stage update 16ms apart (1 frame at 60fps)
                // so the ProgressIndicator animates through each real stage.
                const stageUpdate = data.checklist;
                checklistFrameRef.current += 16;
                const delay = checklistFrameRef.current;
                setTimeout(() => {
                  setChecklistItems(prev => {
                    const item: ChecklistItem = {
                      stage: stageUpdate.stage,
                      status: stageUpdate.status as ChecklistItem['status'],
                      detail: stageUpdate.detail,
                      label: '', // filled by ProgressIndicator from STAGE_CONFIG
                    };
                    const next = prev.filter(i => i.stage !== item.stage);
                    next.push(item);
                    return next;
                  });
                }, delay);
                // Don't start the text drainer during checklist — keep raw
                // reasoning hidden behind the checklist
                continue;
              }
              if (data.screeningMeta) {
                setScreeningMeta(data.screeningMeta);
                continue;
              }
              if (data.text) {
                charQueueRef.current.push(...data.text.split(''));
                lastAiResponseRef.current = displayedContentRef.current + charQueueRef.current.join('');
                startDrainer();
                // Auto-scroll handled by the streaming useEffect above (pin-to-bottom)
              }
              if (data.corrections) {
                // Server-side marker validation caught a hallucinated ticker
                correctedTextRef.current = data.correctedText;
                for (const issue of data.corrections) {
                  if (issue.correction) {
                    const syms = Array.isArray(issue.correction) ? issue.correction : [issue.correction];
                    for (const s of syms) correctedSymbolsRef.current.add(s);
                  }
                }
                console.log('[chat] Marker corrections applied:', data.corrections);
              }
              if (data.regenerate || data.fatalValidationFailure) {
                // Server-side strict validation rejected the response
                // Store regeneration state — processed after stream ends
                validationRejectRef.current = data;
                console.log('[chat] Validation rejection received:', data.regenerate ? 'regenerate' : 'fatal');
              }
              if (data.fatalStreamError) {
                // Server-side stream crashed — store error for display
                validationRejectRef.current = data;
                console.error('[chat] Fatal stream error received:', data.message);
              }
              if (data.budgetViolation) {
                // Budget gate flagged the portfolio total as outside ±2% of requested budget
                // Show a warning banner on the LAST AI message
                setBudgetWarnings(data.budgetViolation);
                console.warn('[chat] Budget violation:', data.budgetViolation.message);
              }
            } catch (e) {}
          }
        }
      }

      streamDoneRef.current = true;

      // Wait for drainer to finish accumulating text into displayedContentRef.
      // Content is NOT committed to the visible message yet — it stays hidden
      // behind the progress indicator until validation passes.
      while (isDrainingRef.current || charQueueRef.current.length > 0) {
        await new Promise(r => setTimeout(r, 50));
      }

      // If server-side marker validation corrected hallucinated tickers,
      // use the corrected text instead of the streamed version.
      const finalContent = correctedTextRef.current || displayedContentRef.current;

      // Always sync marker symbols to validSymbols — prevents legitimate markers
      // (ETFs, ADRs) from being filtered out when symbols came from the original
      // AI response (not gap-fill) and validSymbols was populated from Finnhub.
      const ALL_MARKER_REGEX = /\[RECOMMEND:([A-Z]{1,5}(?:\.[A-Z]{1,2})?):/g;
      for (const m of finalContent.matchAll(ALL_MARKER_REGEX)) {
        const raw = m[1].toUpperCase();
        const dotIdx = raw.lastIndexOf('.');
        const suffix = dotIdx >= 0 ? raw.slice(dotIdx + 1) : '';
        const symbol = suffix.length >= 2 ? raw.slice(0, dotIdx) : raw;
        correctedSymbolsRef.current.add(symbol);
      }

      // Capture symbols BEFORE clearing the ref — React state updaters run
      // asynchronously, so correctedSymbolsRef.current would be empty by then.
      const symbolsToAdd = correctedSymbolsRef.current.size > 0
        ? new Set([...correctedSymbolsRef.current])
        : null;
      correctedTextRef.current = null;
      correctedSymbolsRef.current = new Set();

      // ── Handle validation rejection (regenerate / fatal) FIRST —
      // BEFORE committing content to the visible message. This prevents
      // the unvalidated first attempt from flashing on screen. ──
      if (validationRejectRef.current) {
        const rejectData = validationRejectRef.current;
        validationRejectRef.current = null;

        if (rejectData.regenerate && !rejectData.fatalValidationFailure) {
          // Auto-retry: keep the progress indicator (checklist) visible,
          // remove the empty AI message stub, and retry silently.
          console.log('[chat] Validation failed — auto-regenerating (content hidden)...');
          setMessages(prev => prev.slice(0, -1)); // Remove empty AI message stub
          setChecklistItems([]); // Clear stale checklist so new stages animate fresh
          setLoading(false);
          await new Promise(r => setTimeout(r, 50));
          try {
            await sendMessage(content, 'chat', undefined, {
              retryAttempt: 1,
              retryFailures: rejectData.failures,
            });
          } catch (retryErr) {
            console.error('[chat] Auto-retry failed:', retryErr);
          }
          return;
        }

        if (rejectData.fatalValidationFailure) {
          // Fatal: both attempts failed — show error to user
          const failures = (rejectData.failures || []) as Array<{ check: string; detail: string }>;
          const errorMarkdown = [
            '⚠️ **Portfolio generation failed validation**',
            '',
            ...failures.map(f => `• **${f.check.replace(/_/g, ' ')}**: ${f.detail}`),
            '',
            '_Try rephrasing your request or adjusting your budget._'
          ].join('\n');
          setMessages(prev => prev.slice(0, -1)); // Remove empty AI stub
          setMessages(prev => [...prev, { role: 'ai', content: errorMarkdown }]);
          // Clear progress indicator — show the error
          setChecklistItems([]);
          setScreeningMeta(null);
          setLoading(false);
          return;
        }

        if (rejectData.fatalStreamError) {
          // Server-side stream crashed — surface the actual error
          console.error('[chat] Handling fatal stream error:', rejectData.message);
          setMessages(prev => prev.slice(0, -1)); // Remove empty AI stub
          setMessages(prev => [...prev, {
            role: 'ai',
            content: `I hit an internal error processing your request: **${rejectData.message || 'Unknown streaming error'}**\n\nThis has been logged. Could you try again? If it persists, try a simpler query.`,
          }]);
          setChecklistItems([]);
          setScreeningMeta(null);
          setLoading(false);
          return;
        }
      }

      // ── Validation passed — commit content to visible message ──
      if (symbolsToAdd && symbolsToAdd.size > 0) {
        console.log('[chat] Adding symbols to validSymbols:', [...symbolsToAdd]);
        setValidSymbols(prev => {
          const next = new Set(prev || []);
          for (const s of symbolsToAdd) next.add(s);
          console.log('[chat] validSymbols size after add:', next.size);
          return next;
        });
        fetch(`/api/symbols/names?symbols=${encodeURIComponent([...symbolsToAdd].join(','))}`)
          .then(r => r.json())
          .then(data => {
            if (data.names && Object.keys(data.names).length > 0) {
              setSymbolNames(prev => {
                const next = new Map(prev);
                for (const [sym, name] of Object.entries(data.names)) {
                  if (!next.has(sym)) next.set(sym as string, name as string);
                }
                console.log('[chat] Added missing names:', Object.keys(data.names));
                return next;
              });
            }
          })
          .catch(() => {});
      }

      // Commit validated content to the AI message bubble
      setMessages(prev => {
        const updated = [...prev];
        if (updated.length > 0 && updated[updated.length - 1].role === 'ai') {
          updated[updated.length - 1] = { ...updated[updated.length - 1], role: 'ai' as const, content: finalContent };
        }
        return updated;
      });

      // ── Clear progress indicator — content is now visible and valid ──
      setChecklistItems([]);
      setScreeningMeta(null);

      // Store validated content for save/replay
      lastAiResponseRef.current = finalContent;
      // Scroll suppressed — user controls position
    } catch (error: any) {
      console.error('Chat error:', error);
      setToast(null);
      if (error?.status === 429) {
        const reason = error?.reason || error?.error || 'Usage limit reached';
        const resetsIn = error?.resetsIn || '';
        const errorType = error?.type || '';

        // Abuse cooldown — short temporary throttle, no upgrade nudge
        if (errorType === 'abuse_cooldown') {
          setMessages(prev => [...prev, {
            role: 'ai',
            content: `⏳ ${reason}`,
          }]);
        } else {
          // Limit reached — build a clear system message
          const isPool = reason.includes('trial') || reason.includes('pool');
          const isMonthly = reason.includes('Monthly') || reason.includes('monthly');

          let msg = `📊 ${reason}`;
          if (resetsIn === 'upgrade' || isPool) {
            msg += `\n\nUpgrade to Silver or Gold for more deep analyses.`;
          } else if (isMonthly) {
            msg += `\n\nResets on the 1st of next month.`;
          } else {
            msg += `\n\nResets tomorrow.`;
          }
          // Only show upgrade mention for Demo/Silver
          if (tier !== 'gold') {
            const upgradeTarget = tier === 'demo' ? 'Silver' : 'Gold';
            msg += ` Upgrade to ${upgradeTarget} on the [Plans &amp; Pricing](/plans) page.`;
          }
          setMessages(prev => [...prev, { role: 'ai', content: msg }]);
        }
      } else {
        setMessages(prev => [...prev, { role: 'ai', content: 'Sorry — I encountered an error. Please try again.' }]);
      }
    } finally {
      setLoading(false);
      refreshRemaining();
      if (userId) {
        try {
          // Await both saves before anything else — prevents losing the last message on refresh
          const userSaved = await saveChatMessage(userId, 'user', content).catch((e: any) => { console.error('[AITab] user msg save failed:', e?.message); return null; });
          if (lastAiResponseRef.current) {
            const aiSaved = await saveChatMessage(userId, 'assistant', lastAiResponseRef.current).catch((e: any) => { console.error('[AITab] ai msg save failed:', e?.message); return null; });
            console.log('[AITab] Saved: user=', !!userSaved, 'ai=', !!aiSaved);
            setLastAIResponse(lastAiResponseRef.current);
            lastAiResponseRef.current = '';
            // Refresh session list after saving to DB
            fetchRecentSessions(userId, 10).then(s => { console.log('[AITab] sessions refreshed:', s.length); }).catch(() => {});
          }
        } catch (e: any) {
          console.error('[AITab] save message exception:', e?.message || e);
          // Still clear refs so we don't leak stale data
          if (lastAiResponseRef.current) {
            setLastAIResponse(lastAiResponseRef.current);
            lastAiResponseRef.current = '';
          }
        }
      } else if (lastAiResponseRef.current) {
        setLastAIResponse(lastAiResponseRef.current);
        lastAiResponseRef.current = '';
      }
      scrollToBottom();
    }
  };

  // ── Market Pulse: fetch live quotes before sending ──
  const handleMarketPulse = async (e: React.MouseEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.style.transition = 'box-shadow 0s';
    el.style.boxShadow = '0 0 0 2px #22d3ee';
    setTimeout(() => {
      el.style.transition = 'box-shadow 400ms ease-out';
      el.style.boxShadow = '';
    }, 100);

    const symbols = ['SPY', 'QQQ', 'DIA', 'IWM', 'VIX'];
    const quotes: Record<string, { c: number; d: number; dp: number }> = {};

    try {
      await Promise.all(symbols.map(async (sym) => {
        try {
          const res = await fetch(`/api/finnhub/quote?symbol=${sym}`);
          const data = await res.json();
          quotes[sym] = { c: data.c || 0, d: data.d || 0, dp: data.dp || 0 };
        } catch {
          quotes[sym] = { c: 0, d: 0, dp: 0 };
        }
      }));
    } catch {}

    const fmtChg = (d: number) => (d > 0 ? `+${d.toFixed(2)}` : d.toFixed(2));
    const fmtPct = (dp: number) => (dp > 0 ? `+${dp.toFixed(2)}` : dp.toFixed(2));

    const marketContext = `LIVE MARKET DATA (real-time from Finnhub):
S&P 500 ETF (SPY): $${quotes.SPY?.c?.toFixed(2) || 'N/A'} ${fmtChg(quotes.SPY?.d || 0)} (${fmtPct(quotes.SPY?.dp || 0)}%)
Nasdaq ETF (QQQ): $${quotes.QQQ?.c?.toFixed(2) || 'N/A'} ${fmtChg(quotes.QQQ?.d || 0)} (${fmtPct(quotes.QQQ?.dp || 0)}%)
Dow ETF (DIA): $${quotes.DIA?.c?.toFixed(2) || 'N/A'} ${fmtChg(quotes.DIA?.d || 0)} (${fmtPct(quotes.DIA?.dp || 0)}%)
Russell 2000 (IWM): $${quotes.IWM?.c?.toFixed(2) || 'N/A'} ${fmtChg(quotes.IWM?.d || 0)} (${fmtPct(quotes.IWM?.dp || 0)}%)
VIX: $${quotes.VIX?.c?.toFixed(2) || 'N/A'} ${fmtChg(quotes.VIX?.d || 0)} (${fmtPct(quotes.VIX?.dp || 0)}%)

Note: For sector performance, use the ETF moves above as proxies and your knowledge of sector correlations. QQQ weakness = tech pressure. IWM weakness = small cap risk-off. DIA vs QQQ spread = value vs growth rotation. Use this data to answer the following — do NOT search the web for prices, these are the real current numbers:`;

    const question = 'Give me a market pulse check — how are the major indexes performing today, what sectors are leading and lagging, and what should I know as an investor right now?';

    sendMessage(question, 'chat', marketContext);
    wasAtBottomRef.current = true;
    scrollToBottom(true);
  };

  const sendToChat = (message: string, e?: React.MouseEvent) => {
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
    wasAtBottomRef.current = true;
    scrollToBottom(true);
  };

  // ── derived data ──
  const equity = liveAccount?.equity ?? 0;
  const dayPnl = liveAccount?.dayPnl ?? 0;
  const dayPnlPct = liveAccount?.dayPnlPercent ?? 0;
  const totalPnl = liveAccount?.totalPnl ?? 0;
  const positions = liveAccount?.positions || [];

  // ── AI Noticed items (fetched from API — already set via useEffect) ──

  // ── Suggested chips (trimmed to 2 per reference) ──
  const suggestionChips: string[] = (() => {
    const chips: string[] = [];
    const pos = positions;

    const largest = pos.reduce((a, b) => (a.marketValue || 0) > (b.marketValue || 0) ? a : b, pos[0]);
    if (largest) {
      chips.push(`Should I trim ${largest.symbol} given recent outperformance?`);
    }
    if (pos.length > 0) {
      chips.push(`What would deploying half my cash into ${pos[0].symbol} look like?`);
    }
    return chips.slice(0, 2);
  })();

  // ── Explore bottom sheet ──
  const [showExplore, setShowExplore] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, position: 'relative', background: 'linear-gradient(180deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.015) 40%, rgba(10,15,30,0.4) 100%)', border: '1px solid rgba(34,211,238,0.2)', borderRadius: '28px', margin: '8px 12px 6px 12px', overflow: 'hidden', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), 0 20px 60px rgba(0,0,0,0.4)' }}>
      {/* Previous session banner */}
      {previousSession && messages.length === 0 && (
        <div
          style={{
            background: '#1a2235',
            border: '1px solid #2a3448',
            borderRadius: '10px',
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

      {/* ======== TOP BAR — hamburger + title (left-aligned) ======== */}
      <div style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '16px 16px 12px',
        zIndex: 20,
        position: 'relative',
      }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => setShowMenu(!showMenu)}
            style={{
              width: '36px',
              height: '36px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: showMenu ? 'rgba(34,211,238,0.15)' : 'rgba(255,255,255,0.06)',
              border: showMenu ? '1px solid rgba(34,211,238,0.3)' : '1px solid rgba(255,255,255,0.1)',
              borderRadius: '50%',
              color: showMenu ? ACCENT : 'rgba(255,255,255,0.6)',
              fontSize: '15px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              lineHeight: 1,
            }}
          >
            ☰
          </button>

        </div>
        <div style={{ fontSize: '15px', fontWeight: 800, color: '#22d3ee' }}>Vantage AI Advisor</div>
        {/* Live pulse indicator */}
        <div style={{
          width: '7px',
          height: '7px',
          borderRadius: '50%',
          background: ACCENT,
          animation: 'vantageLivePulse 2s infinite',
          marginLeft: '2px',
        }} />
        {/* Spacer pushes 📚 to the right */}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setShowLibrary(true)}
          title="Learning Library"
          style={{
            width: '32px',
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '8px',
            color: 'rgba(255,255,255,0.6)',
            fontSize: '16px',
            cursor: 'pointer',
            fontFamily: 'inherit',
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          📚
        </button>
        <style>{`
          @keyframes vantageLivePulse {
            0% { box-shadow: 0 0 0 0 rgba(34,211,238,0.5); }
            70% { box-shadow: 0 0 0 8px rgba(34,211,238,0); }
            100% { box-shadow: 0 0 0 0 rgba(34,211,238,0); }
          }
        `}</style>
      </div>

      {/* Hamburger dropdown — inline panel below header, per redesign spec */}
      {showMenu && (
        <div style={{
          flexShrink: 0,
          margin: '0 16px 10px',
          background: 'rgba(20,28,48,0.95)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '14px',
          overflow: 'hidden',
        }}>
          <button
            onClick={() => { setShowMenu(false); setShowHistory(true); }}
            style={{
              display: 'block',
              width: '100%',
              background: 'transparent',
              border: 'none',
              borderTop: '1px solid rgba(255,255,255,0.06)',
              color: '#e2e8f0',
              fontSize: '13.5px',
              fontWeight: 600,
              padding: '12px 16px',
              cursor: 'pointer',
              textAlign: 'left',
              fontFamily: 'inherit',
            }}
          >
            History
          </button>
          <button
            onClick={() => { setShowMenu(false); setShowClearConfirm(true); }}
            style={{
              display: 'block',
              width: '100%',
              background: 'transparent',
              border: 'none',
              borderTop: '1px solid rgba(255,255,255,0.06)',
              color: '#e2e8f0',
              fontSize: '13.5px',
              fontWeight: 600,
              padding: '12px 16px',
              cursor: 'pointer',
              textAlign: 'left',
              fontFamily: 'inherit',
            }}
          >
            Clear Conversation
          </button>
          <button
            onClick={() => { setShowMenu(false); setShowSettings(true); refreshUsageStats(); }}
            style={{
              display: 'block',
              width: '100%',
              background: 'transparent',
              border: 'none',
              borderTop: '1px solid rgba(255,255,255,0.06)',
              color: '#e2e8f0',
              fontSize: '13.5px',
              fontWeight: 600,
              padding: '12px 16px',
              cursor: 'pointer',
              textAlign: 'left',
              fontFamily: 'inherit',
            }}
          >
            AI Settings
          </button>
        </div>
      )}

      {/* ======== CHAT WINDOW — structural container ======== */}
      <div style={{
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      }}>

      {/* ======== MESSAGE THREAD — greeting scrolls with chat ======== */}
      <div
        ref={chatContainerRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          paddingTop: '8px',
        }}
      >

        {/* ======== 1. GREETING CARD (gradient border + radial glow) ======== */}
        {greetingLoaded && (
          <div style={{ padding: '0 16px', marginBottom: '12px' }}>
            <div style={{
              position: 'relative',
              background: 'rgba(255,255,255,0.05)',
              borderRadius: '18px',
              padding: '20px',
              overflow: 'hidden',
              backdropFilter: BACKDROP_BLUR,
            }}>
              {/* Gradient border (pseudo-element simulation) */}
              <div style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '18px',
                padding: '1px',
                background: 'linear-gradient(135deg, rgba(34,211,238,0.5), rgba(34,211,238,0.05) 40%, rgba(34,211,238,0.25))',
                WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                WebkitMaskComposite: 'xor',
                maskComposite: 'exclude',
                pointerEvents: 'none',
                zIndex: 1,
              }} />
              {/* Radial glow overlay */}
              <div style={{
                position: 'absolute',
                top: '-40%',
                left: '-20%',
                width: '140%',
                height: '140%',
                background: 'radial-gradient(circle, rgba(34,211,238,0.10), transparent 60%)',
                pointerEvents: 'none',
                zIndex: 0,
              }} />

              {/* Opener — serif italic 28px */}
              <div style={{ position: 'relative', zIndex: 2, fontFamily: "Georgia, 'Playfair Display', serif", fontStyle: 'italic', fontWeight: 400, fontSize: '28px', marginBottom: '4px', color: '#fff' }}>
                {greetingOpener && greetingOpener.split(new RegExp(`\\b(${userInitial.replace('.', '\\.')})\\b`)).map((part, i) =>
                  part === userInitial ? (
                    <span key={i} style={{ color: ACCENT }}>{userInitial}</span>
                  ) : (
                    <span key={i}>{part}</span>
                  )
                )}
              </div>

              {/* Hook */}
              {greetingHook && (
                <div style={{ position: 'relative', zIndex: 2, fontSize: '14.5px', lineHeight: '1.6', color: 'rgba(255,255,255,0.85)' }}>
                  {greetingHook}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ======== Greeting loading state ======== */}
        {!greetingLoaded && (
          <div style={{ padding: '0 16px', marginBottom: '12px' }}>
            <div style={{
              position: 'relative',
              background: 'rgba(255,255,255,0.05)',
              borderRadius: '18px',
              padding: '20px',
              overflow: 'hidden',
              backdropFilter: BACKDROP_BLUR,
            }}>
              <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', gap: '4px', alignItems: 'center', padding: '4px 0' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: ACCENT, animation: 'vantagePulse 1.2s ease-in-out infinite', animationDelay: '0s' }} />
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: ACCENT, animation: 'vantagePulse 1.2s ease-in-out infinite', animationDelay: '0.2s' }} />
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: ACCENT, animation: 'vantagePulse 1.2s ease-in-out infinite', animationDelay: '0.4s' }} />
                </div>
              </div>
            </div>
          </div>
        )}

        <div
          ref={messagesContainerRef}
          style={{
            padding: '0 16px 16px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            minHeight: messages.length > 0 ? '120px' : '0px',
            position: 'relative',
          }}
        >
        {/* Empty state — no suggestions inside chat */}
        {messages.length === 0 && !loading && (
          <div style={{ flex: 1 }} />
        )}

        {/* Messages */}
        {messages.map((msg, i) => {
          if (msg.role === 'user') {
            // User message — teal-tinted, right-aligned
            return (
              <div
                key={i}
                style={{
                  alignSelf: 'flex-end',
                  maxWidth: '85%',
                  background: 'rgba(34,211,238,0.12)',
                  border: '1px solid rgba(34,211,238,0.2)',
                  borderRadius: '16px 16px 4px 16px',
                  padding: '12px 15px',
                  fontSize: '14px',
                }}
              >
                <span style={{ lineHeight: '1.5', wordBreak: 'break-word', color: '#fff' }}>{msg.content}</span>
              </div>
            );
          }
          // AI message — accent left border, same 14px font as user messages
          // Compute clarifying options from [CLARIFY:...] markers for chips BELOW the bubble
          const isLastAiMsg = !loading && !messages.slice(i + 1).some(m => m.role === 'ai');
          const isClarifyResolved = !!(msg.id && getResolvedClarify().has(msg.id));
          // Only show CLARIFY chips if this is the last AI message AND the CLARIFY hasn't been resolved
          const clarifyQuestions = (isLastAiMsg && !isClarifyResolved) ? parseClarifyMarkers(msg.content) : [];
          // Stepper mode: multi-question queue active for this message
          const isStepperActive = clarifyQueue.length > 0 && msg.id === stepperMsgIdRef.current;
          // Single-question mode: fallback for 1 question or no stepper
          const clarifyingOpts = !isStepperActive ? questionsToOptions(clarifyQuestions) : null;
          return (
            <React.Fragment key={i}>
            <div
              style={{
                maxWidth: '92%',
                background: 'rgba(255,255,255,0.04)',
                borderLeft: '3px solid #22d3ee',
                borderRadius: '4px 16px 16px 16px',
                padding: '14px 16px',
                fontSize: '14px',
                color: 'rgba(255,255,255,0.85)',
              }}
            >
              <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#22d3ee', marginBottom: '6px', letterSpacing: '0.03em' }}>
                VANTAGE AI
              </div>
              {(() => {
                // ── Show progress indicator while AI is generating ──
                // Replaces raw reasoning text with branded pipeline stages
                if (loading && i === messages.length - 1 && checklistItems.length > 0) {
                  return <ProgressIndicator items={checklistItems} />;
                }
                const tldr = extractTLDR(msg.content);
                const showTLDR = tldr && qualifiesForTLDR(msg.content);
                const isCollapsed = collapsedTLDRs.has(i);
                return (
                  <>
                    {showTLDR && (
                      <div style={{ marginBottom: isCollapsed ? '0' : '6px' }}>
                        <button
                          onClick={() => toggleTLDR(i)}
                          style={{
                            background: 'rgba(34,211,238,0.08)',
                            border: '1px solid rgba(34,211,238,0.2)',
                            borderRadius: '6px',
                            color: '#22d3ee',
                            fontSize: '11px',
                            fontWeight: 600,
                            padding: '2px 10px',
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                            opacity: 0.85,
                          }}
                        >
                          {isCollapsed ? 'Show full response ▲' : 'TL;DR ▼'}
                        </button>
                      </div>
                    )}
                    {isCollapsed ? (
                      <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.7)', lineHeight: '1.6', fontStyle: 'italic', borderLeft: '2px solid rgba(34,211,238,0.3)', paddingLeft: '10px' }}>
                        {tldr}
                      </div>
                    ) : (
                      <>
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          p: ({ children }) => (<p style={{ margin: '0 0 8px 0', lineHeight: '1.6' }}>{children}</p>),
                          strong: ({ children }) => (<strong style={{ color: '#ffffff', fontWeight: '700' }}>{children}</strong>),
                          ul: ({ children }) => (<ul style={{ margin: '4px 0 8px 0', paddingLeft: '16px', listStyleType: 'disc' }}>{children}</ul>),
                          li: ({ children }) => (<li style={{ margin: '4px 0', lineHeight: '1.5' }}>{children}</li>),
                          h2: ({ children }) => (<h2 style={{ fontSize: '14px', fontWeight: '700', color: '#ffffff', margin: '12px 0 8px 0' }}>{children}</h2>),
                          h3: ({ children }) => (<h3 style={{ fontSize: '13px', fontWeight: '700', color: '#22d3ee', margin: '12px 0 6px 0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{children}</h3>),
                          code: ({ children }) => (<code style={{ background: '#0f1829', borderRadius: '4px', padding: '1px 6px', fontSize: '12px', color: '#22d3ee' }}>{children}</code>),
                          table: ({ children }) => (<div style={{ overflowX: 'auto', margin: '8px 0', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>{children}</table></div>),
                          thead: ({ children }) => (<thead style={{ background: 'rgba(34,211,238,0.1)' }}>{children}</thead>),
                          th: ({ children }) => (<th style={{ padding: '8px 12px', textAlign: 'left', color: '#22d3ee', fontWeight: '600', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid rgba(255,255,255,0.1)', whiteSpace: 'nowrap' }}>{children}</th>),
                          td: ({ children }) => (<td style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#e2e8f0', verticalAlign: 'top' }}>{children}</td>),
                          hr: () => (<hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.1)', margin: '12px 0' }} />),
                        }}
                      >
                        {stripRecommendationMarkers(msg.content)}
                      </ReactMarkdown>
                        {/* Summary card: TL;DR + allocation table below prose */}
                        {(() => {
                          if (tier === 'silver') return null;
                          const suggestions = parseSuggestions(msg.content, validSymbols);
                          if (suggestions.length === 0) return null;
                          const tldrText = parseSummaryTLDR(msg.content);
                          if (!tldrText) return null;
                          return (
                            <SummaryCard
                              tldr={tldrText}
                              suggestions={suggestions}
                              symbolNames={symbolNames}
                              proseText={msg.content}
                              enabled={tier !== 'silver'}
                              onTrade={(sym, sd, sh, am) => handleTradeAction(sym, sd, sh, am, msg.id)}
                            />
                          );
                        })()}
                      </>
                    )}
                  </>
                );
              })()}
              {/* Inline trade buttons (Demo/Gold only) */}
              {(() => {
                if (tier === 'silver') return null;

                // ── Multi-strategy detection ──
                const msgBlocks = parsePortfolioBlocks(msg.content);
                const isMultiStrategy = msgBlocks.length > 1;
                const selectedBlockIdx = msg.id ? selectedStrategies[msg.id] : undefined;
                const hasSelection = selectedBlockIdx !== undefined && selectedBlockIdx >= 0 && selectedBlockIdx < msgBlocks.length;

                let suggestions: Suggestion[];
                let choices: ChoiceSuggestion[];

                if (isMultiStrategy && hasSelection) {
                  // Use the selected block's positions directly — PORTFOLIO block IS the source of truth.
                  // No RECOMMEND marker parsing, no regeneration.
                  const block = msgBlocks[selectedBlockIdx];
                  suggestions = block.positions.map(p => ({
                    symbol: p.symbol,
                    side: 'BUY' as const,
                    suggestedAmount: p.amount,
                  }));
                  choices = [];
                } else if (isMultiStrategy) {
                  // Multi-strategy but nothing selected — hide trade buttons, show cards below
                  return null;
                } else {
                  // Normal single-strategy behavior
                  suggestions = parseSuggestions(msg.content, validSymbols);
                  choices = parseChoiceSuggestions(msg.content);
                }

                if (suggestions.length === 0 && choices.length === 0) return null;
                // Build executedMap for this message from global state + localStorage
                const msgExecutedMap: Record<string, { shares: number; amount: number; side: string }> = {};
                for (const s of suggestions) {
                  // Check in-memory state (triggers immediate re-render, most reliable)
                  // Layer 1: messageId:symbol key (from DB-persisted markers)
                  if (msg.id && executedMarkers[`${msg.id}:${s.symbol}`]) {
                    msgExecutedMap[s.symbol] = executedMarkers[`${msg.id}:${s.symbol}`];
                    continue;
                  }
                  // Layer 2: direct:symbol:side fallback (works even without messageId)
                  if (executedMarkers[`direct:${s.symbol}:${s.side}`]) {
                    msgExecutedMap[s.symbol] = executedMarkers[`direct:${s.symbol}:${s.side}`];
                    continue;
                  }
                  // Layer 3: localStorage by symbol:side (survives reloads)
                  const stored = isMarkerExecutedInStorage(s.symbol, s.side);
                  if (stored) {
                    msgExecutedMap[s.symbol] = stored;
                  }
                }
                return (
                  <>
                    {isMultiStrategy && hasSelection && (
                      <div style={{
                        fontSize: '11px', fontWeight: 600, color: '#22d3ee',
                        marginBottom: '8px', letterSpacing: '0.05em',
                        textTransform: 'uppercase', paddingTop: '4px',
                      }}>
                        ✓ Selected: {msgBlocks[selectedBlockIdx!].strategy || `Strategy ${Number(selectedBlockIdx) + 1}`}
                      </div>
                    )}
                    <InlineTradeButtons
                      suggestions={suggestions}
                      choiceSuggestions={choices}
                      enabled={tier !== 'silver'}
                      onTrade={(sym, sd, sh, am) => handleTradeAction(sym, sd, sh, am, msg.id)}
                      executedMap={msgExecutedMap}
                    />
                  </>
                );
              })()}
                {loading && i === messages.length - 1 && checklistItems.length === 0 && (
                  <span style={{ display: 'inline-block', width: '2px', height: '14px', background: '#22d3ee', marginLeft: '2px', verticalAlign: 'middle', animation: 'blink 1s step-end infinite' }} />
                )}
            </div>
            {/* Multi-strategy cards — BELOW the bubble, never inside */}
            {(() => {
              if (!msg.id) return null;
              if (tier === 'silver') return null;
              const msgBlocks = parsePortfolioBlocks(msg.content);
              if (msgBlocks.length <= 1) return null;
              const selectedBlockIdx = selectedStrategies[msg.id];
              if (selectedBlockIdx !== undefined) return null; // already selected
              return (
                <StrategyCards
                  blocks={msgBlocks}
                  screeningMeta={screeningMeta}
                  onBuildThis={(block) => {
                    const blockIdx = msgBlocks.indexOf(block);
                    setSelectedStrategies(prev => ({ ...prev, [msg.id!]: blockIdx }));
                  }}
                />
              );
            })()}
            {/* Clarifying options chips — BELOW the bubble, never inside */}
            {/* Stepper mode: sequential one-at-a-time for multi-question messages */}
            {isStepperActive && (
              <ClarifyStepper
                questions={clarifyQueue}
                step={clarifyStep}
                onChipTap={(answer) => {
                  const newAnswers = [...clarifyAnswers, answer];
                  setClarifyAnswers(newAnswers);
                  advanceStepper(newAnswers);
                }}
              />
            )}
            {/* Single-question mode: all chips at once (existing behavior) */}
            {clarifyingOpts && clarifyingOpts.length >= 2 && (
              <ClarifyingOptions
                options={clarifyingOpts}
                onSelect={(opt: ClarifyingOption) => {
                  // "Let me adjust" opens free-text input instead of sending a preset
                  if (opt.label === 'Let me adjust ✎' || opt.label === 'Let me adjust something') {
                    setTimeout(() => inputRef.current?.focus(), 100);
                    return;
                  }
                  // Mark this CLARIFY message as resolved so it won't re-activate on page reload
                  if (msg.id) markClarifyResolved(msg.id);
                  sendMessage(opt.fullText, 'chat');
                }}
              />
            )}
          </React.Fragment>
          );
        })}

        {/* Thinking indicator — hidden during progress (ProgressIndicator takes over) */}
        {loading && checklistItems.length === 0 && (
          <div style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '6px', padding: '12px 0 4px' }}>
            <span className="vantage-typing-dot" style={{ animationDelay: '0s' }} />
            <span className="vantage-typing-dot" style={{ animationDelay: '0.2s' }} />
            <span className="vantage-typing-dot" style={{ animationDelay: '0.4s' }} />
            <style>{`
              .vantage-typing-dot {
                width: 6px; height: 6px; border-radius: 50%;
                background: #22d3ee;
                animation: vantageTypingBounce 1.4s ease-in-out infinite;
              }
              @keyframes vantageTypingBounce {
                0%, 60%, 100% { opacity: 0.2; transform: scale(0.9); }
                30% { opacity: 1; transform: scale(1.1); }
              }
            `}</style>
          </div>
        )}

        <div ref={bottomAnchorRef} style={{ height: '1px' }} />

        {/* Scroll-to-bottom button */}
        {showScrollButton && (
          <button onClick={() => { scrollToBottom(true); wasAtBottomRef.current = true; setShowScrollButton(false); }}
            style={{ position: 'absolute', bottom: '16px', right: '16px', width: '36px', height: '36px', borderRadius: '50%', background: 'rgba(26,34,53,0.95)', border: '1px solid rgba(34,211,238,0.3)', color: '#22d3ee', fontSize: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10, boxShadow: '0 2px 12px rgba(0,0,0,0.4)' }}>
            ↓
          </button>
        )}
      </div>

      {/* ── Budget violation warning banner ── */}
      {budgetWarnings && (
        <div style={{
          margin: '0 16px 0 16px',
          padding: '10px 14px',
          background: 'rgba(239,68,68,0.12)',
          border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '8px',
        }}>
          <span style={{ fontSize: '14px', flexShrink: 0 }}>⚠️</span>
          <div style={{ flex: 1 }}>
            <p style={{
              fontSize: '12px',
              color: '#fca5a5',
              fontWeight: 600,
              margin: '0 0 4px 0',
              lineHeight: '1.4',
            }}>
              Budget Mismatch
            </p>
            <p style={{
              fontSize: '11px',
              color: 'rgba(255,255,255,0.7)',
              margin: 0,
              lineHeight: '1.5',
            }}>
              {budgetWarnings.message || 'The generated portfolio total differs from your requested budget.'}
            </p>
          </div>
          <button
            onClick={() => setBudgetWarnings(null)}
            style={{
              background: 'none',
              border: 'none',
              color: 'rgba(255,255,255,0.4)',
              fontSize: '16px',
              cursor: 'pointer',
              padding: '0 4px',
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* ======== MESSAGE THREAD END ======== */}
      </div>

      {/* ======== 3. INPUT ZONE — fixed at bottom with separator ======== */}
      <div style={{ flexShrink: 0, borderTop: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.015)', padding: '18px 16px 20px', paddingBottom: 'calc(20px + env(safe-area-inset-bottom))', position: 'relative', zIndex: 10 }}>
        {/* ── Real-broker trade warning — block execution is in executeTrade(), this is visual ── */}
        {isConnected && brokerMeta && !brokerMeta.tradingEnabled && (
          <div style={{
            fontSize: '11px',
            color: WARNING,
            textAlign: 'center',
            marginBottom: '10px',
            background: 'rgba(245,158,11,0.08)',
            padding: '8px 12px',
            borderRadius: '10px',
            border: '1px solid rgba(245,158,11,0.2)',
            lineHeight: 1.4,
          }}>
            ⚠️ Real order execution not yet available for connected brokers.<br/>
            <span style={{ color: TEXT_DIM, fontSize: '10px' }}>Trade buttons run paper-only demo simulations — no orders are sent to your broker.</span>
          </div>
        )}

        {/* Usage counter — chat + deep (only shown after real data loads, never flashes defaults) */}
        {chatRemaining !== null && deepRemaining !== null && (
        <div style={{
          fontSize: '11px',
          color: (chatRemaining! <= 3 || deepRemaining <= 3) ? WARNING : TEXT_MUTED,
          textAlign: 'center',
          marginBottom: '10px',
          transition: 'color 0.3s ease',
        }}>
          <b style={{ color: chatRemaining! <= 3 ? WARNING : ACCENT }}>
            {chatRemaining}
          </b> messages ·{' '}
          <b style={{ color: deepRemaining! <= 3 ? WARNING : ACCENT }}>
            {deepRemaining!}
          </b> deep analyses remaining today
        </div>
        )}

        {/* Input bar — with Explore button */}
        <div>
          <div className="vantage-input-bar" style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            background: 'rgba(20,28,48,0.9)',
            border: '1.5px solid rgba(34,211,238,0.45)',
            borderRadius: '999px',
            padding: '8px 8px 8px 8px',
            boxShadow: '0 0 20px rgba(34,211,238,0.12)',
          }}>
            {/* Explore button — text-first, falls back to icon-only on narrow screens */}
            <button
              onClick={() => { setShowExplore(!showExplore); setExploreSeenCount(noticedItems.length); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: exploreCompact ? '0px' : '6px',
                background: showExplore ? '#ffffff' : exploreCompact ? 'rgba(34,211,238,0.18)' : 'rgba(255,255,255,0.08)',
                border: showExplore ? '1px solid rgba(0,0,0,0.1)' : exploreCompact ? '1px solid rgba(34,211,238,0.4)' : 'none',
                borderRadius: '999px',
                padding: exploreCompact ? '0px' : '8px 14px',
                width: exploreCompact ? '38px' : 'auto',
                height: exploreCompact ? '38px' : 'auto',
                justifyContent: 'center',
                fontSize: '13px',
                fontWeight: 700,
                color: showExplore ? '#0f172a' : '#fff',
                flexShrink: 0,
                position: 'relative',
                whiteSpace: 'nowrap',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <span style={{ fontSize: '15px', lineHeight: 1 }}>+</span>
              {!exploreCompact && ' Explore'}
              {noticedItems.length > exploreSeenCount && (
                <span style={{
                  position: 'absolute',
                  top: '-2px',
                  right: '-2px',
                  width: '9px',
                  height: '9px',
                  background: WARNING,
                  border: '2px solid #0a0f1e',
                  borderRadius: '50%',
                }} />
              )}
            </button>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => { if (showExplore) setShowExplore(false); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (chatRemaining !== 0) sendMessage(input);
                }
              }}
              placeholder={chatPlaceholder}
              maxLength={500}
              disabled={chatRemaining === 0}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                color: '#ffffff',
                fontSize: '14px',
                outline: 'none',
                fontFamily: 'inherit',
                minWidth: 0,
              }}
            />
            <div
              onClick={() => { if (chatRemaining !== 0 && input.trim()) sendMessage(input); }}
              style={{
                width: '34px',
                height: '34px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: input.trim() && chatRemaining !== 0 ? ACCENT : 'rgba(255,255,255,0.12)',
                borderRadius: '50%',
                fontSize: '15px',
                color: input.trim() && chatRemaining !== 0 ? '#05202a' : 'rgba(255,255,255,0.3)',
                flexShrink: 0,
                cursor: input.trim() && chatRemaining !== 0 ? 'pointer' : 'default',
                fontWeight: 700,
              }}
            >
              ↑
            </div>
          </div>
        </div>
      </div>

      {/* ─── AI Settings Sheet ─── */}
      {showSettings && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 99990 }}
            onClick={() => setShowSettings(false)}
          />
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              zIndex: 99991,
              background: '#10162a',
              borderTop: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '20px 20px 0 0',
              padding: '20px 20px 28px',
              paddingBottom: 'calc(28px + env(safe-area-inset-bottom))',
              maxHeight: '60vh',
              overflowY: 'auto',
            }}
          >
            <div style={{
              width: '36px', height: '4px',
              background: 'rgba(255,255,255,0.2)',
              borderRadius: '999px',
              margin: '0 auto 20px',
            }} />
            <div style={{ fontSize: '10.5px', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: '16px' }}>
              AI Settings
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Usage section — full breakdown */}
              <div style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '12px',
                padding: '14px 16px',
              }}>
                <div style={{ fontSize: '10.5px', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: '12px' }}>
                  Usage
                </div>
                {usageStats ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '12px' }}>
                    {/* Chat messages */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: 'rgba(255,255,255,0.65)' }}>Today&apos;s chat messages</span>
                      <span style={{ color: usageStats.chat.daily.used >= usageStats.chat.daily.limit ? WARNING : '#e2e8f0', fontWeight: 600 }}>
                        {usageStats.chat.daily.used} / {usageStats.chat.daily.limit}
                      </span>
                    </div>
                    {/* Deep analyses */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: 'rgba(255,255,255,0.65)' }}>Today&apos;s deep analyses</span>
                      <span style={{ color: usageStats.deepAnalysis.daily.used >= usageStats.deepAnalysis.daily.limit ? WARNING : '#e2e8f0', fontWeight: 600 }}>
                        {usageStats.deepAnalysis.daily.used} / {usageStats.deepAnalysis.daily.limit}
                      </span>
                    </div>
                    {/* Monthly deep (Silver/Gold) */}
                    {usageStats.deepAnalysis.monthly && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'rgba(255,255,255,0.5)' }}>This month&apos;s deep</span>
                        <span style={{ color: usageStats.deepAnalysis.monthly.used >= usageStats.deepAnalysis.monthly.limit ? WARNING : 'rgba(255,255,255,0.6)', fontWeight: 500 }}>
                          {usageStats.deepAnalysis.monthly.used} / {usageStats.deepAnalysis.monthly.limit}
                        </span>
                      </div>
                    )}
                    {/* Monthly chat (Silver/Gold) */}
                    {usageStats.chat.monthly && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'rgba(255,255,255,0.5)' }}>This month&apos;s chat</span>
                        <span style={{ color: usageStats.chat.monthly.used >= usageStats.chat.monthly.limit ? WARNING : 'rgba(255,255,255,0.6)', fontWeight: 500 }}>
                          {usageStats.chat.monthly.used} / {usageStats.chat.monthly.limit}
                        </span>
                      </div>
                    )}
                    {/* Demo pool */}
                    {usageStats.deepAnalysis.demoPool && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'rgba(255,255,255,0.5)' }}>Trial deep analyses</span>
                        <span style={{ color: usageStats.deepAnalysis.demoPool.used >= usageStats.deepAnalysis.demoPool.limit ? WARNING : 'rgba(255,255,255,0.6)', fontWeight: 500 }}>
                          {usageStats.deepAnalysis.demoPool.used} / {usageStats.deepAnalysis.demoPool.limit}
                        </span>
                      </div>
                    )}
                    {/* Demo pool explanation */}
                    {usageStats.deepAnalysis.demoPool && (
                      <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', lineHeight: '1.4', marginTop: '2px' }}>
                        Up to {usageStats.deepAnalysis.daily.limit} per day, {usageStats.deepAnalysis.demoPool.limit} total for your 30‑day trial.
                      </div>
                    )}
                    {/* Upgrade nudge for Demo/Silver */}
                    {tier !== 'gold' && (
                      (() => {
                        const ds = usageStats.deepAnalysis;
                        const nearPoolLimit = ds.demoPool && (ds.demoPool.limit - ds.demoPool.used) <= 3;
                        const nearMonthlyLimit = ds.monthly && (ds.monthly.limit - ds.monthly.used) <= 3;
                        if (nearPoolLimit || nearMonthlyLimit) {
                          return (
                            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.45)', lineHeight: '1.4', marginTop: '4px' }}>
                              Frequently hitting your limit?{' '}
                              <a href="/plans" style={{ color: ACCENT, textDecoration: 'underline' }}>
                                {tier === 'demo' ? 'Silver includes more daily analysis.' : 'Gold includes more daily analysis.'}
                              </a>
                            </div>
                          );
                        }
                        return null;
                      })()
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.35)' }}>Loading usage data…</div>
                )}
              </div>

              <div style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '12px',
                padding: '14px 16px',
              }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#e2e8f0', marginBottom: '4px' }}>
                  Investor Style Lens
                </div>
                <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', lineHeight: '1.5' }}>
                  Your AI responses are tailored to your investor profile. Update your style in Preferences → Investor Style.
                </div>
              </div>
              <div style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '12px',
                padding: '14px 16px',
              }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#e2e8f0', marginBottom: '4px' }}>
                  Response Detail
                </div>
                <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', lineHeight: '1.5' }}>
                  Default response depth and length preferences. More controls coming soon.
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ─── Explore Bottom Sheet ─── */}
      {showExplore && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            bottom: '80px',
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            zIndex: 9,
            overflow: 'hidden',
          }}
          onClick={() => setShowExplore(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              background: '#10162a',
              borderTop: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '20px 20px 0 0',
              padding: '10px 16px 32px',
              overflowY: 'auto',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            {/* Handle row: drag handle centered + X close button right */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '14px',
              position: 'relative',
            }}>
              <div style={{
                width: '36px',
                height: '4px',
                background: 'rgba(255,255,255,0.2)',
                borderRadius: '999px',
              }} />
              <button
                onClick={(e) => { e.stopPropagation(); setShowExplore(false); }}
                style={{
                  position: 'absolute',
                  right: 0,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: '50%',
                  width: '28px',
                  height: '28px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'rgba(255,255,255,0.6)',
                  fontSize: '14px',
                  cursor: 'pointer',
                  padding: 0,
                  fontFamily: 'inherit',
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            </div>

            {/* ── AI Noticed items (if any) ── */}
            {noticedItems.length > 0 && (
              <>
                <div style={{ fontSize: '10.5px', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', padding: '4px 4px 10px' }}>
                  Suggested for you
                </div>
                {noticedItems.map((item) => {
                  const borderColor = item.variant === 'warn' ? WARNING : item.variant === 'gain' ? GAIN : ACCENT;
                  return (
                    <div key={item.id} style={{ position: 'relative' }}>
                      <div
                        onClick={() => {
                          setShowExplore(false);
                          sendToChat(item.followUp || `Tell me about ${item.title}`);
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '8px',
                          background: GLASS_BG_LIGHTER,
                          borderLeft: `3px solid ${borderColor}`,
                          borderRadius: '12px',
                          padding: '12px 14px',
                          marginBottom: '8px',
                          fontSize: '13.5px',
                          color: TEXT_BODY,
                          cursor: 'pointer',
                        }}
                      >
                        <span style={{ fontSize: '14px', marginTop: '1px' }}>{item.icon}</span>
                        <span style={{ flex: 1 }}>{item.body}</span>
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            setSnoozeTarget(snoozeTarget === item.id ? null : item.id);
                          }}
                          style={{ color: TEXT_DIM, fontSize: '14px', padding: '0 2px', cursor: 'pointer' }}
                        >
                          ×
                        </span>
                      </div>
                      {/* Snooze popover */}
                      {snoozeTarget === item.id && (
                        <>
                          <div
                            style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
                            onClick={() => setSnoozeTarget(null)}
                          />
                          <div style={{
                            position: 'absolute',
                            right: '8px',
                            top: '36px',
                            zIndex: 9999,
                            background: '#1a2235',
                            border: '1px solid rgba(255,255,255,0.15)',
                            borderRadius: '10px',
                            padding: '6px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '2px',
                            minWidth: '170px',
                            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                          }}>
                            {[
                              { label: 'Remind in 3 days', type: '3d' },
                              { label: 'Remind in 1 week', type: '1w' },
                              { label: "Don't remind again", type: 'permanent' },
                            ].map((opt) => (
                              <button
                                key={opt.type}
                                onClick={(e) => { e.stopPropagation(); handleDismiss(item.id, opt.type); }}
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  color: '#cbd5e1',
                                  fontSize: '12px',
                                  padding: '8px 12px',
                                  borderRadius: '6px',
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                  fontFamily: 'inherit',
                                }}
                                onMouseEnter={(e) => { (e.target as HTMLElement).style.background = 'rgba(255,255,255,0.08)'; }}
                                onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </>
            )}

            {/* ── Quick Prompts (suggested chips) ── */}
            <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.06em', color: '#22d3ee', textTransform: 'uppercase', padding: '4px 4px 10px' }}>
              Quick Prompts
            </div>
            {suggestionChips.map((chip) => (
              <div
                key={chip}
                onClick={() => {
                  setShowExplore(false);
                  sendToChat(chip);
                }}
                style={{
                  background: GLASS_BG_LIGHTER,
                  border: `1px solid ${BORDER_MUTED}`,
                  borderRadius: '999px',
                  padding: '10px 16px',
                  marginBottom: '8px',
                  fontSize: '12px',
                  color: 'rgba(255,255,255,0.8)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {chip}
              </div>
            ))}

            {/* Divider */}
            <div style={{ height: '1px', background: 'rgba(255,255,255,0.07)', margin: '4px 0 8px' }} />

            {/* ── Quick Tools ── */}
            <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.06em', color: '#22d3ee', textTransform: 'uppercase', padding: '4px 4px 10px' }}>
              Quick Tools
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {[
                { label: 'Market Pulse', live: true, onClick: (e: React.MouseEvent) => { setShowExplore(false); handleMarketPulse(e); } },
                { label: 'Strategy Ideas', live: false, onClick: () => { setShowExplore(false); sendToChat('Based on my current portfolio and market conditions, what investment strategies should I consider right now? Give me 2-3 specific actionable ideas.'); } },
                { label: 'Tax Check', live: true, onClick: (e: React.MouseEvent) => { setShowExplore(false); sendToChat('Run a tax check on my portfolio — identify any positions with unrealized losses I could harvest, flag wash sale risks, and give me any year-end tax optimization moves to consider.', e); } },
                { label: 'Alerts', live: false, onClick: () => { setShowExplore(false); sendMessage('Scan my portfolio for urgent alerts', 'alerts'); wasAtBottomRef.current = true; scrollToBottom(true); } },
              ].map((action) => (
                <div
                  key={action.label}
                  onClick={action.onClick}
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.07)',
                    borderRadius: '12px',
                    padding: '13px 10px',
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#fff' }}>{action.label}</span>
                  {action.live && (
                    <span style={{
                      fontSize: '8.5px',
                      fontWeight: 700,
                      color: ACCENT,
                      background: 'rgba(34,211,238,0.12)',
                      padding: '1px 5px',
                      borderRadius: '999px',
                      letterSpacing: '0.05em',
                      lineHeight: 1.4,
                    }}>
                      LIVE
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

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

      {/* ======== CHAT WINDOW END ======== */}
      </div>

      {/* ─── Clear Confirm Modal ─── */}
      {showClearConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: '#1a2235', border: '1px solid #2a3448', borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '320px', textAlign: 'center' }}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>🗑️</div>
            <p style={{ fontSize: '16px', fontWeight: '700', color: '#ffffff', marginBottom: '8px' }}>Clear Conversation</p>
            <p style={{ fontSize: '13px', color: '#cbd5e1', marginBottom: '24px', lineHeight: '1.5' }}>This will remove all messages from your current session. This cannot be undone.</p>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={() => setShowClearConfirm(false)} style={{ flex: 1, padding: '12px', background: 'transparent', border: '1px solid #374151', borderRadius: '10px', color: '#94a3b8', fontSize: '14px', cursor: 'pointer' }}>Cancel</button>
              <button onClick={async () => {
                // ── Clear everything: in-memory state, DB, localStorage ──
                const sessionToDelete = currentSessionId;
                setMessages([]);
                setCurrentSessionId(null);
                setShowClearConfirm(false);
                setLoading(false);
                setToast(null);
                greetingFetchedRef.current = false;
                setGreetingLoaded(false);
                charQueueRef.current = [];
                displayedContentRef.current = '';
                streamDoneRef.current = false;
                isDrainingRef.current = false;
                if (userId) {
                  clearUserMessages(userId).catch(e => console.error('[clear] DB clear failed:', e));
                }
                try {
                  const mod = await import('@/lib/chat-history');
                  if (sessionToDelete) mod.deleteSession(sessionToDelete);
                  mod.saveSessions([]);
                } catch {}
              }} style={{ flex: 1, padding: '12px', background: '#ef4444', border: 'none', borderRadius: '10px', color: '#ffffff', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>Clear</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── TradeTicket (inline chat entry) ─── */}
      <TradeTicket
        isOpen={tradeTicket !== null}
        onClose={() => setTradeTicket(null)}
        symbol={tradeTicket?.symbol || ''}
        side={tradeTicket?.side || 'BUY'}
        currentPrice={tradeTicket?.currentPrice || 0}
        sharesHeld={tradeTicket?.sharesHeld || 0}
        availableCash={tradeTicket?.availableCash || 0}
        initialShares={tradeTicket?.initialShares}
        initialAmount={tradeTicket?.initialAmount}
        variant="ai"
        supportsFractional={true}
        onConfirm={async (params) => {
          if (!tradeTicket) return;
          const price = tradeTicket.currentPrice;
          const result = await executeTrade(tradeTicket.symbol, tradeTicket.side, params.shares, price, params.type, params.stopPrice, params.limitPrice, params.timeInForce, undefined, undefined, undefined, tradeTicket.messageId, params.dollarAmount);
          if (!result.success) {
            throw new Error(result.error || 'Order failed');
          }
          // ── Persist marker execution state ──
          // Always update in-memory state to trigger immediate button update.
          // Uses a primary key (messageId:symbol) + fallback key (direct:symbol:side)
          // so the re-render happens regardless of whether messageId is available.
          const execData = { shares: params.shares, amount: params.shares * price, side: tradeTicket.side };
          const update: Record<string, typeof execData> = {
            [`direct:${tradeTicket.symbol}:${tradeTicket.side}`]: execData,
          };
          if (tradeTicket.messageId) {
            update[`${tradeTicket.messageId}:${tradeTicket.symbol}`] = execData;
          }
          setExecutedMarkers(prev => ({ ...prev, ...update }));

          // Persist to DB (only with messageId — DB needs a valid message_id FK)
          if (tradeTicket.messageId) {
            fetch('/api/marker-executions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                message_id: tradeTicket.messageId,
                symbol: tradeTicket.symbol,
                side: tradeTicket.side,
                executed_shares: params.shares,
                executed_amount: params.shares * price,
                order_id: result.orderId || null,
              }),
            }).then(async (res) => {
              if (!res.ok) {
                const errBody = await res.json().catch(() => ({}));
                const detail = errBody?.error || `HTTP ${res.status}`;
                console.error('[marker-exec] POST failed:', detail);
                // Surface to user — this means cross-device buy-button persistence is broken
                setToast(`⚠️ Buy recorded but may not persist across devices`);
                setTimeout(() => setToast(null), 6000);
              }
            }).catch(e => {
              console.error('[marker-exec] Record failed:', e);
              setToast(`⚠️ Buy recorded but persistence failed — check connection`);
              setTimeout(() => setToast(null), 6000);
            });
          }
          // Also update localStorage for InlineTradeButton component persistence
          markMarkerExecuted(tradeTicket.symbol, tradeTicket.side, params.shares, params.shares * price);
        }}
      />

      {/* ── Learning Moment Card ── */}
      {learningCard && (
        <LearningMomentCard card={learningCard} onGotIt={() => dismissLearning(true)} onDismiss={() => dismissLearning(false)} />
      )}

      {/* ── Learning Library Overlay ── */}
      <LearningLibrary open={showLibrary} onClose={() => setShowLibrary(false)} />
      <ChatHistory open={showHistory} onClose={() => setShowHistory(false)} />

    </div>
  );
}
