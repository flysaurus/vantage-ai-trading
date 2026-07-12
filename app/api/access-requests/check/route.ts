// ─── GET /api/access-requests/check — Check waitlist status ──
// Query: ?email=X
// Public — no auth required (unauthenticated users check their status).
//
// Returns:
//   { status: "not_found" | "pending" | "rejected" | "approved", hasWaitingInvite?: boolean, inviteToken?: string }

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const email = searchParams.get('email')?.trim().toLowerCase();

  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
  }

  try {
    const supabase = createServerClient();
    const sb = supabase as any;

    // 1. Check access_requests for this email (any status)
    const { data: requests, error: reqErr } = await sb
      .from('access_requests')
      .select('id, email, status, reviewed_at')
      .eq('email', email)
      .order('requested_at', { ascending: false })
      .limit(1);

    // Table might not exist yet
    if (reqErr && reqErr.message?.includes('does not exist')) {
      return NextResponse.json({ status: 'not_found' });
    }

    if (reqErr) {
      console.error('[access-requests/check] Query error:', reqErr.message);
      return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }

    if (!requests || requests.length === 0) {
      return NextResponse.json({ status: 'not_found' });
    }

    const latest = requests[0];

    // 2. If approved, check for an unexpired, unaccepted invite
    if (latest.status === 'approved') {
      const { data: invites } = await sb
        .from('invites')
        .select('invite_token, status, expires_at')
        .eq('email', email)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1);

      const hasWaitingInvite = invites && invites.length > 0;
      const inviteToken = hasWaitingInvite ? invites[0].invite_token : null;

      return NextResponse.json({
        status: 'approved',
        hasWaitingInvite,
        inviteToken,
      });
    }

    return NextResponse.json({ status: latest.status });
  } catch (err: any) {
    console.error('[access-requests/check] Error:', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
