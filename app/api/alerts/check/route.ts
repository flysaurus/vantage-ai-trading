// ─── GET /api/alerts/check ────────────────────────────────────
// Evaluates all active alerts against current prices (Finnhub) and
// sends notifications for triggered alerts via email.
// Called by Vercel cron job.
//
// POST /api/alerts/check?symbol=AAPL
//   Checks just one symbol (called after price updates).

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
// Inline Resend email sender (replaces deleted lib/email.ts)
async function sendEmail(opts: { to: string; subject: string; html: string }): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[alerts/check] No RESEND_API_KEY set — skipping email');
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Vantage Alerts <alerts@vantage-ai.app>',
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    console.error('[alerts/check] Email send failed:', res.status, errBody.slice(0, 200));
  }
}
import { getBatchQuotes } from '@/lib/market-data';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://vantage-ai-trading.vercel.app';

type AlertRow = {
  id: string;
  user_id: string;
  symbol: string;
  type: 'price_above' | 'price_below' | 'percent_change';
  threshold: number;
  notification_channels: string[];
};

// ─── Multi-source price fetch ──────────────────────────────
async function getCurrentPrice(symbol: string): Promise<{ price: number; prevClose: number } | null> {
  const quotes = await getBatchQuotes([symbol]);
  const q = quotes.get(symbol.toUpperCase());
  if (!q || q.price <= 0) return null;
  return { price: q.price, prevClose: q.previousClose || q.price };
}

// ─── Trigger check ──────────────────────────────────────────
function isTriggered(
  alert: AlertRow,
  price: number,
  prevClose: number,
): boolean {
  switch (alert.type) {
    case 'price_above':
      return price >= alert.threshold;
    case 'price_below':
      return price <= alert.threshold;
    case 'percent_change': {
      if (prevClose <= 0) return false;
      const changePct = ((price - prevClose) / prevClose) * 100;
      const absChange = Math.abs(changePct);
      const absTarget = Math.abs(alert.threshold);
      return absChange >= absTarget;
    }
    default:
      return false;
  }
}

// ─── Email templates ────────────────────────────────────────
function getAlertEmailHTML(params: {
  symbol: string;
  price: number;
  alertType: string;
  targetValue: number;
  prevClose: number;
}): string {
  const { symbol, price, alertType, targetValue, prevClose } = params;
  const changeStr = prevClose ? ` (${price >= prevClose ? '+' : ''}${((price - prevClose) / prevClose * 100).toFixed(2)}%)` : '';
  const condition = alertType === 'price_above'
    ? `rose above your target of $${targetValue.toFixed(2)}`
    : alertType === 'price_below'
      ? `dropped below your target of $${targetValue.toFixed(2)}`
      : `moved ${targetValue.toFixed(1)}%`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:40px 0;">
<tr><td align="center">
<table width="480" cellpadding="0" cellspacing="0" style="background:#1e293b;border-radius:12px;overflow:hidden;">
<tr><td style="padding:32px 32px 0;">
<p style="font-size:28px;font-weight:800;color:#06b6d4;margin:0;">Vantage</p>
<p style="color:#94a3b8;font-size:13px;margin:4px 0 0;">Price Alert Triggered</p>
</td></tr>
<tr><td style="padding:32px;">
<div style="background:#0f172a;border-radius:8px;padding:20px;margin-bottom:20px;">
<p style="color:#f1f5f9;font-size:18px;font-weight:700;margin:0 0 4px;font-family:monospace;">${symbol}</p>
<p style="color:#22c55e;font-size:28px;font-weight:800;margin:0;">$${price.toFixed(2)}<span style="font-size:14px;font-weight:400;color:#94a3b8;">${changeStr}</span></p>
</div>
<p style="color:#cbd5e1;font-size:15px;line-height:1.6;margin:0 0 24px;">
${symbol} ${condition}.
</p>
<table cellpadding="0" cellspacing="0">
<tr><td align="center" style="border-radius:8px;background:#06b6d4;">
<a href="${APP_URL}/price-alerts" style="display:inline-block;padding:14px 32px;color:#fff;font-size:15px;font-weight:600;text-decoration:none;">View Alerts</a>
</td></tr>
</table>
</td></tr>
<tr><td style="padding:20px 32px;background:#0f172a;border-top:1px solid #334155;">
<p style="color:#475569;font-size:11px;margin:0;">Vantage · AI Portfolio Analysis<br>This is an automated alert. Manage your alerts in the app.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

// ─── Main handler ───────────────────────────────────────────
export async function GET(req: NextRequest): Promise<NextResponse> {
  // CRON_SECRET required for cron security (Bearer token)
  const authHeader = req.headers.get('authorization') || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const expected = process.env.CRON_SECRET || '';
  if (!expected || bearerToken !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const checkSymbol = req.nextUrl.searchParams.get('symbol');

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch active alerts — production DB uses 'type' and 'threshold'
    let query = (supabase as any)
      .from('alerts')
      .select('id, user_id, symbol, type, threshold, notification_channels')
      .eq('is_active', true)
      .is('triggered_at', null);

    if (checkSymbol) {
      query = query.eq('symbol', checkSymbol.toUpperCase());
    }

    const { data: alerts, error } = await query;

    if (error) {
      console.error('[alerts/check] Query error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!alerts?.length) {
      return NextResponse.json({ checked: 0, triggered: 0, alerts: [] });
    }

    // Batch fetch all prices via multi-source fallback
    const symbolSet = [...new Set((alerts as AlertRow[]).map(a => a.symbol))];
    const quotes = await getBatchQuotes(symbolSet);
    const priceMap = new Map<string, { price: number; prevClose: number }>();
    for (const [sym, q] of quotes) {
      if (q.price > 0) priceMap.set(sym, { price: q.price, prevClose: q.previousClose || q.price });
    }

    const triggered: Array<{
      alertId: string;
      userId: string;
      symbol: string;
      price: number;
      prevClose: number;
      alertType: string;
      targetValue: number;
      channels: string[];
    }> = [];

    for (const alert of alerts as AlertRow[]) {
      const priceData = priceMap.get(alert.symbol);
      if (!priceData) continue;

      if (isTriggered(alert, priceData.price, priceData.prevClose)) {
        // Mark as triggered
        await (supabase as any)
          .from('alerts')
          .update({ triggered_at: new Date().toISOString(), is_active: false })
          .eq('id', alert.id);

        // Create in-app notification
        await (supabase as any)
          .from('recent_notifications')
          .insert({
            user_id: alert.user_id,
            alert_id: alert.id,
            type: 'price_alert',
            title: `Price Alert: ${alert.symbol}`,
            body: `${alert.symbol} ${alert.type === 'price_above' ? 'above' : alert.type === 'price_below' ? 'below' : 'changed by'} ${alert.threshold} → Current: $${priceData.price.toFixed(2)}`,
            is_read: false,
          });

        triggered.push({
          alertId: alert.id,
          userId: alert.user_id,
          symbol: alert.symbol,
          price: priceData.price,
          prevClose: priceData.prevClose,
          alertType: alert.type,
          targetValue: alert.threshold,
          channels: alert.notification_channels || ['in_app'],
        });
      }
    }

    // Send email notifications
    let emailsSent = 0;
    for (const t of triggered) {
      if (t.channels.includes('email')) {
        try {
          const userRes = await (supabase as any)
            .from('users')
            .select('email')
            .eq('id', t.userId)
            .single();

          if (userRes.data?.email) {
            const subject = `🔔 ${t.symbol} $${t.price.toFixed(2)} — Price Alert`;
            const html = getAlertEmailHTML({
              symbol: t.symbol,
              price: t.price,
              alertType: t.alertType,
              targetValue: t.targetValue,
              prevClose: t.prevClose,
            });

            await sendEmail({ to: userRes.data.email, subject, html });
            emailsSent++;
          }
        } catch (err: any) {
          console.warn('[alerts/check] Email failed for alert', t.alertId, ':', err?.message || err);
        }
      }
    }

    console.log('[alerts/check] Checked:', alerts.length, '| Triggered:', triggered.length, '| Emails:', emailsSent);

    return NextResponse.json({
      checked: alerts.length,
      triggered: triggered.length,
      emailsSent,
      alerts: triggered.map(t => ({ alertId: t.alertId, symbol: t.symbol, price: t.price })),
    });
  } catch (err: any) {
    console.error('[alerts/check] Error:', err);
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 });
  }
}
