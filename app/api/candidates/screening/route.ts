import { NextResponse } from "next/server";

import { screeningViews } from "@/backend/lib/candidates/screening";

import { errorResponse, readJson, requireCandidateAccess } from "../_lib/auth";

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

/** Reject old clients rather than sending candidate questionnaires. */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  return NextResponse.json({ error: "Screening questions are for internal HR use only." }, { status: 410 });
}
