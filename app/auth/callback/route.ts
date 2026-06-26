// ─── GET /auth/callback ──────────────────────────────────────
// Minimal magic link callback. User lands here after clicking
// the magic link in their email.
//
// Flow:
// 1. Exchange `code` query param for a Supabase session
// 2. Read anonymous_id from query params or cookie
// 3. Simple upsert on user_profiles
// 4. Migrate data tables if anonymous_id present
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
      const anonymousId =
        requestUrl.searchParams.get("anonymous_id") ||
        cookieStore.get("vantage_anon_id")?.value;

      await supabase.from("user_profiles").upsert(
        {
          user_id: data.user.id,
          anonymous_id: anonymousId || null,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "user_id",
          ignoreDuplicates: false,
        }
      );

      // If we have an anonymous_id, migrate data tables
      // Simple updates only — no deletes, no touching auth tables
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
            .update({ user_id: data.user.id })
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
