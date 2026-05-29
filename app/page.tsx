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
  const { user, isDataLoaded } = useAuth();
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
  // The API (/api/auth/me) is the authoritative source — localStorage is only
  // a cache, and when the API says the user hasn't been onboarded, we clear
  // any stale localStorage to prevent it from blocking the modal.
  useEffect(() => {
    if (!user || !isDataLoaded) return;

    if (user.investorStyleOnboarded) {
      setShowOnboarding(false);
      return;
    }

    // API says not onboarded — clear any stale localStorage that might
    // have been set by a prior testing session or corrupt cache.
    if (typeof window !== 'undefined') {
      localStorage.removeItem('vantage:onboarded');
    }

    setShowOnboarding(true);
  }, [user, isDataLoaded]);

  // 🔒 HARD GATE: Don't render ANY dashboard content until DB profile is confirmed.
  // Prevents cascading 401/500 API errors from dashboard components
  // that mount before auth synchronization completes.
  // AuthGuard handles the loading spinner and error screens above this.
  if (!isDataLoaded || !user) {
    return null;
  }

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
    <BrokerProvider>
      <div className="app-shell">
        {isDesktop && <DesktopSidebar />}
        {isDesktop ? <div className="main-panel">{mainContent}</div> : mainContent}
      </div>

      {/* Onboarding Overlay */}
      {showOnboarding && (
        <InvestorStyleOnboarding />
      )}
    </BrokerProvider>
  );
}

export default function Home() {
  return <AppShell />;
}
