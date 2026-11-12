import { NextResponse } from "next/server";

import { SEARCH_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { searchCandidates, validateSearchBody } from "@/backend/lib/candidates/search";

import { errorResponse, rateLimited, readJson, requireCandidateAccess } from "../_lib/auth";

export const runtime = "nodejs";
// Two Claude calls (query: up to 2 x 20 s; ranking: up to 45 s) plus search: allow 120 s.
export const maxDuration = 120;

/** Plain-English search: { orgId, query, topN (1-30) } -> ranked top N with explanations. */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("search", auth.user.id, SEARCH_RATE_LIMIT);
  if (limited) return limited;
  try {
    const { query, topN } = validateSearchBody(body);
    return NextResponse.json(await searchCandidates(auth.admin, auth.orgId, auth.user.id, query, topN));
  } catch (error) {
    return errorResponse(error, "The search failed. Please try again.");
  }
}
