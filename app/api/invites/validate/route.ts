// ─── Invite Validation API ─────────────────────────────────────
// GET /api/invites/validate?email=xxx → check if any pending invite for email
// GET /api/invites/validate?token=xxx → validate a specific invite token
// Public endpoint — used during signup flow (pre-auth).

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email');
    const token = searchParams.get('token');

    const supabase = createServerClient();
    const sb = supabase as any;

    // Token-based validation (more secure — direct invite link)
    if (token) {
      // Query the invite in ANY status to differentiate reasons
      const { data: inviteRows, error: queryErr } = await sb
        .from('invites')
        .select('id, email, status, expires_at, accepted_at')
        .eq('invite_token', token)
        .limit(1);

      if (queryErr) {
        if (queryErr.message?.includes('does not exist')) {
          return NextResponse.json({ valid: false, reason: 'invalid' });
        }
        console.error('[invites/validate] Query error:', queryErr.message);
        return NextResponse.json({ valid: false, reason: 'invalid', error: 'Validation unavailable' }, { status: 500 });
      }

      const invite = inviteRows?.[0];

      // Token not found at all
      if (!invite) {
        return NextResponse.json({ valid: false, reason: 'invalid' });
      }

      // Token already used
      if (invite.status === 'accepted' || invite.accepted_at) {
        return NextResponse.json({ valid: false, reason: 'already_used' });
      }

      // Token expired
      if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
        return NextResponse.json({ valid: false, reason: 'expired' });
      }

      // Token is valid and pending
      if (invite.status === 'pending') {
        return NextResponse.json({ valid: true, email: invite.email });
      }

      // Any other status (e.g. revoked)
      return NextResponse.json({ valid: false, reason: 'invalid' });
    }

    // Email-based check (during signup form)
    if (!email) {
      return NextResponse.json({ error: 'Provide email or token parameter' }, { status: 400 });
    }

    // Auto-expire stale invites first
    try {
      await sb.rpc('expire_old_invites');
    } catch {
      // RPC might not exist
    }

    const { data: invites, error: queryError } = await sb
      .from('invites')
      .select('id, invite_token, status, expires_at')
      .eq('email', email.toLowerCase().trim())
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .limit(1);

    if (queryError) {
      // Table might not exist yet — fail open for safety
      if (queryError.message?.includes('does not exist')) {
        console.warn('[invites/validate] invites table does not exist — failing open');
        return NextResponse.json({ valid: true, note: 'invites table not created yet' });
      }
      return NextResponse.json({ error: queryError.message }, { status: 500 });
    }

    const hasValidInvite = invites && invites.length > 0;

    return NextResponse.json({
      valid: hasValidInvite,
      ...(hasValidInvite && invites?.[0] ? { token: invites[0].invite_token } : {}),
    });
  } catch (err: any) {
    console.error('[invites/validate] Unexpected error:', err.message);
    // Fail open — never block signup due to infra error
    return NextResponse.json({ valid: true, note: 'invite check failed, allowing signup' });
  }
}
