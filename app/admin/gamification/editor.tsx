'use client';

import { useEffect, useState } from 'react';

// ─── Types ────────────────────────────────────────────────────

interface PillarWeight {
  discipline: number;
  understanding: number;
  construction: number;
  engagement: number;
}

interface TrueToStyle {
  trades_executed: number;
  match_rate: number;
}

interface WellBuilt {
  position_count: number;
  diversification_score: number;
  max_position_pct: number;
}

interface StudentOfTheGame {
  learning_count: number;
  deep_engagement_count: number;
}

interface SteadyHands {
  drawdown_pct: number;
}

interface WeatheredStorm {
  drawdown_pct: number;
  recovery_pct: number;
}

interface MilestoneThresholds {
  true_to_style: TrueToStyle;
  well_built: WellBuilt;
  student_of_the_game: StudentOfTheGame;
  steady_hands: SteadyHands;
  weathered_a_storm: WeatheredStorm;
}

interface PointCaps {
  streak_max: number;
  ai_max: number;
  learning_depth_max: number;
  learning_depth_points: number;
  style_consistency_max: number;
  drawdown_bonus: number;
  diversification_max: number;
  diversification_multiplier: number;
  position_sizing_max: number;
  position_sizing_ideal_pct: number;
  position_sizing_worst_pct: number;
  ai_session_tier1_count: number;
  ai_session_tier1_points: number;
  ai_session_tier2_count: number;
  ai_session_tier2_points: number;
  ai_session_tier3_points: number;
  streak_points_per_day: number;
}

// ─── Labels ───────────────────────────────────────────────────

const PILLAR_LABELS: Record<string, string> = {
  discipline: 'Discipline',
  understanding: 'Understanding',
  construction: 'Construction',
  engagement: 'Engagement',
};

const PILLAR_DESCRIPTIONS: Record<string, string> = {
  discipline: 'Style consistency + drawdown resilience',
  understanding: 'Deep learning engagement',
  construction: 'Diversification + position sizing',
  engagement: 'Streak + AI sessions (diminishing returns)',
};

const CAP_LABELS: Record<string, string> = {
  streak_max: 'Streak point cap',
  ai_max: 'AI sessions point cap',
  learning_depth_max: 'Max deep engagements counted',
  learning_depth_points: 'Points per deep engagement',
  style_consistency_max: 'Style consistency max points',
  drawdown_bonus: 'Drawdown hold bonus',
  diversification_max: 'Diversification max points',
  diversification_multiplier: 'Diversification multiplier',
  position_sizing_max: 'Position sizing max points',
  position_sizing_ideal_pct: 'Ideal max position %',
  position_sizing_worst_pct: 'Worst max position %',
  ai_session_tier1_count: 'AI Tier 1 count',
  ai_session_tier1_points: 'AI Tier 1 points each',
  ai_session_tier2_count: 'AI Tier 2 count',
  ai_session_tier2_points: 'AI Tier 2 points each',
  ai_session_tier3_points: 'AI Tier 3 points each',
  streak_points_per_day: 'Streak points per day',
};

// ─── Component ────────────────────────────────────────────────

export function GamificationEditor() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [activeAccounts, setActiveAccounts] = useState(0);
  const [showWeightConfirm, setShowWeightConfirm] = useState(false);

  const [weights, setWeights] = useState<PillarWeight>({
    discipline: 40, understanding: 25, construction: 20, engagement: 15,
  });
  const [caps, setCaps] = useState<PointCaps>({
    streak_max: 90, ai_max: 60, learning_depth_max: 5, learning_depth_points: 50,
    style_consistency_max: 300, drawdown_bonus: 100, diversification_max: 150,
    diversification_multiplier: 1.5, position_sizing_max: 50,
    position_sizing_ideal_pct: 25, position_sizing_worst_pct: 50,
    ai_session_tier1_count: 10, ai_session_tier1_points: 3,
    ai_session_tier2_count: 10, ai_session_tier2_points: 2,
    ai_session_tier3_points: 0.5, streak_points_per_day: 3,
  });
  const [milestones, setMilestones] = useState<MilestoneThresholds>({
    true_to_style: { trades_executed: 10, match_rate: 0.70 },
    well_built: { position_count: 5, diversification_score: 70, max_position_pct: 35 },
    student_of_the_game: { learning_count: 5, deep_engagement_count: 3 },
    steady_hands: { drawdown_pct: 10 },
    weathered_a_storm: { drawdown_pct: 10, recovery_pct: 95 },
  });

  const [weightChanged, setWeightChanged] = useState(false);

  useEffect(() => {
    fetch('/api/admin/gamification')
      .then(r => r.json())
      .then(data => {
        if (data.config) {
          if (data.config.pillar_weights) setWeights(data.config.pillar_weights);
          if (data.config.point_caps) setCaps(data.config.point_caps);
          if (data.config.milestone_thresholds) setMilestones(data.config.milestone_thresholds);
        }
        setActiveAccounts(data.activeAccounts || 0);
      })
      .catch(e => setError('Failed to load config: ' + e.message))
      .finally(() => setLoading(false));
  }, []);

  const weightSum = weights.discipline + weights.understanding + weights.construction + weights.engagement;

  const handleWeightChange = (key: keyof PillarWeight, value: number) => {
    setWeights(prev => ({ ...prev, [key]: value }));
    setWeightChanged(true);
    setResult(null);
    setError(null);
  };

  const handleCapChange = (key: keyof PointCaps, value: number) => {
    setCaps(prev => ({ ...prev, [key]: value }));
    setResult(null);
    setError(null);
  };

  const handleMilestoneChange = (
    group: keyof MilestoneThresholds,
    key: string,
    value: number,
  ) => {
    setMilestones(prev => ({
      ...prev,
      [group]: { ...prev[group], [key]: value },
    }));
    setResult(null);
    setError(null);
  };

  const save = async (confirmWeights: boolean = false) => {
    // Pillar weight guardrail: confirmation step
    if (weightChanged && !confirmWeights) {
      setShowWeightConfirm(true);
      return;
    }
    setShowWeightConfirm(false);
    setSaving(true);
    setError(null);
    setResult(null);

    try {
      const resp = await fetch('/api/admin/gamification', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pillar_weights: weights,
          point_caps: caps,
          milestone_thresholds: milestones,
          recalculate: true,
        }),
      });

      const data = await resp.json();
      if (!resp.ok) {
        setError(data.details ? data.details.join('\n') : data.error || 'Save failed');
      } else {
        setResult(data);
        setWeightChanged(false);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ padding: '2rem' }}>Loading config…</div>;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '2rem 1rem' }}>
      <h1 style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>⚙️ Gamification Config</h1>
      <p style={{ color: '#888', marginBottom: '2rem' }}>
        Pillar weights, milestone thresholds, and point caps.
        Changes trigger immediate recalculation for all {activeAccounts} active accounts.
      </p>

      {error && (
        <div style={{ background: '#fee', border: '1px solid #f66', padding: '1rem', borderRadius: 8, marginBottom: '1.5rem', whiteSpace: 'pre-wrap' }}>
          {error}
        </div>
      )}

      {result && (
        <div style={{ background: '#efe', border: '1px solid #6c6', padding: '1rem', borderRadius: 8, marginBottom: '1.5rem' }}>
          ✅ Config saved. Updated keys: {result.updated?.join(', ') || 'none'}.
          {result.recalculate && (
            <span> Recalculated {result.recalculate.recalculated}/{result.recalculate.total} accounts
            in {(result.recalculate.durationMs / 1000).toFixed(1)}s
            {result.recalculate.errors > 0 && ` (${result.recalculate.errors} errors)`}.
            </span>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* Pillar Weights                                           */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem', borderBottom: '2px solid #333', paddingBottom: '0.5rem' }}>
          Pillar Weights
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          {Object.entries(PILLAR_LABELS).map(([key, label]) => (
            <div key={key}>
              <label style={{ display: 'block', fontSize: '0.875rem', color: '#aaa', marginBottom: '0.25rem' }}>
                {label} (%)
              </label>
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={weights[key as keyof PillarWeight]}
                onChange={e => handleWeightChange(key as keyof PillarWeight, Number(e.target.value))}
                style={{
                  width: '100%', padding: '0.5rem', background: '#1a1a2e', color: '#fff',
                  border: '1px solid #444', borderRadius: 6, fontSize: '1rem',
                }}
              />
              <div style={{ fontSize: '0.75rem', color: '#666', marginTop: '0.25rem' }}>
                {PILLAR_DESCRIPTIONS[key]}
              </div>
            </div>
          ))}
        </div>
        <div style={{
          marginTop: '0.75rem', padding: '0.5rem 1rem', borderRadius: 6,
          background: Math.abs(weightSum - 100) < 0.01 ? '#1a2e1a' : '#3e1a1a',
          color: Math.abs(weightSum - 100) < 0.01 ? '#6c6' : '#f66',
        }}>
          Sum: {weightSum.toFixed(1)}% {Math.abs(weightSum - 100) < 0.01 ? '✅' : '❌ Must equal 100%'}
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* Milestone Thresholds                                      */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem', borderBottom: '2px solid #333', paddingBottom: '0.5rem' }}>
          Milestone Thresholds
        </h2>

        {/* True to Style */}
        <fieldset style={{ border: '1px solid #444', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}>
          <legend style={{ fontWeight: 600, color: '#ccc' }}>True to Style</legend>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', color: '#aaa' }}>Min trades</label>
              <input type="number" min={1} step={1} value={milestones.true_to_style.trades_executed}
                onChange={e => handleMilestoneChange('true_to_style', 'trades_executed', Number(e.target.value))}
                style={{ width: '100%', padding: '0.4rem', background: '#1a1a2e', color: '#fff', border: '1px solid #444', borderRadius: 4 }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', color: '#aaa' }}>Match rate (0-1)</label>
              <input type="number" min={0} max={1} step={0.01} value={milestones.true_to_style.match_rate}
                onChange={e => handleMilestoneChange('true_to_style', 'match_rate', Number(e.target.value))}
                style={{ width: '100%', padding: '0.4rem', background: '#1a1a2e', color: '#fff', border: '1px solid #444', borderRadius: 4 }} />
            </div>
          </div>
        </fieldset>

        {/* Well-Built */}
        <fieldset style={{ border: '1px solid #444', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}>
          <legend style={{ fontWeight: 600, color: '#ccc' }}>Well-Built</legend>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', color: '#aaa' }}>Min positions</label>
              <input type="number" min={1} step={1} value={milestones.well_built.position_count}
                onChange={e => handleMilestoneChange('well_built', 'position_count', Number(e.target.value))}
                style={{ width: '100%', padding: '0.4rem', background: '#1a1a2e', color: '#fff', border: '1px solid #444', borderRadius: 4 }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', color: '#aaa' }}>Min diversification (0-100)</label>
              <input type="number" min={0} max={100} step={1} value={milestones.well_built.diversification_score}
                onChange={e => handleMilestoneChange('well_built', 'diversification_score', Number(e.target.value))}
                style={{ width: '100%', padding: '0.4rem', background: '#1a1a2e', color: '#fff', border: '1px solid #444', borderRadius: 4 }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', color: '#aaa' }}>Max position % (&lt;)</label>
              <input type="number" min={1} max={100} step={1} value={milestones.well_built.max_position_pct}
                onChange={e => handleMilestoneChange('well_built', 'max_position_pct', Number(e.target.value))}
                style={{ width: '100%', padding: '0.4rem', background: '#1a1a2e', color: '#fff', border: '1px solid #444', borderRadius: 4 }} />
            </div>
          </div>
        </fieldset>

        {/* Student of the Game */}
        <fieldset style={{ border: '1px solid #444', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}>
          <legend style={{ fontWeight: 600, color: '#ccc' }}>Student of the Game</legend>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', color: '#aaa' }}>Min learning moments</label>
              <input type="number" min={1} step={1} value={milestones.student_of_the_game.learning_count}
                onChange={e => handleMilestoneChange('student_of_the_game', 'learning_count', Number(e.target.value))}
                style={{ width: '100%', padding: '0.4rem', background: '#1a1a2e', color: '#fff', border: '1px solid #444', borderRadius: 4 }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', color: '#aaa' }}>Min deep engagements</label>
              <input type="number" min={1} step={1} value={milestones.student_of_the_game.deep_engagement_count}
                onChange={e => handleMilestoneChange('student_of_the_game', 'deep_engagement_count', Number(e.target.value))}
                style={{ width: '100%', padding: '0.4rem', background: '#1a1a2e', color: '#fff', border: '1px solid #444', borderRadius: 4 }} />
            </div>
          </div>
        </fieldset>

        {/* Steady Hands */}
        <fieldset style={{ border: '1px solid #444', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}>
          <legend style={{ fontWeight: 600, color: '#ccc' }}>Steady Hands</legend>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: '#aaa' }}>Drawdown threshold (%)</label>
            <input type="number" min={1} max={99} step={1} value={milestones.steady_hands.drawdown_pct}
              onChange={e => handleMilestoneChange('steady_hands', 'drawdown_pct', Number(e.target.value))}
              style={{ width: 160, padding: '0.4rem', background: '#1a1a2e', color: '#fff', border: '1px solid #444', borderRadius: 4 }} />
          </div>
        </fieldset>

        {/* Weathered a Storm */}
        <fieldset style={{ border: '1px solid #444', borderRadius: 8, padding: '1rem' }}>
          <legend style={{ fontWeight: 600, color: '#ccc' }}>Weathered a Storm</legend>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', color: '#aaa' }}>Drawdown threshold (%)</label>
              <input type="number" min={1} max={99} step={1} value={milestones.weathered_a_storm.drawdown_pct}
                onChange={e => handleMilestoneChange('weathered_a_storm', 'drawdown_pct', Number(e.target.value))}
                style={{ width: '100%', padding: '0.4rem', background: '#1a1a2e', color: '#fff', border: '1px solid #444', borderRadius: 4 }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', color: '#aaa' }}>Recovery threshold (%)</label>
              <input type="number" min={1} max={100} step={1} value={milestones.weathered_a_storm.recovery_pct}
                onChange={e => handleMilestoneChange('weathered_a_storm', 'recovery_pct', Number(e.target.value))}
                style={{ width: '100%', padding: '0.4rem', background: '#1a1a2e', color: '#fff', border: '1px solid #444', borderRadius: 4 }} />
            </div>
          </div>
        </fieldset>
      </section>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* Point Caps                                                */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem', borderBottom: '2px solid #333', paddingBottom: '0.5rem' }}>
          Point Caps & Constants
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
          {Object.entries(CAP_LABELS).map(([key, label]) => (
            <div key={key}>
              <label style={{ display: 'block', fontSize: '0.75rem', color: '#aaa', marginBottom: '0.25rem' }}>
                {label}
              </label>
              <input
                type="number"
                min={0}
                step={key.includes('multiplier') || key.includes('tier3_points') ? 0.1 : 1}
                value={caps[key as keyof PointCaps]}
                onChange={e => handleCapChange(key as keyof PointCaps, Number(e.target.value))}
                style={{
                  width: '100%', padding: '0.4rem', background: '#1a1a2e', color: '#fff',
                  border: '1px solid #444', borderRadius: 4, fontSize: '0.9rem',
                }}
              />
            </div>
          ))}
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* Save                                                      */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <button
        onClick={() => save(false)}
        disabled={saving || Math.abs(weightSum - 100) > 0.01}
        style={{
          padding: '0.75rem 2rem', fontSize: '1rem', fontWeight: 600, borderRadius: 8,
          background: (saving || Math.abs(weightSum - 100) > 0.01) ? '#444' : '#4a6',
          color: '#fff', border: 'none', cursor: (saving || Math.abs(weightSum - 100) > 0.01) ? 'not-allowed' : 'pointer',
        }}
      >
        {saving ? 'Saving & recalculating…' : 'Save & Recalculate All'}
      </button>

      {Math.abs(weightSum - 100) > 0.01 && (
        <p style={{ color: '#f66', fontSize: '0.8rem', marginTop: '0.5rem' }}>
          Fix pillar weights to sum to 100% before saving.
        </p>
      )}

      {/* Confirmation modal for weight changes */}
      {showWeightConfirm && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999,
        }}>
          <div style={{
            background: '#1e1e3e', padding: '2rem', borderRadius: 12, maxWidth: 480,
            border: '1px solid #f90',
          }}>
            <h3 style={{ marginTop: 0, color: '#f90' }}>⚠️ Pillar Weights Changed</h3>
            <p style={{ lineHeight: 1.6 }}>
              Changing pillar weights will reshape every user's score calculation.
              This will <strong>recalculate scores for all {activeAccounts} active accounts</strong> immediately.
            </p>
            <p style={{ color: '#aaa', fontSize: '0.875rem' }}>
              Weights must sum to 100%: {weightSum.toFixed(1)}%
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowWeightConfirm(false)}
                style={{ padding: '0.5rem 1.5rem', borderRadius: 6, border: '1px solid #555', background: 'transparent', color: '#ccc', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={() => save(true)}
                style={{ padding: '0.5rem 1.5rem', borderRadius: 6, border: 'none', background: '#f90', color: '#000', fontWeight: 600, cursor: 'pointer' }}
              >
                Confirm — Recalculate All {activeAccounts} Accounts
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
