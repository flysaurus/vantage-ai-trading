'use client';
import { Plus } from 'lucide-react';
import { useMarketStore } from '@/store';

export function WatchlistBar() {
  const { watchlist } = useMarketStore();

  if (watchlist.length === 0) return null;

  return (
    <div className="watchlist-bar">
      <span className="watchlist-label">Watchlist</span>
      {watchlist.map((item) => (
        <div key={item.symbol} className="wl-item">
          <span className="wl-symbol">{item.symbol}</span>
          {(item.changePercent ?? 0) !== 0 && (
            <span className={`wl-change ${(item.changePercent ?? 0) >= 0 ? 'up' : 'down'}`}>
              {(item.changePercent ?? 0) >= 0 ? '+' : ''}{item.changePercent?.toFixed(1)}%
            </span>
          )}
        </div>
      ))}
      <div className="wl-add">
        <Plus size={12} /> Add
      </div>
      <style jsx>{`
        .wl-item {
          background: rgba(6,182,212,0.08);
          border: 1px solid rgba(6,182,212,0.2);
          border-radius: 6px;
          padding: 5px 8px;
          flex-shrink: 0;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .wl-symbol { font-size: 10px; color: #f1f5f9; font-weight: 700; }
        .wl-change { font-size: 9px; font-weight: 600; }
        .wl-add {
          background: #1e293b;
          border: 1px dashed #475569;
          border-radius: 6px;
          padding: 5px 8px;
          color: #94a3b8;
          font-size: 11px;
          cursor: pointer;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          gap: 4px;
        }
      `}</style>
    </div>
  );
}
