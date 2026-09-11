// ─── position-avatar ────────────────────────────────────────
// Shared deterministic ticker → tint + initials, used by the Holdings position
// rows and the full-screen Position Detail header so a symbol looks identical
// in both places. Colours are fixed (theme-safe) palette entries.
export const AVATAR_COLORS = [
  { bg: 'rgba(14, 140, 153, 0.16)', fg: '#0e8c99' },
  { bg: 'rgba(30, 158, 90, 0.16)', fg: '#1e9e5a' },
  { bg: 'rgba(91, 75, 196, 0.16)', fg: '#5b4bc4' },
  { bg: 'rgba(217, 169, 74, 0.18)', fg: '#a97b14' },
  { bg: 'rgba(214, 69, 69, 0.14)', fg: '#d64545' },
  { bg: 'rgba(58, 110, 205, 0.16)', fg: '#3a6ecd' },
];

export function avatarColor(symbol: string) {
  let h = 0;
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function initials(symbol: string) {
  return symbol.slice(0, 2).toUpperCase();
}
