import { after, NextResponse } from "next/server";

import { runCallAnalysis } from "@/backend/lib/callInsights/pipeline";
import { callStorage, listCalls, prepareCall } from "@/backend/lib/candidates/calls";
import { CALL_RATE_LIMIT } from "@/backend/lib/candidates/config";

import { actorFor, errorResponse, rateLimited, readJson, requireCandidateAccess, UUID } from "../_lib/auth";

export const runtime = "nodejs";
/** A pasted transcript is read right after the response (after()); the model call can take a minute. */
export const maxDuration = 120;

/** A candidate's calls, newest first (owner 2026-11-16). Query: orgId, candidateId. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const auth = await requireCandidateAccess(params.get("orgId"));
  if (auth.error) return auth.error;
  const candidateId = params.get("candidateId") ?? "";
  if (!UUID.test(candidateId)) return NextResponse.json({ error: "candidateId is required" }, { status: 400 });
  const limited = rateLimited("calls", auth.user.id, CALL_RATE_LIMIT);
  if (limited) return limited;
  try {
    return NextResponse.json({ calls: await listCalls(auth.admin, auth.orgId, candidateId.toLowerCase()) });
  } catch (error) {
    return errorResponse(error, "Couldn't load the calls");
  }
}

/**
 * Add a call: { orgId, applicationId, positionId?, calledOn?, consent, file: { name, size } } answers the row and a
 * one-time upload link (the browser sends the bytes, then calls /confirm); { orgId, applicationId, ..., transcript }
 * saves the transcript and starts reading it straight away.
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("calls", auth.user.id, CALL_RATE_LIMIT);
  if (limited) return limited;
  try {
    const storage = callStorage(auth.admin);
    const prepared = await prepareCall(auth.admin, storage, auth.orgId, await actorFor(auth.admin, auth.user), body);
    if (!prepared.upload) after(() => runCallAnalysis(auth.admin, storage, auth.orgId, prepared.call.id));
    return NextResponse.json(prepared);
  } catch (error) {
    return errorResponse(error, "Couldn't add the call");
  }
}
