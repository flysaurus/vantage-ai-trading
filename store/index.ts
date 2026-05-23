import { create } from 'zustand';
import type { 
  Quote, MarketIndex, AccountSummary, Order, OrderFormState, 
  ChatMessage, ConfidenceBreakdown, WatchlistItem, Position 
} from '@/types';

// ─── Tab State ───
export type TabId = 'ai' | 'trade' | 'portfolio' | 'orders' | 'settings';

interface TabStore {
  activeTab: TabId;
  setTab: (tab: TabId) => void;
}

export const useTabStore = create<TabStore>((set) => ({
  activeTab: 'ai',
  setTab: (tab) => set({ activeTab: tab }),
}));

// ─── Market Data ───
interface MarketStore {
  indexes: MarketIndex[];
  watchlist: WatchlistItem[];
  quotes: Record<string, Quote>;
  isMarketOpen: boolean;
  setIndexes: (indexes: MarketIndex[]) => void;
  setWatchlist: (items: WatchlistItem[]) => void;
  updateQuote: (symbol: string, quote: Partial<Quote>) => void;
  setMarketOpen: (open: boolean) => void;
}

export const useMarketStore = create<MarketStore>((set) => ({
  indexes: [],
  watchlist: [],
  quotes: {},
  isMarketOpen: false,
  setIndexes: (indexes) => set({ indexes }),
  setWatchlist: (items) => set({ watchlist: items }),
  updateQuote: (symbol, quote) =>
    set((s) => ({
      quotes: { ...s.quotes, [symbol]: { ...s.quotes[symbol], ...quote } as Quote },
    })),
  setMarketOpen: (open) => set({ isMarketOpen: open }),
}));

// ─── Portfolio ───
interface PortfolioStore {
  account: AccountSummary | null;
  loading: boolean;
  setAccount: (account: AccountSummary) => void;
  setLoading: (loading: boolean) => void;
  updatePosition: (symbol: string, updates: Partial<Position>) => void;
}

export const usePortfolioStore = create<PortfolioStore>((set) => ({
  account: null,
  loading: false,
  setAccount: (account) => set({ account, loading: false }),
  setLoading: (loading) => set({ loading }),
  updatePosition: (symbol, updates) =>
    set((s) => {
      if (!s.account) return s;
      return {
        account: {
          ...s.account,
          positions: s.account.positions.map((p) =>
            p.symbol === symbol ? { ...p, ...updates } : p
          ),
        },
      };
    }),
}));

// ─── Orders ───
interface OrderStore {
  orders: Order[];
  activeFilter: 'open' | 'filled' | 'cancelled' | 'all';
  setOrders: (orders: Order[]) => void;
  addOrder: (order: Order) => void;
  updateOrder: (id: string, updates: Partial<Order>) => void;
  setFilter: (filter: 'open' | 'filled' | 'cancelled' | 'all') => void;
}

export const useOrderStore = create<OrderStore>((set) => ({
  orders: [],
  activeFilter: 'open',
  setOrders: (orders) => set({ orders }),
  addOrder: (order) => set((s) => ({ orders: [order, ...s.orders] })),
  updateOrder: (id, updates) =>
    set((s) => ({
      orders: s.orders.map((o) => (o.id === id ? { ...o, ...updates } : o)),
    })),
  setFilter: (filter) => set({ activeFilter: filter }),
}));

// ─── AI Chat ───
interface ChatStore {
  messages: ChatMessage[];
  isLoading: boolean;
  confidence: ConfidenceBreakdown | null;
  lastCost: number;
  remainingCalls: number;
  error: string | null;
  addMessage: (msg: ChatMessage) => void;
  appendToLast: (content: string) => void;
  updateLastMessage: (updates: Partial<ChatMessage>) => void;
  setLoading: (loading: boolean) => void;
  setConfidence: (c: ConfidenceBreakdown) => void;
  setLastCost: (cost: number) => void;
  setRemainingCalls: (calls: number) => void;
  setError: (error: string | null) => void;
  clearChat: () => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  messages: [],
  isLoading: false,
  confidence: null,
  lastCost: 0,
  remainingCalls: 15,
  error: null,
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  appendToLast: (content) =>
    set((s) => {
      const msgs = [...s.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant') {
        msgs[msgs.length - 1] = { ...last, content: last.content + content };
      }
      return { messages: msgs };
    }),
  updateLastMessage: (updates) =>
    set((s) => {
      const msgs = [...s.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant') {
        msgs[msgs.length - 1] = { ...last, ...updates };
      }
      return { messages: msgs };
    }),
  setLoading: (loading) => set({ isLoading: loading }),
  setConfidence: (c) => set({ confidence: c }),
  setLastCost: (cost) => set({ lastCost: cost }),
  setRemainingCalls: (calls) => set({ remainingCalls: calls }),
  setError: (error) => set({ error }),
  clearChat: () => set({ messages: [] }),
}));

// ─── Order Form (Trade Tab) ───
interface OrderFormStore {
  form: OrderFormState;
  updateForm: (updates: Partial<OrderFormState>) => void;
  resetForm: () => void;
  setSymbol: (symbol: string) => void;
}

const defaultForm: OrderFormState = {
  symbol: '',
  side: 'buy',
  type: 'market',
  qty: 0,
  qtyType: 'shares',
  timeInForce: 'day',
  extendedHours: false,
  bracketOrder: false,
};

export const useOrderFormStore = create<OrderFormStore>((set) => ({
  form: { ...defaultForm },
  updateForm: (updates) => set((s) => ({ form: { ...s.form, ...updates } })),
  resetForm: () => set({ form: { ...defaultForm } }),
  setSymbol: (symbol) => set((s) => ({ form: { ...s.form, symbol } })),
}));
