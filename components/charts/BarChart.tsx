'use client';

// ─── BarChart — horizontal bars (single or paired) ───────────────
// "single": one bar per label. "paired": two thin bars per label
// (current vs target) with a small legend. Plain divs — no chart lib needed,
// and no backdrop-blur. Colours come from existing --v-* tokens.
//
// NUMBERS ARE NEVER FORMATTED HERE. The server sends preformatted display
// strings (`display` / `currentDisplay` / `targetDisplay`); the numeric fields
// exist only to size the bars.

export interface BarItem {
  label: string;
  value?: number;
  display?: string;
  note?: string;
  current?: number;
  target?: number;
  currentDisplay?: string;
  targetDisplay?: string;
}

export default function BarChart({
  items,
  series = 'single',
  targetLabel,
  currentLabel,
  max,
}: {
  items: BarItem[];
  series?: 'single' | 'paired';
  targetLabel?: string;
  currentLabel?: string;
  max?: number;
}) {
  if (!items || items.length === 0) return null;

  const peak =
    max ??
    Math.max(
      1,
      ...items.map((it) =>
        series === 'paired'
          ? Math.max(it.current ?? 0, it.target ?? 0)
          : Math.abs(it.value ?? 0),
      ),
    );

  return (
    <div>
      {series === 'paired' && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 6, fontSize: 10.5 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--v-text-secondary)' }}>
            <span style={{ width: 10, height: 8, borderRadius: 2, background: 'var(--v-accent)' }} />
            {currentLabel ?? 'Current'}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--v-text-secondary)' }}>
            <span style={{ width: 10, height: 8, borderRadius: 2, background: 'var(--v-text-faint)' }} />
            {targetLabel ?? 'Target'}
          </span>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((it) => {
          if (series === 'paired') {
            const cur = it.current ?? 0;
            const tgt = it.target ?? 0;
            return (
              <div key={it.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    width: 96,
                    flexShrink: 0,
                    fontSize: 11,
                    color: 'var(--v-text-primary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  title={it.label}
                >
                  {it.label}
                </span>
                <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span
                    style={{
                      height: 7,
                      width: `${Math.min(100, (cur / peak) * 100)}%`,
                      background: 'var(--v-accent)',
                      borderRadius: 3,
                    }}
                  />
                  <span
                    style={{
                      height: 7,
                      width: `${Math.min(100, (tgt / peak) * 100)}%`,
                      background: 'var(--v-text-faint)',
                      borderRadius: 3,
                    }}
                  />
                </span>
                <span
                  style={{
                    width: 84,
                    flexShrink: 0,
                    textAlign: 'right',
                    fontSize: 10.5,
                    color: 'var(--v-text-secondary)',
                  }}
                >
                  {it.currentDisplay}
                  {it.targetDisplay ? ` / ${it.targetDisplay}` : null}
                </span>
              </div>
            );
          }

          const v = it.value ?? 0;
          return (
            <div key={it.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  width: 96,
                  flexShrink: 0,
                  fontSize: 11,
                  color: 'var(--v-text-primary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={it.note ? `${it.label} — ${it.note}` : it.label}
              >
                {it.label}
              </span>
              <span
                style={{
                  flex: 1,
                  height: 8,
                  background: 'var(--v-rule)',
                  borderRadius: 4,
                  overflow: 'hidden',
                }}
              >
                <span
                  style={{
                    display: 'block',
                    height: '100%',
                    width: `${Math.min(100, (Math.abs(v) / peak) * 100)}%`,
                    background: v < 0 ? 'var(--v-loss)' : 'var(--v-accent)',
                    borderRadius: 4,
                  }}
                />
              </span>
              <span
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 4,
                  flexShrink: 1,
                  minWidth: 0,
                  maxWidth: '52%',
                  fontSize: 10.5,
                  color: 'var(--v-text-secondary)',
                  whiteSpace: 'nowrap',
                }}
                title={it.note ? `${it.display} · ${it.note}` : it.display}
              >
                {/* The value is never truncated; the note ellipsises instead of
                    being hard-cut at the frame edge. */}
                <span style={{ flexShrink: 0 }}>{it.display}</span>
                {it.note ? (
                  <span
                    style={{
                      color: 'var(--v-text-faint)',
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    · {it.note}
                  </span>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
