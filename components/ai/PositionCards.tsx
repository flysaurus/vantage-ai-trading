'use client';
// ─── PositionCards — render structured [POSITION:{...}] markers as cards ───
// The AI emits [POSITION:{"ticker":"IJR","name":"Small-Cap","pct":15,"thesis":"..."}]
// markers alongside each position in a portfolio-build response. This component
// renders each as a compact card (ticker + role name + pct badge + one-line
// thesis) in place of the raw JSON. It is purely presentational — parsing lives
// in InlineTradeButton.parsePositions, stripping in stripRecommendationMarkers.
import type { PositionMarker } from '@/lib/portfolio-types';

const CARD_STYLE: React.CSSProperties = {
  background: 'var(--v-chat-fill)',
  border: '1px solid var(--v-chat-border)',
  borderRadius: '10px',
  padding: '10px 12px',
};

export function PositionCard({ card }: { card: PositionMarker }) {
  return (
    <div style={CARD_STYLE}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
        marginBottom: card.thesis ? '4px' : '0',
      }}>
        <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--v-chat-text)' }}>
          {card.ticker}
          {card.name ? (
            <span style={{ color: 'var(--v-chat-text-3)', fontWeight: 600 }}> — {card.name}</span>
          ) : null}
        </div>
        {card.pct != null && !Number.isNaN(card.pct) ? (
          <span style={{
            fontSize: '11px',
            fontWeight: 700,
            color: 'var(--v-accent-label)',
            background: 'var(--v-chat-accent-soft)',
            border: '1px solid var(--v-chat-accent-border)',
            borderRadius: '999px',
            padding: '2px 8px',
            whiteSpace: 'nowrap',
          }}>
            {card.pct}%
          </span>
        ) : null}
      </div>
      {card.thesis ? (
        <div style={{ fontSize: '12px', color: 'var(--v-chat-text-2)', lineHeight: 1.55 }}>
          {card.thesis}
        </div>
      ) : null}
    </div>
  );
}

export function PositionCards({ positions }: { positions: PositionMarker[] }) {
  if (!positions || positions.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', margin: '8px 0' }}>
      {positions.map((p, i) => (
        <PositionCard key={`${p.ticker}-${i}`} card={p} />
      ))}
    </div>
  );
}
