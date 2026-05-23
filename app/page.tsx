'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { BottomNav } from '@/components/layout/BottomNav';
import { MarketBar } from '@/components/layout/MarketBar';
import { WatchlistBar } from '@/components/layout/WatchlistBar';
import { AITab } from '@/components/ai/AITab';
import { TradeTab } from '@/components/trade/TradeTab';
import { PortfolioTab } from '@/components/portfolio/PortfolioTab';
import { OrdersTab } from '@/components/orders/OrdersTab';
import { SettingsTab } from '@/components/settings/SettingsTab';
import { BrokerProvider } from '@/components/providers/BrokerProvider';
import { AuthProvider, useAuth } from '@/components/providers/AuthProvider';
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
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const TabContent = TAB_COMPONENTS[activeTab];

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isLoading, isAuthenticated, router]);

  // Loading state — subtle pulse animation
  if (isLoading) {
    return (
      <div className="app-shell">
        <div className="loading-screen">
          <div className="loading-logo">
            <span className="logo">Vantage</span>
          </div>
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  // Redirecting — render nothing while router pushes
  if (!isAuthenticated) {
    return null;
  }

  return (
    <BrokerProvider brokerId="alpaca" config={{ environment: 'paper' }}>
      <div className="app-shell">
        <Header />
        <MarketBar />
        <WatchlistBar />
        <div className="content-area">
          <TabContent />
        </div>
        <BottomNav />
      </div>
    </BrokerProvider>
  );
}

export default function Home() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
