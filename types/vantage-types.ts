// ─── Vantage Types — Manual overrides for application-level types ──
// These types extend or override the auto-generated supabase.ts types.
// Do NOT edit types/supabase.ts directly — it's generated from the DB schema.

export interface VantageUser {
  id?: string;
  email: string;
  first_name: string;
  last_name: string;
  display_name?: string;
  investor_style: string | null;
  risk_tolerance: string | null;
  investor_style_onboarded: boolean;
  investor_style_set_at: string | null;
  tier: 'demo' | 'silver' | 'gold';
  demo_start_at: string | null;
  demo_expires_at: string | null;
  first_open: string | null;
  last_login: string | null;
  portfolio_mode?: string;
  created_at?: string;
  updated_at?: string;
}

export interface DemoStatus {
  daysRemaining: number;
  isExpired: boolean;
  showWarning: boolean;
  percentUsed: number;
}

export type AppState =
  | 'loading'
  | 'onboarding'
  | 'needs-quiz'
  | 'needs-profile'
  | 'broker-selection'
  | 'demo-expired'
  | 'authenticated';
