// ─── Admin Invite Management API ───────────────────────────────
// GET  /api/admin/invites               → list all invites
// POST /api/admin/invites               → create new invite(s)
// PUT  /api/admin/invites               → revoke or resend an invite
// Gated behind requireAdmin().

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin-check';
import { createServerClient } from '@/lib/supabase';
import crypto from 'crypto';

function generateToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

// ─── GET: List all invites ───────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { adminError } = await requireAdmin(request);
    if (adminError) return adminError;

    const supabase = createServerClient();
    const sb = supabase as any;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status'); // optional filter
    const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 200);

    let query = sb
      .from('invites')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      if (error.message?.includes('does not exist')) {
        return NextResponse.json({ invites: [], total: 0, note: 'invites table not created yet' });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ invites: data || [], total: data?.length || 0 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ─── POST: Create new invite(s) ─────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const { adminUser, adminError } = await requireAdmin(request);
    if (adminError) return adminError;

    const adminEmail = adminUser.email || 'unknown';
    const body = await request.json();
    const { emails, expiryDays } = body;

    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return NextResponse.json({ error: 'Provide emails array with at least one email' }, { status: 400 });
    }

    const days = typeof expiryDays === 'number' && expiryDays > 0 ? expiryDays : 30;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

    const supabase = createServerClient();
    const sb = supabase as any;

    const created: Array<{ email: string; token: string }> = [];
    const skipped: string[] = [];
    const errors: string[] = [];

    for (const rawEmail of emails) {
      const email = String(rawEmail || '').toLowerCase().trim();
      if (!email || !email.includes('@')) {
        skipped.push(email || '(empty)');
        continue;
      }

      try {
        // Check if there's already a pending invite for this email
        const { data: existing } = await sb
          .from('invites')
          .select('id, status')
          .eq('email', email)
          .eq('status', 'pending')
          .gt('expires_at', new Date().toISOString())
          .limit(1);

        if (existing && existing.length > 0) {
          skipped.push(`${email} (already has a pending invite)`);
          continue;
        }

        const token = generateToken();
        const { error: insertErr } = await sb.from('invites').insert({
          email,
          invite_token: token,
          status: 'pending',
          created_by: adminEmail,
          expires_at: expiresAt,
        });

        if (insertErr) {
          errors.push(`${email}: ${insertErr.message}`);
        } else {
          created.push({ email, token });
        }
      } catch (e: any) {
        errors.push(`${email}: ${e.message}`);
      }
    }

    return NextResponse.json({
      success: created.length > 0,
      created,
      skipped: skipped.length > 0 ? skipped : undefined,
      errors: errors.length > 0 ? errors : undefined,
      expires_at: expiresAt,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ─── PUT: Revoke or resend an invite ────────────────────────

export async function PUT(request: NextRequest) {
  try {
    const { adminUser, adminError } = await requireAdmin(request);
    if (adminError) return adminError;

    const adminEmail = adminUser.email || 'unknown';
    const body = await request.json();
    const { inviteId, action } = body;

    if (!inviteId) {
      return NextResponse.json({ error: 'Missing inviteId' }, { status: 400 });
    }

    if (!action || !['revoke', 'resend'].includes(action)) {
      return NextResponse.json({ error: 'Action must be "revoke" or "resend"' }, { status: 400 });
    }

    const supabase = createServerClient();
    const sb = supabase as any;

    if (action === 'revoke') {
      const { error } = await sb
        .from('invites')
        .update({ status: 'revoked' })
        .eq('id', inviteId)
        .eq('status', 'pending');

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, message: 'Invite revoked' });
    }

    // Resend: generate a new token and extend expiry
    const newToken = generateToken();
    const newExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const { error } = await sb
      .from('invites')
      .update({
        invite_token: newToken,
        expires_at: newExpiry,
        created_by: adminEmail, // update who resent it
      })
      .eq('id', inviteId)
      .eq('status', 'pending');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Invite resent with new token',
      token: newToken,
      expires_at: newExpiry,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
