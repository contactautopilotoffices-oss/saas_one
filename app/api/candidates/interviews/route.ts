import { NextResponse } from "next/server";

import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { defaultInterviewDeps, listInterviews, scheduleInterview } from "@/backend/lib/candidates/interviews";
import { interviewsBetween } from "@/backend/lib/candidates/recruitment-dashboard";

import { actorFor, errorResponse, rateLimited, readJson, requireCandidateAccess, UUID } from "../_lib/auth";

export const runtime = "nodejs";

/**
 * Interviews (owner 2026-11-19). GET: the candidate's interviews, newest first, each with its video meeting's notes
 * once written (query: orgId, candidateId; or people=1 for the interviewers to pick from).
 * Owner 2026-11-25: or from + to (ISO instants, up to 42 days) for every interview in that span, for the calendar.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = url.searchParams;
  const auth = await requireCandidateAccess(params.get("orgId"));
  if (auth.error) return auth.error;
  try {
    if (params.get("people") === "1") return NextResponse.json({ people: await defaultInterviewDeps(url.origin).people() });
    const from = params.get("from");
    const to = params.get("to");
    if (from || to) {
      const span = [new Date(from ?? ""), new Date(to ?? "")];
      if (span.some((d) => Number.isNaN(d.getTime()))) return NextResponse.json({ error: "from and to must be dates" }, { status: 400 });
      return NextResponse.json({ interviews: await interviewsBetween(auth.admin, auth.orgId, span[0], span[1]) });
    }
    const candidateId = params.get("candidateId") ?? "";
    if (!UUID.test(candidateId)) return NextResponse.json({ error: "candidateId is required" }, { status: 400 });
    return NextResponse.json({ interviews: await listInterviews(auth.admin, auth.orgId, candidateId.toLowerCase(), defaultInterviewDeps(url.origin).appUrl) });
  } catch (error) {
    return errorResponse(error, "Couldn't load the interviews");
  }
}

/**
 * Schedule an interview: { orgId, applicationId, positionId, round, at ("2026-11-21T11:00", India time), mode
 * (online | hybrid | in_person), venue?, interviewerIds?, note?, moveTo?, notify: { whatsapp, email, interviewers } }.
 * Online and hybrid make the video meeting (one link). Invites go only where HR ticked; the reply says what went.
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  try {
    const fields = { ...body };
    delete fields.orgId;
    const result = await scheduleInterview(auth.admin, auth.orgId, await actorFor(auth.admin, auth.user), fields, defaultInterviewDeps(new URL(request.url).origin));
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, "Couldn't schedule the interview");
  }
}
