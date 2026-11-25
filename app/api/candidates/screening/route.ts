import { NextResponse } from "next/server";

import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { getRecord } from "@/backend/lib/candidates/records";
import { screeningViews, startScreening } from "@/backend/lib/candidates/screening";

import { actorFor, errorResponse, rateLimited, readJson, requireCandidateAccess, UUID } from "../_lib/auth";

export const runtime = "nodejs";

/*
 * The screening screen (owner 2026-11-24): on a candidate's Calls tab, the job description, the screening questions and
 * the answers for each position they are in; and "Send the screening questions" when they did not go on the move.
 */

/** Query: orgId, candidateId → { questions, views }. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const auth = await requireCandidateAccess(params.get("orgId"));
  if (auth.error) return auth.error;
  try {
    return NextResponse.json(await screeningViews(auth.admin, auth.orgId, params.get("candidateId")));
  } catch (error) {
    return errorResponse(error, "Couldn't load the screening");
  }
}

/** { orgId, applicationId, positionId } → sends the screening questions (once per person and position). */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  if (typeof body.applicationId !== "string" || !UUID.test(body.applicationId) || typeof body.positionId !== "string" || !UUID.test(body.positionId)) {
    return NextResponse.json({ error: "Pick the candidate and the position." }, { status: 400 });
  }
  try {
    const record = await getRecord(auth.admin, auth.orgId, body.applicationId);
    const { data: member } = await auth.admin.from("candidate_position_members").select("id").eq("organization_id", auth.orgId).eq("position_id", body.positionId).eq("candidate_id", record.candidateId).is("deleted_at", null).maybeSingle();
    if (!member) return NextResponse.json({ error: "This person is not in that position." }, { status: 400 });
    const result = await startScreening(auth.admin, auth.orgId, await actorFor(auth.admin, auth.user), {
      positionId: body.positionId, candidateId: record.candidateId, applicationId: record.id, memberId: (member as { id: string }).id,
    });
    return NextResponse.json({ result });
  } catch (error) {
    return errorResponse(error, "Couldn't send the screening questions");
  }
}
