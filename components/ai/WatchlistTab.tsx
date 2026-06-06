'use client';

import { Star, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useMarketStore } from '@/store';

export default function WatchlistTab() {
  const watchlist = useMarketStore((s) => s.watchlist);
  const quotes = useMarketStore((s) => s.quotes);

  return (
    <div className="pt-4 px-4 pb-24">
      <h2 className="text-white text-xl font-bold mb-1">Watchlist</h2>
      <p className="text-slate-400 text-sm mb-4">Stocks you&apos;re tracking</p>

      {watchlist.length === 0 ? (
        <div className="text-center py-12">
          <Star className="mx-auto text-slate-600 mb-3" size={32} />
          <p className="text-slate-400 text-sm">No stocks in your watchlist</p>
          <p className="text-slate-600 text-xs mt-1">
            Add stocks from the Invest tab
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {watchlist.map((item) => {
            const quote = quotes[item.symbol];
            const change = quote?.change ?? item.change ?? 0;
            const changePct = quote?.changePercent ?? item.changePercent ?? 0;
            const price = quote?.last;
            const isUp = change > 0;
            const isDown = change < 0;
            const ChangeIcon = isUp ? TrendingUp : isDown ? TrendingDown : Minus;

            return (
              <div
                key={item.symbol}
                className="flex items-center justify-between bg-slate-800 rounded-xl px-4 py-3 border border-slate-700/50"
              >
                <div className="flex items-center gap-3">
                  <Star size={16} className="text-amber-400" />
                  <div>
                    <p className="text-white font-semibold text-sm">{item.symbol}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-white font-mono text-sm font-medium">
                    ${typeof price === 'number' ? price.toFixed(2) : '—'}
                  </p>
                  <p
                    className={`text-xs font-medium flex items-center justify-end gap-0.5 ${
                      isUp ? 'text-green-400' : isDown ? 'text-red-400' : 'text-slate-500'
                    }`}
                  >
                    <ChangeIcon size={12} />
                    {isUp ? '+' : ''}
                    {typeof change === 'number' ? change.toFixed(2) : '—'}%
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
