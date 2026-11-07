import { NextResponse } from "next/server";

import { SUGGEST_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { suggestKeywords } from "@/backend/lib/candidates/keyword-suggest";

import { errorResponse, rateLimited, readJson, requireCandidateAccess } from "../_lib/auth";

export const runtime = "nodejs";
// One small model chain, with SUGGEST_CALL's 12 s budget, then a few counts.
export const maxDuration = 30;

/** "AI suggested keywords": { orgId, keywords } -> related terms that exist on this organisation's records. */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("suggest", auth.user.id, SUGGEST_RATE_LIMIT);
  if (limited) return limited;
  try {
    const keywords = Array.isArray(body.keywords)
      ? body.keywords.filter((k): k is string => typeof k === "string").map((k) => k.slice(0, 60)).slice(0, 20)
      : [];
    return NextResponse.json({ suggestions: await suggestKeywords(auth.admin, auth.orgId, keywords) });
  } catch (error) {
    return errorResponse(error, "Couldn't load suggestions");
  }
}
