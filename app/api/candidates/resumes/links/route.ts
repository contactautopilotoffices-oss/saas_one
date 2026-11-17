import { NextResponse } from "next/server";

import { RESUME_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { resumeLinks, resumeStorage } from "@/backend/lib/candidates/resumes";

import { errorResponse, rateLimited, readJson, requireCandidateAccess } from "../../_lib/auth";

export const runtime = "nodejs";

/** Short-lived download links for up to 100 files: { orgId, ids }. Used by "Download all (ZIP)". */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("resumes", auth.user.id, RESUME_RATE_LIMIT);
  if (limited) return limited;
  try {
    return NextResponse.json(await resumeLinks(auth.admin, resumeStorage(auth.admin), auth.orgId, body.ids));
  } catch (error) {
    return errorResponse(error, "Couldn't make the download links");
  }
}
