// ─── POST /api/strategies/rebalancing/export ────────────────
// Generates the Excel (.xlsx) download for a Portfolio Rebalancing plan.
//
// READ-ONLY FRIENDLY BY DESIGN: this endpoint never places an order and never
// touches a broker — it only serializes the plan the client already computed
// (current vs target allocation + the exact buy/sell legs). View-only
// connections are expected to download and execute elsewhere, so the download
// path must work for them even though Execute is disabled.
//
// Auth-gated via requireAuth; the payload is the caller's own plan.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import {
  buildRebalancePlanWorkbook,
  rebalanceExportFilename,
  type RebalanceExportOrder,
  type RebalanceExportPosition,
  type RebalancePlanExportInput,
} from '@/lib/export/rebalance-plan-export';

export const maxDuration = 60;

/** Clamp/validate a number coming from the client. */
function num(v: unknown, fallback: number | null = null): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

function str(v: unknown, max = 120): string | null {
  return v != null && String(v).trim().length > 0 ? String(v).trim().slice(0, max) : null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { authUser, authError } = await requireAuth(req);
  if (authError || !authUser) return authError;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const rawPositions: any[] = Array.isArray(body?.positions) ? body.positions.slice(0, 500) : [];
  const positions: RebalanceExportPosition[] = rawPositions
    .map((p) => ({
      symbol: String(p?.symbol ?? '').toUpperCase().slice(0, 12),
      name: str(p?.name, 80),
      qty: num(p?.qty, 0) ?? 0,
      price: num(p?.price, 0) ?? 0,
      marketValue: num(p?.marketValue, 0) ?? 0,
    }))
    .filter((p) => p.symbol.length > 0);

  const rawOrders: any[] = Array.isArray(body?.orders) ? body.orders.slice(0, 500) : [];
  const orders: RebalanceExportOrder[] = rawOrders
    .map((o) => ({
      symbol: String(o?.symbol ?? '').toUpperCase().slice(0, 12),
      name: str(o?.name, 80),
      action: (String(o?.action ?? '').toUpperCase() === 'SELL' ? 'SELL' : 'BUY') as 'SELL' | 'BUY',
      shares: num(o?.shares, 0) ?? 0,
      price: num(o?.price, 0) ?? 0,
      estimatedValue: num(o?.estimatedValue, 0) ?? 0,
      orderType: str(o?.orderType, 12),
      limitPrice: num(o?.limitPrice),
    }))
    .filter((o) => o.symbol.length > 0);

  // Targets: symbol → percent (0-100).
  const targets: Record<string, number> = {};
  const rawTargets = body?.targets && typeof body.targets === 'object' ? body.targets : {};
  for (const [k, v] of Object.entries(rawTargets).slice(0, 500)) {
    const pct = num(v);
    if (pct != null) targets[String(k).toUpperCase().slice(0, 12)] = pct;
  }

  if (positions.length === 0 && orders.length === 0 && Object.keys(targets).length === 0) {
    return NextResponse.json({ error: 'Nothing to export — no allocation or orders provided' }, { status: 400 });
  }

  const generatedAt = new Date();
  const environment =
    body?.environment === 'demo' || body?.environment === 'paper' || body?.environment === 'live'
      ? (body.environment as 'demo' | 'paper' | 'live')
      : null;

  const input: RebalancePlanExportInput = {
    accountName: str(body?.accountName, 80) || 'Portfolio',
    broker: str(body?.broker, 60),
    environment,
    access: body?.access === 'read-only' ? 'read-only' : 'trading',
    isDemo: body?.isDemo === true,
    styleName: str(body?.styleName, 60) || 'Custom allocation',
    totalValue: num(body?.totalValue, 0) ?? 0,
    cash: num(body?.cash),
    buyingPower: num(body?.buyingPower),
    driftThreshold: num(body?.driftThreshold),
    driftAlertEnabled: body?.driftAlertEnabled !== false,
    positions,
    targets,
    orders,
    generatedAt,
    note: str(body?.note, 500),
  };

  let buffer: Buffer;
  try {
    buffer = await buildRebalancePlanWorkbook(input);
  } catch (err) {
    console.error('[rebalance-export] workbook build failed:', err);
    return NextResponse.json({ error: 'Failed to generate plan export' }, { status: 500 });
  }

  const filename = rebalanceExportFilename({ accountName: input.accountName, generatedAt });
  const bytes = new Uint8Array(buffer);
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(bytes.length),
      'Cache-Control': 'no-store',
    },
  });
}
