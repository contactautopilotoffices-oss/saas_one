import { NextResponse } from "next/server";

import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { defaultFlowDeps, rescheduleInterview, setInterviewStatus, shareScorecard } from "@/backend/lib/candidates/hiring";

import { actorFor, errorResponse, rateLimited, readJson, requireCandidateAccess } from "../../_lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  try {
    return NextResponse.json(await shareScorecard(auth.admin, auth.orgId, body.scorecardId, body.action, defaultFlowDeps()), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error, "Could not share this scorecard."); }
}

/**
 * An interview's follow-up (owner 2026-11-21; spec Stage 6, T07, A12): { orgId, id, status: done | no_show | cancelled,
 * reason?, notify? }, or { orgId, id, reschedule: "2026-11-22T11:00", reason?, notify? }. Cancelling and moving tell the
 * candidate and the interviewers by email unless notify is false.
 */
export async function PATCH(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  try {
    const by = await actorFor(auth.admin, auth.user);
    const deps = defaultFlowDeps();
    if (typeof body.reschedule === "string") return NextResponse.json(await rescheduleInterview(auth.admin, auth.orgId, by, String(body.id), { at: body.reschedule, reason: body.reason, notify: body.notify }, deps));
    return NextResponse.json(await setInterviewStatus(auth.admin, auth.orgId, by, String(body.id), { status: body.status, reason: body.reason, notify: body.notify }, deps));
  } catch (error) {
    return errorResponse(error, "Couldn't update the interview");
  }
}
