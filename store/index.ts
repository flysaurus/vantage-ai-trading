import { create } from 'zustand';
import type { 
  Quote, MarketIndex, AccountSummary, Order, OrderFormState, 
  ChatMessage, ConfidenceBreakdown, WatchlistItem, Position 
} from '@/types';
import { saveCurrentSession, generateSessionId } from '@/lib/chat-history';

// ─── localStorage helpers ───
const STORAGE_KEYS = {
  watchlist: 'vantage:watchlist',
  indexSymbols: 'vantage:indexSymbols',
  chatMessages: 'vantage:chatMessages',
  chatSessionId: 'vantage:chatSessionId',
} as const;

function loadFromStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const stored = localStorage.getItem(key);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore corrupt data */ }
  return fallback;
}

function saveToStorage(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* ignore quota errors */ }
}

// ─── Persisted defaults ───
const DEFAULT_WATCHLIST: WatchlistItem[] = [];
const DEFAULT_INDEX_SYMBOLS = ['SPY', 'QQQ', 'IWM', 'DIA', 'XLF'];

// ─── Tab State ───
export type TabId = 'ai' | 'invest' | 'portfolio' | 'watchlist' | 'settings';

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
  indexSymbols: string[];
  watchlist: WatchlistItem[];
  quotes: Record<string, Quote>;
  isMarketOpen: boolean;
  setIndexes: (indexes: MarketIndex[]) => void;
  setIndexSymbols: (symbols: string[]) => void;
  setWatchlist: (items: WatchlistItem[]) => void;
  addToWatchlist: (item: WatchlistItem) => void;
  removeFromWatchlist: (symbol: string) => void;
  updateQuote: (symbol: string, quote: Partial<Quote>) => void;
  setMarketOpen: (open: boolean) => void;
}

const initialIndexSymbols = loadFromStorage(STORAGE_KEYS.indexSymbols, DEFAULT_INDEX_SYMBOLS);
const initialWatchlist = loadFromStorage(STORAGE_KEYS.watchlist, DEFAULT_WATCHLIST);

export const useMarketStore = create<MarketStore>((set) => ({
  indexes: [],
  indexSymbols: initialIndexSymbols,
  watchlist: initialWatchlist,
  quotes: {},
  isMarketOpen: false,
  setIndexes: (indexes) => set({ indexes }),
  setIndexSymbols: (symbols) => {
    saveToStorage(STORAGE_KEYS.indexSymbols, symbols);
    set({ indexSymbols: symbols });
  },
  setWatchlist: (items) => {
    saveToStorage(STORAGE_KEYS.watchlist, items);
    set({ watchlist: items });
  },
  addToWatchlist: (item) =>
    set((s) => {
      if (s.watchlist.some(w => w.symbol === item.symbol)) return s;
      const updated = [...s.watchlist, item];
      saveToStorage(STORAGE_KEYS.watchlist, updated);
      return { watchlist: updated };
    }),
  removeFromWatchlist: (symbol) =>
    set((s) => {
      const updated = s.watchlist.filter(w => w.symbol !== symbol);
      saveToStorage(STORAGE_KEYS.watchlist, updated);
      return { watchlist: updated };
    }),
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
  clearAccount: () => void;
  setLoading: (loading: boolean) => void;
  updatePosition: (symbol: string, updates: Partial<Position>) => void;
}

export const usePortfolioStore = create<PortfolioStore>((set) => ({
  account: null,
  loading: false,
  setAccount: (account) => set({ account, loading: false }),
  clearAccount: () => set({ account: null }),
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
  persistChat: () => void;
  sessionCount: number;
  currentSessionId: string;
}

const initialChatMessages = loadFromStorage<ChatMessage[]>(STORAGE_KEYS.chatMessages, []);
const initialSessionId = loadFromStorage<string>(STORAGE_KEYS.chatSessionId, generateSessionId());

export const useChatStore = create<ChatStore>((set) => ({
  messages: initialChatMessages,
  currentSessionId: initialSessionId,
  isLoading: false,
  confidence: null,
  lastCost: 0,
  remainingCalls: 15,
  error: null,
  sessionCount: 1,
  addMessage: (msg) =>
    set((s) => {
      const MAX_MESSAGES = 10; // 5 user prompts + 5 AI responses
      let updated = [...s.messages, msg];
      // Trim oldest messages if we exceed the limit
      if (updated.length > MAX_MESSAGES) {
        updated = updated.slice(updated.length - MAX_MESSAGES);
      }
      saveToStorage(STORAGE_KEYS.chatMessages, updated);
      return { messages: updated };
    }),
  appendToLast: (content) =>
    set((s) => {
      const msgs = [...s.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant') {
        msgs[msgs.length - 1] = { ...last, content: last.content + content };
        // NOTE: do NOT write to localStorage here — called on every token.
        // Persistence happens at stream completion via addMessage → saveToStorage.
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
  clearChat: () => {
    const newId = generateSessionId();
    saveToStorage(STORAGE_KEYS.chatMessages, []);
    saveToStorage(STORAGE_KEYS.chatSessionId, newId);
    set((s) => ({
      messages: [],
      sessionCount: s.sessionCount + 1,
      currentSessionId: newId,
    }));
  },
  persistChat: () => {
    const { messages, currentSessionId } = useChatStore.getState();
    saveToStorage(STORAGE_KEYS.chatMessages, messages);
    // Also save as device-keyed session for history across auth changes
    if (typeof window !== 'undefined' && messages.length > 0) {
      const formatted = messages.map(m => ({
        role: (m.role === 'assistant' ? 'ai' : 'user') as 'user' | 'ai',
        content: m.content,
        timestamp: m.timestamp,
      }));
      saveCurrentSession(currentSessionId, formatted);
    }
  },
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
  timeInForce: 'gtc',
  extendedHours: false,
  bracketOrder: false,
};

export const useOrderFormStore = create<OrderFormStore>((set) => ({
  form: { ...defaultForm },
  updateForm: (updates) => set((s) => ({ form: { ...s.form, ...updates } })),
  resetForm: () => set({ form: { ...defaultForm } }),
  setSymbol: (symbol) => set((s) => ({ form: { ...s.form, symbol } })),
}));
