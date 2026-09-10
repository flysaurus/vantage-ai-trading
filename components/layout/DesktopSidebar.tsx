// ─── Desktop Sidebar ─────────────────────────────────────────
// Shows on ≥1024px screens instead of BottomNav.
// Same tabs, same state — just vertical with labels.

'use client';
import { Lightbulb, Briefcase, TrendingUp, Settings } from 'lucide-react';
import { useTabStore } from '@/store';
import type { TabId } from '@/store';

const TABS: { id: TabId; icon: typeof Lightbulb; label: string }[] = [
  { id: 'insights', icon: Lightbulb, label: 'Insights' },
  { id: 'portfolio', icon: Briefcase, label: 'Holdings' },
  { id: 'invest', icon: TrendingUp, label: 'Invest' },
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
            <Icon size={18} strokeWidth={activeTab === id ? 2.5 : 1.5} />
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
