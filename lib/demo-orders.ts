// ─── Demo Order Simulation ──────────────────────────────────
// localStorage-based pending order system for demo mode.
// When no broker is connected, orders are stored locally with
// status 'pending' — they do NOT simulate auto-fills.

import type { Order } from '@/types';

const STORAGE_KEY = 'vantage:demo-orders';

export function getPendingDemoOrders(): Order[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function addPendingDemoOrder(order: Order): void {
  if (typeof window === 'undefined') return;
  const existing = getPendingDemoOrders();
  existing.unshift(order);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
}

export function clearDemoOrders(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}
