import { useCallback, useRef, useEffect } from 'react';
import { useChatStore, usePortfolioStore, useOrderStore } from '@/store';
import { useAuth } from '@/components/providers/AuthProvider';
import { streamChat, getRemainingCalls, isRateLimited, estimateCost, estimateTokens, type ChatContext } from '@/lib/ai';
import { saveMessage, getMessages } from '@/lib/supabase/chat';
import type { ChatMessage, AICardComponent } from '@/types';

/** localStorage key — must match store */
const CHAT_STORAGE_KEY = 'vantage:chatMessages';

/**
 * AI Chat hook — manages streaming chat with cost tracking and caching.
 *
 * Passes full portfolio context, investor style, open orders, and
 * market data as input to the AI for deeply personalized advice.
 */
export function useAIChat() {
  const {
    messages,
    isLoading,
    addMessage,
    appendToLast,
    setLoading,
    clearChat,
    lastCost,
    remainingCalls,
    setLastCost,
    setRemainingCalls,
    error,
    setError,
    updateLastMessage,
  } = useChatStore();

  const { account } = usePortfolioStore();
  const { orders } = useOrderStore();
  const { user } = useAuth();
  const abortRef = useRef<AbortController | null>(null);
  const hydratedRef = useRef(false);

  // ─── Hydrate chat messages from DB on mount ──────────────────
  // localStorage is the primary store; DB is used to recover messages
  // when localStorage is empty (new device, incognito, cleared cache).
  useEffect(() => {
    if (!user?.id || hydratedRef.current) return;
    hydratedRef.current = true;

    // Only hydrate if localStorage is empty — avoids overwriting newer data
    const local = typeof window !== 'undefined'
      ? localStorage.getItem(CHAT_STORAGE_KEY)
      : null;
    if (local) {
      // Trim existing localStorage messages to last 10 (5 prompts + 5 responses)
      try {
        const parsed = JSON.parse(local);
        if (Array.isArray(parsed) && parsed.length > 10) {
          const trimmed = parsed.slice(-10);
          localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(trimmed));
        }
      } catch {}
      return;
    }

    getMessages(user.id, 200, 0).then((result) => {
      if (!result?.messages?.length) return;

      // Convert DB format to store format (oldest first for display)
      const dbMessages: ChatMessage[] = result.messages
        .reverse() // DB returns newest first, store wants oldest first
        .map((m: any) => ({
          id: m.id || crypto.randomUUID(),
          role: m.messageType === 'user_message' ? 'user' : 'assistant',
          content: m.content || '',
          timestamp: m.createdAt ? new Date(m.createdAt).getTime() : Date.now(),
        }));

      if (dbMessages.length === 0) return;

      // Keep only last 10 messages (5 prompts + 5 responses)
      const trimmed = dbMessages.slice(-10);

      // Populate store + persist to localStorage
      useChatStore.setState({ messages: trimmed });
      if (typeof window !== 'undefined') {
        localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(trimmed));
      }
    }).catch(() => {}); // Non-fatal — stay with empty chat
  }, [user?.id]);

  const buildContext = useCallback((): ChatContext | undefined => {
    if (!account) return undefined;

    const ctx: ChatContext = {
      portfolio: {
        cash: account.cash,
        equity: account.equity,
        positions: account.positions,
        dayPnlPercent: account.dayPnlPercent,
        totalPnlPercent: account.totalPnlPercent,
        buyingPower: account.buyingPower,
      },
    };

    // Investor style
    if (user?.investorStyle) {
      ctx.investorStyle = user.investorStyle;
    }

    // Open orders (limit to 20 to keep context manageable)
    const openOrders = orders.filter(o => o.status === 'open' || o.status === 'pending');
    if (openOrders.length > 0) {
      ctx.orders = openOrders.slice(0, 20).map(o => ({
        symbol: o.symbol,
        side: o.side,
        type: o.type,
        qty: o.qty,
        status: o.status,
        filledQty: o.filledQty,
        limitPrice: o.limitPrice,
        stopPrice: o.stopPrice,
      }));
    }

    return ctx;
  }, [account, orders, user]);

  const sendMessage = useCallback(
    async (content: string, responseMode?: string, mode?: string, symbol?: string) => {
      if (!content.trim() || isLoading) return;

      // Rate limit check
      if (isRateLimited()) {
        setError('You\'ve reached 75 messages today. Resets at midnight EST.');
        return;
      }

      setError(null);
      setLoading(true);

      // Add user message
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content,
        timestamp: Date.now(),
      };
      addMessage(userMsg);

      // Persist to DB (fire-and-forget)
      if (user?.id) {
        saveMessage({
          userId: user.id,
          messageType: 'user_message',
          content,
          investorStyle: user.investorStyle || 'buffett',
        });
      }

      // Add empty assistant message (will be filled by streaming)
      const aiMsgId = crypto.randomUUID();
      const aiMsg: ChatMessage = {
        id: aiMsgId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      };
      addMessage(aiMsg);

      const context = buildContext();

      // Build messages array for the API
      const apiMessages = [...messages, userMsg].map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));
      apiMessages.push({ role: 'user', content });

      try {
        await streamChat(apiMessages, context, {
          onToken: (token: string) => {
            appendToLast(token);
          },
          onCard: (card: AICardComponent) => {
            // Add card to the last message's components
            const state = useChatStore.getState();
            const msgs = [...state.messages];
            const lastMsg = msgs[msgs.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              const existingComponents = lastMsg.components || [];
              // Check if this is a rebalance plan card with trade data — client-side session
              const isRebalance = card.type === 'rebalance' && (card as any).data?.trades?.length > 0;
              // Always strip JSON blocks from displayed content
              const cleanContent = lastMsg.content.replace(/```json\s*\n[\s\S]*?```\n?/g, '').trim();
              useChatStore.setState({
                messages: msgs.map((m) =>
                  m.id === lastMsg.id
                    ? {
                        ...m,
                        content: cleanContent,
                        components: [...existingComponents, card],
                        // Create client-side session from rebalance card data (no DB needed)
                        rebalanceSession: isRebalance ? {
                          sessionId: `local-${Date.now()}`,
                          summary: (card as any).data?.summary || '',
                          trades: (card as any).data?.trades || [],
                        } : m.rebalanceSession || undefined,
                      }
                    : m
                ),
              });
            }
          },
          onDone: (tokens, cost: number) => {
            setLastCost(cost);
            setRemainingCalls(getRemainingCalls());
            setLoading(false);

            // Always strip any leaked JSON blocks from the last message (safety backstop)
            const state = useChatStore.getState();
            const msgs = [...state.messages];
            const lastMsg = msgs[msgs.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              const cleanContent = lastMsg.content.replace(/```json\s*\n[\s\S]*?```\n?/g, '').trim();
              if (cleanContent !== lastMsg.content) {
                useChatStore.setState({
                  messages: msgs.map((m) =>
                    m.id === lastMsg.id ? { ...m, content: cleanContent } : m
                  ),
                });
              }
            }

            // Persist AI response to DB (fire-and-forget)
            if (user?.id) {
              const freshState = useChatStore.getState();
              const freshLastMsg = freshState.messages[freshState.messages.length - 1];
              if (freshLastMsg?.content) {
                saveMessage({
                  userId: user.id,
                  messageType: 'ai_response',
                  content: freshLastMsg.content,
                  investorStyle: user.investorStyle || 'buffett',
                });
              }
            }

            // Fire-and-forget save to chat history endpoint
            const state2 = useChatStore.getState();
            const lastAi = state2.messages[state2.messages.length - 1];
            const lastUser = [...state2.messages].reverse().find(m => m.role === 'user');
            if (lastAi?.content && lastUser?.content) {
              fetch('/api/chat/history/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  userMessage: lastUser.content,
                  assistantMessage: lastAi.content,
                  mode,
                }),
              }).catch(() => {});
            }
          },
          onSession: (session) => {
            // Attach rebalance session to the last AI message
            const state = useChatStore.getState();
            const msgs = [...state.messages];
            const lastMsg = msgs[msgs.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              // Strip JSON code blocks from displayed content
              const cleanContent = lastMsg.content.replace(/```json\s*\n[\s\S]*?```\n?/g, '').trim();
              useChatStore.setState({
                messages: msgs.map((m) =>
                  m.id === lastMsg.id
                    ? { ...m, content: cleanContent, rebalanceSession: session }
                    : m
                ),
              });
            }
          },
          onBasket: (data) => {
            // Attach theme basket metadata to the last AI message
            const state = useChatStore.getState();
            const msgs = [...state.messages];
            const lastMsg = msgs[msgs.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              useChatStore.setState({
                messages: msgs.map((m) =>
                  m.id === lastMsg.id
                    ? { ...m, type: 'theme_basket', basketId: data.basketId, basketName: data.basketName, stocks: data.stocks }
                    : m
                ),
              });
            }
          },
          onError: (err: string) => {
            setError(err);
            setLoading(false);
            // Update last message with error indication
            const state = useChatStore.getState();
            const msgs = [...state.messages];
            const lastMsg = msgs[msgs.length - 1];
            if (lastMsg && lastMsg.role === 'assistant' && !lastMsg.content) {
              useChatStore.setState({
                messages: msgs.map((m) =>
                  m.id === lastMsg.id
                    ? { ...m, content: '⚠️ ' + err }
                    : m
                ),
              });
            }
          },
        }, responseMode, mode, user?.investorStyle);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Connection failed');
        setLoading(false);
      }
    },
    [messages, isLoading, addMessage, appendToLast, setLoading, setError, setLastCost, setRemainingCalls, buildContext, user?.investorStyle]
  );

  const retry = useCallback(() => {
    if (messages.length < 2) return;
    // Retry last user message
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUserMsg) {
      // Remove last AI response
      const state = useChatStore.getState();
      const msgs = state.messages.filter((m) => m.role === 'user' || m.id !== state.messages[state.messages.length - 1]?.id);
      // Keep only messages before the last user message
      const userIdx = msgs.findIndex((m) => m.id === lastUserMsg.id);
      const trimmedMsgs = msgs.slice(0, userIdx);
      useChatStore.setState({ messages: trimmedMsgs });

      sendMessage(lastUserMsg.content);
    }
  }, [messages, sendMessage]);

  return {
    messages,
    isLoading,
    sendMessage,
    retry,
    clearChat,
    lastCost,
    remainingCalls,
    error,
    setError,
  };
}
