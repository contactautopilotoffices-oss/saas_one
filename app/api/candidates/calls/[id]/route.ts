import { NextResponse } from "next/server";

import { callStorage, deleteCall, getCall, setCallRound } from "@/backend/lib/candidates/calls";
import { CALL_RATE_LIMIT } from "@/backend/lib/candidates/config";

import { errorResponse, rateLimited, readJson, requireCandidateAccess, UUID } from "../../_lib/auth";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

/** One call with its transcript and result (the Calls tab polls this while a call is being read). Query: orgId. */
export async function GET(request: Request, { params }: Params) {
  const auth = await requireCandidateAccess(new URL(request.url).searchParams.get("orgId"));
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return notFound();
  const limited = rateLimited("calls", auth.user.id, CALL_RATE_LIMIT);
  if (limited) return limited;
  try {
    return NextResponse.json({ call: await getCall(auth.admin, auth.orgId, id) });
  } catch (error) {
    return errorResponse(error, "Couldn't load the call");
  }
}

/** Remove the call: the row is kept marked deleted; the recording's bytes leave storage. Query: orgId. */
export async function DELETE(request: Request, { params }: Params) {
  const auth = await requireCandidateAccess(new URL(request.url).searchParams.get("orgId"));
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return notFound();
  const limited = rateLimited("calls", auth.user.id, CALL_RATE_LIMIT);
  if (limited) return limited;
  try {
    await deleteCall(auth.admin, callStorage(auth.admin), auth.orgId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, "Couldn't delete the call");
  }
}

/** Which round the call was for (owner 2026-11-17): { orgId, round }. The reading stays until HR reads it again. */
export async function PATCH(request: Request, { params }: Params) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return notFound();
  const limited = rateLimited("calls", auth.user.id, CALL_RATE_LIMIT);
  if (limited) return limited;
  try {
    return NextResponse.json({ call: await setCallRound(auth.admin, auth.orgId, id, body.round) });
  } catch (error) {
    return errorResponse(error, "Couldn't change the round");
  }
}
