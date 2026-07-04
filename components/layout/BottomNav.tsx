'use client';

import { Briefcase, TrendingUp, Star, Settings } from 'lucide-react';
import { useTabStore } from '@/store';
import type { TabId } from '@/store';
import CompassIcon from '../CompassIcon';

interface NavTab {
  id: TabId;
  icon: typeof Briefcase;
  label: string;
  isRaised?: boolean;
}

const TABS: NavTab[] = [
  { id: 'portfolio', icon: Briefcase, label: 'Portfolio' },
  { id: 'invest', icon: TrendingUp, label: 'Invest' },
  { id: 'ai', icon: Briefcase, label: 'AI', isRaised: true },
  { id: 'watchlist', icon: Star, label: 'Watchlist' },
  { id: 'settings', icon: Settings, label: 'Settings' },
];

export function BottomNav() {
  const { activeTab, setTab } = useTabStore();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 h-16 bg-slate-900 border-t border-slate-800 pb-safe flex items-center justify-around px-1">
      {TABS.map(({ id, icon: Icon, label, isRaised }) => {
        const isActive = activeTab === id;

        if (isRaised) {
          return (
            <div key={id} className="relative flex flex-col items-center" style={{ marginTop: -20 }}>
              <button
                onClick={() => setTab(id)}
                className="w-14 h-14 bg-cyan-500 rounded-full flex items-center justify-center shadow-lg shadow-cyan-500/30 active:scale-95 transition-transform"
              >
                <CompassIcon size={28} color="white" />
              </button>
              <span className={`text-[11px] font-medium mt-1 ${isActive ? 'text-cyan-400' : 'text-slate-300'}`}>
                {label}
              </span>
            </div>
          );
        }

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
