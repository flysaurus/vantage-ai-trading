'use client';

import { Lightbulb, Briefcase, TrendingUp, Settings } from 'lucide-react';
import { useTabStore } from '@/store';
import type { TabId } from '@/store';

interface NavTab {
  id: TabId;
  icon: typeof Lightbulb;
  label: string;
}

// Four tabs — Insights is the landing tab. "Holdings" is the existing
// portfolio screen (kept as-is; only the label/nav slot changed).
const TABS: NavTab[] = [
  { id: 'insights', icon: Lightbulb, label: 'Insights' },
  { id: 'portfolio', icon: Briefcase, label: 'Holdings' },
  { id: 'invest', icon: TrendingUp, label: 'Invest' },
  { id: 'settings', icon: Settings, label: 'Settings' },
];

export function BottomNav() {
  const { activeTab, setTab } = useTabStore();

  return (
    <nav
      data-testid="bottom-nav"
      className="fixed bottom-0 left-0 right-0 z-50 h-16 pb-safe flex items-center justify-around px-1"
      style={{
        background: 'var(--v-nav-bg)',
        borderTop: '0.5px solid var(--v-nav-border)',
      }}
    >
      {TABS.map(({ id, icon: Icon, label }) => {
        const isActive = activeTab === id;

        return (
          <button
            key={id}
            type="button"
            data-testid={`nav-${id}`}
            data-active={isActive ? 'true' : 'false'}
            onClick={() => setTab(id)}
            className="flex flex-col items-center"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            <Icon
              size={24}
              strokeWidth={isActive ? 2.5 : 1.5}
              color={isActive ? 'var(--v-accent)' : 'var(--v-nav-idle)'}
            />
            <span
              className="text-[11px] mt-1"
              style={{
                /* 11px label text → the AA small-label accent; the icon above keeps
                   the full-brightness accent (graphics only need 3:1). */
                color: isActive ? 'var(--v-accent-label)' : 'var(--v-nav-idle)',
                fontWeight: isActive ? 600 : 500,
              }}
            >
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

export default BottomNav;
