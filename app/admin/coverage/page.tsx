// ─── Admin: Test Coverage ─────────────────────────────────────
// Server component — gated behind requireAdmin(). Renders, per ACTIVE cycle,
// the latest recorded result for every assigned case plus the % passed.

import { requireAdmin } from '@/lib/auth/admin-check';
import { listCycles, getCoverage, type CoverageSummary } from '@/lib/qa/test-runner';

export const dynamic = 'force-dynamic';

function resultBadge(result: 'pass' | 'fail' | 'not_run') {
  const map = {
    pass: { label: '✓ pass', color: '#3fb950', bg: 'rgba(63,185,80,0.1)' },
    fail: { label: '✗ fail', color: '#f85149', bg: 'rgba(218,54,51,0.1)' },
    not_run: { label: '— not run', color: '#8b949e', bg: 'rgba(255,255,255,0.06)' },
  } as const;
  const s = map[result];
  return (
    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: s.color, background: s.bg, borderRadius: 6, padding: '2px 8px', whiteSpace: 'nowrap' }}>
      {s.label}
    </span>
  );
}

function fmt(d: string | null) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleString();
  } catch {
    return d;
  }
}

export default async function AdminCoveragePage() {
  const { adminError } = await requireAdmin();

  if (adminError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 p-8">
        <div className="max-w-md w-full text-center">
          <div className="text-6xl mb-4">🔒</div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            Admin Access Required
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            Your account is not in the admin allowlist.
          </p>
          <a href="/" className="text-blue-600 dark:text-blue-400 hover:underline text-sm">
            ← Back to Vantage
          </a>
        </div>
      </div>
    );
  }

  let coverage: CoverageSummary[] = [];
  let note: string | null = null;

  try {
    const cycles = (await listCycles()).filter((c) => c.active !== false);
    coverage = await Promise.all(cycles.map((c) => getCoverage(c.id)));
  } catch (e: any) {
    note = e?.message || 'Failed to load coverage.';
  }

  return (
    <div style={{ padding: '1.5rem', maxWidth: 980, margin: '0 auto', color: '#c9d1d9' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0 0 1.25rem', color: '#f0f6fc' }}>
        Test Coverage
      </h1>

      {note && (
        <div style={{ background: 'rgba(218,54,51,0.1)', border: '1px solid #da3633', borderRadius: 8, padding: '10px 14px', marginBottom: '1rem', fontSize: '0.85rem', color: '#f85149' }}>
          {note}
        </div>
      )}

      {coverage.length === 0 && !note && (
        <p style={{ color: '#8b949e', fontSize: '0.9rem' }}>No active cycles yet.</p>
      )}

      {coverage.map((cy) => (
        <section key={cy.cycle_id} style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 10, padding: '16px 18px', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 600, margin: 0, color: '#f0f6fc' }}>{cy.cycle_name}</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: '0.8rem' }}>
              <span style={{ color: '#3fb950' }}>{cy.passed} pass</span>
              <span style={{ color: '#f85149' }}>{cy.failed} fail</span>
              <span style={{ color: '#8b949e' }}>{cy.not_run} not run</span>
              <span style={{ fontWeight: 700, color: cy.percent_passed === 100 ? '#3fb950' : '#e3b341' }}>
                {cy.percent_passed}% passed
              </span>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#8b949e' }}>
                  <th style={th}>TC</th>
                  <th style={th}>Title</th>
                  <th style={th}>Latest</th>
                  <th style={th}>Tester</th>
                  <th style={th}>Date</th>
                </tr>
              </thead>
              <tbody>
                {cy.rows.map((r) => (
                  <tr key={r.test_case_id} style={{ borderTop: '1px solid #21262d' }}>
                    <td style={{ ...td, fontFamily: 'ui-monospace, monospace', color: '#58a6ff' }}>{r.tc_number}</td>
                    <td style={td}>{r.title || '(untitled)'}</td>
                    <td style={td}>{resultBadge(r.result)}</td>
                    <td style={{ ...td, color: '#8b949e' }}>{r.tester_name || '—'}</td>
                    <td style={{ ...td, color: '#8b949e' }}>{fmt(r.created_at)}</td>
                  </tr>
                ))}
                {cy.rows.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ ...td, color: '#8b949e' }}>
                      No cases assigned to this cycle.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

const th: React.CSSProperties = { padding: '6px 8px', fontWeight: 600 };
const td: React.CSSProperties = { padding: '8px' };
