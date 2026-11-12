import { NextResponse } from "next/server";

import { SEARCH_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { parseFilters } from "@/backend/lib/candidates/filter-search";
import { PreferSchema } from "@/backend/lib/candidates/query-spec";
import { rankFiltered } from "@/backend/lib/candidates/search";

import { errorResponse, rateLimited, readJson, requireCandidateAccess } from "../_lib/auth";

export const runtime = "nodejs";
// One ranking chain, with RERANK_CALL's 60 s budget.
export const maxDuration = 90;

/** "Rank with AI": { orgId, filters, prefer, jobText } -> the matched records scored and explained. */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("search", auth.user.id, SEARCH_RATE_LIMIT);
  if (limited) return limited;
  try {
    const filters = parseFilters(body.filters);
    const prefer = PreferSchema.catch({}).parse(body.prefer ?? {});
    const jobText = typeof body.jobText === "string" ? body.jobText.slice(0, 4000) : "";
    return NextResponse.json(await rankFiltered(auth.admin, auth.orgId, auth.user.id, filters, prefer, jobText));
  } catch (error) {
    return errorResponse(error, "The ranking failed. Please try again.");
  }
}
