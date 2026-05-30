// ─── PUT /api/strategies/dca/update ──────────────────────────
// Updates an existing DCA schedule. Verifies ownership.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';

const VALID_FREQUENCIES = ['daily', 'weekly', 'biweekly', 'monthly'];
const VALID_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
const VALID_DATES = ['1', '15', 'last'];

export async function PUT(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId } = await requireAuth(req);
    const supabase = createServerClient();

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Missing request body' }, { status: 400 });
    }

    const { scheduleId, symbol, amount, frequency, dayOfWeek, dayOfMonth, startDate, endDate, investBy, quantity } = body as Record<string, any>;
    if (!scheduleId) {
      return NextResponse.json({ error: 'Schedule ID required' }, { status: 400 });
    }

    // Verify ownership
    const { data: existing } = await (supabase as any)
      .from('strategies')
      .select('id, user_id')
      .eq('id', scheduleId)
      .eq('type', 'dca')
      .single();

    if (!existing || existing.user_id !== userId) {
      return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
    }

    // Validate
    if (!symbol?.trim()) return NextResponse.json({ error: 'Symbol required' }, { status: 400 });
    if (!amount || typeof amount !== 'number' || amount < 1) return NextResponse.json({ error: 'Amount must be at least $1' }, { status: 400 });
    if (!frequency || !VALID_FREQUENCIES.includes(frequency)) return NextResponse.json({ error: `Frequency must be one of: ${VALID_FREQUENCIES.join(', ')}` }, { status: 400 });
    if (!startDate || isNaN(Date.parse(startDate))) return NextResponse.json({ error: 'Valid start date required' }, { status: 400 });

    const config: Record<string, any> = { amount, frequency, startDate, investBy: investBy || 'amount' };
    if (investBy === 'shares' && quantity) config.quantity = quantity;
    if (dayOfWeek) config.dayOfWeek = dayOfWeek;
    if (dayOfMonth) config.dayOfMonth = dayOfMonth;
    if (endDate) config.endDate = endDate;

    const { data, error } = await (supabase as any)
      .from('strategies')
      .update({
        symbol: symbol.trim().toUpperCase(),
        config,
      })
      .eq('id', scheduleId)
      .select('id, type, symbol, config, is_active, created_at')
      .single();

    if (error) {
      return NextResponse.json({ error: 'Failed to update schedule', detail: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
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
    return NextResponse.json({ error: 'Internal server error', detail: err?.message }, { status: 500 });
  }
}
