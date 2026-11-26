import { NextResponse } from "next/server";

import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { defaultInterviewDeps, startInterviewRecording } from "@/backend/lib/candidates/interviews";

import { actorFor, errorResponse, rateLimited, readJson, requireCandidateAccess } from "../../_lib/auth";

export const runtime = "nodejs";

/**
 * "Record interview" on an in-person interview (owner 2026-11-19): { orgId, candidateId, interviewId }. Makes its
 * recording (the Meeting Assistant's recorder, HR space, not listed there) or hands back the one still going:
 * { meetingId, title }. The recording itself then runs through the Meeting Assistant's recorder routes.
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  try {
    const result = await startInterviewRecording(auth.admin, auth.orgId, await actorFor(auth.admin, auth.user), { candidateId: body.candidateId, interviewId: body.interviewId, analysisConsent: body.analysisConsent }, defaultInterviewDeps(new URL(request.url).origin));
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, "Couldn't start the recording");
  }
}
