// ─── Access Request Actions ───────────────────────────────────
// PUT /api/access-requests/[id]  → approve or reject a request

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin-check';
import { createServerClient } from '@/lib/supabase';
import { sendInviteEmail } from '@/lib/invite-email';
import crypto from 'crypto';

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdmin(request);
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = params;
    const body = await request.json();
    const { action } = body; // 'approve' or 'reject'

    if (!action || !['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: "Action must be 'approve' or 'reject'" }, { status: 400 });
    }

    const supabase = createServerClient();
    const sb = supabase as any;
    const adminEmail = auth.user?.email || 'admin';

    // Fetch the request
    const { data: accessReq, error: fetchErr } = await sb
      .from('access_requests')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !accessReq) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    if (accessReq.status !== 'pending') {
      return NextResponse.json({ error: `Request is already ${accessReq.status}` }, { status: 400 });
    }

    if (action === 'reject') {
      const { error } = await sb
        .from('access_requests')
        .update({
          status: 'rejected',
          reviewed_by: adminEmail,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      return NextResponse.json({ success: true, action: 'rejected' });
    }

    // action === 'approve'
    // 1. Generate invite token
    const token = generateToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    // 2. Check for existing pending invite for this email
    const { data: existingInvite } = await sb
      .from('invites')
      .select('id')
      .eq('email', accessReq.email)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .limit(1);

    if (existingInvite && existingInvite.length > 0) {
      // Already has a pending invite — just approve the request, don't duplicate
      const { error } = await sb
        .from('access_requests')
        .update({
          status: 'approved',
          reviewed_by: adminEmail,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      // Resend the existing invite email
      sendInviteEmail(accessReq.email, token).catch((e) =>
        console.error('[access-requests] Invite resend failed for', accessReq.email, ':', e.message)
      );

      return NextResponse.json({
        success: true,
        action: 'approved',
        note: 'User already had a pending invite — request approved, invite email resent',
      });
    }

    // 3. Create invite
    const { error: inviteErr } = await sb.from('invites').insert({
      email: accessReq.email,
      invite_token: token,
      status: 'pending',
      created_by: adminEmail,
      expires_at: expiresAt,
    });

    if (inviteErr) {
      return NextResponse.json({ error: 'Failed to create invite: ' + inviteErr.message }, { status: 500 });
    }

    // 4. Mark request as approved
    const { error: updateErr } = await sb
      .from('access_requests')
      .update({
        status: 'approved',
        reviewed_by: adminEmail,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // 5. Send invite email (fire-and-forget)
    sendInviteEmail(accessReq.email, token).catch((e) =>
      console.error('[access-requests] Invite email failed for', accessReq.email, ':', e.message)
    );

    return NextResponse.json({
      success: true,
      action: 'approved',
      token,
      expires_at: expiresAt,
    });
  } catch (err: any) {
    console.error('[access-requests] PUT error:', err.message);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
