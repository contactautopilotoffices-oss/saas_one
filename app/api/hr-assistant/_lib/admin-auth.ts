import type { SupabaseClient, User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getHrAccess, PolicyActionError, type HrAccess } from "@/backend/lib/hr-assistant";
import { createClient } from "@/frontend/utils/supabase/server";
import { checkRateLimit } from "@/frontend/utils/rate-limiter";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AuthResult =
  | { user: User; access: HrAccess; supabase: SupabaseClient; error?: never }
  | { error: NextResponse };

/** The signed-in user and their HR assistant access, or a 401 response to return as-is. */
export async function requireHrSession(): Promise<AuthResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  return { user, access: await getHrAccess(user.id), supabase };
}

/** An employee or staff member allowed to chat, or a 401/403 response. */
export async function requireHrUser(): Promise<AuthResult> {
  const auth = await requireHrSession();
  if (auth.error) return auth;
  if (!auth.access.canUse) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return auth;
}

/** The signed-in HR admin, or a 401/403 response to return as-is. */
export async function requireHrAdmin(): Promise<AuthResult> {
  const auth = await requireHrSession();
  if (auth.error) return auth;
  if (!auth.access.isAdmin) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return auth;
}

/** A 429 response if this user went over `limit` for `bucket`, else null. */
export function rateLimited(
  bucket: string,
  userId: string,
  limit: { maxRequests: number; windowMs: number },
): NextResponse | null {
  const { allowed, resetTime } = checkRateLimit(`hr-assistant:${bucket}:${userId}`, limit);
  if (allowed) return null;
  return NextResponse.json(
    { error: "Too many requests. Please wait a moment and try again." },
    { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil((resetTime - Date.now()) / 1000))) } },
  );
}

/** Turn an error from a policy action into a JSON response. */
export function actionErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof PolicyActionError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error(`[hr-assistant] ${fallback}`, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
