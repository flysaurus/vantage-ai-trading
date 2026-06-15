// ─── Demo Broker ──────────────────────────────────────────────
// Implements BrokerEngine using localStorage for state persistence.
// Uses Finnhub quotes (/api/finnhub/quote?symbol=) for live prices.
// Market hours via getMarketStatus() from lib/market-hours.ts.
//
// When the user connects a live broker later (Phase 5), the context
// swaps DemoBroker → AlpacaBroker with zero UI changes.

import {
  BrokerEngine, OrderRequest, OrderResult,
  BasketOrderRequest, BasketOrderResult,
  BrokerPosition, BrokerOrder, BrokerBasketOrder,
  BrokerAccountSummary, OrderStatus,
  DemoStateInternal,
} from './engine';
import { getMarketStatus } from '@/lib/market-hours';
import { getDemoAccount } from '@/lib/demo-data';
import type { InvestorStyle } from '@/types';

const STORAGE_KEY = 'vantage_demo_state_v3';
const PENDING_KEY = 'vantage_pending_baskets_v2';
const STALE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export class DemoBroker implements BrokerEngine {
  readonly name = 'Demo';
  readonly isDemo = true;
  readonly supportsTrading = true;

  private state: DemoStateInternal;
  private supabase: any;
  private userId: string;

  constructor(userId: string = 'demo_user', supabaseClient?: any) {
    this.userId = userId;
    this.supabase = supabaseClient;
    this.state = this.loadState();
  }

  // ─── MARKET HOURS (delegate to lib/market-hours) ───

  isMarketOpen(): boolean {
    return getMarketStatus().isOpen;
  }

  getNextOpenLabel(): string {
    return getMarketStatus().nextOpenLabel;
  }

  // ─── STATE PERSISTENCE ───

  private loadState(): DemoStateInternal {
    if (typeof window === 'undefined') return this.emptyState();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        const age = Date.now() - (saved.savedAt || 0);
        if (age < STALE_MS && saved.positions?.length > 0) {
          console.log('[DemoBroker] Loaded state:', {
            positions: saved.positions.length,
            cash: saved.cashBalance,
            orders: saved.orders?.length || 0,
          });
          return saved;
        }
      }
    } catch (e) {
      console.error('[DemoBroker] Load error:', e);
    }
    console.log('[DemoBroker] Using empty state — needs seed');
    return this.emptyState();
  }

  private emptyState(): DemoStateInternal {
    return {
      positions: [],
      cashBalance: 65005,
      orders: [],
      basketOrders: [],
      savedAt: Date.now(),
    };
  }

  private async saveState(): Promise<void> {
    try {
      const toSave = { ...this.state, savedAt: Date.now() };
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
      }
      // Sync to Supabase if configured
      if (this.supabase && this.userId !== 'demo_user') {
        try {
          await this.supabase.from('demo_portfolio_state').upsert({
            user_id: this.userId,
            positions: this.state.positions,
            cash_balance: this.state.cashBalance,
            orders: this.state.orders,
            basket_orders: this.state.basketOrders,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id' });
        } catch { /* offline / no table yet */ }
      }
    } catch (e) {
      console.error('[DemoBroker] Save error:', e);
    }
  }

  async loadFromSupabase(): Promise<boolean> {
    if (!this.supabase || this.userId === 'demo_user') return false;
    try {
      const { data } = await this.supabase
        .from('demo_portfolio_state')
        .select('*')
        .eq('user_id', this.userId)
        .single();
      if (data && data.positions?.length > 0) {
        this.state = {
          positions: data.positions,
          cashBalance: data.cash_balance,
          orders: data.orders || [],
          basketOrders: data.basket_orders || [],
          savedAt: new Date(data.updated_at).getTime(),
        };
        if (typeof window !== 'undefined') {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...this.state, savedAt: Date.now() }));
        }
        console.log('[DemoBroker] Restored from Supabase');
        return true;
      }
    } catch (e) {
      console.error('[DemoBroker] Supabase load:', e);
    }
    return false;
  }

  // ─── SEED DEMO DATA ───

  seedFromDemoData(style: InvestorStyle): void {
    const account = getDemoAccount(style, {});
    if (!account) return;

    this.state.positions = (account.positions || []).map((p: any) => ({
      symbol: p.symbol,
      type: 'Stock' as const,
      shares: p.qty,
      avgCost: p.avgCost,
      totalCost: p.qty * p.avgCost,
      buyDate: p.buyDate || '2024-01-01',
      basketId: p.basketId,
      basketName: p.basketName,
      basketEmoji: p.basketEmoji,
    }));

    this.state.cashBalance = account.cash || 65005;

    // Generate FILLED orders from positions
    this.state.orders = this.state.positions.map((p, i) => ({
      id: `demo-${p.symbol}-${i}`,
      symbol: p.symbol,
      side: 'BUY' as const,
      type: 'market' as const,
      status: 'FILLED' as const,
      shares: p.shares,
      submittedPrice: p.avgCost,
      fillPrice: p.avgCost,
      totalCost: p.totalCost,
      submittedAt: new Date(`${p.buyDate}T14:30:00Z`).toISOString(),
      filledAt: new Date(`${p.buyDate}T14:30:00Z`).toISOString(),
    }));

    this.state.basketOrders = [];
    this.state.savedAt = Date.now();
    this.saveState().catch(() => {});
    console.log('[DemoBroker] Seeded from demo-data:', {
      positions: this.state.positions.length,
      cash: this.state.cashBalance,
    });
  }

  // ─── ACCOUNT ───

  async getAccount(): Promise<BrokerAccountSummary> {
    const totalInvested = this.state.positions.reduce((sum, p) => sum + p.totalCost, 0);
    return {
      totalValue: totalInvested + this.state.cashBalance,
      cashBalance: this.state.cashBalance,
      buyingPower: this.state.cashBalance,
      totalInvested,
      totalPnL: 0,
      totalPnLPct: 0,
      todayPnL: 0,
      todayPnLPct: 0,
    };
  }

  // ─── POSITIONS ───

  async getPositions(): Promise<BrokerPosition[]> {
    return this.state.positions;
  }

  // ─── ORDERS ───

  async getOrders(status?: OrderStatus): Promise<BrokerOrder[]> {
    if (!status) return this.state.orders;
    return this.state.orders.filter(o => o.status === status);
  }

  async getBasketOrders(): Promise<BrokerBasketOrder[]> {
    return this.state.basketOrders;
  }

  // ─── FETCH QUOTE ───

  private async fetchQuote(symbol: string): Promise<{ price: number; change: number } | null> {
    try {
      const res = await fetch(`/api/finnhub/quote?symbol=${symbol}`);
      if (!res.ok) return null;
      const data = await res.json();
      if (data.c && typeof data.c === 'number' && data.c > 0) {
        return { price: data.c, change: data.d || 0 };
      }
      return null;
    } catch {
      return null;
    }
  }

  // ─── PLACE ORDER ───

  async placeOrder(req: OrderRequest): Promise<OrderResult> {
    const orderId = crypto.randomUUID();
    const isOpen = this.isMarketOpen();
    const quote = await this.fetchQuote(req.symbol);
    const price = quote?.price || 0;

    if (price === 0) {
      return { success: false, orderId, status: 'REJECTED', message: `Unable to fetch live price for ${req.symbol}` };
    }

    const shares = req.shares || (req.dollarAmount ? req.dollarAmount / price : 0);
    const cost = shares * price;

    // ── BUY ──
    if (req.side === 'BUY') {
      if (cost > this.state.cashBalance) {
        return { success: false, orderId, status: 'REJECTED', message: `Insufficient funds. Need $${cost.toFixed(2)}, have $${this.state.cashBalance.toFixed(2)}` };
      }

      this.state.cashBalance -= cost;

      const order: BrokerOrder = {
        id: orderId,
        symbol: req.symbol,
        side: 'BUY',
        type: req.type,
        status: isOpen ? 'FILLED' : 'OPEN',
        shares,
        submittedPrice: price,
        fillPrice: isOpen ? price : undefined,
        totalCost: cost,
        submittedAt: new Date().toISOString(),
        filledAt: isOpen ? new Date().toISOString() : undefined,
        basketId: req.basketId,
        basketName: req.basketName,
        basketEmoji: req.basketEmoji,
        basketDisplayName: req.basketDisplayName,
        reservedCost: isOpen ? undefined : cost,
        note: isOpen ? undefined : `Pending · ${this.getNextOpenLabel()}`,
      };

      this.state.orders.unshift(order);

      if (isOpen) {
        this.upsertPosition({ symbol: req.symbol, shares, price, cost, basketId: req.basketId, basketName: req.basketName, basketEmoji: req.basketEmoji });
      }

      await this.saveState();

      return {
        success: true, orderId, status: order.status,
        estimatedShares: shares, reservedAmount: cost,
        nextOpenLabel: isOpen ? undefined : this.getNextOpenLabel(),
        fillPrice: isOpen ? price : undefined,
        filledShares: isOpen ? shares : undefined,
        totalCost: cost,
        filledAt: isOpen ? new Date().toISOString() : undefined,
      };
    }

    // ── SELL ──
    const position = this.state.positions.find(p => p.symbol === req.symbol);
    if (!position || position.shares < shares) {
      return { success: false, orderId, status: 'REJECTED', message: `Insufficient shares of ${req.symbol}` };
    }

    const proceeds = shares * price;
    this.removePosition(req.symbol, shares);
    this.state.cashBalance += proceeds;

    const order: BrokerOrder = {
      id: orderId,
      symbol: req.symbol,
      side: 'SELL',
      type: req.type,
      status: 'FILLED',
      shares,
      submittedPrice: price,
      fillPrice: price,
      totalCost: proceeds,
      submittedAt: new Date().toISOString(),
      filledAt: new Date().toISOString(),
    };

    this.state.orders.unshift(order);
    await this.saveState();

    return {
      success: true, orderId, status: 'FILLED',
      fillPrice: price, filledShares: shares,
      totalCost: proceeds,
      filledAt: new Date().toISOString(),
    };
  }

  // ─── PLACE BASKET ORDER ───

  async placeBasketOrder(req: BasketOrderRequest): Promise<BasketOrderResult> {
    const basketOrderId = crypto.randomUUID();
    const isOpen = this.isMarketOpen();

    // Fetch all prices in parallel
    const priceResults = await Promise.allSettled(
      req.stocks.map(s => this.fetchQuote(s.symbol))
    );

    const executionPlan = req.stocks.map((s, i) => {
      const r = priceResults[i];
      const price = r.status === 'fulfilled' ? r.value?.price || 0 : 0;
      const shares = price > 0 ? s.dollarAmount / price : 0;
      return { symbol: s.symbol, price, shares, dollarAmount: s.dollarAmount, allocationPct: s.allocationPct };
    }).filter(s => s.price > 0 && s.shares > 0);

    if (executionPlan.length === 0) {
      return { success: false, basketOrderId, status: 'REJECTED', orders: [], totalReserved: 0, message: 'All stocks failed to fetch prices' };
    }

    const totalCost = executionPlan.reduce((sum, s) => sum + s.dollarAmount, 0);
    if (totalCost > this.state.cashBalance) {
      return { success: false, basketOrderId, status: 'REJECTED', orders: [], totalReserved: totalCost, message: `Insufficient funds. Need $${totalCost.toFixed(2)}, have $${this.state.cashBalance.toFixed(2)}` };
    }

    // Reserve cash
    this.state.cashBalance -= totalCost;

    // Create individual orders
    const orders: BrokerOrder[] = executionPlan.map(s => ({
      id: crypto.randomUUID(),
      symbol: s.symbol,
      side: 'BUY' as const,
      type: 'market' as const,
      status: (isOpen ? 'FILLED' : 'OPEN') as OrderStatus,
      shares: s.shares,
      submittedPrice: s.price,
      fillPrice: isOpen ? s.price : undefined,
      totalCost: s.dollarAmount,
      submittedAt: new Date().toISOString(),
      filledAt: isOpen ? new Date().toISOString() : undefined,
      basketOrderId,
      basketId: req.basketId,
      basketName: req.basketName,
      basketEmoji: req.basketEmoji,
      basketDisplayName: req.basketDisplayName,
      reservedCost: isOpen ? undefined : s.dollarAmount,
      note: isOpen ? undefined : `Pending · ${this.getNextOpenLabel()}`,
    }));

    const basketOrder: BrokerBasketOrder = {
      id: basketOrderId,
      basketId: req.basketId,
      basketName: req.basketName,
      basketEmoji: req.basketEmoji,
      basketDisplayName: req.basketDisplayName,
      status: isOpen ? 'FILLED' : 'OPEN',
      orders,
      totalReserved: totalCost,
      totalFilled: isOpen ? totalCost : undefined,
      submittedAt: new Date().toISOString(),
      filledAt: isOpen ? new Date().toISOString() : undefined,
      nextOpenLabel: isOpen ? undefined : this.getNextOpenLabel(),
    };

    this.state.orders.unshift(...orders);
    this.state.basketOrders.unshift(basketOrder);

    // If market open: add positions now
    if (isOpen) {
      let executed = 0;
      let totalSpent = 0;
      for (const s of executionPlan) {
        try {
          this.upsertPosition({
            symbol: s.symbol, shares: s.shares, price: s.price,
            cost: s.dollarAmount, basketId: req.basketId,
            basketName: req.basketName, basketEmoji: req.basketEmoji,
          });
          executed++;
          totalSpent += s.dollarAmount;
        } catch { /* position create failed */ }
      }
      await this.saveState();

      return {
        success: executed > 0, basketOrderId, status: 'FILLED',
        orders: orders.map(o => ({ success: true, orderId: o.id, status: 'FILLED' as OrderStatus, estimatedShares: o.shares, reservedAmount: o.totalCost, fillPrice: o.fillPrice, filledShares: o.shares, totalCost: o.totalCost, filledAt: o.filledAt })),
        totalReserved: totalCost, totalSpent, executed, failed: executionPlan.length - executed,
      };
    }

    // Market closed — store as pending
    await this.saveState();

    // Save to pending baskets key (legacy compat)
    try {
      if (typeof window !== 'undefined') {
        const raw = localStorage.getItem(PENDING_KEY);
        const pending = raw ? JSON.parse(raw) : [];
        pending.push({
          id: basketOrderId,
          basketName: req.basketName,
          basketEmoji: req.basketEmoji,
          basketDisplayName: req.basketDisplayName,
          stocks: executionPlan,
          totalReserved: totalCost,
          status: 'OPEN',
          submittedAt: new Date().toISOString(),
          nextOpenLabel: this.getNextOpenLabel(),
        });
        localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
      }
    } catch { /* ignore */ }

    return {
      success: true, basketOrderId, status: 'OPEN',
      orders: orders.map(o => ({ success: true, orderId: o.id, status: 'OPEN' as OrderStatus, estimatedShares: o.shares, reservedAmount: o.totalCost, nextOpenLabel: this.getNextOpenLabel() })),
      totalReserved: totalCost, nextOpenLabel: this.getNextOpenLabel(),
      executed: executionPlan.length, failed: 0,
    };
  }

  // ─── CANCEL ───

  async cancelOrder(orderId: string): Promise<{ success: boolean; message?: string }> {
    const order = this.state.orders.find(o => o.id === orderId);
    if (!order || order.status !== 'OPEN') {
      return { success: false, message: 'Order not found or already filled/cancelled' };
    }

    if (order.side === 'BUY') {
      this.state.cashBalance += order.reservedCost || order.totalCost;
    }
    order.status = 'CANCELLED';
    order.cancelledAt = new Date().toISOString();
    await this.saveState();
    return { success: true };
  }

  async cancelBasketOrder(basketOrderId: string): Promise<{ success: boolean; message?: string }> {
    const bo = this.state.basketOrders.find(b => b.id === basketOrderId);
    if (!bo || bo.status !== 'OPEN') {
      return { success: false, message: 'Basket order not found or already filled/cancelled' };
    }

    // Release reserved cash
    this.state.cashBalance += bo.totalReserved;

    // Cancel all individual OPEN orders in basket
    for (const order of this.state.orders) {
      if (order.basketOrderId === basketOrderId && order.status === 'OPEN') {
        order.status = 'CANCELLED';
        order.cancelledAt = new Date().toISOString();
      }
    }

    bo.status = 'CANCELLED';
    bo.cancelledAt = new Date().toISOString();
    await this.saveState();
    return { success: true };
  }

  // ─── EXECUTE PENDING ORDERS (market opens) ───

  async executePendingOrders(): Promise<number> {
    if (!this.isMarketOpen()) return 0;

    let filled = 0;
    const pendingBaskets = this.state.basketOrders.filter(b => b.status === 'OPEN');

    for (const basket of pendingBaskets) {
      const pendingOrders = this.state.orders.filter(
        o => o.basketOrderId === basket.id && o.status === 'OPEN'
      );
      let basketFilled = 0;

      for (const order of pendingOrders) {
        try {
          const quote = await this.fetchQuote(order.symbol);
          const fillPrice = quote?.price || order.submittedPrice;
          const shares = order.reservedCost ? order.reservedCost / fillPrice : order.totalCost / fillPrice;

          order.status = 'FILLED';
          order.fillPrice = fillPrice;
          order.shares = shares;
          order.filledAt = new Date().toISOString();
          order.note = undefined;

          this.upsertPosition({
            symbol: order.symbol,
            shares,
            price: fillPrice,
            cost: order.reservedCost || order.totalCost,
            basketId: basket.basketId,
            basketName: basket.basketName,
            basketEmoji: basket.basketEmoji,
          });
          filled++;
          basketFilled++;
        } catch (e) {
          console.error(`[DemoBroker] Failed to fill ${order.symbol}:`, e);
        }
      }

      if (basketFilled > 0) {
        basket.status = 'FILLED';
        basket.filledAt = new Date().toISOString();
      }
    }

    // Execute individual pending orders
    const pendingOrders = this.state.orders.filter(
      o => o.status === 'OPEN' && !o.basketOrderId
    );
    for (const order of pendingOrders) {
      try {
        const quote = await this.fetchQuote(order.symbol);
        const fillPrice = quote?.price || order.submittedPrice;

        if (order.side === 'BUY') {
          const shares = order.reservedCost ? order.reservedCost / fillPrice : order.totalCost / fillPrice;
          order.status = 'FILLED';
          order.fillPrice = fillPrice;
          order.shares = shares;
          order.filledAt = new Date().toISOString();
          order.note = undefined;
          this.upsertPosition({
            symbol: order.symbol, shares,
            price: fillPrice, cost: order.reservedCost || order.totalCost,
          });
          filled++;
        }
      } catch (e) {
        console.error(`[DemoBroker] Failed to fill ${order.symbol}:`, e);
      }
    }

    if (filled > 0) {
      await this.saveState();
      console.log(`[DemoBroker] Executed ${filled} pending orders`);
    }
    return filled;
  }

  // ─── PRIVATE HELPERS ───

  private upsertPosition(params: {
    symbol: string;
    shares: number;
    price: number;
    cost: number;
    basketId?: string;
    basketName?: string;
    basketEmoji?: string;
  }): void {
    const idx = this.state.positions.findIndex(
      p => p.symbol === params.symbol && p.basketId === (params.basketId || undefined)
    );
    if (idx >= 0) {
      const p = this.state.positions[idx];
      const newShares = p.shares + params.shares;
      const newCost = p.totalCost + params.cost;
      p.shares = newShares;
      p.totalCost = newCost;
      p.avgCost = newCost / newShares;
    } else {
      this.state.positions.push({
        symbol: params.symbol,
        type: 'Stock',
        shares: params.shares,
        avgCost: params.price,
        totalCost: params.cost,
        buyDate: new Date().toISOString(),
        basketId: params.basketId,
        basketName: params.basketName,
        basketEmoji: params.basketEmoji,
      });
    }
  }

  private removePosition(symbol: string, shares: number, basketId?: string): void {
    const idx = this.state.positions.findIndex(
      p => p.symbol === symbol && (basketId === undefined || p.basketId === basketId)
    );
    if (idx === -1) return;
    const pos = this.state.positions[idx];
    if (shares >= pos.shares) {
      this.state.positions.splice(idx, 1);
    } else {
      pos.shares -= shares;
      pos.totalCost = pos.shares * pos.avgCost;
    }
  }

  // ─── RAW STATE ACCESS (for context to read/sync) ───

  getRawState(): Readonly<DemoStateInternal> {
    return this.state;
  }

  getPendingBaskets(): any[] {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      return raw ? JSON.parse(raw).filter((b: any) => b.status === 'OPEN') : [];
    } catch { return []; }
  }
}
