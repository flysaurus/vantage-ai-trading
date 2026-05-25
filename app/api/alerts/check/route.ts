// ─── GET /api/alerts/check ────────────────────────────────────
// Evaluates all active alerts against current prices and sends
// notifications for triggered alerts. Designed to be called by
// a cron job (Vercel cron or external).
//
// POST /api/alerts/check?symbol=AAPL
//   Checks just one symbol (called after price updates).

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Notification types
type AlertRow = {
  id: string;
  user_id: string;
  symbol: string;
  alert_type: 'price_above' | 'price_below' | 'percent_change';
  target_value: number;
  notification_channels: string[];
};

async function getCurrentPrice(symbol: string): Promise<{ price: number; prevClose: number } | null> {
  try {
    const keyId = process.env.ALPACA_API_KEY_ID;
    const secretKey = process.env.ALPACA_SECRET_KEY;
    const dataUrl = process.env.ALPACA_ENVIRONMENT === 'live'
      ? 'https://data.alpaca.markets'
      : 'https://data.alpaca.markets';

    const url = `${dataUrl}/v2/stocks/snapshots?symbols=${symbol}`;
    const res = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID': keyId || '',
        'APCA-API-SECRET-KEY': secretKey || '',
      },
    });

    if (!res.ok) return null;
    const data = await res.json();
    const snap = data[symbol];
    if (!snap) return null;

    const price = snap.latestTrade?.p ?? snap.dailyBar?.c ?? null;
    const prevClose = snap.prevDailyBar?.c ?? price;
    return price ? { price, prevClose } : null;
  } catch {
    return null;
  }
}

function isTriggered(
  alert: AlertRow,
  price: number,
  prevClose: number,
): boolean {
  switch (alert.alert_type) {
    case 'price_above':
      return price >= alert.target_value;
    case 'price_below':
      return price <= alert.target_value;
    case 'percent_change': {
      const changePct = ((price - prevClose) / prevClose) * 100;
      const absChange = Math.abs(changePct);
      const absTarget = Math.abs(alert.target_value);
      return absChange >= absTarget;
    }
    default:
      return false;
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Require a shared secret for cron security
  const authHeader = req.headers.get('authorization') || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const cronSecret = bearerToken
    || req.nextUrl.searchParams.get('secret')
    || req.nextUrl.searchParams.get('cron_secret');
  const expected = process.env.CRON_SECRET || '';
  if (!expected || cronSecret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const checkSymbol = req.nextUrl.searchParams.get('symbol');

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch active alerts (untriggered only)
    let query = (supabase as any)
      .from('alerts')
      .select('id, user_id, symbol, alert_type, target_value, notification_channels')
      .eq('is_active', true)
      .is('triggered_at', null);

    if (checkSymbol) {
      query = query.eq('symbol', checkSymbol.toUpperCase());
    }

    const { data: alerts, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!alerts?.length) {
      return NextResponse.json({ checked: 0, triggered: 0, alerts: [] });
    }

    // Group by symbol to minimize API calls
    const symbolSet = [...new Set((alerts as AlertRow[]).map(a => a.symbol))];
    const priceMap = new Map<string, { price: number; prevClose: number }>();

    for (const sym of symbolSet) {
      const p = await getCurrentPrice(sym);
      if (p) priceMap.set(sym, p);
    }

    const triggered: Array<{
      alertId: string;
      userId: string;
      symbol: string;
      price: number;
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
            body: `${alert.symbol} ${alert.alert_type === 'price_above' ? 'above' : alert.alert_type === 'price_below' ? 'below' : 'changed by'} ${alert.target_value} → Current: $${priceData.price.toFixed(2)}`,
            is_read: false,
          });

        triggered.push({
          alertId: alert.id,
          userId: alert.user_id,
          symbol: alert.symbol,
          price: priceData.price,
          channels: alert.notification_channels || ['in_app'],
        });
      }
    }

    // Send email notifications via Resend
    let emailsSent = 0;
    for (const t of triggered) {
      if (t.channels.includes('email')) {
        try {
          const userRes = await (supabase as any)
            .from('users')
            .select('email')
            .eq('id', t.userId)
            .single();

          if (userRes.data?.email && process.env.RESEND_API_KEY) {
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                from: 'Vantage Alerts <alerts@vantage-ai-trading.vercel.app>',
                to: [userRes.data.email],
                subject: `🔔 Price Alert: ${t.symbol} at $${t.price.toFixed(2)}`,
                html: `
                  <h2>Price Alert Triggered</h2>
                  <p><strong>${t.symbol}</strong> has triggered your price alert.</p>
                  <p>Current price: <strong>$${t.price.toFixed(2)}</strong></p>
                  <p><a href="https://vantage-ai-trading.vercel.app/price-alerts">View Alerts</a></p>
                `,
              }),
            });
            emailsSent++;
          }
        } catch {
          // Email failure is non-critical
        }
      }
    }

    return NextResponse.json({
      checked: alerts.length,
      triggered: triggered.length,
      emailsSent,
      alerts: triggered,
    });
  } catch (err: any) {
    console.error('[alerts/check] Error:', err);
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
