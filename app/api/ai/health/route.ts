// ─── AI Advisor Health Check (Phase 7 Observability) ───
// GET /api/ai/health — returns circuit breaker states, recent errors,
// and per-dependency health. Used by monitoring dashboards.

import { NextResponse } from 'next/server';
import { getHealthSummary, getAllBreakerStates, getRecentLogs } from '@/lib/ai/resilience';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const health = getHealthSummary();
    const breakerStates = getAllBreakerStates();
    const recentErrors = getRecentLogs(20).filter(e => e.level === 'error');

    const allHealthy = Object.values(health.breakers).every(b => b.state !== 'open');
    const status = allHealthy ? 'healthy' : 'degraded';

    return NextResponse.json({
      status,
      timestamp: Date.now(),
      breakers: health.breakers,
      breakerStates: Object.fromEntries(
        Object.entries(breakerStates).map(([name, state]) => [
          name,
          { ...state, failureRate: state.totalCalls > 0 ? state.totalFailures / state.totalCalls : 0 },
        ])
      ),
      recentErrors: recentErrors.map(e => ({
        timestamp: e.timestamp,
        stage: e.stage,
        dependency: e.dependency,
        message: e.message,
      })),
      recentErrorCount: health.recentErrors,
    }, { status: allHealthy ? 200 : 503 });
  } catch (err: any) {
    return NextResponse.json({
      status: 'error',
      error: err.message,
      timestamp: Date.now(),
    }, { status: 500 });
  }
}
