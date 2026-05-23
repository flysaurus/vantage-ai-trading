'use client';
import { Search, Bell, Settings } from 'lucide-react';
import { useMarketStore, useTabStore } from '@/store';

export function Header() {
  const { isMarketOpen } = useMarketStore();
  const { setTab } = useTabStore();

  return (
    <div className="app-header">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div className="logo">Vantage</div>
        <div className={`market-status ${!isMarketOpen ? 'closed' : ''}`}>
          {isMarketOpen ? 'OPEN' : 'CLOSED'}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="icon-btn"><Search size={16} /></button>
        <button className="icon-btn" style={{ position: 'relative' }}>
          <Bell size={16} />
          <div className="notif-dot" />
        </button>
        <button className="icon-btn" onClick={() => setTab('settings')}>
          <Settings size={16} />
        </button>
      </div>
      <style jsx>{`
        .icon-btn {
          width: 32px; height: 32px;
          background: #1e293b; border: none;
          border-radius: 8px; color: #cbd5e1;
          cursor: pointer; display: flex;
          align-items: center; justify-content: center;
        }
        .notif-dot {
          position: absolute; top: 4px; right: 4px;
          width: 8px; height: 8px;
          background: #ef4444; border-radius: 50%;
          border: 2px solid #0f172a;
        }
      `}</style>
    </div>
  );
}
