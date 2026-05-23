'use client';
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
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
