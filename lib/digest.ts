// ─── Portfolio Agent Email Digest ──────────────────────────────
// Daily email digest of AI Noticed feed items.
//
// getDigestItemsForUser()  — pulls noticed items since last digest
// renderDigestEmail()      — builds simple HTML email body
// signUnsubscribeToken()   — HMAC-signed token for one-click unsubscribe
// verifyUnsubscribeToken() — validates token, returns userId or null

import { createServerClient } from '@/lib/supabase';
import crypto from 'crypto';
import { sendEmail } from '@/lib/email';

// ── Types ──

export interface DigestItem {
  id: string;
  trigger_type: string;
  trigger_key: string;
  title: string | null;
  body: string;
  follow_up: string | null;
  variant: 'accent' | 'warn' | 'gain';
  icon: string;
  created_at: string;
}

export interface DigestResult {
  items: DigestItem[];
  since: string;
}

// ── Fetch since last digest ──

export async function getDigestItemsForUser(
  userId: string,
): Promise<DigestResult | null> {
  const supabase = createServerClient() as any;

  // Get last_digest_sent_at
  const { data: userRow, error: userErr } = await supabase
    .from('users')
    .select('last_digest_sent_at')
    .eq('id', userId)
    .single();

  if (userErr) {
    console.error(`[digest] Failed to fetch user ${userId.slice(0, 8)}:`, userErr.message);
    return null;
  }

  const since = userRow?.last_digest_sent_at
    || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // fallback: last 24h

  const { data: items, error: itemsErr } = await supabase
    .from('noticed_items')
    .select('id, trigger_type, trigger_key, title, body, follow_up, variant, icon, created_at')
    .eq('user_id', userId)
    .eq('resolved', false)
    .gt('created_at', since)
    .order('created_at', { ascending: false });

  if (itemsErr) {
    console.error(`[digest] Failed to fetch items for user ${userId.slice(0, 8)}:`, itemsErr.message);
    return null;
  }

  return { items: (items || []) as DigestItem[], since };
}

// ── Update last_digest_sent_at ──

export async function markDigestSent(userId: string): Promise<void> {
  const supabase = createServerClient() as any;
  const { error } = await supabase
    .from('users')
    .update({ last_digest_sent_at: new Date().toISOString() })
    .eq('id', userId);

  if (error) {
    console.error(`[digest] Failed to update last_digest_sent_at for ${userId.slice(0, 8)}:`, error.message);
  }
}

// ── Signing (HMAC-SHA256, same pattern as magic-link.ts) ──

const DIGEST_SECRET = process.env.SESSION_SECRET || 'vantage-dev-secret';

export function signUnsubscribeToken(userId: string): string {
  const hmac = crypto.createHmac('sha256', DIGEST_SECRET);
  hmac.update(`unsub:${userId}`);
  return `${userId}.${hmac.digest('hex')}`;
}

export function verifyUnsubscribeToken(token: string): string | null {
  const dotIndex = token.lastIndexOf('.');
  if (dotIndex === -1) return null;
  const userId = token.slice(0, dotIndex);
  const expected = signUnsubscribeToken(userId);
  // Constant-time comparison to prevent timing attacks
  try {
    if (crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
      return userId;
    }
  } catch {
    // Different lengths = invalid
  }
  return null;
}

// ── Render HTML email ──

const VARIANT_STYLES: Record<string, { border: string; bg: string; dot: string }> = {
  accent: { border: '#22d3ee', bg: 'rgba(34,211,238,0.08)', dot: '#22d3ee' },
  warn: { border: '#f59e0b', bg: 'rgba(245,158,11,0.08)', dot: '#f59e0b' },
  gain: { border: '#10b981', bg: 'rgba(16,185,129,0.08)', dot: '#10b981' },
};

const TRIGGER_TYPE_LABELS: Record<string, string> = {
  idle_cash: '💵 Cash Alert',
  position_milestone: '📊 Position Milestone',
  portfolio_drift: '⚖️ Portfolio Drift',
  earnings_proximity: '📅 Earnings Ahead',
  sentiment_shift: '📰 Sentiment Shift',
};

export function renderDigestEmail(
  items: DigestItem[],
  unsubscribeToken: string,
): string {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://vantage-ai-trading.vercel.app';
  const count = items.length;
  const now = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  // Group by trigger type
  const grouped = new Map<string, DigestItem[]>();
  for (const item of items) {
    const group = grouped.get(item.trigger_type) || [];
    group.push(item);
    grouped.set(item.trigger_type, group);
  }

  const groupsHtml = [...grouped.entries()].map(([type, groupItems]) => {
    const label = TRIGGER_TYPE_LABELS[type] || type;
    const itemsHtml = groupItems.map(item => {
      const style = VARIANT_STYLES[item.variant] || VARIANT_STYLES.accent;
      return `
        <tr>
          <td style="padding: 14px 16px; border-bottom: 1px solid rgba(255,255,255,0.06);">
            <table cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td style="width: 20px; vertical-align: top; padding-top: 2px;">
                  <span style="font-size: 14px;">${item.icon || '📊'}</span>
                </td>
                <td style="vertical-align: top;">
                  <div style="font-size: 13px; font-weight: 600; color: ${style.dot}; margin-bottom: 4px;">
                    ${escapeHtml(item.title || item.trigger_key)}
                  </div>
                  <div style="font-size: 13px; color: rgba(255,255,255,0.8); line-height: 1.5;">
                    ${escapeHtml(item.body)}
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>`;
    }).join('');

    return `
      <div style="margin-bottom: 20px;">
        <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; padding: 0 16px;">
          ${label}
        </div>
        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background: rgba(255,255,255,0.03); border-radius: 10px; overflow: hidden;">
          ${itemsHtml}
        </table>
      </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background: #0a0f1a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #e2e8f0;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width: 560px; margin: 0 auto;">
    <!-- Header -->
    <tr>
      <td style="padding: 32px 24px 16px;">
        <div style="font-size: 20px; font-weight: 700; color: #22d3ee; letter-spacing: 0.03em;">🦊 Vantage</div>
        <div style="font-size: 12px; color: #475569; margin-top: 2px;">Portfolio Agent Digest</div>
      </td>
    </tr>

    <!-- Summary line -->
    <tr>
      <td style="padding: 0 24px 20px;">
        <div style="font-size: 15px; color: #e2e8f0; line-height: 1.5;">
          ${count} update${count !== 1 ? 's' : ''} from your Portfolio Agent for ${now}.
        </div>
      </td>
    </tr>

    <!-- Items -->
    <tr>
      <td style="padding: 0 8px 8px;">
        ${groupsHtml}
      </td>
    </tr>

    <!-- CTA -->
    <tr>
      <td style="padding: 16px 24px 24px; text-align: center;">
        <a href="${baseUrl}?tab=ai" style="display: inline-block; background: rgba(34,211,238,0.12); border: 1px solid rgba(34,211,238,0.25); border-radius: 8px; color: #22d3ee; text-decoration: none; font-size: 13px; font-weight: 600; padding: 10px 24px;">
          Open Vantage →
        </a>
      </td>
    </tr>

    <!-- Divider -->
    <tr>
      <td style="padding: 0 24px;">
        <hr style="border: none; border-top: 1px solid rgba(255,255,255,0.06);">
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="padding: 16px 24px 32px; text-align: center;">
        <div style="font-size: 11px; color: #475569; line-height: 1.6;">
          You received this because Portfolio Agent emails are enabled for your account.<br>
          <a href="${baseUrl}/api/agent-emails/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}" style="color: #64748b; text-decoration: underline;">Unsubscribe</a> — one click, no login.
        </div>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
