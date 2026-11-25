import { NextResponse } from "next/server";

import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { removePersonData } from "@/backend/lib/candidates/privacy";

import { actorFor, errorResponse, rateLimited, readJson, requireCandidateAccess } from "../_lib/auth";

export const runtime = "nodejs";

/** Owner 2026-11-24: "remove this person's data" on their request. { orgId, candidateId, reason } → { records }. Audited. */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  try {
    return NextResponse.json(await removePersonData(auth.admin, auth.orgId, await actorFor(auth.admin, auth.user), body.candidateId, body.reason));
  } catch (error) {
    return errorResponse(error, "Couldn't remove the data");
  }
}
