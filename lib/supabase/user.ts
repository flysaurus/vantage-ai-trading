// ─── User Profile Operations ─────────────────────────────────
// Supabase mutations for user profile fields (investor style, display name, etc.)

import { createClient } from '@/lib/supabase';
import type { InvestorStyle } from '@/types';

/**
 * Updates the user's investor style in Supabase and returns the updated row.
 */
export async function updateInvestorStyle(
  userId: string,
  style: InvestorStyle,
): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase
    .from('users')
    .update({
      investor_style: style,
      investor_style_set_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', userId);

  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Marks the user as having completed investor style onboarding.
 */
export async function completeOnboarding(userId: string): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase
    .from('users')
    .update({
      investor_style_onboarded: true,
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', userId);

  if (error) {
    throw new Error(error.message);
  }
}
