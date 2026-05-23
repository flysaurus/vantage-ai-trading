'use client';
import { ConfidenceRing } from './ConfidenceRing';
import { QuickActions } from './QuickActions';
import { AIChat } from './AIChat';

export function AITab() {
  return (
    <>
      <ConfidenceRing />
      <div style={{ padding: '12px 16px 0' }}>
        {/* Key Insight */}
        <div className="key-insight">
          <div className="insight-title">🎯 Today&apos;s Key Insight</div>
          <div className="insight-text">
            Semiconductor exposure elevated (28%). Volatility up. Consider trimming NVDA to rebalance.
          </div>
        </div>
      </div>
      <QuickActions />
      <div className="disclaimer">
        <strong>⚠️ Disclaimer:</strong> AI suggestions are not financial advice. Always do your own research.
      </div>
      <AIChat />

      <style jsx>{`
        .key-insight {
          background: rgba(15,23,42,0.8);
          border: 1px solid #334155;
          border-radius: 10px;
          padding: 10px;
          margin-bottom: 12px;
        }
        .insight-title {
          font-size: 10px;
          color: #06b6d4;
          font-weight: 700;
          margin-bottom: 4px;
          text-transform: uppercase;
        }
        .insight-text {
          font-size: 12px;
          color: #cbd5e1;
          line-height: 1.4;
        }
        .disclaimer {
          background: rgba(251,191,36,0.1);
          border: 1px solid rgba(251,191,36,0.3);
          border-radius: 8px;
          padding: 9px;
          font-size: 10px;
          color: #cbd5e1;
          margin: 12px 16px;
          line-height: 1.4;
        }
        .disclaimer strong { color: #fbbf24; }
      `}</style>
    </>
  );
}
