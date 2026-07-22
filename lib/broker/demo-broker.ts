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
import { evaluateOpenOrder } from './fill-engine';
import { sendOrderNotification, sendBasketNotification } from '@/lib/notifications';
import { getMarketStatus } from '@/lib/market-hours';
import { getDemoAccount } from '@/lib/demo-data';
import type { InvestorStyle } from '@/types';

const STORAGE_KEY = 'vantage_demo_state_v3';
const STALE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export class DemoBroker implements BrokerEngine {
  readonly name = 'Demo';
  readonly isDemo = true;
  readonly supportsTrading = true;

  private state: DemoStateInternal;
  private supabase: any;
  private userId: string;
  private userEmail?: string;

  constructor(userId: string = 'demo_user', supabaseClient?: any, userEmail?: string) {
    this.userId = userId;
    this.supabase = supabaseClient;
    this.userEmail = userEmail;
    this.state = this.loadState();
  }

  /** Update cached broker's email — user may not be available on first construction */
  setUserEmail(email: string): void {
    this.userEmail = email;
  }

  setUserId(userId: string): void {
    this.userId = userId;
  }

  setSupabase(client: any): void {
    this.supabase = client;
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
          // Ensure all loaded positions have name/sector fields (patch pre-fix localStorage)
          saved.positions = saved.positions.map((p: any) => ({ ...p, name: p.name || p.symbol, sector: p.sector || '' }));
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
      cashBalance: 0,
      orders: [],
      basketOrders: [],
      savedAt: Date.now(),
    };
  }

  private saveLocalOnly(): void {
    try {
      const toSave = { ...this.state, savedAt: Date.now() };
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
      }
    } catch (e) {
      console.error('[DemoBroker] Local save error:', e);
    }
  }

  // ── Basket holdings sync (Supabase basket_holdings table, replaces localStorage) ──
  private async syncBasketHoldings(
    basketId: string,
    mode: 'upsert' | 'delete' | 'activatePending',
    positions?: Array<{
      symbol: string;
      shares?: number;
      avgCost?: number;
      totalCost?: number;
      allocationPct?: number;
      status: 'active' | 'pending' | 'filled' | 'closed' | 'sold' | 'cancelled';
      basketName?: string;
      emoji?: string;
      name?: string;
      sector?: string;
      reservedAmount?: number;
      nextOpenLabel?: string;
      boughtAt?: string;
      basketOrderId?: string;
      basketDisplayName?: string;
    }>,
  ): Promise<void> {
    if (!this.supabase || this.userId === 'demo_user') return;

    try {
      if (mode === 'delete') {
        await this.supabase.from('basket_holdings')
          .delete()
          .eq('basket_id', basketId)
          .eq('user_id', this.userId);
        return;
      }

      if (mode === 'activatePending') {
        // Sync ALL positions for this basket (post-merge) — not just the newly filled orders
        const allPositions = this.state.positions.filter(
          (p: any) => p.basketId === basketId,
        );
        const totalValue = allPositions.reduce((sum: number, p: any) => sum + (p.shares * p.avgCost), 0);
        for (const p of allPositions) {
          await this.supabase.from('basket_holdings').upsert({
            user_id: this.userId,
            basket_id: basketId,
            symbol: p.symbol,
            shares: p.shares,
            avg_cost: p.avgCost,
            total_cost: p.shares * p.avgCost,
            allocation_pct: totalValue > 0 ? Math.round((p.shares * p.avgCost / totalValue) * 10000) / 100 : 0,
            status: 'active',
            bought_at: new Date().toISOString(),
          }, { onConflict: 'basket_id,symbol,user_id' });
        }
        return;
      }

      // mode === 'upsert'
      if (!positions?.length) return;

      const rows = positions.map(p => ({
        user_id: this.userId,
        basket_id: basketId,
        basket_order_id: p.basketOrderId || null,
        symbol: p.symbol,
        name: p.name || null,
        sector: p.sector || null,
        basket_name: p.basketName || null,
        emoji: p.emoji || null,
        shares: p.shares ?? 0,
        avg_cost: p.avgCost ?? 0,
        total_cost: p.totalCost ?? 0,
        reserved_amount: p.reservedAmount ?? 0,
        allocation_pct: p.allocationPct ?? 0,
        status: p.status,
        next_open_label: p.nextOpenLabel || null,
        bought_at: p.boughtAt || new Date().toISOString(),
      }));

      const { error } = await this.supabase.from('basket_holdings').upsert(rows, {
        onConflict: 'basket_id,symbol,user_id',
      });
      if (error) throw error;
    } catch (err: any) {
      console.error('[DemoBroker] Basket holdings sync failed:', err?.message || err);
      throw err; // No localStorage fallback — fail explicitly
    }
  }

  private async saveState(): Promise<void> {
    // 1. Save to localStorage (non-critical — Supabase is authoritative)
    try {
      const toSave = { ...this.state, savedAt: Date.now() };
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
      }
    } catch (e) {
      console.error('[DemoBroker] localStorage save failed:', e);
    }

    // 2. Sync to Supabase if configured (runs even if localStorage fails)
    if (this.supabase && this.userId !== 'demo_user') {
      try {
        const normalizedPositions = this.state.positions.map((p: any) => ({
          ...p,
          qty: p.qty ?? p.shares ?? 0,
        }));
        await this.supabase.from('demo_portfolio_state').upsert({
          user_id: this.userId,
          positions: normalizedPositions,
          cash_balance: this.state.cashBalance,
          order_history: this.state.orders,       // canonical: full BrokerOrder[]
          basket_orders: this.state.basketOrders,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
      } catch (err: any) {
        console.error('[DemoBroker] Supabase sync failed:', err?.message || err);
      }
    }
  }

  async loadFromSupabase(): Promise<boolean> {
    if (!this.supabase || this.userId === 'demo_user') {
      console.log('[DemoBroker] loadFromSupabase SKIP — no supabase client or demo user');
      return false;
    }
    try {
      console.log('[DemoBroker] loadFromSupabase — querying demo_portfolio_state for user:', this.userId);
      const { data, error } = await this.supabase
        .from('demo_portfolio_state')
        .select('order_history, positions, cash_balance, basket_orders, updated_at')
        .eq('user_id', this.userId)
        .single();
      console.log('[DemoBroker] loadFromSupabase — result:', { hasData: !!data, error: error?.message, basketOrdersCount: data?.basket_orders?.length, positionsCount: data?.positions?.length, cashBalance: data?.cash_balance });
      if (data) {
        // Single canonical column: order_history (BrokerOrder[] format).
        // Normalize createdAt→submittedAt for legacy DemoOrder-format records.
        const rawOrders: any[] = data.order_history || [];
        const canonicalOrders = rawOrders.map((o: any) => ({
          ...o,
          submittedAt: o.submittedAt || o.createdAt || o.submitted_at,
        }));
        const restoredBasketOrders = data.basket_orders || [];
        console.log('[DemoBroker] loadFromSupabase — restoring basketOrders:', restoredBasketOrders.length, 'names:', restoredBasketOrders.map((bo: any) => bo.name || bo.basketName));
        this.state = {
          positions: (data.positions as any[]).map((p: any) => ({
            ...p,
            shares: p.shares ?? p.qty ?? p.quantity ?? 0, // normalize DemoOrder (qty) → BrokerPosition (shares)
          })),
          cashBalance: data.cash_balance ?? 0,
          orders: canonicalOrders,
          basketOrders: restoredBasketOrders,
          savedAt: new Date(data.updated_at).getTime(),
        };
        if (typeof window !== 'undefined') {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...this.state, savedAt: Date.now() }));
        }
        console.log('[DemoBroker] Restored from Supabase — positions:', this.state.positions.length, 'basketOrders:', this.state.basketOrders.length, 'orders:', this.state.orders.length);
        return true;
      } else {
        console.log('[DemoBroker] loadFromSupabase — no row found for this user');
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
      name: p.name || p.symbol,
      sector: p.sector,
      type: 'Stock' as const,
      shares: p.qty,
      avgCost: p.avgCost,
      totalCost: p.qty * p.avgCost,
      buyDate: p.buyDate || '2024-01-01',
      basketId: p.basketId,
      basketName: p.basketName,
      basketEmoji: p.basketEmoji,
    }));

    this.state.cashBalance = account.cash || 0;

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

    this.state.basketOrders = this.state.basketOrders || []; // preserve basket orders restored from Supabase
    this.state.savedAt = Date.now();
    // Do NOT call saveState() — seeds are for localStorage only.
    // Supabase is the authoritative store; pushing seeds would overwrite
    // real user portfolio data on every stale-cache-clear cycle.
    this.saveLocalOnly();
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

  setBasketOrders(orders: BrokerBasketOrder[]): void {
    this.state.basketOrders = orders;
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

    // Order type handling — supports market, limit, stop, stop_limit
    const isStopType = req.type === 'stop' || req.type === 'stop_limit';
    const hasLimit = req.type === 'limit' || req.type === 'stop_limit';
    const limitPriceVal = hasLimit && req.limitPrice != null && req.limitPrice > 0 ? req.limitPrice : undefined;
    const stopPriceVal = isStopType && req.stopPrice != null && req.stopPrice > 0 ? req.stopPrice : undefined;
    const submitPrice = hasLimit ? (limitPriceVal || price) : (isStopType ? (stopPriceVal || price) : price);
    const tif = req.timeInForce || 'day';

    // Stop orders: check if stop is already triggered at current price
    let stopTriggered = false;
    if (isStopType && stopPriceVal) {
      stopTriggered = req.side === 'BUY'
        ? price >= stopPriceVal   // stop-buy triggers when price rises to stop
        : price <= stopPriceVal;  // stop-sell triggers when price falls to stop
    }

    // Can fill now?
    let canFillNow = false;
    if (isOpen) {
      if (req.type === 'market') {
        canFillNow = true;
      } else if (req.type === 'limit') {
        canFillNow = req.side === 'BUY' ? price <= (limitPriceVal || price) : price >= (limitPriceVal || price);
      } else if (req.type === 'stop' && stopTriggered) {
        canFillNow = true; // triggered stop → market fill
      } else if (req.type === 'stop_limit' && stopTriggered) {
        canFillNow = req.side === 'BUY' ? price <= (limitPriceVal || price) : price >= (limitPriceVal || price);
      }
    }

    // ── BUY ──
    if (req.side === 'BUY') {
      if (cost > this.state.cashBalance) {
        return { success: false, orderId, status: 'REJECTED', message: `Insufficient funds. Need $${cost.toFixed(2)}, have $${this.state.cashBalance.toFixed(2)}` };
      }

      this.state.cashBalance -= cost;

      let buyNote: string | undefined;
      if (!canFillNow) {
        if (isStopType && !stopTriggered) {
          buyNote = `Stop $${(stopPriceVal || price).toFixed(2)} · last $${price.toFixed(2)} · ${tif.toUpperCase()}`;
        } else if (req.type === 'limit' && limitPriceVal) {
          buyNote = `Limit $${limitPriceVal.toFixed(2)} not met · last $${price.toFixed(2)} · ${tif.toUpperCase()}`;
        } else if (req.type === 'stop_limit' && stopTriggered && limitPriceVal) {
          buyNote = `Stop triggered, limit $${limitPriceVal.toFixed(2)} not met · last $${price.toFixed(2)}`;
        } else {
          buyNote = `Pending · ${this.getNextOpenLabel()} · ${tif.toUpperCase()}`;
        }
      }

      const order: BrokerOrder = {
        id: orderId,
        symbol: req.symbol,
        side: 'BUY',
        type: req.type,
        status: canFillNow ? 'FILLED' : 'OPEN',
        shares,
        submittedPrice: submitPrice,
        limitPrice: limitPriceVal,
        stopPrice: stopPriceVal,
        timeInForce: tif,
        fillPrice: canFillNow ? price : undefined,
        totalCost: cost,
        submittedAt: new Date().toISOString(),
        filledAt: canFillNow ? new Date().toISOString() : undefined,
        basketId: req.basketId,
        basketName: req.basketName,
        basketEmoji: req.basketEmoji,
        basketDisplayName: req.basketDisplayName,
        reservedCost: canFillNow ? undefined : cost,
        note: buyNote,
      };

      this.state.orders.unshift(order);

      // ── Notify: order acknowledged ──
      if (this.userEmail) {
        sendOrderNotification(this.userEmail, {
          type: order.status === 'FILLED' ? 'order_filled' : 'order_acknowledged',
          orderId: order.id,
          symbol: order.symbol,
          side: order.side,
          orderType: order.type,
          shares: order.shares,
          fillPrice: order.status === 'FILLED' ? order.fillPrice : undefined,
          submittedPrice: submitPrice,
          limitPrice: limitPriceVal,
          stopPrice: stopPriceVal,
          details: order.note,
        }).catch(() => {}); // fire-and-forget
      }

      if (canFillNow) {
        this.upsertPosition({ symbol: req.symbol, shares, price, cost, basketId: req.basketId, basketName: req.basketName, basketEmoji: req.basketEmoji });
      }

      await this.saveState();

      return {
        success: true, orderId, status: order.status,
        estimatedShares: shares, reservedAmount: cost,
        nextOpenLabel: canFillNow ? undefined : this.getNextOpenLabel(),
        fillPrice: canFillNow ? price : undefined,
        filledShares: canFillNow ? shares : undefined,
        totalCost: cost,
        filledAt: canFillNow ? new Date().toISOString() : undefined,
      };
    }

    // ── SELL ──
    const position = this.state.positions.find(p => p.symbol === req.symbol);
    // Account for shares already reserved by other OPEN sell orders
    const reservedSellShares = this.state.orders
      .filter(o => o.symbol === req.symbol && o.side === 'SELL' && o.status === 'OPEN')
      .reduce((sum, o) => sum + (o.reservedShares || 0), 0);
    const availableShares = (position?.shares || 0) - reservedSellShares;
    if (!position || availableShares < shares) {
      return { success: false, orderId, status: 'REJECTED',
        message: reservedSellShares > 0
          ? `Insufficient shares of ${req.symbol}. Hold ${position?.shares || 0}, ${reservedSellShares} reserved by pending orders, ${availableShares} available`
          : `Insufficient shares of ${req.symbol}` };
    }

    const proceeds = shares * price;

    let sellNote: string | undefined;
    if (!canFillNow) {
      if (isStopType && !stopTriggered) {
        sellNote = `Stop $${(stopPriceVal || price).toFixed(2)} · last $${price.toFixed(2)} · ${tif.toUpperCase()}`;
      } else if (req.type === 'limit' && limitPriceVal) {
        sellNote = `Limit $${limitPriceVal.toFixed(2)} not met · last $${price.toFixed(2)} · ${tif.toUpperCase()}`;
      } else if (req.type === 'stop_limit' && stopTriggered && limitPriceVal) {
        sellNote = `Stop triggered, limit $${limitPriceVal.toFixed(2)} not met · last $${price.toFixed(2)}`;
      } else {
        sellNote = `Pending · ${this.getNextOpenLabel()} · ${tif.toUpperCase()}`;
      }
    }

    const order: BrokerOrder = {
      id: orderId,
      symbol: req.symbol,
      side: 'SELL',
      type: req.type,
      status: canFillNow ? 'FILLED' : 'OPEN',
      shares,
      submittedPrice: submitPrice,
      limitPrice: limitPriceVal,
      stopPrice: stopPriceVal,
      timeInForce: tif,
      fillPrice: canFillNow ? price : undefined,
      totalCost: proceeds,
      submittedAt: new Date().toISOString(),
      filledAt: canFillNow ? new Date().toISOString() : undefined,
      note: sellNote,
      reservedShares: canFillNow ? undefined : shares,
    };

    if (canFillNow) {
      this.removePosition(req.symbol, shares);
      this.state.cashBalance += proceeds;
    }

    this.state.orders.unshift(order);

    // ── Notify: order acknowledged ──
    if (this.userEmail) {
      sendOrderNotification(this.userEmail, {
        type: order.status === 'FILLED' ? 'order_filled' : 'order_acknowledged',
        orderId: order.id,
        symbol: order.symbol,
        side: order.side,
        orderType: order.type,
        shares: order.shares,
        fillPrice: order.status === 'FILLED' ? order.fillPrice : undefined,
        submittedPrice: submitPrice,
        limitPrice: limitPriceVal,
        stopPrice: stopPriceVal,
        details: order.note,
      }).catch(() => {});
    }

    await this.saveState();

    return {
      success: true, orderId, status: order.status,
      fillPrice: canFillNow ? price : undefined,
      filledShares: canFillNow ? shares : undefined,
      totalCost: proceeds,
      filledAt: canFillNow ? new Date().toISOString() : undefined,
      nextOpenLabel: canFillNow ? undefined : this.getNextOpenLabel(),
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
      const livePrice = r.status === 'fulfilled' ? r.value?.price || 0 : 0;
      const fallback = s.fallbackPrice || 0;
      // Prefer live quote, but use review-step price as fallback if quote fails
      const price = livePrice > 0 ? livePrice : fallback;
      const shares = price > 0 ? s.dollarAmount / price : 0;
      return { symbol: s.symbol, price, shares, dollarAmount: s.dollarAmount, allocationPct: s.allocationPct, usedFallback: livePrice === 0 && fallback > 0 };
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

      // Upsert ALL basket positions into Supabase basket_holdings (merged, not just new)
      try {
        // Build merged position list from broker's in-memory state after upsert,
        // so existing shares are added to, not replaced
        const allPositions = this.state.positions.filter(
          (p: any) => p.basketId === req.basketId,
        );
        const totalValue = allPositions.reduce((sum: number, p: any) => sum + (p.shares * p.avgCost), 0);
        const positions = allPositions.map((p: any) => ({
          symbol: p.symbol,
          shares: p.shares,
          avgCost: p.avgCost,
          totalCost: p.shares * p.avgCost,
          allocationPct: totalValue > 0 ? Math.round((p.shares * p.avgCost / totalValue) * 10000) / 100 : 0,
          status: 'active' as const,
          basketName: req.basketName,
          emoji: req.basketEmoji,
          boughtAt: new Date().toISOString(),
        }));
        await this.syncBasketHoldings(req.basketId, 'upsert', positions);
      } catch (err: any) {
        console.error('[DemoBroker] Failed to sync filled basket holdings:', err?.message || err);
      }

      // ── Notify: basket filled ──
      if (this.userEmail) {
        const failedCount = executionPlan.length - executed;
        sendBasketNotification(this.userEmail, {
          type: failedCount > 0 ? 'basket_partial_fill' : 'basket_filled',
          basketId: req.basketId,
          basketName: req.basketName,
          basketEmoji: req.basketEmoji,
          positions: executionPlan.map(s => ({
            symbol: s.symbol,
            shares: s.shares,
            fillPrice: s.price,
            totalCost: s.dollarAmount,
            status: 'filled' as const,
          })),
          totalInvested: totalSpent,
          filledCount: executed,
          failedCount: failedCount,
        }).catch(() => {});
      }

      return {
        success: executed > 0, basketOrderId, status: 'FILLED',
        orders: orders.map(o => ({ success: true, orderId: o.id, status: 'FILLED' as OrderStatus, estimatedShares: o.shares, reservedAmount: o.totalCost, fillPrice: o.fillPrice, filledShares: o.shares, totalCost: o.totalCost, filledAt: o.filledAt })),
        totalReserved: totalCost, totalSpent, executed, failed: executionPlan.length - executed,
      };
    }

    // Market closed — store as pending
    await this.saveState();

    const now = new Date().toISOString();
    const nextOpenLabel = this.getNextOpenLabel();

    // Upsert pending basket positions into Supabase basket_holdings
    try {
      const positions = executionPlan.map(s => ({
        symbol: s.symbol,
        shares: 0,
        avgCost: 0,
        totalCost: s.dollarAmount,
        allocationPct: s.allocationPct,
        status: 'pending' as const,
        basketName: req.basketName,
        emoji: req.basketEmoji,
        reservedAmount: s.dollarAmount,
        nextOpenLabel,
        boughtAt: now,
      }));
      await this.syncBasketHoldings(req.basketId, 'upsert', positions);
    } catch (err: any) {
      console.error('[DemoBroker] Failed to sync pending basket holdings:', err?.message || err);
    }

    // ── Notify: basket submitted (pending) ──
    if (this.userEmail) {
      sendBasketNotification(this.userEmail, {
        type: 'basket_submitted',
        basketId: req.basketId,
        basketName: req.basketName,
        basketEmoji: req.basketEmoji,
        positions: executionPlan.map(s => ({
          symbol: s.symbol,
          shares: s.shares,
          fillPrice: s.price,
          totalCost: s.dollarAmount,
          status: 'filled' as const,
        })),
        totalInvested: totalCost,
        filledCount: executionPlan.length,
        failedCount: 0,
      }).catch(() => {});
    }

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

    // ── Notify: user cancelled ──
    if (this.userEmail) {
      sendOrderNotification(this.userEmail, {
        type: 'order_cancelled',
        orderId: order.id,
        symbol: order.symbol,
        side: order.side,
        orderType: order.type,
        shares: order.shares,
        cancelReason: 'user_cancelled',
      }).catch(() => {});
    }

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

    // Delete pending basket holdings for this cancelled basket
    try {
      await this.syncBasketHoldings(bo.basketId, 'delete');
    } catch (err: any) {
      console.error('[DemoBroker] Failed to delete cancelled basket holdings:', err?.message || err);
    }

    return { success: true };
  }

  // ─── EXECUTE PENDING ORDERS (market opens) ───

  async executePendingOrders(): Promise<number> {
    const marketOpen = this.isMarketOpen();
    const now = new Date();

    let filled = 0;
    let expired = 0;

    // Collect all symbols that need quotes
    const openOrders = this.state.orders.filter(o => o.status === 'OPEN');
    if (openOrders.length === 0) return 0;

    const symbols = [...new Set(openOrders.map(o => o.symbol))];
    const quotes = new Map<string, number>();
    for (const sym of symbols) {
      const q = await this.fetchQuote(sym);
      if (q && q.price > 0) quotes.set(sym.toUpperCase(), q.price);
    }

    // Process each order using the shared fill-engine
    for (const order of openOrders) {
      try {
        const quotePrice = quotes.get(order.symbol.toUpperCase());
        if (quotePrice == null || quotePrice <= 0) continue;

        const decision = evaluateOpenOrder(order, quotePrice, now, marketOpen);

        if (decision.action === 'fill') {
          const fillPx = decision.fillPrice || quotePrice;
          this.applyFillToOrder(order, fillPx);
          filled++;
        } else if (decision.action === 'expire') {
          this.expireOrder(order);
          expired++;
        }
      } catch (e) {
        console.error(`[DemoBroker] Failed to process order ${order.id}:`, e);
      }
    }

    // Update basket orders that have completed
    const newlyFilledBaskets: typeof this.state.basketOrders = [];
    for (const basket of this.state.basketOrders.filter(b => b.status === 'OPEN')) {
      const basketOrders = this.state.orders.filter(o => o.basketOrderId === basket.id);

      // ── Bug #5 fix: sync inner order statuses from canonical orders array ──
      // basket.orders was snapshotted at submission time and never updated
      // after fills/cancellations — it was stale. Now sync before computing status.
      for (const innerOrder of basket.orders) {
        const canonical = basketOrders.find(o => o.id === innerOrder.id);
        if (canonical) {
          innerOrder.status = canonical.status;
          if (canonical.fillPrice) innerOrder.fillPrice = canonical.fillPrice;
          if (canonical.filledAt) innerOrder.filledAt = canonical.filledAt;
        }
      }

      if (basketOrders.length === 0) continue;
      if (basketOrders.some(o => o.status === 'OPEN')) continue; // still pending

      // ── Bug #4 fix: distinguish FILLED vs CANCELLED vs PARTIAL ──
      const filledCount = basketOrders.filter(o => o.status === 'FILLED').length;
      const cancelledCount = basketOrders.filter(o => o.status === 'CANCELLED').length;

      if (filledCount > 0 && cancelledCount === 0) {
        basket.status = 'FILLED';
      } else if (cancelledCount > 0 && filledCount === 0) {
        basket.status = 'CANCELLED';
      } else {
        basket.status = 'PARTIAL';
      }
      basket.filledAt = new Date().toISOString();
      newlyFilledBaskets.push(basket);
    }

    // ── Notify: baskets filled via cron ──
    for (const basket of newlyFilledBaskets) {
      if (this.userEmail) {
        const orders = this.state.orders.filter(o => o.basketOrderId === basket.id);
        const filledOrders = orders.filter(o => o.status === 'FILLED');
        const failedOrders = orders.filter(o => o.status === 'CANCELLED');
        const totalInvested = filledOrders.reduce((sum, o) => sum + (o.totalCost || 0), 0);
        sendBasketNotification(this.userEmail, {
          type: failedOrders.length > 0 ? 'basket_partial_fill' : 'basket_filled',
          basketId: basket.basketId || basket.id,
          basketName: basket.basketName || '',
          basketEmoji: basket.basketEmoji || '',
          positions: orders.map(o => ({
            symbol: o.symbol,
            shares: o.shares,
            fillPrice: o.fillPrice || o.submittedPrice || 0,
            totalCost: o.totalCost || 0,
            status: (o.status === 'FILLED' ? 'filled' : 'failed') as 'filled' | 'failed',
          })),
          totalInvested,
          filledCount: filledOrders.length,
          failedCount: failedOrders.length,
        }).catch(() => {});
      }
    }

    if (filled > 0 || expired > 0) {
      await this.saveState();

      // Activate pending basket positions → active with real fill data
      const executedBasketIds = new Set(
        this.state.basketOrders.filter(b => b.status === 'FILLED').map(b => b.basketId)
      );
      try {
        for (const basketId of executedBasketIds) {
          await this.syncBasketHoldings(basketId, 'activatePending');
        }
      } catch (err: any) {
        console.error('[DemoBroker] Failed to activate pending basket holdings:', err?.message || err);
      }

      console.log(`[DemoBroker] Filled ${filled}, expired ${expired} pending orders`);
    }
    return filled + expired;
  }

  // ─── PRIVATE HELPERS ───

  /** Apply a fill to a BUY or SELL order — updates order, upserts/removes position, adjusts cash */
  private applyFillToOrder(order: BrokerOrder, fillPrice: number): void {
    order.status = 'FILLED';
    order.fillPrice = fillPrice;
    order.filledAt = new Date().toISOString();
    order.note = undefined;

    if (order.side === 'BUY') {
      const cost = order.reservedCost || order.totalCost;
      const shares = cost / fillPrice;
      order.shares = shares;
      order.totalCost = cost;
      this.upsertPosition({
        symbol: order.symbol,
        shares,
        price: fillPrice,
        cost,
        basketId: order.basketId,
        basketName: order.basketName,
        basketEmoji: order.basketEmoji,
      });
    } else {
      // SELL: remove shares from position, add proceeds to cash
      const shares = order.shares;
      const proceeds = shares * fillPrice;
      order.totalCost = proceeds;
      this.removePosition(order.symbol, shares);
      this.state.cashBalance += proceeds;
    }

    // ── Notify: order filled ──
    if (this.userEmail) {
      sendOrderNotification(this.userEmail, {
        type: 'order_filled',
        orderId: order.id,
        symbol: order.symbol,
        side: order.side,
        orderType: order.type,
        shares: order.shares,
        fillPrice,
      }).catch(() => {});
    }
  }

  /** Expire a DAY order — cancel it and release reserved cash */
  private expireOrder(order: BrokerOrder): void {
    order.status = 'CANCELLED';
    order.cancelledAt = new Date().toISOString();
    order.note = 'DAY order expired at market close';
    if (order.side === 'BUY' && order.reservedCost) {
      this.state.cashBalance += order.reservedCost;
    }

    // ── Notify: order expired ──
    if (this.userEmail) {
      sendOrderNotification(this.userEmail, {
        type: 'order_cancelled',
        orderId: order.id,
        symbol: order.symbol,
        side: order.side,
        orderType: order.type,
        shares: order.shares,
        cancelReason: 'day_expired',
      }).catch(() => {});
    }
  }

  private upsertPosition(params: {
    symbol: string;
    name?: string;
    sector?: string;
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
      if (params.name) p.name = params.name;
      if (params.sector) p.sector = params.sector;
    } else {
      this.state.positions.push({
        symbol: params.symbol,
        name: params.name || params.symbol,
        sector: params.sector || '',
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
    // Read from in-memory broker state (synced to Supabase via saveState)
    return this.state.basketOrders.filter((b: any) => b.status === 'OPEN');
  }
}
