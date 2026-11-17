import { NextResponse } from "next/server";

import { RESUME_RATE_LIMIT, WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { dismissRepeat, listRepeats } from "@/backend/lib/candidates/resumes";

import { errorResponse, rateLimited, readJson, requireCandidateAccess } from "../../_lib/auth";

export const runtime = "nodejs";

/**
 * The same CV uploaded again by someone else (owner 2026-11-16). It is not stored twice; HR sees who uploaded it first
 * and who again. GET ?orgId= lists the open entries; POST { orgId, id } dismisses one.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const auth = await requireCandidateAccess(params.get("orgId"));
  if (auth.error) return auth.error;
  const limited = rateLimited("resumes", auth.user.id, RESUME_RATE_LIMIT);
  if (limited) return limited;
  try {
    return NextResponse.json(await listRepeats(auth.admin, auth.orgId));
  } catch (error) {
    return errorResponse(error, "Couldn't load the repeated uploads");
  }
}

export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  try {
    await dismissRepeat(auth.admin, auth.orgId, auth.user.id, body.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, "Couldn't dismiss the entry");
  }
}
