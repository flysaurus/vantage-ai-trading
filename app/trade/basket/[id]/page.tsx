'use client';

import { apiGet } from '@/lib/api-client';
import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, SkipForward, AlertCircle, Loader2, CheckCircle, XCircle, Clock } from 'lucide-react';

interface BasketPosition {
  id: string;
  symbol: string;
  score: number;
  confidence: number;
  reason: string;
  allocation: number;
  status: string;
}

interface Basket {
  id: string;
  name: string;
  emoji: string;
  status: string;
  basket_positions: BasketPosition[];
}

interface OrderRow {
  symbol: string;
  qty: number;
  orderType: 'market' | 'limit' | 'stop' | 'stop_limit';
  timeInForce: 'day' | 'gtc' | 'ioc' | 'fok';
  limitPrice?: number;
  estCost: number;
  included: boolean;
}

export default function BasketOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id } = use(params);

  const [basket, setBasket] = useState<Basket | null>(null);
  const [loading, setLoading] = useState(true);
  const [budget, setBudget] = useState<number>(0);
  const [distribution, setDistribution] = useState<'score' | 'equal'>('score');
  const [buyingPower, setBuyingPower] = useState<number>(0);
  const [skippedStocks, setSkippedStocks] = useState<Set<string>>(new Set());
  const [orderRows, setOrderRows] = useState<OrderRow[]>([]);
  const [qtyDigits, setQtyDigits] = useState<Record<string, string>>({});
  const [limitDigits, setLimitDigits] = useState<Record<string, string>>({});
  const [showConfirm, setShowConfirm] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [orderResults, setOrderResults] = useState<Array<{ symbol: string; status: string; error?: string }>>([]);

  // Fetch basket data
  useEffect(() => {
    fetch(`/api/baskets/${id}`)
      .then(r => r.json())
      .then(data => {
        if (data.basket) {
          setBasket(data.basket);
          // Initialize order rows from positions
          const positions = data.basket.basket_positions || [];
          const rows: OrderRow[] = positions.map((p: BasketPosition) => ({
            symbol: p.symbol,
            qty: 0,
            orderType: 'market' as const,
            timeInForce: 'day' as const,
            limitPrice: undefined,
            estCost: 0,
            included: true,
          }));
          setOrderRows(rows);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  // Fetch buying power
  useEffect(() => {
    apiGet('/api/broker/session')
      .then(r => r.json())
      .then(data => {
        if (data.session?.buying_power) {
          setBuyingPower(parseFloat(data.session.buying_power));
        } else if (data.buying_power) {
          setBuyingPower(parseFloat(data.buying_power));
        }
      })
      .catch(() => {});
  }, []);

  // Recalculate distributions when budget/distribution changes
  useEffect(() => {
    if (!basket || budget <= 0) return;

    const positions = basket.basket_positions || [];
    const includedPositions = positions.filter(p => !skippedStocks.has(p.symbol));

    if (includedPositions.length === 0) return;

    let allocBySymbol: Record<string, number> = {};
    if (distribution === 'equal') {
      const each = budget / includedPositions.length;
      includedPositions.forEach(p => { allocBySymbol[p.symbol] = each; });
    } else {
      // By AI Score
      const totalScore = includedPositions.reduce((sum, p) => sum + (p.score || 1), 0);
      includedPositions.forEach(p => {
        allocBySymbol[p.symbol] = (p.score || 1) / totalScore * budget;
      });
    }

    setOrderRows(prev => prev.map(row => ({
      ...row,
      estCost: allocBySymbol[row.symbol] || 0,
    })));
  }, [budget, distribution, skippedStocks, basket]);

  const toggleSkip = (symbol: string) => {
    setSkippedStocks(prev => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  };

  const updateQty = (symbol: string, qtyStr: string) => {
    setQtyDigits(prev => ({ ...prev, [symbol]: qtyStr }));
    const qty = parseFloat(qtyStr) || 0;
    setOrderRows(prev => prev.map(row =>
      row.symbol === symbol ? { ...row, qty, estCost: row.estCost } : row
    ));
  };

  const updateOrderType = (symbol: string, orderType: 'market' | 'limit' | 'stop' | 'stop_limit') => {
    setOrderRows(prev => prev.map(row =>
      row.symbol === symbol ? { ...row, orderType } : row
    ));
  };

  const updateTIF = (symbol: string, timeInForce: 'day' | 'gtc' | 'ioc' | 'fok') => {
    setOrderRows(prev => prev.map(row =>
      row.symbol === symbol ? { ...row, timeInForce } : row
    ));
  };

  const updateLimitPrice = (symbol: string, priceStr: string) => {
    setLimitDigits(prev => ({ ...prev, [symbol]: priceStr }));
    const price = parseFloat(priceStr) || undefined;
    setOrderRows(prev => prev.map(row =>
      row.symbol === symbol ? { ...row, limitPrice: price } : row
    ));
  };

  const activeOrders = orderRows.filter(r => r.included && !skippedStocks.has(r.symbol) && r.qty > 0);
  const totalCost = activeOrders.reduce((sum, r) => sum + r.qty * (r.orderType === 'limit' ? (r.limitPrice || 0) : 0), 0);

  const handleExecute = async () => {
    setIsExecuting(true);
    setShowConfirm(false);

    const ordersToPlace = orderRows
      .filter(r => r.included && !skippedStocks.has(r.symbol) && r.qty > 0)
      .map(r => ({
        symbol: r.symbol,
        qty: r.qty,
        orderType: r.orderType,
        timeInForce: r.timeInForce,
        limitPrice: r.limitPrice,
      }));

    try {
      const res = await fetch(`/api/baskets/${id}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders: ordersToPlace }),
      });
      const json = await res.json();
      setOrderResults(json.results || []);
    } catch (e: any) {
      setOrderResults(activeOrders.map(o => ({ symbol: o.symbol, status: 'failed', error: e.message })));
    } finally {
      setIsComplete(true);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
      </div>
    );
  }

  // Not found
  if (!basket) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center gap-4 p-6">
        <AlertCircle className="w-12 h-12 text-slate-300" />
        <p className="text-slate-300 text-sm">Basket not found</p>
        <button onClick={() => router.back()} className="text-cyan-400 text-sm font-medium">← Go back</button>
      </div>
    );
  }

  // Execution complete screen
  if (isExecuting) {
    const filledCount = orderResults.filter(r => r.status === 'filled').length;
    const failedCount = orderResults.filter(r => r.status === 'failed').length;
    const pendingCount = orderResults.length - filledCount - failedCount;

    return (
      <div className="min-h-screen bg-slate-900 max-w-lg mx-auto">
        {/* Header */}
        <div className="px-4 py-4 flex items-center gap-3 border-b border-slate-800">
          <div className="text-2xl">{basket.emoji}</div>
          <div className="flex-1">
            <h1 className="text-white font-semibold text-base">{basket.name}</h1>
            <p className="text-slate-300 text-xs">
              {isComplete ? 'Execution complete' : 'Executing orders...'}
            </p>
          </div>
        </div>

        <div className="px-4 py-6">
          {/* Progress summary */}
          <div className="bg-slate-800 rounded-2xl p-4 mb-4 border border-slate-700">
            <div className="flex items-center justify-between mb-3">
              <span className="text-slate-300 text-sm font-medium">Order Progress</span>
              <span className="text-slate-300 text-xs">
                {filledCount + failedCount}/{orderResults.length} processed
              </span>
            </div>
            {/* Progress bar */}
            <div className="w-full bg-slate-700 rounded-full h-2 mb-4">
              <div
                className="h-2 rounded-full transition-all duration-500"
                style={{
                  width: `${orderResults.length ? ((filledCount + failedCount) / orderResults.length) * 100 : 0}%`,
                  background: failedCount > 0 ? '#f59e0b' : '#06b6d4',
                }}
              />
            </div>

            {/* Per-symbol status */}
            <div className="space-y-2">
              {orderResults.map((result, i) => (
                <div key={i} className="flex items-center justify-between py-1.5">
                  <div className="flex items-center gap-2">
                    {result.status === 'filled' ? (
                      <CheckCircle className="w-4 h-4 text-emerald-400" />
                    ) : result.status === 'failed' ? (
                      <XCircle className="w-4 h-4 text-red-400" />
                    ) : (
                      <Clock className="w-4 h-4 text-amber-400 animate-pulse" />
                    )}
                    <span className={`text-sm font-medium ${result.status === 'failed' ? 'text-red-300' : 'text-slate-200'}`}>
                      {result.symbol}
                    </span>
                  </div>
                  <span className={`text-xs font-medium ${
                    result.status === 'filled' ? 'text-emerald-400' :
                    result.status === 'failed' ? 'text-red-400' : 'text-amber-400'
                  }`}>
                    {result.status === 'filled' ? '✅ Filled' :
                     result.status === 'failed' ? '❌ Failed' : '⏳ Pending'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Post-execution actions */}
          {isComplete && (
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => router.push('/?tab=orders')}
                className="flex-1 bg-slate-800 border border-slate-700 text-white font-medium py-3 rounded-xl text-sm hover:bg-slate-700 transition"
              >
                View Orders
              </button>
              <button
                onClick={() => router.push('/?tab=portfolio')}
                className="flex-1 bg-cyan-500 text-white font-medium py-3 rounded-xl text-sm hover:bg-cyan-600 transition"
              >
                View Portfolio
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Main review screen
  return (
    <div className="min-h-screen bg-slate-900 max-w-lg mx-auto pb-24">
      {/* Header */}
      <div className="px-4 py-4 flex items-center gap-3 border-b border-slate-800 sticky top-0 bg-slate-900 z-10">
        <button onClick={() => router.back()} className="text-slate-300 hover:text-white p-1 -ml-1">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="text-2xl">{basket.emoji}</div>
        <div>
          <h1 className="text-white font-semibold text-base">{basket.name}</h1>
          <p className="text-slate-300 text-xs">
            {basket.basket_positions?.length || 0} stocks · Review & place orders
          </p>
        </div>
      </div>

      <div className="px-4 py-4">
        {/* Budget Input Section */}
        <div className="bg-slate-800 rounded-2xl p-4 mb-4 border border-slate-700">
          <label className="text-slate-300 text-xs font-semibold uppercase tracking-wide mb-2 block">
            Total Budget
          </label>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-slate-300 text-lg">$</span>
            <input
              type="number"
              value={budget || ''}
              onChange={e => setBudget(parseFloat(e.target.value) || 0)}
              placeholder="0"
              className="flex-1 bg-slate-900 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-lg font-semibold outline-none focus:border-cyan-500 transition"
            />
          </div>
          {/* Quick amount buttons */}
          <div className="flex gap-2 mb-3">
            {[1000, 5000, 10000, 25000].map(amount => (
              <button
                key={amount}
                onClick={() => setBudget(amount)}
                className={`flex-1 py-2 rounded-lg text-xs font-semibold transition ${
                  budget === amount
                    ? 'bg-cyan-500 text-white'
                    : 'bg-slate-700 text-slate-200 hover:bg-slate-600'
                }`}
              >
                ${amount >= 1000 ? `${amount / 1000}K` : amount}
              </button>
            ))}
          </div>
          {/* Distribution toggle */}
          <div className="flex items-center justify-between">
            <span className="text-slate-300 text-xs">Distribution</span>
            <div className="flex bg-slate-900 rounded-lg p-0.5">
              <button
                onClick={() => setDistribution('score')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                  distribution === 'score' ? 'bg-cyan-500 text-white' : 'text-slate-300 hover:text-white'
                }`}
              >
                By AI Score
              </button>
              <button
                onClick={() => setDistribution('equal')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                  distribution === 'equal' ? 'bg-cyan-500 text-white' : 'text-slate-300 hover:text-white'
                }`}
              >
                Equal Split
              </button>
            </div>
          </div>
          {/* Buying power */}
          {buyingPower > 0 && (
            <div className="mt-3 flex items-center justify-between text-xs border-t border-slate-700 pt-3">
              <span className="text-slate-300">Buying Power</span>
              <span className="text-slate-300 font-medium">${buyingPower.toLocaleString()}</span>
            </div>
          )}
        </div>

        {/* Order Rows — scrollable */}
        <div className="space-y-3 mb-4" style={{ maxHeight: '50vh', overflowY: 'auto' }}>
          {orderRows.map((row) => {
            const isSkipped = skippedStocks.has(row.symbol);
            const position = basket.basket_positions?.find(p => p.symbol === row.symbol);
            const score = position?.score ?? 0;
            const confidence = position?.confidence ?? 0;

            return (
              <div
                key={row.symbol}
                className={`bg-slate-800 rounded-2xl p-4 border transition ${
                  isSkipped ? 'border-slate-700 opacity-50' : 'border-slate-700'
                }`}
              >
                {/* Top row: symbol + skip */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-bold text-sm">{row.symbol}</span>
                    {score > 0 && (
                      <span className="text-xs bg-cyan-500/20 text-cyan-400 px-1.5 py-0.5 rounded font-semibold">
                        {score.toFixed(0)}
                      </span>
                    )}
                    {confidence > 0 && (
                      <span className="text-xs bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded font-semibold">
                        {confidence}%
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => toggleSkip(row.symbol)}
                    className={`text-xs font-medium px-2.5 py-1 rounded-lg transition ${
                      isSkipped
                        ? 'bg-slate-700 text-slate-200'
                        : 'bg-slate-700 text-slate-200 hover:bg-red-900/50 hover:text-red-400'
                    }`}
                  >
                    {isSkipped ? 'Skipped' : 'Skip'}
                  </button>
                </div>

                {/* Shares input */}
                {!isSkipped && (
                  <>
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <div>
                        <label className="text-slate-300 text-2xs font-semibold uppercase block mb-1">Shares</label>
                        <input
                          type="number"
                          value={qtyDigits[row.symbol] ?? ''}
                          onChange={e => updateQty(row.symbol, e.target.value)}
                          placeholder="0"
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg py-1.5 px-2.5 text-white text-sm outline-none focus:border-cyan-500 transition"
                        />
                      </div>
                      <div>
                        <label className="text-slate-300 text-2xs font-semibold uppercase block mb-1">Est. Cost</label>
                        <div className="bg-slate-900 border border-slate-700 rounded-lg py-1.5 px-2.5 text-slate-300 text-sm">
                          ${((row.qty || 0) * (row.orderType === 'limit' ? (row.limitPrice || 0) : 0)).toFixed(2) || '—'}
                        </div>
                      </div>
                    </div>

                    {/* Order type + TIF */}
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <div>
                        <label className="text-slate-300 text-2xs font-semibold uppercase block mb-1">Type</label>
                        <select
                          value={row.orderType}
                          onChange={e => updateOrderType(row.symbol, e.target.value as any)}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg py-1.5 px-2 text-white text-xs outline-none appearance-none cursor-pointer"
                        >
                          <option value="market">Market</option>
                          <option value="limit">Limit</option>
                          <option value="stop">Stop</option>
                          <option value="stop_limit">Stop Limit</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-slate-300 text-2xs font-semibold uppercase block mb-1">TIF</label>
                        <select
                          value={row.timeInForce}
                          onChange={e => updateTIF(row.symbol, e.target.value as any)}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg py-1.5 px-2 text-white text-xs outline-none appearance-none cursor-pointer"
                        >
                          <option value="day">Day</option>
                          <option value="gtc">GTC</option>
                          <option value="ioc">IOC</option>
                          <option value="fok">FOK</option>
                        </select>
                      </div>
                    </div>

                    {/* Limit price (conditional) */}
                    {(row.orderType === 'limit' || row.orderType === 'stop_limit') && (
                      <div className="mb-2">
                        <label className="text-slate-300 text-2xs font-semibold uppercase block mb-1">Limit Price</label>
                        <input
                          type="number"
                          value={limitDigits[row.symbol] ?? ''}
                          onChange={e => updateLimitPrice(row.symbol, e.target.value)}
                          placeholder="$0.00"
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg py-1.5 px-2.5 text-white text-sm outline-none focus:border-cyan-500 transition"
                        />
                      </div>
                    )}

                    {/* Allocation bar */}
                    {budget > 0 && row.estCost > 0 && (
                      <div className="mt-2">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-slate-300">Allocation</span>
                          <span className="text-slate-300">
                            {((row.estCost / budget) * 100).toFixed(1)}% · ${row.estCost.toFixed(0)}
                          </span>
                        </div>
                        <div className="w-full bg-slate-700 rounded-full h-1.5">
                          <div
                            className="h-1.5 rounded-full bg-cyan-500 transition-all"
                            style={{ width: `${Math.min((row.estCost / budget) * 100, 100)}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Fixed bottom bar */}
      <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto bg-slate-900 border-t border-slate-800 px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <div>
            <span className="text-slate-300 text-xs">Orders</span>
            <span className="text-white font-bold text-sm ml-1.5">{activeOrders.length}</span>
          </div>
          <div>
            <span className="text-slate-300 text-xs">Est. Total</span>
            <span className="text-white font-bold text-sm ml-1.5">
              ${totalCost.toFixed(2) || '—'}
            </span>
          </div>
        </div>
        <button
          onClick={() => setShowConfirm(true)}
          disabled={activeOrders.length === 0}
          className={`w-full py-3 rounded-xl font-semibold text-sm transition ${
            activeOrders.length === 0
              ? 'bg-slate-700 text-slate-200 cursor-not-allowed'
              : 'bg-cyan-500 text-white hover:bg-cyan-600 active:scale-[0.98]'
          }`}
        >
          {activeOrders.length === 0 ? 'Enter quantity for at least one stock' : `Place ${activeOrders.length} Order${activeOrders.length > 1 ? 's' : ''}`}
        </button>
      </div>

      {/* Confirmation Modal */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center">
          <div className="bg-slate-800 rounded-t-2xl sm:rounded-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto border border-slate-700">
            <div className="p-5">
              <div className="flex items-center gap-3 mb-4">
                <span className="text-2xl">{basket.emoji}</span>
                <div>
                  <h2 className="text-white font-semibold">Confirm Orders</h2>
                  <p className="text-slate-300 text-xs">{activeOrders.length} order{activeOrders.length > 1 ? 's' : ''} · {basket.name}</p>
                </div>
              </div>

              {/* Order summary table */}
              <div className="mb-4">
                <div className="grid grid-cols-12 text-xs font-semibold text-slate-300 uppercase pb-2 border-b border-slate-700">
                  <span className="col-span-3">Symbol</span>
                  <span className="col-span-2 text-right">Qty</span>
                  <span className="col-span-3 text-center">Type</span>
                  <span className="col-span-4 text-right">Est. Cost</span>
                </div>
                {activeOrders.map(order => {
                  const estCost = order.qty * (order.orderType === 'limit' ? (order.limitPrice || 0) : 0);
                  return (
                    <div key={order.symbol} className="grid grid-cols-12 text-sm py-2 border-b border-slate-700/50">
                      <span className="col-span-3 text-white font-medium">{order.symbol}</span>
                      <span className="col-span-2 text-right text-slate-300">{order.qty}</span>
                      <span className="col-span-3 text-center text-slate-300 text-xs">
                        {order.orderType.replace('_', ' ')} · {order.timeInForce.toUpperCase()}
                      </span>
                      <span className="col-span-4 text-right text-slate-300 font-mono text-xs">
                        ${estCost > 0 ? estCost.toFixed(2) : '—'}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Totals */}
              <div className="bg-slate-900 rounded-xl p-3 mb-4">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-slate-300">Total Orders</span>
                  <span className="text-white font-semibold">{activeOrders.length}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-300">Budget</span>
                  <span className="text-white font-semibold">${budget.toLocaleString()}</span>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex gap-3">
                <button
                  onClick={() => setShowConfirm(false)}
                  className="flex-1 bg-slate-700 text-white font-medium py-3 rounded-xl text-sm hover:bg-slate-600 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleExecute}
                  className="flex-1 bg-cyan-500 text-white font-semibold py-3 rounded-xl text-sm hover:bg-cyan-600 transition flex items-center justify-center gap-2"
                >
                  <Check className="w-4 h-4" />
                  Confirm & Execute
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
