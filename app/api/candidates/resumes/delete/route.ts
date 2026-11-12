import { NextResponse } from "next/server";

import { DANGER_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { deleteResumeFiles, resumeStorage } from "@/backend/lib/candidates/resumes";

import { errorResponse, rateLimited, readJson, requireCandidateAccess } from "../../_lib/auth";

export const runtime = "nodejs";

/** Deletes the ticked files (up to 200): { orgId, ids }. The stored bytes and the rows go; not undoable. */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("danger", auth.user.id, DANGER_RATE_LIMIT);
  if (limited) return limited;
  try {
    return NextResponse.json(await deleteResumeFiles(auth.admin, resumeStorage(auth.admin), auth.orgId, body.ids));
  } catch (error) {
    return errorResponse(error, "Couldn't delete the resumes");
  }
}
