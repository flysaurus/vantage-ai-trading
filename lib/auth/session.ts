// ─── Auth Session Utilities ──────────────────────────────────
// Server-side session helpers for Supabase magic link auth.
//
// These complement the existing custom auth system (lib/auth.ts).
// The custom system handles email/password + session cookies.
// This module handles Supabase-native auth (magic link).

import { getSupabaseServerClient } from './supabase-server';
import { createServerClient } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';

// ─── Types ────────────────────────────────────────────────────

export interface UserProfile {
  id: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  investorStyle: 'buffett' | 'lynch' | 'livermore' | 'soros' | 'munger';
  investorStyleOnboarded: boolean;
  anonymousId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── User Functions ──────────────────────────────────────────

/**
 * Get the currently authenticated Supabase user (server-side).
 * Returns null if no valid session exists.
 *
 * Uses @supabase/ssr's cookie-based auth — the session cookie
 * must be present from a prior signInWithOtp callback.
 */
export async function getCurrentUser(): Promise<User | null> {
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
      console.log('[session] No authenticated user');
      return null;
    }

    console.log('[session] User found:', data.user.email);
    return data.user;
  } catch (err: any) {
    console.error('[session] getCurrentUser error:', err.message);
    return null;
  }
}

/**
 * Fetch a user profile from the users table.
 * Returns null if no profile exists for the given userId.
 */
export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  try {
    const supabase = createServerClient();

    const { data, error } = await (supabase as any)
      .from('users')
      .select('id, email, display_name, avatar_url, investor_style, investor_style_onboarded, anonymous_id, created_at, updated_at')
      .eq('id', userId)
      .maybeSingle();

    if (error || !data) {
      console.log('[session] No profile found for user:', userId);
      return null;
    }

    return {
      id: data.id,
      email: data.email,
      displayName: data.display_name,
      avatarUrl: data.avatar_url,
      investorStyle: data.investor_style || 'buffett',
      investorStyleOnboarded: data.investor_style_onboarded === true,
      anonymousId: data.anonymous_id || null,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  } catch (err: any) {
    console.error('[session] getUserProfile error:', err.message);
    return null;
  }
}

/**
 * Get or create a user profile after magic link authentication.
 *
 * Called after the Supabase callback route exchanges the magic
 * link code for a session. Links the anonymousId to the profile
 * for data migration tracking.
 *
 * If a profile already exists: returns it (updates anonymous_id if provided).
 * If not: creates one with first_open preserved from the anonymous session.
 *
 * @param userId - Supabase Auth user ID
 * @param anonymousId - Anonymous session ID to link for migration
 * @param email - User email from Supabase Auth
 */
export async function getOrCreateProfile(
  userId: string,
  anonymousId: string,
  email?: string | null
): Promise<UserProfile> {
  const supabase = createServerClient();

  // Check if profile already exists (by Supabase auth user ID)
  console.log('[session/getOrCreateProfile] 🔍 Checking for existing profile — userId:', userId, '| anonId:', anonymousId?.slice(0, 12) + '...');
  const existing = await getUserProfile(userId);

  if (existing) {
    console.log('[session/getOrCreateProfile] 📋 Existing profile FOUND — investor_style:', existing.investorStyle, '| onboarded:', existing.investorStyleOnboarded, '| anonId:', existing.anonymousId?.slice(0, 12) + '...');
    // Update anonymous_id if not already set
    if (!existing.anonymousId && anonymousId) {
      console.log('[session] Linking existing profile to anonymous ID:', anonymousId);
      await (supabase as any)
        .from('users')
        .update({ anonymous_id: anonymousId, updated_at: new Date().toISOString() })
        .eq('id', userId);
    }

    return {
      ...existing,
      anonymousId: existing.anonymousId || anonymousId,
    };
  }
  console.log('[session/getOrCreateProfile] 📋 No existing profile — will CREATE new one');

  // Create new profile — first check anonymous_profiles for quiz data
  console.log('[session] Creating new profile for user:', userId);

  // Attempt to hydrate from anonymous_profiles (quiz completed before signup)
  let quizStyle: string | null = null;
  let quizRiskTolerance: string | null = null;
  let quizName: string | null = null;
  let quizOnboarded = false;

  if (anonymousId) {
    console.log('[session/getOrCreateProfile] 🔍 Looking up anonymous_profiles for anonId:', anonymousId);
    const anonSupabase = createServerClient();
    const { data: anonProfile } = await (anonSupabase as any)
      .from('anonymous_profiles')
      .select('first_name, investor_style, risk_tolerance')
      .eq('anonymous_id', anonymousId)
      .maybeSingle();

    if (anonProfile) {
      quizStyle = anonProfile.investor_style || null;
      quizRiskTolerance = anonProfile.risk_tolerance || null;
      quizName = anonProfile.first_name || null;
      // If anonymous profile has investor_style set, they completed the quiz
      quizOnboarded = !!quizStyle;
      console.log('[session/getOrCreateProfile] 📋 anonymous_profiles FOUND — investor_style:', quizStyle, '| risk:', quizRiskTolerance);
    } else {
      console.log('[session/getOrCreateProfile] ⚠️ No anonymous_profiles row found for anonId:', anonymousId);
    }
  }

  // Try insert. If email already exists (duplicate key 23505), fetch the
  // existing row and update only metadata — do NOT change users.id because
  // foreign keys (chat_history, user_sessions, etc.) reference it.
  console.log('[session/getOrCreateProfile] 📝 Attempting INSERT for userId:', userId, '| email:', email);
  const { data, error } = await (supabase as any)
    .from('users')
    .insert({
      id: userId,
      email: email || null,
      display_name: quizName || email?.split('@')[0] || null,
      investor_style: quizStyle || 'buffett',
      investor_style_onboarded: quizOnboarded,
      anonymous_id: anonymousId,
    })
    .select('id, email, display_name, avatar_url, investor_style, investor_style_onboarded, anonymous_id, created_at, updated_at')
    .single();

  if (error) {
    // 23505 = duplicate key (unique constraint violation)
    if (error.code === '23505' && email) {
      console.log('[session/getOrCreateProfile] 🔄 Email already exists — fetching existing row and updating metadata');
      // Fetch the existing row by email (keep its original id)
      const { data: existingRow, error: fetchErr } = await (supabase as any)
        .from('users')
        .select('*')
        .eq('email', email)
        .single();

      if (fetchErr || !existingRow) {
        console.error('[session] Failed to fetch existing user by email:', fetchErr?.message);
        throw new Error(`Failed to create user profile: ${error.message}`);
      }

      console.log('[session/getOrCreateProfile] 📋 Found existing by email — id:', existingRow.id, '| style:', existingRow.investor_style);

      // Update metadata ONLY (not id — FK constraints would break)
      const updateData: any = { updated_at: new Date().toISOString() };
      if (!existingRow.investor_style_onboarded && quizOnboarded) {
        updateData.investor_style = quizStyle;
        updateData.investor_style_onboarded = true;
      }
      if (!existingRow.anonymous_id && anonymousId) {
        updateData.anonymous_id = anonymousId;
      }
      if (!existingRow.display_name && (quizName || email)) {
        updateData.display_name = quizName || email?.split('@')[0] || null;
      }

      await (supabase as any)
        .from('users')
        .update(updateData)
        .eq('email', email);

      // Return the existing profile with updated metadata
      return {
        id: existingRow.id,
        email: existingRow.email,
        displayName: updateData.display_name || existingRow.display_name,
        avatarUrl: existingRow.avatar_url,
        investorStyle: quizOnboarded ? (quizStyle || 'buffett') : (existingRow.investor_style || 'buffett'),
        investorStyleOnboarded: existingRow.investor_style_onboarded || quizOnboarded,
        anonymousId: anonymousId || existingRow.anonymous_id || null,
        createdAt: existingRow.created_at,
        updatedAt: existingRow.updated_at,
      };
    }

    // Not a duplicate email — real error
    console.error('[session] Failed to insert profile:', error.message, error.code, error.details);
    throw new Error(`Failed to create user profile: ${error.message}`);
  }

  return {
    id: data.id,
    email: data.email,
    displayName: data.display_name,
    avatarUrl: data.avatar_url,
    investorStyle: data.investor_style || 'buffett',
    investorStyleOnboarded: data.investor_style_onboarded === true,
    anonymousId: data.anonymous_id || null,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}
