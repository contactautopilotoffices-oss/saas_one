import { after, NextResponse } from "next/server";

import { runCallAnalysis } from "@/backend/lib/callInsights/pipeline";
import { callStorage, confirmCall } from "@/backend/lib/candidates/calls";
import { CALL_RATE_LIMIT } from "@/backend/lib/candidates/config";

import { actorFor, errorResponse, rateLimited, readJson, requireCandidateAccess, UUID } from "../../../_lib/auth";

export const runtime = "nodejs";
/** The recording is transcribed and read right after the response (after()): up to a minute or two for a long call. */
export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

/** The browser finished sending the recording: { orgId }. Checks the object arrived, logs the call, starts the pipeline. */
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
    const storage = callStorage(auth.admin);
    const call = await confirmCall(auth.admin, storage, auth.orgId, await actorFor(auth.admin, auth.user), id);
    if (call.status === "uploaded") after(() => runCallAnalysis(auth.admin, storage, auth.orgId, id));
    return NextResponse.json({ call });
  } catch (error) {
    return errorResponse(error, "Couldn't finish the upload");
  }
}
