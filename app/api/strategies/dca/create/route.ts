// ─── POST /api/strategies/dca/create ──────────────────────────
// Creates a DCA schedule for the authenticated user.
// Requires: valid session cookie.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';

const VALID_FREQUENCIES = ['daily', 'weekly', 'biweekly', 'monthly'];
const VALID_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
const VALID_DATES = ['1', '15', 'last'];

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId } = await requireAuth(req);
    const supabase = createServerClient();

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Missing request body' }, { status: 400 });
    }

    const {
      symbol,
      amount,
      frequency,
      dayOfWeek,
      dayOfMonth,
      startDate,
      endDate,
      investBy,
      quantity,
    } = body as {
      symbol?: string;
      amount?: number;
      frequency?: string;
      dayOfWeek?: string;
      dayOfMonth?: string;
      startDate?: string;
      endDate?: string | null;
      investBy?: string;
      quantity?: number;
    };

    // ─── Validation ─────────────────────────────────────────
    if (!symbol || !symbol.trim()) {
      return NextResponse.json({ error: 'Symbol required' }, { status: 400 });
    }

    if (!amount || typeof amount !== 'number' || amount < 1) {
      return NextResponse.json({ error: 'Amount must be at least $1' }, { status: 400 });
    }

    if (!frequency || !VALID_FREQUENCIES.includes(frequency)) {
      return NextResponse.json({ error: `Frequency must be one of: ${VALID_FREQUENCIES.join(', ')}` }, { status: 400 });
    }

    if ((frequency === 'weekly' || frequency === 'biweekly') && dayOfWeek && !VALID_DAYS.includes(dayOfWeek)) {
      return NextResponse.json({ error: 'Day of week must be mon-fri' }, { status: 400 });
    }

    if (frequency === 'monthly' && dayOfMonth && !VALID_DATES.includes(dayOfMonth)) {
      return NextResponse.json({ error: 'Day of month must be 1, 15, or last' }, { status: 400 });
    }

    if (!startDate || isNaN(Date.parse(startDate))) {
      return NextResponse.json({ error: 'Valid start date required' }, { status: 400 });
    }

    const config: Record<string, any> = {
      amount,
      frequency,
      startDate,
      investBy: investBy || 'amount',
    };

    if (investBy === 'shares' && quantity) config.quantity = quantity;

    if (dayOfWeek) config.dayOfWeek = dayOfWeek;
    if (dayOfMonth) config.dayOfMonth = dayOfMonth;
    if (endDate) {
      if (isNaN(Date.parse(endDate))) {
        return NextResponse.json({ error: 'Invalid end date' }, { status: 400 });
      }
      config.endDate = endDate;
    }

    const { data, error } = await (supabase as any)
      .from('strategies')
      .insert({
        user_id: userId,
        type: 'dca',
        symbol: symbol.trim().toUpperCase(),
        config,
        is_active: true,
      })
      .select('id, type, symbol, config, is_active, created_at')
      .single();

    if (error) {
      console.error('[strategies/dca/create] Insert failed:', error.message);
      return NextResponse.json({ error: 'Failed to create DCA schedule', detail: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      scheduleId: data.id,
      schedule: {
        id: data.id,
        type: data.type,
        symbol: data.symbol,
        config: data.config,
        isActive: data.is_active,
        createdAt: data.created_at,
      },
    });
  } catch (err: any) {
    if (err?.name === 'AuthError') {
      return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    }
    console.error('[strategies/dca/create] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error', detail: err?.message }, { status: 500 });
  }
}
