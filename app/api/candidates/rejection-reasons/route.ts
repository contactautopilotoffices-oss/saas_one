import { NextResponse } from "next/server";

import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { loadRecruitmentConfig, saveRejectionReasons } from "@/backend/lib/candidates/requisitions";

import { actorFor, errorResponse, rateLimited, readJson, requireCandidateAccess } from "../_lib/auth";

export const runtime = "nodejs";

/*
 * The rejection reasons (owner 2026-11-21; spec: "reason required to reject", "which rejection reasons should appear in
 * the dropdown? A fixed list keeps the reports usable"). HR edits them in Recruitment -> Configurations.
 */

/** Query: orgId. { reasons }. */
export async function GET(request: Request) {
  const auth = await requireCandidateAccess(new URL(request.url).searchParams.get("orgId"));
  if (auth.error) return auth.error;
  try {
    return NextResponse.json({ reasons: (await loadRecruitmentConfig(auth.admin, auth.orgId)).rejectionReasons });
  } catch (error) {
    return errorResponse(error, "Couldn't load the rejection reasons");
  }
}

/** { orgId, reasons: string[] }. */
export async function PUT(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  try {
    return NextResponse.json({ reasons: await saveRejectionReasons(auth.admin, auth.orgId, { reasons: body.reasons }, await actorFor(auth.admin, auth.user)) });
  } catch (error) {
    return errorResponse(error, "Couldn't save the rejection reasons");
  }
}
