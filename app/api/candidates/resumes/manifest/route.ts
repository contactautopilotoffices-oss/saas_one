import { NextResponse } from "next/server";

import { RESUME_EXPORT_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { parseResumeQuery, resumeManifest } from "@/backend/lib/candidates/resumes";

import { errorResponse, rateLimited, requireCandidateAccess } from "../../_lib/auth";

export const runtime = "nodejs";

/** Every file matching the list filters (id, name, size), for "Download all (ZIP)". Same query as the list. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const auth = await requireCandidateAccess(params.get("orgId"));
  if (auth.error) return auth.error;
  const limited = rateLimited("resume-export", auth.user.id, RESUME_EXPORT_RATE_LIMIT);
  if (limited) return limited;
  try {
    return NextResponse.json(await resumeManifest(auth.admin, auth.orgId, parseResumeQuery(params)));
  } catch (error) {
    return errorResponse(error, "Couldn't list the resumes");
  }
}
