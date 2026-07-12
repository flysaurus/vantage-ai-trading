import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Vantage — Admin',
  robots: 'noindex, nofollow',
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      {/* Admin nav bar */}
      <nav style={{
        background: '#0d1117',
        borderBottom: '1px solid #30363d',
        padding: '0 1rem',
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
        height: 48,
        flexShrink: 0,
      }}>
        <a href="/admin" style={{
          color: '#8b949e',
          textDecoration: 'none',
          fontSize: '0.875rem',
          fontWeight: 600,
          padding: '0.25rem 0.5rem',
          borderRadius: 4,
        }}>
          ⚙️ Admin
        </a>
        <a href="/?tab=settings" style={{
          color: '#f0f6fc',
          textDecoration: 'none',
          fontSize: '0.75rem',
          fontWeight: 500,
          padding: '0.25rem 0.5rem',
          borderRadius: 4,
          background: 'rgba(255,255,255,0.06)',
        }}>
          ← Back to App
        </a>
        <a href="/admin/tiers" style={{
          color: '#58a6ff',
          textDecoration: 'none',
          fontSize: '0.875rem',
          padding: '0.25rem 0.5rem',
          borderRadius: 4,
        }}>
          Tiers
        </a>
        <a href="/admin/gamification" style={{
          color: '#58a6ff',
          textDecoration: 'none',
          fontSize: '0.875rem',
          padding: '0.25rem 0.5rem',
          borderRadius: 4,
        }}>
          Gamification
        </a>
        <a href="/admin/requests" style={{
          color: '#58a6ff',
          textDecoration: 'none',
          fontSize: '0.875rem',
          padding: '0.25rem 0.5rem',
          borderRadius: 4,
        }}>
          Requests
        </a>
        <a href="/admin/users" style={{
          color: '#58a6ff',
          textDecoration: 'none',
          fontSize: '0.875rem',
          padding: '0.25rem 0.5rem',
          borderRadius: 4,
        }}>
          Users
        </a>
      </nav>
      {/* Scrollable content area */}
      <main style={{
        height: 'calc(100dvh - 48px)',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
      }}>
        {children}
      </main>
    </div>
  );
}
