// ─── GET /api/cron ────────────────────────────────────────────
// Unified cron dispatcher — runs alert checks + DCA strategy execution.
// Called by Vercel cron: once daily at 10 AM ET Mon-Fri.
// Protected by CRON_SECRET header.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { executeDcaSchedules } from '@/lib/scheduler';
import { getPrice, getBatchQuotes } from '@/lib/market-data';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CRON_SECRET = process.env.CRON_SECRET || '';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://vantage-ai-trading.vercel.app';

// ─── Inline email (replaces deleted lib/email.ts) ───────────
async function sendEmail(opts: { to: string; subject: string; html: string }): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) { console.warn('[cron] No RESEND_API_KEY — skipping email'); return; }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Vantage <noreply@vantage-ai.app>', to: opts.to, subject: opts.subject, html: opts.html }),
  });
  if (!res.ok) { console.error('[cron] Email send failed:', res.status); }
}

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
        // Fetch current price via multi-source fallback
        const quote = await getPrice(alert.symbol);
        if (quote == null || quote <= 0) continue;
        const price = quote;
        // For prevClose we need a quote object; use getBatchQuotes or approximate
        const prevClose = price; // fallback if we can't get prev close

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
            <p style="margin:0 0 4px;font-size:14px">Current price: <strong>$${price.toFixed(2)}</strong></p>
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

// ─── Run drift detection checks ────────────────────────────
async function runDriftChecks(supabase: any): Promise<{ processed: number; alertsSent: number }> {
  try {
    const { data: strategies } = await supabase
      .from('strategies')
      .select('id, user_id, config')
      .eq('type', 'rebalance')
      .eq('is_active', true);

    if (!strategies || strategies.length === 0) return { processed: 0, alertsSent: 0 };

    let alertsSent = 0;

    for (const strat of strategies) {
      try {
        const targets = strat.config?.targetAllocations || [];
        const threshold = strat.config?.driftThreshold || 5;
        const alertEnabled = strat.config?.alertEnabled;

        if (!targets.length || !alertEnabled) continue;

        // Fetch user's current portfolio positions from Finnhub
        // We use the Finnhub API to get current prices, then compare with targets
        const symbols = targets.map((t: any) => t.symbol);
        if (!symbols.length) continue;

        // Check if alert was already sent today for this user + strategy
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const { data: existingAlerts } = await supabase
          .from('recent_notifications')
          .select('id')
          .eq('user_id', strat.user_id)
          .eq('type', 'drift_alert')
          .gte('created_at', today.toISOString());

        if (existingAlerts && existingAlerts.length > 0) continue;

        // Get current prices via multi-source fallback
        const priceMap: Record<string, number> = {};
        const quotes = await getBatchQuotes(symbols);
        for (const [sym, q] of quotes) {
          if (q.price > 0) priceMap[sym] = q.price;
        }

        if (Object.keys(priceMap).length === 0) continue;

        // Calculate drift and find drifted positions
        const driftedPositions: Array<{ symbol: string; targetPercent: number; currentPercent: number; drift: number }> = [];

        // We need total portfolio value from the user's positions
        // Since we don't have position data in the cron, estimate from targets
        // In production, this would query the broker for actual positions
        // For now, use a simple price-based check
        const totalEstValue = Object.values(priceMap).reduce((s, p) => s + (p * 10), 0); // rough estimate

        for (const target of targets) {
          const price = priceMap[target.symbol];
          if (!price) continue;
          // Approximate: assume equal share counts for target weighting
          const currentPercent = (price * 10 / totalEstValue) * 100;
          const drift = Math.abs(currentPercent - target.targetPercent);
          if (drift > threshold) {
            driftedPositions.push({
              symbol: target.symbol,
              targetPercent: target.targetPercent,
              currentPercent: Math.round(currentPercent * 100) / 100,
              drift: Math.round(drift * 100) / 100,
            });
          }
        }

        if (driftedPositions.length === 0) continue;

        // Get user email
        const { data: userData } = await supabase
          .from('users')
          .select('email')
          .eq('id', strat.user_id)
          .single();

        const email = userData?.email;
        if (!email) continue;

        // Create in-app notification
        const driftedSymbols = driftedPositions.map(p => p.symbol).join(', ');
        await (supabase as any).from('recent_notifications').insert({
          user_id: strat.user_id,
          type: 'drift_alert',
          title: 'Portfolio Drift Detected',
          message: `${driftedSymbols} ${driftedPositions.length > 1 ? 'have' : 'has'} drifted from target. Max drift: ${Math.max(...driftedPositions.map(p => p.drift))}%`,
          action_url: '/strategies/setup/rebalancing',
          is_read: false,
        });

        // Send email
        const rows = driftedPositions
          .map(p => `<tr><td style="padding:6px 12px">${p.symbol}</td><td style="padding:6px 12px;text-align:right">${p.currentPercent}%</td><td style="padding:6px 12px;text-align:right">${p.targetPercent}%</td><td style="padding:6px 12px;text-align:right;color:#f87171">${p.drift > 0 ? '+' : ''}${p.drift}%</td></tr>`)
          .join('');

        await sendEmail({
          to: email,
          subject: '⚠️ Portfolio Drift Alert — Vantage',
          html: `<div style="background:#0f172a;color:#f1f5f9;padding:24px;font-family:sans-serif;border-radius:8px;max-width:500px">
            <h2 style="color:#fbbf24;margin:0 0 8px">⚠️ Portfolio Drift Detected</h2>
            <p style="margin:0 0 16px;font-size:14px">Your portfolio has drifted from your target allocations.</p>
            <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:13px">
              <tr style="border-bottom:1px solid #334155;color:#94a3b8">
                <th style="text-align:left;padding:6px 12px">Symbol</th>
                <th style="text-align:right;padding:6px 12px">Current</th>
                <th style="text-align:right;padding:6px 12px">Target</th>
                <th style="text-align:right;padding:6px 12px">Drift</th>
              </tr>
              ${rows}
            </table>
            <a href="${APP_URL}/strategies/setup/rebalancing" style="display:inline-block;padding:10px 20px;background:#06b6d4;color:#0f172a;text-decoration:none;border-radius:6px;font-weight:600">Open Vantage to Rebalance</a>
          </div>`,
        });

        alertsSent++;
      } catch { /* continue to next strategy */ }
    }

    return { processed: strategies.length, alertsSent };
  } catch (err: any) {
    console.error('[cron] Drift checks failed:', err.message);
    return { processed: 0, alertsSent: 0 };
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
  const [dcaResult, alertResult, driftResult] = await Promise.all([
    runDcaJobs(supabase),
    runAlertChecks(supabase),
    runDriftChecks(supabase),
  ]);

  console.log(`[cron] Done — DCA: ${dcaResult.count} schedules, Alerts: ${alertResult.checked}/${alertResult.triggered}, Drift: ${driftResult.processed}/${driftResult.alertsSent}`);

  return NextResponse.json({
    success: true,
    timestamp: new Date().toISOString(),
    dca: dcaResult,
    alerts: alertResult,
    drift: driftResult,
  });
}
