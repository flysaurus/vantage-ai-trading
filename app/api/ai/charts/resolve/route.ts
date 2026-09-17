/**
 * POST /api/ai/charts/resolve — retro-resolve charts for ALREADY-STORED messages.
 *
 * Why this exists: charts used to be shipped only as a live-session SSE `charts`
 * event and never persisted, so every historical answer lost its chart on reload.
 * New messages now carry `metadata.charts` (see saveChatMessage), but messages
 * written BEFORE that change only have the `[CHART:<type>|<key>]` marker sitting
 * in their stored `content`. This endpoint re-resolves those markers with the
 * exact same machinery the chat route uses (`parseChartRequests` →
 * `buildChartCtx` → `resolveCharts`) and heals each row once.
 *
 * Contract:
 *   body: { items: [{id, content}], portfolio?, accountMeta? }
 *   → { resolved: [{id, charts}], healed: <rows stamped> }
 *
 * Rules:
 * - Only the last MAX_ITEMS items are looked at, and only ones that actually
 *   carry a chart marker. Nothing is invented: a marker whose data is
 *   unavailable resolves to nothing and the message stays prose-only.
 * - The heal write is scoped to `user_id = <caller>` AND the exact ids the
 *   caller sent — a caller can never stamp another user's row.
 * - The heal is BEST-EFFORT: if the write fails the resolved charts are still
 *   returned (the next open simply retries). A failed heal is logged, never
 *   allowed to turn a successful resolve into an error.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';
import { parseChartRequests, resolveCharts } from '@/lib/ai/chart-markers';
import { buildChartCtx } from '@/lib/ai/chart-ctx';
import type { PortfolioSnapshot } from '@/lib/ai/account-actions';

/** Hard cap on markers resolved per call — this is a replay path, not a batch job. */
export const MAX_ITEMS = 12;

interface ResolveItem {
  id: string;
  content: string;
}

export async function POST(req: NextRequest) {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const rawItems = Array.isArray(body?.items) ? body.items : [];
  const items: ResolveItem[] = rawItems
    .filter((it: any) => it && typeof it.id === 'string' && it.id && typeof it.content === 'string')
    .slice(0, MAX_ITEMS);

  if (items.length === 0) {
    return NextResponse.json({ resolved: [], healed: 0 });
  }

  // Only marker-bearing messages are worth a resolve pass.
  const withMarkers = items.filter((it) => parseChartRequests(it.content).length > 0);
  if (withMarkers.length === 0) {
    return NextResponse.json({ resolved: [], healed: 0 });
  }

  const portfolio = body?.portfolio;
  const portfolioSnapshot: PortfolioSnapshot | null =
    portfolio && typeof portfolio === 'object' && Array.isArray(portfolio.positions)
      ? (portfolio as PortfolioSnapshot)
      : null;
  const accountMeta = body?.accountMeta || null;

  const supabase = createServerClient();

  try {
    const ctx = await buildChartCtx({
      portfolioSnapshot,
      rawPositions: (portfolio as any)?.positions ?? null,
      isDemo: !!accountMeta?.isDemo,
      accountId: accountMeta?.accountId ?? null,
      userId: authUser.id,
      investorStyle: accountMeta?.investorStyle ?? null,
      riskTolerance: accountMeta?.riskTolerance ?? null,
      supabase,
    });

    const resolved: { id: string; charts: any[] }[] = [];
    for (const it of withMarkers) {
      const reqs = parseChartRequests(it.content);
      if (reqs.length === 0) continue;
      const charts = await resolveCharts(reqs, ctx);
      if (charts.length > 0) resolved.push({ id: it.id, charts });
    }

    if (resolved.length === 0) {
      return NextResponse.json({ resolved: [], healed: 0 });
    }

    // ── Heal: stamp the resolved payload onto the caller's OWN rows ──
    let healed = 0;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;
      const ids = resolved.map((r) => r.id);
      const { data: rows } = await db
        .from('chat_messages')
        .select('id, metadata')
        .eq('user_id', authUser.id)
        .in('id', ids);

      const byId = new Map<string, any>((rows || []).map((r: any) => [String(r.id), r]));

      for (const r of resolved) {
        const row = byId.get(r.id);
        if (!row) continue; // not this user's row (or gone) — never write
        const meta =
          row.metadata && typeof row.metadata === 'object' ? { ...(row.metadata as any) } : {};
        if (Array.isArray(meta.charts) && meta.charts.length > 0) continue; // already healed
        const { error } = await db
          .from('chat_messages')
          .update({ metadata: { ...meta, charts: r.charts } })
          .eq('id', r.id)
          .eq('user_id', authUser.id);
        if (error) {
          console.warn('[charts/resolve] heal failed for', r.id, error.message);
        } else {
          healed++;
        }
      }
    } catch (healErr: any) {
      // Best-effort only — the charts are still returned to the caller.
      console.warn('[charts/resolve] heal pass threw:', healErr?.message);
    }

    console.log(
      `[charts/resolve] ${resolved.length} message(s) re-resolved, ${healed} healed`,
    );
    return NextResponse.json({ resolved, healed });
  } catch (err: any) {
    console.error('[charts/resolve] failed:', err?.message);
    return NextResponse.json({ error: 'Chart resolution failed' }, { status: 500 });
  }
}
