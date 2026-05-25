import { useCallback, useRef } from 'react';
import { useChatStore, usePortfolioStore, useOrderStore } from '@/store';
import { useAuth } from '@/components/providers/AuthProvider';
import { streamChat, getRemainingCalls, isRateLimited, estimateCost, estimateTokens, type ChatContext } from '@/lib/ai';
import { saveMessage } from '@/lib/supabase/chat';
import type { ChatMessage, AICardComponent } from '@/types';

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
    async (content: string) => {
      if (!content.trim() || isLoading) return;

      // Rate limit check
      if (isRateLimited()) {
        setError('AI cooldown — you\'ve reached 15 calls this hour. Try again later.');
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
            // We access the store directly to get latest state
            const state = useChatStore.getState();
            const msgs = [...state.messages];
            const lastMsg = msgs[msgs.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              const existingComponents = lastMsg.components || [];
              useChatStore.setState({
                messages: msgs.map((m) =>
                  m.id === lastMsg.id
                    ? { ...m, components: [...existingComponents, card] }
                    : m
                ),
              });
            }
          },
          onDone: (tokens, cost: number) => {
            setLastCost(cost);
            setRemainingCalls(getRemainingCalls());
            setLoading(false);

            // Persist AI response to DB (fire-and-forget)
            if (user?.id) {
              const state = useChatStore.getState();
              const lastMsg = state.messages[state.messages.length - 1];
              if (lastMsg?.content) {
                saveMessage({
                  userId: user.id,
                  messageType: 'ai_response',
                  content: lastMsg.content,
                  investorStyle: user.investorStyle || 'buffett',
                });
              }
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
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Connection failed');
        setLoading(false);
      }
    },
    [messages, isLoading, addMessage, appendToLast, setLoading, setError, setLastCost, setRemainingCalls, buildContext]
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
