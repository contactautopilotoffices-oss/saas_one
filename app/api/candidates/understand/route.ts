import { NextResponse } from "next/server";

import { MAX_QUERY_LENGTH, SEARCH_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { understoodFilters } from "@/backend/lib/candidates/filter-search";
import { parseQuery } from "@/backend/lib/candidates/query-spec";
import { CandidateActionError } from "@/backend/lib/candidates/records";

import { errorResponse, rateLimited, readJson, requireCandidateAccess } from "../_lib/auth";

export const runtime = "nodejs";
// One model chain, with PARSE_CALL's 35 s budget.
export const maxDuration = 60;

/** "Paste a job description": { orgId, text } -> the filters the AI read from it, for HR to check and change. */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("search", auth.user.id, SEARCH_RATE_LIMIT);
  if (limited) return limited;
  try {
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) throw new CandidateActionError(400, "Paste a job description first.");
    if (text.length > MAX_QUERY_LENGTH) throw new CandidateActionError(400, `Keep it under ${MAX_QUERY_LENGTH} characters.`);
    const { spec, aiParsed } = await parseQuery(text, new Date().toISOString().slice(0, 10));
    return NextResponse.json({
      ...understoodFilters(spec),
      summary: text,
      aiParsed,
      notices: aiParsed ? [] : ["The AI couldn't read that just now, so no filters were filled in. Please try again or set them by hand."],
    });
  } catch (error) {
    return errorResponse(error, "Couldn't read the job description");
  }
}
