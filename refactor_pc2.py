#!/usr/bin/env python3
"""Replace executeTrade, executeBasketTrade, cancelOrder, cancelBasketOrder, executePendingOrders bodies with broker delegation."""
import os

path = '/root/.openclaw/workspace/projects/vantage/context/PortfolioContext.tsx'
with open(path, 'r') as f:
    content = f.read()

# ═══════════════════════════════════════════════
# Helper: inline sync function code (used after each broker operation)
# ═══════════════════════════════════════════════
SYNC_CODE = """    const broker_sync = brokerRef.current;
    if (broker_sync) {
      const syncPositions = await broker_sync.getPositions();
      const syncAcct = await broker_sync.getAccount();
      const syncOrders = await broker_sync.getOrders();

      const ctxPositions: any[] = syncPositions.map((p: any) => ({
        symbol: p.symbol, name: p.symbol, qty: p.shares, avgCost: p.avgCost,
        currentPrice: p.avgCost, marketValue: p.shares * p.avgCost,
        dayChange: 0, dayChangePercent: 0, totalPnl: 0, totalPnlPercent: 0,
        portfolioPercent: 0, type: p.type,
        basketId: p.basketId, basketName: p.basketName, basketEmoji: p.basketEmoji,
      }));

      const ctxOrders: DemoOrder[] = syncOrders.map((o: any) => ({
        id: o.id, symbol: o.symbol, side: o.side, shares: o.shares, type: o.type,
        fillPrice: o.fillPrice || o.submittedPrice, totalCost: o.totalCost,
        status: o.status, createdAt: o.submittedAt, submittedPrice: o.submittedPrice,
        reservedCost: o.reservedCost, note: o.note, cancelledAt: o.cancelledAt,
      }));

      const newState: DemoState = {
        positions: ctxPositions, cashBalance: syncAcct.cashBalance,
        orders: ctxOrders, savedAt: Date.now(),
      };
      setDemoState(newState);
      setDemoOrders(ctxOrders);
      persistDemoState(newState);

      try {
        const raw = localStorage.getItem('vantage_pending_baskets');
        if (raw) setPendingBaskets(JSON.parse(raw).filter((b: any) => b.status === 'OPEN'));
      } catch {}
    }"""

# ═══════════════════════════════════════════════
# 1. Replace executeTrade body
# ═══════════════════════════════════════════════
old_exec_fn = """  // ── executeTrade ──
  const executeTrade = useCallback(
    (symbol: string, side: 'BUY' | 'SELL', shares: number, price: number): TradeResult => {
      if (!demoState) return { success: false, error: 'No portfolio loaded' };

      const market = getMarketStatus();
      const positions = [...demoState.positions];
      let cashBalance = demoState.cashBalance;
      const cost = shares * price;

      // ── OPEN ORDER (market closed) ──
      if (!market.isOpen) {"""

# Find where executeTrade starts and where it ends (the useCallback closing)
exec_start = content.find(old_exec_fn)
if exec_start < 0:
    print("❌ executeTrade not found")
else:
    # Find the end of this useCallback — it ends with:
    # "    [demoState, demoOrders, persistDemoState]\n  );"
    end_marker = "    [demoState, demoOrders, persistDemoState]\n  );"
    exec_end = content.find(end_marker, exec_start)
    if exec_end < 0:
        # Try alternative dependency arrays
        end_marker = "    [demoState, demoOrders, persistDemoState],\n  );"
        exec_end = content.find(end_marker, exec_start)
    if exec_end >= 0:
        exec_end += len(end_marker)
        
        new_exec = """  // ── executeTrade (broker-backed) ──
  const executeTrade = useCallback(
    async (symbol: string, side: 'BUY' | 'SELL', shares: number, price: number): Promise<TradeResult> => {
      const broker = brokerRef.current;
      if (!broker) return { success: false, error: 'Broker not initialized' };

      const result = await broker.placeOrder({
        symbol, side, type: 'market', shares,
      });

      // Sync React state from broker
""" + SYNC_CODE + """

      if (result.success) {
        const sideLabel = side === 'BUY' ? 'Bought' : 'Sold';
        const statusLabel = result.status === 'OPEN'
          ? `⏳ Order for ${symbol} queued — ${result.nextOpenLabel || 'pending'}`
          : `✅ ${sideLabel} ${shares} shares of ${symbol} at $${price.toFixed(2)}`;
        setToast({ message: statusLabel, type: 'success' });
        setTimeout(() => setToast(null), result.status === 'OPEN' ? 4000 : 3000);
      } else {
        setToast({ message: `❌ ${result.message || 'Order failed'}`, type: 'error' });
        setTimeout(() => setToast(null), 4000);
      }

      return {
        success: result.success,
        error: result.message,
        status: result.status,
        totalSpent: result.totalCost,
      };
    },
    [persistDemoState],
  );"""

        content = content[:exec_start] + new_exec + content[exec_end:]
        print("✅ executeTrade replaced")
    else:
        print("❌ executeTrade end not found")

with open(path, 'w') as f:
    f.write(content)
print("✅ Refactor stage 2 done")
