// ─── GET /auth/callback ──────────────────────────────────────
// Magic link / passwordless email callback.
// User lands here after clicking the link in their email.
//
// Flow:
// 1. Exchange `code` for Supabase session
// 2. Ensure users row exists (parent of user_profiles FK)
// 3. Ensure user_profiles row exists
// 4. Migrate anonymous data if anonymous_id present
// 5. Redirect to app

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const origin = "https://vantage-ai-trading.vercel.app";

  if (!code) {
    return NextResponse.redirect(`${origin}?auth_error=no_code`);
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          cookieStore.set({ name, value, ...options });
        },
        remove(name: string, options: any) {
          cookieStore.set({ name, value: "", ...options });
        },
      },
    }
  );

  try {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      console.error("Auth error:", error.message);
      return NextResponse.redirect(`${origin}?auth_error=expired`);
    }

    if (data.user) {
      const userId = data.user.id;
      const email = data.user.email;
      const meta = data.user.user_metadata as Record<string, string> | undefined;
      const firstName = meta?.first_name || meta?.given_name || '';
      const lastName = meta?.last_name || meta?.family_name || '';
      const now = new Date().toISOString();
      const anonymousId =
        requestUrl.searchParams.get("anonymous_id") ||
        cookieStore.get("vantage_anon_id")?.value;

      // Ensure users row exists (parent table, required for FK)
      const { data: existingUser } = await (supabase
        .from("users") as any)
        .select("id")
        .eq("id", userId)
        .maybeSingle();

      if (!existingUser) {
        await (supabase.from("users") as any).insert({
          id: userId,
          email,
          first_name: firstName,
          last_name: lastName,
        });
      }

      // Ensure user_profiles row exists (extended profile)
      const { data: existingProfile } = await (supabase
        .from("user_profiles") as any)
        .select("id")
        .eq("id", userId)
        .maybeSingle();

      if (!existingProfile) {
        await (supabase.from("user_profiles") as any).insert({
          id: userId,
          first_name: firstName,
          last_name: lastName,
          tier: 'demo',
          first_open: now,
          demo_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        });
      }

      // Migrate anonymous data tables
      if (anonymousId) {
        const tables = [
          "demo_portfolio_state",
          "chat_messages",
          "pending_basket_orders",
          "streaks",
          "investor_scores",
          "milestones",
        ];

        for (const table of tables) {
          await supabase
            .from(table)
            .update({ user_id: userId })
            .eq("anonymous_id", anonymousId)
            .is("user_id", null);
        }
      }
    }

    return NextResponse.redirect(`${origin}/`);
  } catch (err: any) {
    console.error("Callback error:", err);
    return NextResponse.redirect(`${origin}?auth_error=unknown`);
  }
}
