import { requireAdmin } from '@/lib/auth/admin-check';
import { GamificationEditor } from './editor';

export default async function GamificationConfigPage() {
  const { adminUser, adminError } = await requireAdmin();

  if (adminError) {
    return (
      <div style={{ padding: '2rem', maxWidth: 600, margin: '4rem auto', textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>🔒 Admin Access Required</h1>
        <p style={{ color: '#666' }}>
          This page is restricted to authorized administrators.
          If you believe this is an error, contact your system admin.
        </p>
        <a href="/?tab=settings" style={{ color: '#58a6ff', textDecoration: 'none', fontSize: '0.875rem' }}>← Back to Settings</a>
      </div>
    );
  }

  return <GamificationEditor />;
}
