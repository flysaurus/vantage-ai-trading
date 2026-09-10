// ─── Theme Provider — Light / Dark / System ────────────────────
// PART 1 + PART 2 of the theming work.
//
// Modes:
//   'light'  → always light          (DEFAULT for new users)
//   'dark'   → always dark
//   'system' → follows OS appearance AND stays live: a
//              prefers-color-scheme change re-resolves immediately,
//              no reload required.
//
// Persistence: localStorage `vantage:theme`.
// Application: sets `data-theme="light|dark"` + `color-scheme` on
// <html>. An inline boot script in app/layout.tsx applies the same
// attribute before first paint so there is no flash.

'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'vantage:theme';
/** Light is the default for new users (per the Theming spec). */
export const DEFAULT_THEME_MODE: ThemeMode = 'light';

export function isThemeMode(v: unknown): v is ThemeMode {
  return v === 'light' || v === 'dark' || v === 'system';
}

export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (mode === 'system') return prefersDark ? 'dark' : 'light';
  return mode;
}

interface ThemeContextValue {
  /** The user's choice (may be 'system'). */
  mode: ThemeMode;
  /** What's actually rendering right now ('light' | 'dark'). */
  resolved: ResolvedTheme;
  /** True while mode === 'system' and the OS is currently dark. */
  systemPrefersDark: boolean;
  /** True once the provider has read localStorage (avoids toggle flicker). */
  hydrated: boolean;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(DEFAULT_THEME_MODE);
  const [systemPrefersDark, setSystemPrefersDark] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // ── Read persisted mode + current OS preference on mount ──
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (isThemeMode(stored)) setModeState(stored);
    } catch {
      /* localStorage unavailable — stay on default */
    }
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemPrefersDark(mql.matches);

    // Live OS appearance updates (System mode must not need a reload).
    const onChange = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      setHydrated(true);
      return () => mql.removeEventListener('change', onChange);
    }
    // Safari < 14 fallback
    mql.addListener(onChange);
    setHydrated(true);
    return () => mql.removeListener(onChange);
  }, []);

  const resolved = resolveTheme(mode, systemPrefersDark);

  // ── Apply to <html> ──
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', resolved);
    root.style.colorScheme = resolved;
  }, [resolved]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* ignore quota / private-mode errors */
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, resolved, systemPrefersDark, hydrated, setMode }),
    [mode, resolved, systemPrefersDark, hydrated, setMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Theme hook. Safe to call outside a provider (returns the light
 * default) so isolated components/tests never crash.
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return {
      mode: DEFAULT_THEME_MODE,
      resolved: 'light',
      systemPrefersDark: false,
      hydrated: false,
      setMode: () => {},
    };
  }
  return ctx;
}

/** Inline boot script — runs before first paint, prevents theme flash. */
export const THEME_BOOT_SCRIPT = `(function(){try{
var k='${THEME_STORAGE_KEY}',m=localStorage.getItem(k);
if(m!=='light'&&m!=='dark'&&m!=='system')m='${DEFAULT_THEME_MODE}';
var d=window.matchMedia('(prefers-color-scheme: dark)').matches;
var r=m==='system'?(d?'dark':'light'):m;
document.documentElement.setAttribute('data-theme',r);
document.documentElement.style.colorScheme=r;
}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;
