// ─── Access Requests API ──────────────────────────────────────
// POST /api/access-requests       → submit waitlist request (public)
// GET  /api/access-requests       → list all requests (admin only)
// PUT  /api/access-requests/[id]  → approve or reject (admin only)

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin-check';
import { createServerClient } from '@/lib/supabase';
import { sendWaitlistEmail } from '@/lib/waitlist-email';

// ── POST: Submit a waitlist request (public, no auth needed) ──
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, name, reason } = body;

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
    }

    const supabase = createServerClient();
    const sb = supabase as any;

    const cleanEmail = email.toLowerCase().trim();

    // Check for existing pending request
    const { data: existing } = await sb
      .from('access_requests')
      .select('id')
      .eq('email', cleanEmail)
      .eq('status', 'pending')
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json({
        success: true,
        message: 'Already on waitlist',
        alreadyExists: true,
      });
    }

    // Insert new request
    const { error: insertErr } = await sb.from('access_requests').insert({
      email: cleanEmail,
      name: name || null,
      reason: reason || null,
      status: 'pending',
    });

    if (insertErr) {
      // Unique constraint violation = duplicate, handle gracefully
      if (insertErr.message?.includes('duplicate') || insertErr.code === '23505') {
        return NextResponse.json({
          success: true,
          message: 'Already on waitlist',
          alreadyExists: true,
        });
      }
      console.error('[access-requests] Insert failed:', insertErr.message);
      return NextResponse.json({ error: 'Failed to join waitlist' }, { status: 500 });
    }

    // Fire-and-forget: send confirmation email
    sendWaitlistEmail(cleanEmail).catch((e) =>
      console.error('[access-requests] Waitlist email failed for', cleanEmail, ':', e.message)
    );

    return NextResponse.json({ success: true, message: 'Added to waitlist' });
  } catch (err: any) {
    console.error('[access-requests] POST error:', err.message);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// ── GET: List all requests (admin only) ──
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth.adminError) {
    return auth.adminError;
  }

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '100');

    const supabase = createServerClient();
    const sb = supabase as any;

    let query = sb
      .from('access_requests')
      .select('*')
      .order('requested_at', { ascending: false })
      .limit(limit);

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      // Table might not exist yet
      if (error.message?.includes('does not exist') || error.code === '42P01') {
        return NextResponse.json({ requests: [], note: 'access_requests table not created yet. Run migration 034.' });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Get counts by status
    const { data: counts } = await sb
      .from('access_requests')
      .select('status')
      .limit(1000);

    const statusCounts: Record<string, number> = { pending: 0, approved: 0, rejected: 0 };
    if (counts) {
      for (const r of counts) statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
    }

    return NextResponse.json({ requests: data || [], counts: statusCounts });
  } catch (err: any) {
    console.error('[access-requests] GET error:', err.message);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
