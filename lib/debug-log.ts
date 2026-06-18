// ─── Debug Log Store ───────────────────────────────────────
// In-memory + sessionStorage-backed log store for on-screen
// debug overlay. Survives full page navigation within the
// same browser tab (magic link callback redirect).
//
// TEMPORARY — remove once diagnostic is resolved.
// ────────────────────────────────────────────────────────────

const SESSION_KEY = 'vantage_debug_log';
const MAX_ENTRIES = 100;

export interface DebugEntry {
  timestamp: string; // HH:MM:SS
  label: string;
  value: string;
}

let listeners: Array<() => void> = [];
let entries: DebugEntry[] = [];

// ── Restore from sessionStorage on module init ─────────────
function loadFromStorage(): DebugEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as DebugEntry[];
  } catch {
    return [];
  }
}

function saveToStorage() {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(entries));
  } catch { /* storage full or unavailable */ }
}

// Initialize from sessionStorage
entries = loadFromStorage();

function notifyListeners() {
  for (const fn of listeners) fn();
}

export function debugLog(label: string, value: any) {
  // Always console.log too
  if (typeof window !== 'undefined') {
    console.log(`[${label}]`, value);
  }

  const now = new Date();
  const ts = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map(n => String(n).padStart(2, '0'))
    .join(':');

  const str = typeof value === 'string' ? value : JSON.stringify(value);
  const truncated = str.length > 300 ? str.slice(0, 297) + '...' : str;

  entries = [...entries, { timestamp: ts, label, value: truncated }];

  // Cap at MAX_ENTRIES
  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(-MAX_ENTRIES);
  }

  saveToStorage();
  notifyListeners();
}

export function getDebugEntries(): DebugEntry[] {
  return entries;
}

export function clearDebugLog() {
  entries = [];
  if (typeof window !== 'undefined') {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch { /* ignore */ }
  }
  notifyListeners();
}

export function subscribeDebugLog(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter(l => l !== fn);
  };
}

export function copyDebugLog(): string {
  const text = entries
    .map(e => `[${e.timestamp}] ${e.label}: ${e.value}`)
    .join('\n');
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(() => {});
  }
  return text;
}

export function allDebugEntries(): string {
  return entries
    .map(e => `[${e.timestamp}] ${e.label}: ${e.value}`)
    .join('\n');
}

export function isDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return process.env.NEXT_PUBLIC_DEBUG_MODE === 'true';
}
