'use client';
import { useState } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { InvestorStyleSelector } from '@/components/settings/InvestorStyleSelector';
import type { InvestorStyle } from '@/types';
import { 
  Star, Bell, Newspaper, CalendarDays, Search, 
  History, Target, CreditCard, Plug, Settings2, HelpCircle,
  ChevronRight, Building2, CircleDot, Plus
} from 'lucide-react';
import type { BrokerId } from '@/types/broker';

interface SettingsItemProps {
  icon: typeof Star;
  title: string;
  subtitle: string;
  badge?: number;
  onClick?: () => void;
}

function SettingsItem({ icon: Icon, title, subtitle, badge, onClick }: SettingsItemProps) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: 12,
        cursor: 'pointer', borderBottom: '1px solid #0f172a',
      }}
    >
      <div style={{
        width: 32, height: 32, borderRadius: 8,
        background: 'rgba(6,182,212,0.1)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={16} style={{ color: '#06b6d4' }} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>
      </div>
      {badge ? (
        <span style={{ background: '#ef4444', color: 'white', fontSize: 9, padding: '2px 6px', borderRadius: 8, fontWeight: 700 }}>
          {badge}
        </span>
      ) : null}
      <ChevronRight size={14} style={{ color: '#64748b' }} />
    </div>
  );
}

interface BrokerItem {
  id: BrokerId;
  name: string;
  status: 'connected' | 'disconnected' | 'coming_soon';
  logo?: string;
  description: string;
}

const BROKERS: BrokerItem[] = [
  { id: 'alpaca', name: 'Alpaca Markets', status: 'connected', description: 'Paper trading active' },
  { id: 'ibkr', name: 'Interactive Brokers', status: 'coming_soon', description: 'Coming in Q3 2026' },
  { id: 'tastytrade', name: 'tastytrade', status: 'coming_soon', description: 'Coming in Q3 2026' },
  { id: 'schwab', name: 'Charles Schwab', status: 'coming_soon', description: 'Coming in Q4 2026' },
  { id: 'robinhood', name: 'Robinhood', status: 'coming_soon', description: 'Coming in Q4 2026' },
];

export function SettingsTab() {
  const { user } = useAuth();
  const [showBrokers, setShowBrokers] = useState(false);
  const [investorStyle, setInvestorStyle] = useState<InvestorStyle>(
    user?.investorStyle || 'buffett'
  );

  const connectedBroker = BROKERS.find(b => b.status === 'connected');

  return (
    <div style={{ padding: '12px 16px 80px' }}>
      {/* Portfolio & Research */}
      <div className="section">
        <SettingsItem icon={Star} title="Watchlists" subtitle="3 lists · 24 symbols" />
        <SettingsItem icon={Bell} title="Price Alerts" subtitle="5 active alerts" badge={2} />
        <SettingsItem icon={Newspaper} title="News Feed" subtitle="AI-curated for your portfolio" />
        <SettingsItem icon={CalendarDays} title="Earnings Calendar" subtitle="3 holdings reporting this week" />
        <SettingsItem icon={Search} title="Stock Screener" subtitle="Find new opportunities" />
      </div>

      {/* Investor Style */}
      <div className="section" style={{ marginTop: 12 }}>
        <SettingsItem icon={Star} title="Investor Style" subtitle={`${investorStyle.charAt(0).toUpperCase() + investorStyle.slice(1)} · Tap to change`} />
      </div>

      {/* Account & History */}
      <div className="section" style={{ marginTop: 12 }}>
        <SettingsItem icon={History} title="Trade History" subtitle="All time activity & taxes" />
        <SettingsItem icon={Target} title="Goals & Targets" subtitle="Track financial milestones" />
      </div>

      {/* System */}
      <div className="section" style={{ marginTop: 12 }}>
        <SettingsItem icon={CreditCard} title="Account & Funding" subtitle="Deposits, withdrawals, tax docs" />
        <SettingsItem 
          icon={Plug} 
          title="Connected Brokers" 
          subtitle={connectedBroker ? `${connectedBroker.name} · ${connectedBroker.description}` : 'Not connected'}
          onClick={() => setShowBrokers(!showBrokers)}
        />
        <SettingsItem icon={Settings2} title="Preferences" subtitle="Appearance, notifications & security" />
        <SettingsItem icon={HelpCircle} title="Help & Support" subtitle="Documentation & contact" />
      </div>

      {/* Broker Selector */}
      {showBrokers && (
        <div className="section" style={{ marginTop: 12 }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid #0f172a', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>
            CHOOSE YOUR BROKER
          </div>
          {BROKERS.map((b) => (
            <div
              key={b.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: 14,
                cursor: b.status === 'coming_soon' ? 'default' : 'pointer',
                borderBottom: '1px solid #0f172a',
                opacity: b.status === 'coming_soon' ? 0.5 : 1,
              }}
            >
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: b.status === 'connected' ? 'rgba(6,182,212,0.15)' : 'rgba(100,116,139,0.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Building2 size={18} style={{ color: b.status === 'connected' ? '#06b6d4' : '#64748b' }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {b.name}
                  {b.status === 'connected' && <CircleDot size={10} style={{ color: '#22c55e' }} />}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                  {b.status === 'coming_soon' ? (
                    <span style={{ color: 'var(--accent-teal)' }}>{b.description}</span>
                  ) : b.description}
                </div>
              </div>
              {b.status === 'coming_soon' && (
                <span style={{ fontSize: 9, color: '#64748b', background: 'rgba(100,116,139,0.15)', padding: '2px 8px', borderRadius: 6 }}>
                  SOON
                </span>
              )}
            </div>
          ))}
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: 14,
              cursor: 'pointer', color: '#06b6d4', fontSize: 13, fontWeight: 600,
              borderBottom: 'none',
            }}
          >
            <Plus size={14} />
            Request a broker
          </div>
        </div>
      )}

      {/* App Info */}
      <div style={{ textAlign: 'center', marginTop: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 600, background: 'linear-gradient(135deg, #06b6d4, #0d9488)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          Vantage v0.1.0
        </div>
        <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 4 }}>
          AI-First · Mobile-First · Built with ❤️
        </div>
      </div>

      {/* Investor Style Selector */}
      {user && (
        <InvestorStyleSelector
          userId={user.id}
          currentStyle={investorStyle}
          onStyleChanged={(newStyle) => setInvestorStyle(newStyle)}
        />
      )}

      <style jsx>{`
        .section {
          background: #1e293b;
          border: 1px solid #334155;
          border-radius: 12px;
          overflow: hidden;
        }
        .section > div:last-child { border-bottom: none; }
      `}</style>
    </div>
  );
}
