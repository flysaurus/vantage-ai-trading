'use client';
import { useState, useEffect } from 'react';
import { Bot, LayoutDashboard, BarChart3, ListOrdered, Settings } from 'lucide-react';
import { useTabStore } from '@/store';
import type { TabId } from '@/store';

const TABS: { id: TabId; icon: typeof Bot; label: string }[] = [
  { id: 'ai', icon: Bot, label: 'AI' },
  { id: 'trade', icon: BarChart3, label: 'Trade' },
  { id: 'portfolio', icon: LayoutDashboard, label: 'Portfolio' },
  { id: 'orders', icon: ListOrdered, label: 'Orders' },
  { id: 'settings', icon: Settings, label: 'Settings' },
];

export function BottomNav() {
  const { activeTab, setTab } = useTabStore();
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const checkPending = () => {
      fetch('/api/baskets?status=draft')
        .then(r => r.json())
        .then(data => setPendingCount(data.baskets?.length || 0))
        .catch(() => {});
    };
    checkPending();
    const interval = setInterval(checkPending, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <nav className="bottom-nav">
      {TABS.map(({ id, icon: Icon, label }) => (
        <button
          key={id}
          className={`nav-item${activeTab === id ? ' active' : ''}`}
          onClick={() => setTab(id)}
          style={{ position: 'relative' }}
        >
          <Icon className="nav-icon" size={20} strokeWidth={activeTab === id ? 2.5 : 1.5} />
          {id === 'trade' && pendingCount > 0 && (
            <span style={{
              position: 'absolute', top: -4, right: -4,
              background: '#ef4444', color: 'white',
              fontSize: 10, fontWeight: 700,
              width: 16, height: 16, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {pendingCount}
            </span>
          )}
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
