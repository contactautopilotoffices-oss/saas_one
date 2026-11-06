import type { SupabaseClient, User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { canUseCandidateSearch, getCandidatesAdmin } from "@/backend/lib/candidates/access";
import { SheetError } from "@/backend/lib/candidates/parse-sheet";
import { CandidateActionError } from "@/backend/lib/candidates/records";
import { createClient } from "@/frontend/utils/supabase/server";
import { checkRateLimit } from "@/frontend/utils/rate-limiter";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AuthResult =
  | { user: User; orgId: string; admin: SupabaseClient; error?: never }
  | { error: NextResponse };

/**
 * The signed-in user, allowed to use Candidate Search in `orgId` (HR roles, org super admin, Tech, master admin),
 * plus the service-role client to act with. Otherwise a 400/401/403 response to return as-is.
 */
export async function requireCandidateAccess(orgId: unknown): Promise<AuthResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (typeof orgId !== "string" || !UUID.test(orgId)) {
    return { error: NextResponse.json({ error: "orgId is required" }, { status: 400 }) };
  }
  if (!(await canUseCandidateSearch(user.id, orgId))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user, orgId, admin: getCandidatesAdmin() };
}

/** A 429 response if this user went over `limit` for `bucket`, else null. */
export function rateLimited(bucket: string, userId: string, limit: { maxRequests: number; windowMs: number }): NextResponse | null {
  const { allowed, resetTime } = checkRateLimit(`candidates:${bucket}:${userId}`, limit);
  if (allowed) return null;
  return NextResponse.json(
    { error: "Too many requests. Please wait a moment and try again." },
    { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil((resetTime - Date.now()) / 1000))) } },
  );
}

/** Turn an error from a candidates action into a JSON response. */
export function errorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof CandidateActionError || error instanceof SheetError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error(`[candidates] ${fallback}`, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

/** The JSON object body, or a 400 response to return as-is when it is missing or not a JSON object. */
export async function readJson(request: Request): Promise<Record<string, unknown> | NextResponse> {
  try {
    const body = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  return NextResponse.json({ error: "Expected a JSON object body" }, { status: 400 });
}
