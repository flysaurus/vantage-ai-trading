#!/usr/bin/env python3
"""Refactor PortfolioContext.tsx to use DemoBroker for all trading operations."""
import re, os

path = '/root/.openclaw/workspace/projects/vantage/context/PortfolioContext.tsx'
with open(path, 'r') as f:
    content = f.read()

# ═══════════════════════════════════════════════
# 1. Add broker import after existing imports
# ═══════════════════════════════════════════════
old_import = "import { syncPortfolioToSupabase, loadPortfolioFromSupabase } from '@/lib/portfolio-sync';"
new_import = "import { syncPortfolioToSupabase, loadPortfolioFromSupabase } from '@/lib/portfolio-sync';\nimport { getBroker, resetBroker } from '@/lib/broker/broker-factory';\nimport type { BrokerEngine, BrokerPosition, BrokerOrder, BrokerBasketOrder } from '@/lib/broker/engine';"
content = content.replace(old_import, new_import)

# ═══════════════════════════════════════════════
# 2. Add broker ref after useRef declarations (after the loadBasketsRef block)
# ═══════════════════════════════════════════════
old_ref = "  const basketPositionsRef = useRef<BasketPosition[]>([]);\n  useEffect(() => { demoStateRef.current = demoState; }, [demoState]);"
new_ref = "  const basketPositionsRef = useRef<BasketPosition[]>([]);\n  const brokerRef = useRef<BrokerEngine | null>(null);\n  useEffect(() => { demoStateRef.current = demoState; }, [demoState]);"
content = content.replace(old_ref, new_ref)

# ═══════════════════════════════════════════════
# 3. Add refreshStateFromBroker() after persistDemoState
# ═══════════════════════════════════════════════
old_persist = "  // ── Persist demo state to localStorage ──\n  const persistDemoState = useCallback((state: DemoState) => {\n    try {\n      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, savedAt: Date.now() }));\n    } catch { /* ignore quota exceeded */ }\n  }, []);"
new_persist = """  // ── Persist demo state to localStorage (legacy — broker handles its own storage) ──
  const persistDemoState = useCallback((state: DemoState) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, savedAt: Date.now() }));
    } catch { /* ignore quota exceeded */ }
  }, []);

  // ── Sync React state from broker ──
  const refreshStateFromBroker = useCallback(async () => {
    const broker = brokerRef.current;
    if (!broker) return;
    const positions = await broker.getPositions();
    const acct = await broker.getAccount();
    const orders = await broker.getOrders();
    const basketOrders = await broker.getBasketOrders();

    // Convert BrokerPosition to context's Position format
    const ctxPositions: any[] = positions.map(p => ({
      symbol: p.symbol,
      name: p.symbol,
      qty: p.shares,
      avgCost: p.avgCost,
      currentPrice: p.avgCost,
      marketValue: p.shares * p.avgCost,
      dayChange: 0,
      dayChangePercent: 0,
      totalPnl: 0,
      totalPnlPercent: 0,
      portfolioPercent: 0,
      type: p.type,
      basketId: p.basketId,
      basketName: p.basketName,
      basketEmoji: p.basketEmoji,
    }));

    // Convert BrokerOrder to DemoOrder format
    const ctxOrders: DemoOrder[] = orders.map(o => ({
      id: o.id,
      symbol: o.symbol,
      side: o.side,
      shares: o.shares,
      type: o.type,
      fillPrice: o.fillPrice || o.submittedPrice,
      totalCost: o.totalCost,
      status: o.status,
      createdAt: o.submittedAt,
      submittedPrice: o.submittedPrice,
      reservedCost: o.reservedCost,
      note: o.note,
      cancelledAt: o.cancelledAt,
    }));

    const newState: DemoState = {
      positions: ctxPositions,
      cashBalance: acct.cashBalance,
      orders: ctxOrders,
      savedAt: Date.now(),
    };

    setDemoState(newState);
    setDemoOrders(ctxOrders);
    // Sync pending baskets (broker also stores these)
    if (broker.name === 'Demo') {
      try {
        const raw = localStorage.getItem('vantage_pending_baskets');
        if (raw) {
          const pending = JSON.parse(raw).filter((b: any) => b.status === 'OPEN');
          setPendingBaskets(pending);
        } else {
          setPendingBaskets([]);
        }
      } catch { }
    }
  }, []);"""

content = content.replace(old_persist, new_persist)

# ═══════════════════════════════════════════════
# 4. Wire broker init into the seed useEffect
# ═══════════════════════════════════════════════
old_seed = """  // ── Seed fallback: if no persisted state was loaded, seed from demo-data ──
  useEffect(() => {
    if (isConnected || initialPersistedState) return;
    const style = (user?.investorStyle || 'buffett') as InvestorStyle;
    const seedAccount = getDemoAccount(style, {});"""

new_seed = """  // ── Broker initialization ──
  useEffect(() => {
    brokerRef.current = getBroker('demo', user?.id, supabase);
  }, []);

  // ── Seed fallback: if no persisted state was loaded, seed from demo-data via broker ──
  useEffect(() => {
    if (isConnected || initialPersistedState) return;
    const broker = brokerRef.current;
    if (!broker) return;

    // Check if broker already has positions from localStorage
    broker.getPositions().then(async (positions) => {
      if (positions.length > 0) {
        // Broker has state — sync to context
        await refreshStateFromBroker();
        return;
      }
      // Empty — seed from demo data
      const style = (user?.investorStyle || 'buffett') as InvestorStyle;

      // Run seed via DemoBroker's seedFromDemoData method
      if (broker.name === 'Demo') {
        (broker as any).seedFromDemoData(style);
        await refreshStateFromBroker();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, user?.investorStyle, initialPersistedState]);"""

# But we still need the old seed orders generation code block to be replaced.
# Find the block that starts with getDemoAccount and ends with setDemoState/setDemoOrders
old_seed_body_start = content.find(old_seed)
if old_seed_body_start >= 0:
    # We need to find the end of this useEffect: it closes with a "}, [isConnected..." line
    # Let's find that closure
    block_start = old_seed_body_start
    # Find the closing of this useEffect
    closure_marker = "  }, [isConnected, user?.investorStyle, initialPersistedState]);"
    closure_pos = content.find(closure_marker, block_start + len(old_seed))
    if closure_pos >= 0:
        # Replace entire useEffect block
        end_pos = closure_pos + len(closure_marker) + 1  # +1 for newline
        # Actually the old block has code between old_seed and closure_marker
        # We need to replace: old_seed + [the middle code] + closure_marker
        # with: new_seed
        
        # Find where the old block actually ends (after the closing })
        after_closure = content.find("\n\n  // ── Persist", end_pos)
        if after_closure < 0:
            after_closure = content.find("\n\n  useEffect", end_pos)
        if after_closure < 0:
            # Fallback: just use the end of the closure line
            full_old_block_end = end_pos
        else:
            full_old_block_end = after_closure
        
        # Build the new block
        full_new_block = new_seed + content[end_pos:full_old_block_end]
        content = content[:block_start] + full_new_block + content[full_old_block_end:]

        print("✅ Seed useEffect replaced")

# ═══════════════════════════════════════════════
# 5. Add broker-backed market open watcher useEffect
# ═══════════════════════════════════════════════
# Find the existing market open watcher effect and replace it
old_watcher = """  // ── Auto-execute pending baskets on market open ──
  useEffect(() => {
    if (!demoState) return;
    const market = getMarketStatus();
    if (market.isOpen && pendingBaskets.length > 0) {
      executePendingOrders();
    }
  }, []);"""

new_watcher = """  // ── Auto-execute pending orders on market open (broker-backed) ──
  useEffect(() => {
    const broker = brokerRef.current;
    if (!broker || !broker.isMarketOpen()) return;
    broker.executePendingOrders().then(async (count) => {
      if (count > 0) {
        await refreshStateFromBroker();
        setToast({
          message: `🔔 Market opened — ${count} pending orders executed`,
          type: 'success',
        });
        setTimeout(() => setToast(null), 5000);
      }
    });
  }, []);

  // ── Market open poll (check every 60s) ──
  useEffect(() => {
    const timer = setInterval(async () => {
      const broker = brokerRef.current;
      if (!broker) return;
      if (broker.isMarketOpen()) {
        const count = await broker.executePendingOrders();
        if (count > 0) {
          await refreshStateFromBroker();
          setToast({
            message: `🔔 ${count} pending orders executed`,
            type: 'success',
          });
          setTimeout(() => setToast(null), 5000);
        }
      }
    }, 60000);
    return () => clearInterval(timer);
  }, []);"""

content = content.replace(old_watcher, new_watcher)

with open(path, 'w') as f:
    f.write(content)
print("✅ PortfolioContext refactor step 1 done")
