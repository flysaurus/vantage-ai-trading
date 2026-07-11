'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Settings2, Bell, Shield, Eye, X, ChevronRight, RefreshCw, User } from 'lucide-react';

// ─── localStorage keys ───────────────────────────────────────
const PREFS_KEY = 'vantage:preferences';
const STYLE_KEY = 'vantage:investor_style';

interface PrefsData {
  emailAlerts: boolean;
  alertFrequency: 'instant' | 'daily' | 'weekly';
}

function loadPrefs(): PrefsData {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { emailAlerts: true, alertFrequency: 'instant' };
}

function savePrefs(prefs: PrefsData) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

function loadStyle(): { style: string; trait: string } | null {
  try {
    const raw = localStorage.getItem(STYLE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

// ─── Page ────────────────────────────────────────────────────
export default function PreferencesPage() {
  const router = useRouter();
  const [prefs, setPrefs] = useState<PrefsData>(loadPrefs);
  const [investorStyle, setInvestorStyle] = useState(loadStyle);
  const [isAdmin, setIsAdmin] = useState(false);
  const [_dbg, setDbg] = useState<string>('WAITING');

  // TEMPORARY DEBUG — ALWAYS visible banner at top of page
  // Shows raw /api/auth/is-admin response plus fetch errors
  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/is-admin', { credentials: 'include' })
      .then(r => {
        setDbg(prev => prev + ' | status=' + r.status);
        return r.json();
      })
      .then(d => {
        if (!cancelled) {
          setDbg(JSON.stringify(d, null, 2));
          if (d.isAdmin) setIsAdmin(true);
        }
      })
      .catch(e => { if (!cancelled) setDbg('FETCH_ERROR: ' + String(e)); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const check = () => {
      fetch('/api/auth/is-admin')
        .then((r) => r.json())
        .then((d) => {
          if (!cancelled && d.isAdmin) setIsAdmin(true);
        });
    };

    // Retry once after 1.5s if first attempt fails silently
    const retryId = setTimeout(() => { if (!cancelled) check(); }, 1500);

    check();
    return () => { cancelled = true; clearTimeout(retryId); };
  }, []);

  useEffect(() => {
    savePrefs(prefs);
  }, [prefs]);

  const toggleAlerts = () => setPrefs(p => ({ ...p, emailAlerts: !p.emailAlerts }));

  const setFrequency = (freq: 'instant' | 'daily' | 'weekly') => {
    setPrefs(p => ({ ...p, alertFrequency: freq }));
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      padding: 16, paddingBottom: 32,
      background: '#0a0e27',
      overflowY: 'auto', WebkitOverflowScrolling: 'touch',
    }}>
      <div style={{ maxWidth: 420, margin: '0 auto', width: '100%' }}>
        <div style={{
          background: '#0f172a', border: '1px solid #334155',
          borderRadius: 16, padding: '32px 24px',
        }}>
          {/* ⚠️ TEMP DEBUG — remove after confirming admin check */}
          <div style={{
            marginBottom: 16, padding: 10, background: '#1a0000', border: '2px solid #ff0000',
            borderRadius: 8, fontFamily: 'monospace', fontSize: 10, color: '#ff6666',
            whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          }}>
            🔴 DEBUG: isAdmin={String(isAdmin)} | API={_dbg}
          </div>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(245,158,11,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Settings2 size={18} style={{ color: '#f59e0b' }} />
              </div>
              <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Preferences</h1>
            </div>
            <button onClick={() => router.push('/')} style={{ background: 'none', border: 'none', color: '#e2e8f0', cursor: 'pointer', padding: 4 }}>
              <X size={20} />
            </button>
          </div>

          {/* Notifications */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: '#e2e8f0', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
              Notifications
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: 14, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, marginBottom: 8,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Bell size={15} style={{ color: '#06b6d4' }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Email Alerts</div>
                  <div style={{ fontSize: 10, color: '#e2e8f0' }}>Receive notifications for orders, alerts, and market events</div>
                </div>
              </div>
              <div
                onClick={toggleAlerts}
                style={{
                  width: 44, height: 26, borderRadius: 13, cursor: 'pointer',
                  background: prefs.emailAlerts ? '#06b6d4' : '#334155',
                  position: 'relative', flexShrink: 0, transition: 'background 0.2s',
                }}
              >
                <div style={{
                  width: 20, height: 20, borderRadius: '50%', background: '#fff',
                  position: 'absolute', top: 3,
                  left: prefs.emailAlerts ? 21 : 3,
                  transition: 'left 0.2s',
                }} />
              </div>
            </div>

            {prefs.emailAlerts && (
              <div style={{ padding: '6px 14px 0' }}>
                <div style={{ fontSize: 10, color: '#e2e8f0', marginBottom: 6 }}>Alert Frequency</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['instant', 'daily', 'weekly'] as const).map(freq => (
                    <button
                      key={freq}
                      onClick={() => setFrequency(freq)}
                      style={{
                        flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 11, fontWeight: 600,
                        border: prefs.alertFrequency === freq ? '1px solid #06b6d4' : '1px solid #1e293b',
                        background: prefs.alertFrequency === freq ? 'rgba(6,182,212,0.1)' : '#0f172a',
                        color: prefs.alertFrequency === freq ? '#06b6d4' : '#64748b',
                        cursor: 'pointer', textTransform: 'capitalize',
                      }}
                    >
                      {freq}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Appearance */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: '#e2e8f0', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
              Appearance
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: 14, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Eye size={15} style={{ color: '#8b5cf6' }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Theme</div>
                  <div style={{ fontSize: 10, color: '#e2e8f0' }}>Dark mode (additional themes coming soon)</div>
                </div>
              </div>
              <span style={{ fontSize: 11, color: '#94a3b8', padding: '4px 10px', borderRadius: 6, background: '#1e293b', border: '1px solid #334155' }}>Dark</span>
            </div>
          </div>

          {/* Security */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: '#e2e8f0', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
              Security
            </div>
            <div
              onClick={() => router.push('/security')}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: 14, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12,
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Shield size={15} style={{ color: '#22c55e' }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Security & Encryption</div>
                  <div style={{ fontSize: 10, color: '#e2e8f0' }}>How your data and broker keys are protected</div>
                </div>
              </div>
              <ChevronRight size={14} style={{ color: '#94a3b8' }} />
            </div>
          </div>

          {/* Investor Profile */}
          {investorStyle && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#e2e8f0', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                Investor Profile
              </div>
              <div style={{
                padding: 14, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <User size={15} style={{ color: '#06b6d4' }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{investorStyle.style}</div>
                    <div style={{ fontSize: 11, color: '#e2e8f0' }}>{investorStyle.trait}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => {
                      localStorage.removeItem(STYLE_KEY);
                      sessionStorage.setItem('vantage_onboarding_retake', 'quiz');
                      router.push('/onboarding');
                    }}
                    style={{
                      flex: 1, padding: '10px 0', borderRadius: 8, fontSize: 12, fontWeight: 600,
                      border: '1px solid #334155', background: 'transparent', color: '#94a3b8',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    }}
                  >
                    <RefreshCw size={12} />
                    Retake quiz
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* No style set yet */}
          {!investorStyle && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#e2e8f0', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                Investor Profile
              </div>
              <div
                onClick={() => router.push('/onboarding')}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: 14, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12,
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <User size={15} style={{ color: '#94a3b8' }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8' }}>Set your investor style</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>Discover your approach in 2 minutes</div>
                  </div>
                </div>
                <ChevronRight size={14} style={{ color: '#94a3b8' }} />
              </div>
            </div>
          )}

          {/* Admin — visible only to admins */}
          {isAdmin && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#e2e8f0', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                Admin
              </div>
              <div
                onClick={() => router.push('/admin/tiers')}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: 14, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, marginBottom: 8,
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 14 }}>📊</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>Tier Limits</div>
                    <div style={{ fontSize: 10, color: '#e2e8f0' }}>AI usage limits and model access per tier</div>
                  </div>
                </div>
                <ChevronRight size={14} style={{ color: '#94a3b8' }} />
              </div>
              <div
                onClick={() => router.push('/admin/gamification')}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: 14, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, marginBottom: 8,
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 14 }}>⚙️</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>Gamification Config</div>
                    <div style={{ fontSize: 10, color: '#e2e8f0' }}>Pillar weights, milestones, and point caps</div>
                  </div>
                </div>
                <ChevronRight size={14} style={{ color: '#94a3b8' }} />
              </div>
              <div
                onClick={() => router.push('/admin/users')}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: 14, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12,
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 14 }}>👥</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>Manage Users</div>
                    <div style={{ fontSize: 10, color: '#e2e8f0' }}>User management and tier overrides</div>
                  </div>
                </div>
                <ChevronRight size={14} style={{ color: '#94a3b8' }} />
              </div>
            </div>
          )}

          <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', marginTop: 8 }}>
            Preferences are saved locally on this device.
          </div>
        </div>
      </div>
    </div>
  );
}
