'use client';

// ─── WaterfallChart — additive bridge, start → end ───────────────
// Custom (no recharts primitive). The first bar is an UNKNOWN START anchor —
// we never synthesise a starting balance. Positive steps (contributions,
// gains, income) build up from a centre line; negative steps (fees,
// withdrawals) subtract. The final bar is the account's current value.

export interface WaterfallStep {
  label: string;
  delta: number | null;
  kind: 'start' | 'contrib' | 'gain' | 'income' | 'fee' | 'withdraw' | 'end';
  partial?: boolean;
  /** Server-preformatted amount (e.g. "+$1,234.56"). Null on the unknown start. */
  display?: string | null;
}

const KIND_COLOR: Record<WaterfallStep['kind'], string> = {
  start: 'var(--v-text-faint)',
  contrib: 'var(--v-accent)',
  gain: 'var(--v-hero-gain)',
  income: 'var(--v-hero-gain)',
  fee: 'var(--v-hero-loss)',
  withdraw: 'var(--v-hero-loss)',
  end: 'var(--v-accent)',
};

export default function WaterfallChart({ steps }: { steps: WaterfallStep[] }) {
  if (!steps || steps.length === 0) return null;
  const maxAbs = Math.max(1, ...steps.map((s) => Math.abs(s.delta ?? 0)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {steps.map((s, i) => {
        const color = KIND_COLOR[s.kind] || KIND_COLOR.end;

        // Unknown-start anchor — explicitly NOT a number.
        if (s.kind === 'start') {
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  width: 130,
                  flexShrink: 0,
                  fontSize: 10.5,
                  color: 'var(--v-text-faint)',
                  lineHeight: 1.2,
                }}
              >
                {s.label}
              </span>
              <span
                style={{
                  flex: 1,
                  borderTop: '1px dashed var(--v-text-faint)',
                  height: 0,
                  opacity: 0.7,
                }}
              />
              <span style={{ width: 92, flexShrink: 0, textAlign: 'right', fontSize: 10.5, color: 'var(--v-text-faint)' }}>
                start unknown
              </span>
            </div>
          );
        }

        const delta = s.delta ?? 0;
        const isEnd = s.kind === 'end';
        const pct = isEnd ? 100 : (Math.abs(delta) / maxAbs) * 50;
        const left = isEnd ? 0 : delta >= 0 ? 50 : 50 - pct;

        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                width: 130,
                flexShrink: 0,
                fontSize: 10.5,
                color: 'var(--v-text-primary)',
                lineHeight: 1.2,
              }}
              title={s.partial ? `${s.label} (partial — see note)` : s.label}
            >
              {s.label}
              {s.partial ? ' *' : ''}
            </span>
            <span style={{ flex: 1, position: 'relative', height: 12 }}>
              {!isEnd && (
                <span
                  style={{
                    position: 'absolute',
                    left: '50%',
                    top: -2,
                    bottom: -2,
                    width: 1,
                    background: 'var(--v-rule)',
                  }}
                />
              )}
              <span
                style={{
                  position: 'absolute',
                  left: `${left}%`,
                  width: `${pct}%`,
                  height: '100%',
                  background: color,
                  opacity: isEnd ? 0.85 : 0.7,
                  borderRadius: 3,
                }}
              />
            </span>
            <span
              style={{
                width: 92,
                flexShrink: 0,
                textAlign: 'right',
                fontSize: 10.5,
                color: 'var(--v-text-secondary)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {s.display ?? ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}
