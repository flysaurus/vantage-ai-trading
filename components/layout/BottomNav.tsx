'use client';

import { Home, TrendingUp, Settings } from 'lucide-react';
import { useTabStore } from '@/store';
import type { TabId } from '@/store';

interface NavTab {
  id: TabId;
  icon: typeof Home;
  label: string;
}

const TABS: NavTab[] = [
  { id: 'today', icon: Home, label: 'Today' },
  { id: 'invest', icon: TrendingUp, label: 'Invest' },
  { id: 'settings', icon: Settings, label: 'Settings' },
];

export function BottomNav() {
  const { activeTab, setTab } = useTabStore();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 h-16 bg-slate-900 border-t border-slate-800 pb-safe flex items-center justify-around px-1">
      {TABS.map(({ id, icon: Icon, label }) => {
        const isActive = activeTab === id;

        return (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="flex flex-col items-center"
          >
            <Icon
              size={24}
              strokeWidth={isActive ? 2.5 : 1.5}
              className={isActive ? 'text-cyan-400' : 'text-slate-300'}
            />
            <span className={`text-[11px] mt-1 ${isActive ? 'text-cyan-400 font-semibold' : 'text-slate-300 font-medium'}`}>
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
