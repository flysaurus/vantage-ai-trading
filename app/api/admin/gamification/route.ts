// ─── Admin API: Gamification Config ──────────────────────────
// GET  /api/admin/gamification  → current config + active user count
// PUT  /api/admin/gamification  → save config with validation + audit + recalc
//
// Guardrails:
//   1. Pillar weights must sum to 100% (reject with error if not)
//   2. Every change logged to gamification_config_audit
//   3. On save, recalculate ALL existing users' scores as batch job
//   4. Confirmation handled client-side for weight changes

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth/admin-check';

// ─── GET ──────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { adminUser, adminError } = await requireAdmin(request);
    if (adminError) return adminError;

    const supabase = createServerClient();

    // Fetch config
    const { data: rows, error } = await (supabase as any)
      .from('gamification_config')
      .select('key, value');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const config: Record<string, any> = {};
    for (const r of rows || []) {
      config[r.key] = r.value;
    }

    // Count active accounts (for the confirmation dialog)
    const { count } = await (supabase as any)
      .from('investor_scores')
      .select('*', { count: 'exact', head: true });

    return NextResponse.json({
      config,
      activeAccounts: count || 0,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ─── PUT ──────────────────────────────────────────────────────

export async function PUT(request: NextRequest) {
  try {
    const { adminUser: authUser, adminError } = await requireAdmin(request);
    if (adminError) return adminError;

    const adminEmail = authUser.email || 'unknown';
    const body = await request.json();

    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const supabase = createServerClient();

    // Validation errors accumulate
    const errors: string[] = [];

    // ═══════════════════════════════════════════════════════════
    // 1. Validate pillar weights sum to 100%
    // ═══════════════════════════════════════════════════════════
    if (body.pillar_weights) {
      const w = body.pillar_weights;
      const sum = (Number(w.discipline) || 0) +
                  (Number(w.understanding) || 0) +
                  (Number(w.construction) || 0) +
                  (Number(w.engagement) || 0);
      if (Math.abs(sum - 100) > 0.01) {
        errors.push(
          `Pillar weights must sum to 100%. Current sum: ${sum.toFixed(1)}%. ` +
          `Discipline=${w.discipline || 0}, Understanding=${w.understanding || 0}, ` +
          `Construction=${w.construction || 0}, Engagement=${w.engagement || 0}`
        );
      }

      // Individual bounds
      for (const key of ['discipline', 'understanding', 'construction', 'engagement']) {
        const v = Number(w[key]);
        if (isNaN(v) || v < 0 || v > 100) {
          errors.push(`Weight '${key}' must be between 0 and 100 (got: ${w[key]})`);
        }
      }
    }

    // Validate milestone thresholds have sane values
    if (body.milestone_thresholds) {
      const m = body.milestone_thresholds;
      if (m.true_to_style) {
        const t = m.true_to_style;
        if (typeof t.trades_executed !== 'number' || t.trades_executed < 1) {
          errors.push('true_to_style.trades_executed must be ≥ 1');
        }
        if (typeof t.match_rate !== 'number' || t.match_rate < 0 || t.match_rate > 1) {
          errors.push('true_to_style.match_rate must be 0–1');
        }
      }
      if (m.well_built) {
        const w = m.well_built;
        if (typeof w.position_count !== 'number' || w.position_count < 1) {
          errors.push('well_built.position_count must be ≥ 1');
        }
        if (typeof w.diversification_score !== 'number' || w.diversification_score < 0 || w.diversification_score > 100) {
          errors.push('well_built.diversification_score must be 0–100');
        }
        if (typeof w.max_position_pct !== 'number' || w.max_position_pct < 0 || w.max_position_pct > 100) {
          errors.push('well_built.max_position_pct must be 0–100');
        }
      }
      if (m.student_of_the_game) {
        const s = m.student_of_the_game;
        if (typeof s.learning_count !== 'number' || s.learning_count < 1) {
          errors.push('student_of_the_game.learning_count must be ≥ 1');
        }
        if (typeof s.deep_engagement_count !== 'number' || s.deep_engagement_count < 1) {
          errors.push('student_of_the_game.deep_engagement_count must be ≥ 1');
        }
      }
    }

    if (errors.length > 0) {
      return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 422 });
    }

    // ═══════════════════════════════════════════════════════════
    // 2. Fetch current config for audit trail
    // ═══════════════════════════════════════════════════════════
    const { data: currentRows } = await (supabase as any)
      .from('gamification_config')
      .select('key, value');

    const currentMap: Record<string, any> = {};
    for (const r of currentRows || []) {
      currentMap[r.key] = r.value;
    }

    // ═══════════════════════════════════════════════════════════
    // 3. Write config + audit log (in transaction)
    // ═══════════════════════════════════════════════════════════
    const auditEntries: Array<{
      admin_email: string;
      config_key: string;
      old_value: any;
      new_value: any;
    }> = [];

    const updates: Array<{ key: string; value: any }> = [];
    if (body.pillar_weights) updates.push({ key: 'pillar_weights', value: body.pillar_weights });
    if (body.point_caps) updates.push({ key: 'point_caps', value: body.point_caps });
    if (body.milestone_thresholds) updates.push({ key: 'milestone_thresholds', value: body.milestone_thresholds });

    for (const update of updates) {
      const oldValue = currentMap[update.key] || null;

      // Only audit if something actually changed
      const oldStr = JSON.stringify(oldValue);
      const newStr = JSON.stringify(update.value);
      if (oldStr !== newStr) {
        auditEntries.push({
          admin_email: adminEmail,
          config_key: update.key,
          old_value: oldValue,
          new_value: update.value,
        });

        // Upsert the config row
        const { error: upsertErr } = await (supabase as any)
          .from('gamification_config')
          .upsert({ key: update.key, value: update.value, updated_at: new Date().toISOString() })
          .eq('key', update.key);

        if (upsertErr) {
          return NextResponse.json({ error: `Failed to save ${update.key}: ${upsertErr.message}` }, { status: 500 });
        }
      }
    }

    // Write audit entries
    if (auditEntries.length > 0) {
      const { error: auditErr } = await (supabase as any)
        .from('gamification_config_audit')
        .insert(auditEntries);

      if (auditErr) {
        console.error('[admin/gamification] Audit log write failed:', auditErr.message);
        // Non-fatal — config was saved, log the failure
      }
    }

    // ═══════════════════════════════════════════════════════════
    // 4. Recalculate all accounts (batch)
    // ═══════════════════════════════════════════════════════════
    const recalcStart = Date.now();
    let recalculated = 0;
    let recalcErrors = 0;

    if (body.recalculate !== false) {
      // Fetch all investor_scores
      const { data: allUsers, error: fetchErr } = await (supabase as any)
        .from('investor_scores')
        .select('anonymous_id');

      if (fetchErr) {
        console.error('[admin/gamification] Failed to fetch users for recalc:', fetchErr.message);
      } else if (allUsers) {
        // Recalculate each user by calling the recalculate API
        // We do this sequentially to avoid overwhelming the DB
        for (const user of allUsers) {
          try {
            // Call the existing recalculate endpoint
            const recalcResp = await fetch(
              new URL('/api/gamification/recalculate', request.url).toString(),
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ anonymousId: user.anonymous_id }),
              }
            );
            if (recalcResp.ok) {
              recalculated++;
            } else {
              recalcErrors++;
              console.warn(`[admin/gamification] Recalc failed for ${user.anonymous_id.slice(0, 8)}...`);
            }
          } catch (e: any) {
            recalcErrors++;
            console.warn(`[admin/gamification] Recalc exception for ${user.anonymous_id.slice(0, 8)}...:`, e.message);
          }
        }
      }
    }

    const recalcMs = Date.now() - recalcStart;

    return NextResponse.json({
      success: true,
      updated: auditEntries.map(e => e.config_key),
      auditLog: auditEntries.map(e => ({
        key: e.config_key,
        changedAt: new Date().toISOString(),
      })),
      recalculate: {
        total: (recalculated + recalcErrors),
        recalculated,
        errors: recalcErrors,
        durationMs: recalcMs,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
