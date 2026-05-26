'use client';

import React, { useEffect, useState } from 'react';
import { Header } from '@/components/layout/Header';
import { BottomNav } from '@/components/layout/BottomNav';
import { DesktopSidebar } from '@/components/layout/DesktopSidebar';
import { MarketBar } from '@/components/layout/MarketBar';
import { WatchlistBar } from '@/components/layout/WatchlistBar';
import { AITab } from '@/components/ai/AITab';
import { TradeTab } from '@/components/trade/TradeTab';
import { PortfolioTab } from '@/components/portfolio/PortfolioTab';
import { OrdersTab } from '@/components/orders/OrdersTab';
import { SettingsTab } from '@/components/settings/SettingsTab';
import { BrokerProvider } from '@/components/providers/BrokerProvider';
import { useAuth } from '@/components/providers/AuthProvider';
import { InvestorStyleOnboarding } from '@/components/onboarding/InvestorStyleOnboarding';
import { getUser, storeUser } from '@/lib/auth';
import { useTabStore } from '@/store';
import type { TabId } from '@/store';

const TAB_COMPONENTS: Record<TabId, React.FC> = {
  ai: AITab,
  trade: TradeTab,
  portfolio: PortfolioTab,
  orders: OrdersTab,
  settings: SettingsTab,
};

function AppShell() {
  const { activeTab } = useTabStore();
  const { user, profileSynced } = useAuth();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  // Detect desktop width for sidebar vs bottom nav
  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 1024);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Show onboarding for authenticated users who haven't set their style.
  // Only after DB profile sync completes — avoids flash before DB value is known.
  useEffect(() => {
    if (!user || !profileSynced) return;
    const localStorageOnboarded = typeof window !== 'undefined'
      ? localStorage.getItem('vantage:onboarded') === 'true'
      : false;
    if (user.investorStyleOnboarded || localStorageOnboarded) {
      setShowOnboarding(false);
      return;
    }
    setShowOnboarding(true);
  }, [user, profileSynced]);

  const mainContent = (
    <>
      <Header />
      <MarketBar />
      <WatchlistBar />
      <div className="content-area" key={activeTab}>
        {React.createElement(TAB_COMPONENTS[activeTab])}
      </div>
      {!isDesktop && <BottomNav />}
    </>
  );

  return (
    <BrokerProvider brokerId="alpaca" config={{ environment: 'paper' }}>
      <div className="app-shell">
        {isDesktop && <DesktopSidebar />}
        {isDesktop ? <div className="main-panel">{mainContent}</div> : mainContent}
      </div>

      {/* Onboarding Overlay */}
      {showOnboarding && user && (
        <InvestorStyleOnboarding
          userId={user.id}
          onComplete={(style) => {
            // Persist immediately — localStorage is synchronous, survives everything
            if (typeof window !== 'undefined') {
              localStorage.setItem('vantage:onboarded', 'true');
              localStorage.setItem('vantage:investorStyle', style);
              // Also flush to sessionStorage so AuthProvider picks it up on reload
              try {
                const cached = getUser();
                storeUser({
                  id: cached?.id || '',
                  email: cached?.email || '',
                  displayName: cached?.displayName || 'Trader',
                  investorStyle: style,
                  investorStyleOnboarded: true,
                  createdAt: cached?.createdAt || '',
                });
              } catch { /* ignore */ }
            }
            setShowOnboarding(false);
            // Small delay to ensure localStorage flush before reload
            setTimeout(() => window.location.reload(), 100);
          }}
        />
      )}
    </BrokerProvider>
  );
}

export default function Home() {
  return <AppShell />;
}
