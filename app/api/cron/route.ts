// ─── GET /api/cron ────────────────────────────────────────────
// Unified cron dispatcher — runs alert checks + DCA strategy execution.
// Called by Vercel cron: once daily at 10 AM ET Mon-Fri.
// Protected by CRON_SECRET header.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { executeDcaSchedules } from '@/lib/scheduler';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CRON_SECRET = process.env.CRON_SECRET || '';
const FINNHUB_KEY = process.env.FINNHUB_IO_API_KEY || '';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://vantage-ai-trading.vercel.app';

export const maxDuration = 55;

// ─── Run DCA execution ──────────────────────────────────────
async function runDcaJobs(supabase: any): Promise<{ count: number; results: any[] }> {
  try {
    const results = await executeDcaSchedules(supabase);
    return { count: results.length, results };
  } catch (err: any) {
    console.error('[cron] DCA execution failed:', err.message);
    return { count: 0, results: [] };
  }
}

// ─── Run alert checks ───────────────────────────────────────
async function runAlertChecks(supabase: any): Promise<{ checked: number; triggered: number }> {
  try {
    const { data: alerts } = await supabase
      .from('alerts')
      .select('id, user_id, symbol, type, threshold, notification_channels')
      .eq('is_active', true);

    if (!alerts || alerts.length === 0) return { checked: 0, triggered: 0 };

    let triggered = 0;

    for (const alert of alerts) {
      try {
        // Fetch current price
        if (!FINNHUB_KEY) continue;
        const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${alert.symbol}&token=${FINNHUB_KEY}`);
        if (!res.ok) continue;
        const data = await res.json();
        const price = data.c ?? null;
        const prevClose = data.pc ?? price;
        if (price == null || price <= 0) continue;

        let shouldTrigger = false;
        switch (alert.type) {
          case 'price_above':
            shouldTrigger = price >= alert.threshold;
            break;
          case 'price_below':
            shouldTrigger = price <= alert.threshold;
            break;
          case 'percent_change':
            if (prevClose > 0) {
              const pct = ((price - prevClose) / prevClose) * 100;
              shouldTrigger = Math.abs(pct) >= alert.threshold;
            }
            break;
        }

        if (!shouldTrigger) continue;

        // Trigger — get user email
        const { data: userData } = await supabase
          .from('users')
          .select('email')
          .eq('id', alert.user_id)
          .single();

        const email = userData?.email;
        if (!email) continue;

        // Send email notification
        const { sendEmail } = await import('@/lib/email');
        const alertTypeLabels: Record<string, string> = {
          price_above: 'Price Above',
          price_below: 'Price Below',
          percent_change: 'Percent Change',
        };
        const label = alertTypeLabels[alert.type] || alert.type;

        await sendEmail({
          to: email,
          subject: `Vantage Alert: ${alert.symbol} — ${label}`,
          html: `<div style="background:#0f172a;color:#f1f5f9;padding:24px;font-family:sans-serif;border-radius:8px">
            <h2 style="color:#06b6d4;margin:0 0 8px">🔔 Alert Triggered</h2>
            <p style="margin:0 0 16px"><strong>${alert.symbol}</strong> hit your ${label.toLowerCase()} alert  of <strong>${alert.threshold}</strong>.</p>
            <p style="margin:0 0 4px;font-size:14px">Current price: <strong>$${price.toFixed(2)}</strong> (${data.dp != null ? (data.dp >= 0 ? '+' : '') + data.dp.toFixed(2) + '%' : '--'})</p>
            <a href="${APP_URL}/price-alerts" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#06b6d4;color:#0f172a;text-decoration:none;border-radius:6px;font-weight:600">View Alerts</a>
          </div>`,
        });

        triggered++;
      } catch { /* continue */ }
    }

    return { checked: alerts.length, triggered };
  } catch (err: any) {
    console.error('[cron] Alert checks failed:', err.message);
    return { checked: 0, triggered: 0 };
  }
}

// ─── Handler ────────────────────────────────────────────────
export async function GET(req: NextRequest): Promise<NextResponse> {
  // Validate cron secret
  const authHeader = req.headers.get('authorization');
  const expectedAuth = `Bearer ${CRON_SECRET}`;
  if (!CRON_SECRET || authHeader !== expectedAuth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log('[cron] Starting unified cron run...');

  // Run in parallel
  const [dcaResult, alertResult] = await Promise.all([
    runDcaJobs(supabase),
    runAlertChecks(supabase),
  ]);

  console.log(`[cron] Done — DCA: ${dcaResult.count} schedules, Alerts: ${alertResult.checked} checked / ${alertResult.triggered} triggered`);

  return NextResponse.json({
    success: true,
    timestamp: new Date().toISOString(),
    dca: dcaResult,
    alerts: alertResult,
  });
}
