import { after, NextResponse } from "next/server";

import { runCallAnalysis } from "@/backend/lib/callInsights/pipeline";
import { callStorage, retryCall } from "@/backend/lib/candidates/calls";
import { CALL_RATE_LIMIT } from "@/backend/lib/candidates/config";

import { errorResponse, rateLimited, readJson, requireCandidateAccess, UUID } from "../../../_lib/auth";

export const runtime = "nodejs";
export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

/** Read the call again: after a failure, a run that was cut off, or to re-read a finished call. Body: { orgId }. */
export async function POST(request: Request, { params }: Params) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const limited = rateLimited("calls", auth.user.id, CALL_RATE_LIMIT);
  if (limited) return limited;
  try {
    const call = await retryCall(auth.admin, auth.orgId, id);
    after(() => runCallAnalysis(auth.admin, callStorage(auth.admin), auth.orgId, id));
    return NextResponse.json({ call });
  } catch (error) {
    return errorResponse(error, "Couldn't retry the call");
  }
}
