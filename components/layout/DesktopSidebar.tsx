// ─── Desktop Sidebar ─────────────────────────────────────────
// Shows on ≥1024px screens instead of BottomNav.
// Same tabs, same state — just vertical with labels.

'use client';
import { Briefcase, TrendingUp, Star, Settings } from 'lucide-react';
import { useTabStore } from '@/store';
import type { TabId } from '@/store';
import CompassIcon from '../CompassIcon';

const TABS: { id: TabId; icon: typeof Briefcase; label: string }[] = [
  { id: 'portfolio', icon: Briefcase, label: 'Portfolio' },
  { id: 'invest', icon: TrendingUp, label: 'Invest' },
  { id: 'ai', icon: Briefcase, label: 'AI Advisor' },
  { id: 'watchlist', icon: Star, label: 'Watchlist' },
  { id: 'settings', icon: Settings, label: 'Settings' },
];

export function DesktopSidebar() {
  const { activeTab, setTab } = useTabStore();

  return (
    <aside className="desktop-sidebar">
      <div className="sidebar-logo">Vantage</div>
      <nav className="sidebar-nav">
        {TABS.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            className={`sidebar-item${activeTab === id ? ' active' : ''}`}
            onClick={() => setTab(id)}
          >
            {id === 'ai' ? (
              <CompassIcon size={18} color={activeTab === 'ai' ? '#22d3ee' : '#64748b'} />
            ) : (
              <Icon size={18} strokeWidth={activeTab === id ? 2.5 : 1.5} />
            )}
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div className="sidebar-version">v1.0</div>
      </div>
    </aside>
  );
}
