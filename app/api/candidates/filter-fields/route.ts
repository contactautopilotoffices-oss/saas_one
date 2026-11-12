import { NextResponse } from "next/server";

import { FILTER_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { resumeFieldAvailability } from "@/backend/lib/candidates/filter-search";

import { errorResponse, rateLimited, requireCandidateAccess } from "../_lib/auth";

export const runtime = "nodejs";

/** Which resume filters have data yet (the rest are greyed out). Query: orgId. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const auth = await requireCandidateAccess(params.get("orgId"));
  if (auth.error) return auth.error;
  const limited = rateLimited("filter", auth.user.id, FILTER_RATE_LIMIT);
  if (limited) return limited;
  try {
    return NextResponse.json(await resumeFieldAvailability(auth.admin, auth.orgId));
  } catch (error) {
    return errorResponse(error, "Couldn't load the filters");
  }
}
