'use client';
import { useTabStore, useOrderFormStore } from '@/store';
import type { AICardComponent } from '@/types';
import { TrendingUp, TrendingDown, AlertTriangle, BarChart3, RefreshCw } from 'lucide-react';

interface ConvictionCardProps {
  card: AICardComponent;
}

const CARD_STYLES: Record<string, { bg: string; text: string; icon: typeof TrendingUp; headerColor: string }> = {
  buy_signal: {
    bg: 'rgba(74,222,128,0.2)',
    text: '#4ade80',
    icon: TrendingUp,
    headerColor: '#4ade80',
  },
  sell_signal: {
    bg: 'rgba(248,113,113,0.2)',
    text: '#f87171',
    icon: TrendingDown,
    headerColor: '#f87171',
  },
  risk_analysis: {
    bg: 'rgba(251,191,36,0.2)',
    text: '#fbbf24',
    icon: AlertTriangle,
    headerColor: '#fbbf24',
  },
  rebalance: {
    bg: 'rgba(139,92,246,0.2)',
    text: '#8b5cf6',
    icon: RefreshCw,
    headerColor: '#8b5cf6',
  },
  insight: {
    bg: 'rgba(6,182,212,0.2)',
    text: '#06b6d4',
    icon: BarChart3,
    headerColor: '#06b6d4',
  },
};

export function ConvictionCard({ card }: ConvictionCardProps) {
  const { setTab } = useTabStore();
  const { setSymbol } = useOrderFormStore();

  const style = CARD_STYLES[card.type] || CARD_STYLES.insight;
  const Icon = style.icon;

  const handleAction = (action: { label: string; action: string; params?: Record<string, string | number> }) => {
    switch (action.action) {
      case 'buy':
      case 'sell': {
        if (action.params?.symbol) {
          setSymbol(String(action.params.symbol));
        } else if (card.symbol) {
          setSymbol(card.symbol);
        }
        setTab('trade');
        break;
      }
      case 'view_chart':
      case 'details':
        setTab('portfolio');
        break;
      case 'rebalance':
        // Navigate to AI tab for rebalance plan details
        setTab('ai');
        break;
    }
  };

  return (
    <div className="component-card">
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8,
      }}>
        <Icon size={14} style={{ color: style.headerColor, flexShrink: 0 }} />
        <div className="card-header" style={{ color: style.headerColor }}>
          {card.title}
        </div>
      </div>

      {/* Symbol badge */}
      {card.symbol && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
            {card.symbol}
          </span>
          {card.conviction !== undefined && (
            <span style={{
              fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4,
              background: style.bg, color: style.text,
            }}>
              {card.conviction}% {card.type === 'risk_analysis' ? 'Risk' : 'Conviction'}
            </span>
          )}
        </div>
      )}

      {/* Price */}
      {card.price && card.price > 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
          ${card.price.toFixed(2)}
          {card.type === 'buy_signal' && ' · Entry zone'}
          {card.type === 'sell_signal' && ' · Exit zone'}
        </div>
      )}

      {/* Mini chart placeholder for trade signals */}
      {(card.type === 'buy_signal' || card.type === 'sell_signal') && (
        <div className="mini-chart" style={{
          display: 'flex', alignItems: 'flex-end', justifyContent: 'space-around',
          padding: '6px 2px', gap: 2,
        }}>
          {[40, 55, 30, 65, 45, 70, 50, 58, 42, 62].map((h, i) => (
            <div key={i} style={{
              flex: 1, height: h,
              background: card.type === 'buy_signal'
                ? 'linear-gradient(180deg, #06b6d4, #0d9488)'
                : 'linear-gradient(180deg, #f87171, #ef4444)',
              borderRadius: 2, opacity: 0.7,
            }} />
          ))}
        </div>
      )}

      {/* Reason / description */}
      {card.reason && (
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8, lineHeight: 1.5 }}>
          {card.reason}
        </div>
      )}

      {/* Metrics */}
      {card.metrics && Object.keys(card.metrics).length > 0 && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(60px, 1fr))',
          gap: 4, marginBottom: 8,
        }}>
          {Object.entries(card.metrics).map(([key, val]) => (
            <div key={key} style={{
              padding: '4px 6px', background: '#0f172a', borderRadius: 4,
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 9, color: '#64748b', textTransform: 'capitalize' }}>{key}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#cbd5e1' }}>
                {typeof val === 'number' ? val.toFixed(0) : String(val)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      {card.actions && card.actions.length > 0 && (
        <div style={{ display: 'flex', gap: 6 }}>
          {card.actions.map((action, i) => (
            <button
              key={i}
              onClick={() => handleAction(action)}
              style={{
                flex: 1, padding: '7px 11px', border: 'none', borderRadius: 6,
                fontSize: 11, fontWeight: 600, cursor: 'pointer',
                background:
                  action.action === 'buy' ? '#22c55e' :
                  action.action === 'sell' ? '#ef4444' :
                  '#334155',
                color: action.action === 'buy' || action.action === 'sell' ? 'white' : '#cbd5e1',
                transition: 'opacity 0.15s',
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}

      <style jsx>{`
        .component-card {
          background: #1e293b;
          border-radius: 10px;
          padding: 11px;
          border: 1px solid #334155;
          width: 100%;
        }
        .card-header {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }
        .mini-chart {
          height: 50px;
          background: linear-gradient(180deg, rgba(6,182,212,0.1) 0%, transparent 100%);
          border: 1px solid #334155;
          border-radius: 6px;
          margin-bottom: 8px;
        }
      `}</style>
    </div>
  );
}
