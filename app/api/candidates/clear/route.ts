import { NextResponse } from "next/server";

import { CLEAR_ALL_CONFIRMATION, DANGER_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { clearAllCandidateData } from "@/backend/lib/candidates/sheets";

import { errorResponse, rateLimited, readJson, requireCandidateAccess } from "../_lib/auth";

export const runtime = "nodejs";

/**
 * "Clear all candidate data" (owner 2026-11-03): delete every sheet, record, person, uploaded row and AI fix log of
 * the organisation, for good. Body { orgId, confirm: "DELETE ALL" } — the typed confirmation is checked here too.
 * Search history is kept (it holds the questions asked, not candidate details).
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("danger", auth.user.id, DANGER_RATE_LIMIT);
  if (limited) return limited;
  if (body.confirm !== CLEAR_ALL_CONFIRMATION) {
    return NextResponse.json({ error: `Type ${CLEAR_ALL_CONFIRMATION} to confirm` }, { status: 400 });
  }
  try {
    const result = await clearAllCandidateData(auth.admin, auth.orgId);
    console.info(`[candidates] all candidate data of ${auth.orgId} cleared by ${auth.user.id}`, result);
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, "Couldn't clear the candidate data");
  }
}
