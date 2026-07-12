// ─── POST /api/access-requests/resend — Resend invite (public) ──
// Body: { email }
// Only works if email has an approved access_request.
// Regenerates token, extends expiry, sends new invite email.
// Rate-limited per email.

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { sendInviteEmail } from '@/lib/invite-email';

// In-memory rate limit: max 1 resend per 60s per email
const resendCooldown = new Map<string, number>();

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // ── Rate limit ────────────────────────────────────
    const lastResend = resendCooldown.get(normalizedEmail);
    if (lastResend && Date.now() - lastResend < 60_000) {
      return NextResponse.json({ error: 'Please wait before resending' }, { status: 429 });
    }
    resendCooldown.set(normalizedEmail, Date.now());

    const supabase = createServerClient();
    const sb = supabase as any;

    // ── Verify email is approved ──────────────────────
    const { data: requests } = await sb
      .from('access_requests')
      .select('id, email, status')
      .eq('email', normalizedEmail)
      .eq('status', 'approved')
      .limit(1);

    if (!requests || requests.length === 0) {
      return NextResponse.json({ error: 'No approved request found for this email' }, { status: 404 });
    }

    // ── Find existing invite (any status) ─────────────
    const { data: existingInvites } = await sb
      .from('invites')
      .select('id, invite_token, status')
      .eq('email', normalizedEmail)
      .order('created_at', { ascending: false })
      .limit(1);

    // ── Generate new token ────────────────────────────
    const crypto = await import('crypto');
    const newToken = crypto.randomBytes(32).toString('hex');
    const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    if (existingInvites && existingInvites.length > 0) {
      // Update existing invite with new token and extended expiry
      const { error: updateErr } = await sb
        .from('invites')
        .update({
          invite_token: newToken,
          status: 'pending',
          expires_at: thirtyDaysFromNow,
          accepted_at: null,
          accepted_by: null,
        })
        .eq('id', existingInvites[0].id);

      if (updateErr) {
        console.error('[resend] Update error:', updateErr.message);
        return NextResponse.json({ error: 'Failed to regenerate invite' }, { status: 500 });
      }
    } else {
      // No invite exists yet — create one
      const { error: insertErr } = await sb
        .from('invites')
        .insert({
          email: normalizedEmail,
          invite_token: newToken,
          status: 'pending',
          expires_at: thirtyDaysFromNow,
          created_by: 'system-resend',
        });

      if (insertErr) {
        console.error('[resend] Insert error:', insertErr.message);
        return NextResponse.json({ error: 'Failed to create invite' }, { status: 500 });
      }
    }

    // ── Send invite email ─────────────────────────────
    try {
      await sendInviteEmail(normalizedEmail, newToken);
    } catch (emailErr: any) {
      console.error('[resend] Email send error:', emailErr.message);
      // Token was created/updated, just warn about email
    }

    return NextResponse.json({
      success: true,
      message: 'Invite re-sent. Check your email.',
    });
  } catch (err: any) {
    console.error('[resend] Error:', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
