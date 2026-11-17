import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { createClient } from "@/frontend/utils/supabase/server";
import { checkRateLimit } from "@/frontend/utils/rate-limiter";

export const runtime = "nodejs";

const MIN_LENGTH = 8; // same rule as the reset-password page
const MAX_LENGTH = 72; // bcrypt's limit
// Wrong current passwords are the risk here: 5 tries per 15 minutes per user.
const LIMIT = { maxRequests: 5, windowMs: 15 * 60_000 };

/**
 * POST /api/users/change-password — the signed-in user changes their own password from Settings (owner 2026-11-03:
 * every role). Body { currentPassword, newPassword }.
 *
 * The current password is checked with a separate, non-persistent client, so the browser session is not touched.
 * A user whose account has no email/password sign-in (Google, magic link only) sets a first password without it.
 * The new password is saved with the user's own session (no service-role key), then the user's other sessions are
 * signed out; this one stays signed in.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

  const { allowed } = checkRateLimit(`change-password:${user.id}`, LIMIT);
  if (!allowed) return NextResponse.json({ error: "Too many attempts. Please wait 15 minutes and try again." }, { status: 429 });

  let body: { currentPassword?: unknown; newPassword?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

  if (newPassword.length < MIN_LENGTH) {
    return NextResponse.json({ error: `The new password must be at least ${MIN_LENGTH} characters.` }, { status: 400 });
  }
  if (newPassword.length > MAX_LENGTH) {
    return NextResponse.json({ error: `The new password must be at most ${MAX_LENGTH} characters.` }, { status: 400 });
  }

  const hasPassword = (user.identities ?? []).some((identity) => identity.provider === "email");
  if (hasPassword) {
    if (!currentPassword) return NextResponse.json({ error: "Enter your current password." }, { status: 400 });
    if (currentPassword === newPassword) {
      return NextResponse.json({ error: "The new password must be different from the current one." }, { status: 400 });
    }
    const verifier = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await verifier.auth.signInWithPassword({ email: user.email, password: currentPassword });
    if (error || data.user?.id !== user.id) {
      return NextResponse.json({ error: "Your current password is not correct." }, { status: 400 });
    }
    // The check created a session of its own: end it.
    await verifier.auth.signOut({ scope: "local" }).catch(() => undefined);
  }

  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
  if (updateError) {
    console.error("[change-password] update failed", updateError.message);
    const weak = /weak|pwned|leaked|short|characters/i.test(updateError.message);
    return NextResponse.json(
      { error: weak ? `Please choose a stronger password. ${updateError.message}` : "Couldn't change the password. Please try again." },
      { status: weak ? 400 : 500 },
    );
  }

  // Sign out every other device; this browser stays signed in.
  await supabase.auth.signOut({ scope: "others" }).catch(() => undefined);
  return NextResponse.json({ ok: true, firstPassword: !hasPassword });
}
