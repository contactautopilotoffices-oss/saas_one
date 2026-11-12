import { NextResponse } from "next/server";

import { OPTIONS_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { filterOptions, isOptionField } from "@/backend/lib/candidates/filter-search";

import { errorResponse, rateLimited, requireCandidateAccess } from "../_lib/auth";

export const runtime = "nodejs";

/** The dropdown while HR types. Query: orgId, field (keyword, location, role, company, designation), q. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const auth = await requireCandidateAccess(params.get("orgId"));
  if (auth.error) return auth.error;
  const limited = rateLimited("options", auth.user.id, OPTIONS_RATE_LIMIT);
  if (limited) return limited;
  const field = params.get("field");
  if (!isOptionField(field)) return NextResponse.json({ error: "Invalid field" }, { status: 400 });
  try {
    return NextResponse.json({ options: await filterOptions(auth.admin, auth.orgId, field, params.get("q") ?? "") });
  } catch (error) {
    return errorResponse(error, "Couldn't load suggestions");
  }
}
