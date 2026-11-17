import { NextResponse } from "next/server";

import { RESUME_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { listResumeFiles, parseResumeQuery, prepareResumeUploads, resumeStorage, uploaderName } from "@/backend/lib/candidates/resumes";

import { errorResponse, rateLimited, readJson, requireCandidateAccess } from "../_lib/auth";

export const runtime = "nodejs";

/** Stored resumes, newest download first. Query: orgId, from, to (ISO), q (file name), device, page, pageSize. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const auth = await requireCandidateAccess(params.get("orgId"));
  if (auth.error) return auth.error;
  const limited = rateLimited("resumes", auth.user.id, RESUME_RATE_LIMIT);
  if (limited) return limited;
  try {
    return NextResponse.json(await listResumeFiles(auth.admin, auth.orgId, parseResumeQuery(params)));
  } catch (error) {
    return errorResponse(error, "Couldn't load the resumes");
  }
}

/**
 * Prepare an upload batch: { orgId, files: [{ index, name, size, sha256, modifiedAt, folder }] }. Answers one
 * entry per file: an upload link, "duplicate" (already stored) or "rejected" with the reason. The browser then sends
 * the bytes straight to storage and calls /confirm. The files are filed under the signed-in person's name (owner
 * 2026-11-11): whatever the browser sends as `device` is ignored.
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("resumes", auth.user.id, RESUME_RATE_LIMIT);
  if (limited) return limited;
  try {
    const user = { id: auth.user.id, email: auth.user.email ?? null };
    const device = await uploaderName(auth.admin, user);
    return NextResponse.json(await prepareResumeUploads(auth.admin, resumeStorage(auth.admin), auth.orgId, user, { ...body, device }));
  } catch (error) {
    return errorResponse(error, "Couldn't prepare the upload");
  }
}
