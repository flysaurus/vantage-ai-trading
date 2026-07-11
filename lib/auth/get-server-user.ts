// ─── Server Auth Helper (Supabase Cookie-Based) ─────────────────
// Uses Supabase Auth cookies set by @supabase/ssr createBrowserClient.
// Sessions are refreshed by middleware.ts on every request.
//
// Usage in API routes:
//   import { requireAuth } from '@/lib/auth/get-server-user'
//   export async function GET(request: NextRequest) {
//     const { authUser, authError } = await requireAuth()
//     if (authError) return authError
//     // authUser.email, authUser.id available
//   }

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// ─── Types ────────────────────────────────────────────────────

export interface ServerUser {
  id: string
  email: string
}

// ─── Core: get the current Supabase user from cookies ─────────

/**
 * Resolve the current authenticated user from Supabase Auth cookies.
 * Returns null if no valid session exists.
 */
export async function getServerUser(
  _request?: NextRequest
): Promise<ServerUser | null> {
  try {
    const cookieStore = await cookies()

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(
              ({ name, value, options }) =>
                cookieStore.set(name, value, options)
            )
          }
        }
      }
    )

    const { data: { user }, error } = await supabase.auth.getUser()

    if (error || !user) return null

    return {
      id: user.id,
      email: user.email!
    }

  } catch {
    return null
  }
}

// ─── requireAuth — guard that returns 401 NextResponse on failure ──

/**
 * Authenticate the request using Supabase cookies.
 * On failure returns a 401 JSON NextResponse.
 * On success returns the ServerUser.
 *
 * Usage:
 *   const { authUser, authError } = await requireAuth()
 *   if (authError) return authError
 *
 * Uses `authUser`/`authError` names to avoid collisions with
 * Supabase query destructuring which commonly uses `error` and `user`.
 */
export async function requireAuth(
  request?: NextRequest
): Promise<
  | { authUser: ServerUser; authError: null }
  | { authUser: null; authError: NextResponse }
> {
  const authUser = await getServerUser(request)

  if (!authUser) {
    return {
      authUser: null,
      authError: NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
  }

  // ── Suspended user check ──
  try {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          }
        }
      }
    )

    const { data: userRow, error: queryErr } = await supabase
      .from('users')
      .select('suspended')
      .eq('id', authUser.id)
      .maybeSingle()

    if (!queryErr && userRow?.suspended) {
      return {
        authUser: null,
        authError: NextResponse.json(
          { error: 'Account suspended', message: 'Your account has been suspended. Contact support for assistance.' },
          { status: 403 }
        )
      }
    }
  } catch {
    // If the query fails (table doesn't exist, etc.), allow access
    console.warn('[requireAuth] Suspended check failed — allowing access')
  }

  return { authUser, authError: null }
}

// ─── getServerProfile — full user profile from public.users table ─

/**
 * Get the full application profile for the authenticated user.
 * Reads from public.users table using the user's email as key.
 */
export async function getServerProfile(
  request?: NextRequest
) {
  const user = await getServerUser(request)
  if (!user) return null

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(
            ({ name, value, options }) =>
              cookieStore.set(name, value, options)
          )
        }
      }
    }
  )

  const { data: profile } = await supabase
    .from('users')
    .select('*')
    .eq('email', user.email)
    .single()

  return profile
}

// ─── getOptionalUserId — anonymous-friendly variant ────────────

/**
 * Returns the authenticated user's ID if logged in, 'anonymous' otherwise.
 * For routes that serve both authenticated and anonymous users.
 */
export async function getOptionalUserId(): Promise<string> {
  const user = await getServerUser()
  return user?.id || 'anonymous'
}
