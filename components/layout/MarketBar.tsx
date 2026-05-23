'use client';
import { useMarketStore } from '@/store';

export function MarketBar() {
  const { indexes } = useMarketStore();

  if (indexes.length === 0) return null;

  return (
    <div className="indexes-bar">
      {indexes.map((idx) => (
        <div key={idx.symbol} className="index-item">
          <div className="index-symbol">{idx.symbol}</div>
          <div className="index-price">
            {idx.symbol === 'VIX' || idx.symbol === 'DXY'
              ? idx.price.toFixed(2)
              : `$${idx.price.toFixed(2)}`}
          </div>
          <div className={`index-change ${idx.changePercent >= 0 ? 'up' : 'down'}`}>
            {idx.changePercent >= 0 ? '+' : ''}{idx.changePercent.toFixed(2)}%
          </div>
        </div>
      ))}
    </div>
  );
}
