'use client';

// ─── StatCallout — one headline number + a short context line ────

export default function StatCallout({
  value,
  context,
}: {
  value: string;
  context?: string;
}) {
  return (
    <div
      data-testid="chat-stat"
      style={{ display: 'flex', flexDirection: 'column', gap: 2 }}
    >
      <span
        style={{
          fontSize: 26,
          fontWeight: 700,
          lineHeight: 1.1,
          color: 'var(--v-text-primary)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
      {context && (
        <span style={{ fontSize: 11, color: 'var(--v-text-secondary)' }}>{context}</span>
      )}
    </div>
  );
}
