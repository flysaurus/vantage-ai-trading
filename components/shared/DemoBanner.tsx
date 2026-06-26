'use client';
import { useRouter } from 'next/navigation';

export default function DemoBanner() {
  const router = useRouter();
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '10px 20px',
      gap: 12,
    }}>
      <div style={{
        background: 'rgba(245,158,11,0.12)',
        border: '1px solid rgba(245,158,11,0.25)',
        borderRadius: 999,
        padding: '4px 10px',
        fontFamily: 'var(--font-sans)',
        fontWeight: 600,
        fontSize: 10,
        letterSpacing: '0.08em',
        color: 'var(--warning)',
      }}>
        DEMO MODE
      </div>
      <span style={{
        fontFamily: 'var(--font-sans)',
        fontWeight: 400,
        fontSize: 11,
        color: 'var(--text-muted)',
        flex: 1,
      }}>
        Simulated portfolio · {''}
        Connect a real account to unlock full features.
      </span>
      <button
        onClick={() => router.push('/settings')}
        style={{
          fontFamily: 'var(--font-sans)',
          fontWeight: 600,
          fontSize: 12,
          color: 'var(--accent)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        Connect →
      </button>
    </div>
  );
}
