import { NextResponse } from "next/server";

import { FILTER_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { filterRecords, parseFilters } from "@/backend/lib/candidates/filter-search";

import { errorResponse, rateLimited, readJson, requireCandidateAccess } from "../_lib/auth";

export const runtime = "nodejs";

/** The filter panel: { orgId, filters, page, pageSize } -> one page of matching records. No AI, so it answers at once. */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("filter", auth.user.id, FILTER_RATE_LIMIT);
  if (limited) return limited;
  try {
    return NextResponse.json(await filterRecords(auth.admin, auth.orgId, parseFilters(body.filters), Number(body.page) || 1, Number(body.pageSize) || 20));
  } catch (error) {
    return errorResponse(error, "Couldn't load candidates");
  }
}
